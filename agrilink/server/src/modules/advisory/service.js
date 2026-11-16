import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { HttpError } from "../../lib/http.js";
import { createStore } from "../contracts/storage.js";
import { m2Id } from "../module2/handoff.js";
import { User } from "../users/model.js";
import { word } from "../messaging/templates.js";
import { detect, gather, plan } from "./engine.js";
import { PLAYBOOK, SENSITIVE } from "./knowledge.js";
import { localize } from "./localize.js";

/**
 * Continuous advisory lifecycle per farmer:
 *   inspection → gaps → recommendation (treatment-related ones wait for farmer-doctor approval) → sent to the farmer
 *   (in-app + WhatsApp/SMS in their language) → farmer acknowledges / completes with evidence / asks for help
 *   → farmer doctor verifies → new inspection → previous vs current comparison → recommendations updated.
 * Nothing is deleted: every recommendation keeps its event history; resolved and verified items stay as history.
 */
const DAY = 86400000;
const EVIDENCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../storage/advisory-evidence");
export const evidenceStore = (deps) => deps?.evidenceStore || createStore(process.env.ADVISORY_EVIDENCE_DIR || EVIDENCE_DIR);
const ACTIVE = ["pending_approval", "open", "acknowledged", "completed", "verified"];

const itemSchema = new mongoose.Schema({
  itemId: { type: String, index: true }, key: String, code: String, category: String, severity: String,
  cropId: String, agreementId: String, stage: { key: String, name: String },
  evidence: mongoose.Schema.Types.Mixed, reason: mongoose.Schema.Types.Mixed, notes: mongoose.Schema.Types.Mixed,
  timelineDays: Number, dueDate: Date, followUpDate: Date, followUpBy: String, sources: [String], ephemeral: Boolean,
  status: { type: String, enum: [...ACTIVE, "rejected", "resolved"], default: "open" },
  requiresApproval: Boolean,
  approval: { decision: String, by: String, at: Date, note: String },
  guidance: [{ _id: false, text: String, by: String, at: Date }],
  verification: { result: String, by: String, at: Date, note: String },
  assistance: [{ _id: false, at: Date, note: String, status: String, response: String, by: String }],
  farmerEvidence: [{ _id: false, n: Number, key: String, sha256: String, mime: String, note: String, at: Date }],
  comparisons: [{ _id: false, at: Date, metric: String, before: Number, after: Number, verdict: String }],
  events: [{ _id: false, at: Date, by: String, role: String, action: String, note: String }],
  previousItemId: String, firstSeenAt: Date, acknowledgedAt: Date, completedAt: Date, closedAt: Date,
}, { _id: false });

const advisorySchema = new mongoose.Schema({
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, index: true },
  fpoId: { type: String, index: true },
  generatedAt: Date, seasonNow: Date, sources: mongoose.Schema.Types.Mixed, specRows: mongoose.Schema.Types.Mixed, lastVisitHint: String,
  status: mongoose.Schema.Types.Mixed,          // crop / harvest / visit summary for the dashboard
  snapshots: [{ _id: false, at: Date, ref: String, kind: String, defect: Number, colour: Number, flags: [String], doctorGrade: String, review: String, compliance: Number }],
  items: [itemSchema],
}, { timestamps: true });
export const Advisory = mongoose.models.Advisory || mongoose.model("Advisory", advisorySchema);

const newId = () => `REC-${randomBytes(4).toString("hex").toUpperCase()}`;
const ev = (it, by, role, action, note) => { it.events = [...(it.events || []), { at: new Date(), by, role, action, note }]; };
const fmt = (d) => new Date(d).toLocaleDateString("en-GB");
const METRIC = { blemish_high: "defect", colour_low: "colour", fruit_fly: "flags", anthracnose: "flags", sap_burn: "flags" };

function snapshotOf(g, specRows) {
  const lastCheck = g.checks.filter((c) => c.cv).sort((a, b) => new Date(b.analysed_at) - new Date(a.analysed_at))[0];
  const lastVisit = g.visits.filter((v) => v.status === "COMPLETED" && v.finding).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0];
  // on equal times the farmer doctor's inspection wins over a photo check
  const cand = [lastVisit && { at: new Date(lastVisit.completed_at), ref: `visit:${lastVisit.id}`, kind: "doctor_visit" }, lastCheck && { at: new Date(lastCheck.analysed_at), ref: `check:${lastCheck.id}`, kind: "photo_check" }]
    .filter(Boolean).sort((a, b) => b.at - a.at)[0];
  if (!cand) return null;
  const rows = specRows.flatMap((s) => s.rows).filter((r) => r.ok !== null);
  return { ...cand, defect: lastCheck?.cv?.defect_pct ?? null, colour: lastCheck?.cv?.colour_score ?? null,
    flags: [...new Set([...(lastCheck?.cv?.flags || []), ...(lastVisit?.finding?.pest_signs || [])])], doctorGrade: lastVisit?.finding?.grade || null,
    review: specRows.flatMap((s) => s.rows).find((r) => r.key === "review")?.current || null,
    compliance: rows.length ? Math.round((rows.filter((r) => r.ok).length / rows.length) * 100) : null };
}

function verdict(metric, before, after) {
  if (before == null || after == null) return null;
  const d = after - before;
  if (metric === "defect") return d <= -1 ? "improved" : d >= 1 ? "worse" : "unchanged";
  if (metric === "colour") return d >= 0.03 ? "improved" : d <= -0.03 ? "worse" : "unchanged";
  return d < 0 ? "improved" : d > 0 ? "worse" : "unchanged";
}

function statusSummary(g, specRows) {
  const visits = g.visits.filter((v) => v.status === "SCHEDULED").map((v) => ({ id: v.id, at: v.due_at, doctor: v.doctor_name })).sort((a, b) => new Date(a.at) - new Date(b.at));
  const due = g.checks.filter((c) => ["DUE", "REMINDED", "RETAKE_REQUESTED"].includes(c.status)).map((c) => c.deadline).sort()[0] || null;
  const harvest = g.agreements.map((a) => {
    const cm = (a.commitments || []).find((c) => c.farmer_id === g.fid);
    const start = a.harvest_window?.start ? new Date(a.harvest_window.start) : null;
    const days = start ? Math.round((start - g.now) / DAY) : null;
    const ready = cm?.quality_status === "PASS";
    return { agreementId: a.id, windowStart: start, windowEnd: a.harvest_window?.end || null, days, quality: cm?.quality_status || null,
      state: !start ? "unknown" : ready ? (days <= 0 ? "harvest_now" : "ready") : days <= 14 ? "at_risk" : "not_yet" };
  });
  const crops = g.crops.map((c) => {
    const latest = g.assessments.filter((a) => a.cropId === c.cropId).sort((a, b) => (b.stage.order - a.stage.order) || (b.version - a.version))[0];
    return { cropId: c.cropId, variety: c.variety, season: c.season, plot: c.plot, stage: latest ? { name: latest.stage.name, status: latest.status, score: latest.report?.qualityScore ?? null } : null };
  });
  return { visits, nextPhotoCheck: due, harvest, crops };
}

/** Rebuild the farmer's advisory from the latest evidence. Keeps history; sends messages for what is new. */
export async function generate(userId, deps = {}) {
  const user = await User.findById(userId);
  if (!user || user.role !== "farmer") throw new HttpError(404, "Farmer not found", "not_found");
  const doc = (await Advisory.findOne({ farmer: user._id })) || new Advisory({ farmer: user._id, items: [], snapshots: [] });
  const g = await gather(user, deps);
  // The inspection most recently recorded through AgriLink counts as the latest when farm-operations timestamps tie
  // (the demo season clock is frozen). A visit with a genuinely later time still wins.
  const hint = deps.latestVisitId || doc.lastVisitHint;
  const hinted = hint && g.visits.find((v) => v.id === hint && v.completed_at);
  const maxDone = Math.max(0, ...g.visits.filter((v) => v.completed_at).map((v) => +new Date(v.completed_at)));
  if (hinted && +new Date(hinted.completed_at) === maxDone) g.visits = [hinted, ...g.visits.filter((v) => v !== hinted)];
  if (deps.latestVisitId) doc.lastVisitHint = deps.latestVisitId;
  const { gaps, specRows } = detect(g);
  const planned = plan(g, gaps);
  const items = doc.items.map((i) => (i.toObject ? i.toObject() : i)).map((i) => (i.itemId ? i : {   // records from the first advisory version
    ...i, itemId: newId(), status: i.status === "done" ? "completed" : i.status, events: i.events || [{ at: i.firstSeenAt || new Date(), by: "AgriLink", role: "system", action: "created" }] }));

  // new inspection result? compare with the previous one
  const snap = snapshotOf(g, specRows);
  const prevSnap = doc.snapshots?.[doc.snapshots.length - 1];
  const newInspection = snap && (!prevSnap || prevSnap.ref !== snap.ref);
  if (newInspection) doc.snapshots = [...(doc.snapshots || []), snap].slice(-40);

  const fresh = [], L = user.lang || "en";
  for (const p of planned) {
    const active = items.find((i) => i.key === p.key && ACTIVE.includes(i.status));
    const rejected = items.find((i) => i.key === p.key && i.status === "rejected" && !newInspection);
    if (rejected && !active) continue;                         // farmer doctor rejected it; wait for new evidence
    if (active) {
      if (active.status === "verified" && newInspection) {      // measure verified but the gap persists after re-inspection
        active.status = "resolved"; active.closedAt = new Date(); ev(active, "AgriLink", "system", "closed_gap_persists", "New inspection still shows the gap");
        const it = { ...p, itemId: newId(), previousItemId: active.itemId, status: p.code && SENSITIVE.has(p.code) ? "pending_approval" : "open",
          requiresApproval: SENSITIVE.has(p.code), firstSeenAt: g.now, events: [{ at: new Date(), by: "AgriLink", role: "system", action: "reopened_after_reinspection" }] };
        items.push(it); fresh.push(it);
        continue;
      }
      Object.assign(active, { evidence: p.evidence, reason: p.reason, notes: p.notes, severity: p.severity, followUpBy: active.followUpBy || p.followUpBy });
      continue;
    }
    const it = { ...p, itemId: newId(), status: SENSITIVE.has(p.code) ? "pending_approval" : "open", requiresApproval: SENSITIVE.has(p.code), firstSeenAt: g.now,
      events: [{ at: new Date(), by: "AgriLink", role: "system", action: SENSITIVE.has(p.code) ? "created_awaiting_approval" : "created" }] };
    items.push(it); fresh.push(it);
  }
  // gaps no longer detected
  for (const it of items.filter((i) => ACTIVE.includes(i.status) && !planned.some((p) => p.key === i.key))) {
    if (it.ephemeral) { it.status = "resolved"; it.closedAt = new Date(); ev(it, "AgriLink", "system", "expired"); continue; }
    if (it.status === "pending_approval") { it.status = "resolved"; it.closedAt = new Date(); ev(it, "AgriLink", "system", "resolved_before_approval"); continue; }
    it.status = "resolved"; it.closedAt = new Date(); ev(it, "AgriLink", "system", "resolved", newInspection ? "Latest inspection no longer shows this gap" : "Gap no longer detected");
  }
  // previous vs current inspection on the items it concerns
  const comparison = [];
  if (newInspection && prevSnap) {
    for (const metric of ["defect", "colour"]) {
      const v = verdict(metric, prevSnap[metric], snap[metric]);
      if (v) comparison.push({ at: snap.at, metric, before: prevSnap[metric], after: snap[metric], verdict: v });
    }
    const fv = verdict("flags", prevSnap.flags?.length ?? null, snap.flags?.length ?? null);
    if (fv) comparison.push({ at: snap.at, metric: "flags", before: prevSnap.flags.length, after: snap.flags.length, verdict: fv });
    for (const it of items) {
      const c = comparison.find((x) => x.metric === METRIC[it.code]);
      if (c && (ACTIVE.includes(it.status) || it.closedAt >= new Date(Date.now() - 60000))) it.comparisons = [...(it.comparisons || []), c];
    }
  }

  doc.set({ fpoId: user.farm ? m2Id.fpo(user.farm) : null, generatedAt: new Date(), seasonNow: g.now, sources: g.sources, specRows,
    status: statusSummary(g, specRows), items: items.slice(-250) });
  await doc.save();

  // ---- notifications (in-app + WhatsApp/SMS in the farmer's language)
  const m = deps.messenger;
  const visible = fresh.filter((f) => f.status === "open" && f.severity !== "low");
  if (visible.length && deps.notifier) {
    const top = localize(visible[0], L);
    await deps.notifier.toUsers([user._id], "advisory_new", { count: visible.length, problem: top.problem, severity: top.severity });
    deps.notifier.changed?.("advisory");
  }
  if (m) {
    for (const f of visible) {
      const t = localize(f, L);
      await m.dispatch(user, "new_recommendation", { problem: t.problem, action: t.action, due: fmt(f.dueDate) }, { source: { kind: "advisory", ref: f.itemId }, dedupeKey: `rec:${f.itemId}`,
        voiceText: [t.problem, t.reason, t.action, ...t.steps].filter(Boolean).join(". ") });
      if (f.code === "harvest_readiness") await m.dispatch(user, "harvest_readiness", { days: f.reason.params.days, status: f.reason.params.status }, { dedupeKey: `ready:${f.itemId}` });
    }
    const high = visible.filter((f) => f.severity === "high" && f.code !== "harvest_readiness");
    if (high.length) await m.dispatch(user, "quality_gap", { count: high.length, problem: localize(high[0], L).problem }, { dedupeKey: `gap:${high.map((h) => h.itemId).join(",")}`, channels: ["sms"] });
    if (newInspection && prevSnap) {
      const main = comparison.find((c) => c.metric === "defect") || comparison[0];
      const clean = snap.compliance === 100 && !(snap.flags || []).length && !visible.some((f) => f.severity === "high");
      const res = `${word(clean ? "meets" : "gaps", L)}${main ? ` (${word(main.verdict === "improved" ? "improved" : main.verdict === "worse" ? "worse" : "unchanged", L)})` : ""}`;
      await m.dispatch(user, "inspection_result", { result: res }, { dedupeKey: `insp:${snap.ref}` });
    }
  }
  return doc;
}

export async function forFarmer(userId, deps, { refresh = false } = {}) {
  let a = await Advisory.findOne({ farmer: userId });
  if (refresh || !a || Date.now() - new Date(a.generatedAt) > 60 * 60 * 1000) a = await generate(userId, deps);
  return a;
}

/** Localised view. Farmers do not see treatment steps until a farmer doctor approved them. */
export function present(a, lang, { role = "farmer" } = {}) {
  const items = (a.items || []).map((raw) => {
    const i = localize(raw.toObject ? raw.toObject() : raw, lang);
    if (role === "farmer" && i.status === "pending_approval") return { ...i, steps: [], action: null, expected: null, awaitingApproval: true };
    if (role === "farmer" && i.status === "rejected") return null;
    return i;
  }).filter(Boolean);
  const live = items.filter((i) => ["open", "acknowledged", "pending_approval"].includes(i.status));
  const rows = (a.specRows || []).flatMap((s) => s.rows).filter((r) => r.ok !== null);
  return {
    generatedAt: a.generatedAt, seasonNow: a.seasonNow, sources: a.sources, specRows: a.specRows, status: a.status, snapshots: a.snapshots || [],
    compliance: rows.length ? { score: Math.round((rows.filter((r) => r.ok).length / rows.length) * 100), measured: rows.length } : null,
    summary: { active: live.length, high: live.filter((i) => i.severity === "high").length, pendingActions: items.filter((i) => ["open"].includes(i.status)).length,
      completed: items.filter((i) => ["completed", "verified"].includes(i.status)).length, resolved: items.filter((i) => i.status === "resolved").length,
      awaitingApproval: items.filter((i) => i.status === "pending_approval").length },
    items,
  };
}

async function findItem(itemId) {
  const a = await Advisory.findOne({ "items.itemId": itemId });
  const it = a?.items.find((i) => i.itemId === itemId);
  if (!it) throw new HttpError(404, "Recommendation not found", "not_found");
  return { a, it };
}

/** Farmer: acknowledge, mark done (with optional note + photos), reopen, ask the farmer doctor for help. */
export async function farmerAction(userId, itemId, body, deps = {}) {
  const { a, it } = await findItem(itemId);
  if (String(a.farmer) !== String(userId)) throw new HttpError(404, "Recommendation not found", "not_found");
  const u = await User.findById(userId).select("name");
  const note = String(body.note || "").trim().slice(0, 500);
  if (body.action === "acknowledge") {
    if (it.status !== "open") throw new HttpError(409, "Only new recommendations can be acknowledged", "bad_state");
    it.status = "acknowledged"; it.acknowledgedAt = new Date(); ev(it, u.name, "farmer", "acknowledged", note);
  } else if (body.action === "complete") {
    if (!["open", "acknowledged"].includes(it.status)) throw new HttpError(409, "This recommendation cannot be completed now", "bad_state");
    const photos = Array.isArray(body.photos) ? body.photos.slice(0, 3) : [];
    const store = evidenceStore(deps);
    for (const [i, p] of photos.entries()) {
      const buf = Buffer.from(String(p.dataBase64 || "").replace(/^data:[^;]+;base64,/, ""), "base64");
      if (!(buf[0] === 0xff && buf[1] === 0xd8) && !(buf[0] === 0x89 && buf[1] === 0x50)) throw new HttpError(400, `Photo ${i + 1} must be JPEG or PNG`, "bad_photo");
      if (buf.length > 6 * 1024 * 1024) throw new HttpError(413, "Photo too large", "photo_too_large");
      const n = (it.farmerEvidence?.length || 0) + 1;
      const s = await store.putOnce(`${itemId}/${n}.${buf[0] === 0xff ? "jpg" : "png"}`, buf);
      it.farmerEvidence = [...(it.farmerEvidence || []), { n, key: s.key, sha256: s.sha256, mime: buf[0] === 0xff ? "image/jpeg" : "image/png", note, at: new Date() }];
    }
    it.status = "completed"; it.completedAt = new Date(); ev(it, u.name, "farmer", "completed", note || (photos.length ? `${photos.length} photo(s) as evidence` : ""));
  } else if (body.action === "reopen") {
    if (it.status !== "completed") throw new HttpError(409, "Only completed items can be reopened", "bad_state");
    it.status = "acknowledged"; ev(it, u.name, "farmer", "reopened", note);
  } else if (body.action === "request_help") {
    it.assistance = [...(it.assistance || []), { at: new Date(), note: note || "Farmer asked for help", status: "open" }];
    ev(it, u.name, "farmer", "requested_help", note);
    const doctors = await User.find({ role: "operations", m2Role: "doctor", m2Actor: `DOC-${a.fpoId}` }).select("_id");
    if (doctors.length) await deps.notifier?.toUsers?.(doctors.map((d) => d._id), "advisory_help", { itemId, farmer: u.name, problem: localize(it.toObject(), "en").problem });
  } else throw new HttpError(400, "Unknown action", "bad_action");
  a.markModified("items");
  await a.save();
  deps.notifier?.changed?.("advisory");
  return a;
}

/** Farmer doctor (consultant of the farmer's FPO) only. */
function assertDoctor(desk, a) {
  if (desk.role !== "doctor") throw new HttpError(403, "Only a farmer doctor (agronomist) can do this", "forbidden");
  if (desk.fpoId !== a.fpoId) throw new HttpError(403, "This farmer is not assigned to you", "forbidden");
}

export async function review(itemId, desk, body, deps = {}) {
  const { a, it } = await findItem(itemId);
  assertDoctor(desk, a);
  const note = String(body.note || "").trim().slice(0, 1000), guidance = String(body.guidance || "").trim().slice(0, 1500);
  if (body.decision === "approve") {
    if (it.status !== "pending_approval") throw new HttpError(409, "Only recommendations awaiting approval can be approved", "bad_state");
    it.status = "open"; it.approval = { decision: "approved", by: desk.name, at: new Date(), note };
    if (body.dueDate) it.dueDate = new Date(body.dueDate);
    if (body.followUpDate) it.followUpDate = new Date(body.followUpDate);
    if (guidance) it.guidance = [...(it.guidance || []), { text: guidance, by: desk.name, at: new Date() }];
    ev(it, desk.name, "agronomist", guidance || body.dueDate ? "approved_with_edits" : "approved", note || guidance);
  } else if (body.decision === "reject") {
    if (!["pending_approval", "open", "acknowledged"].includes(it.status)) throw new HttpError(409, "This recommendation cannot be rejected now", "bad_state");
    if (note.length < 5) throw new HttpError(400, "Give a reason for rejecting", "note_required");
    it.status = "rejected"; it.approval = { decision: "rejected", by: desk.name, at: new Date(), note }; it.closedAt = new Date();
    ev(it, desk.name, "agronomist", "rejected", note);
  } else if (body.decision === "guidance") {
    if (guidance.length < 5) throw new HttpError(400, "Write the guidance", "guidance_required");
    it.guidance = [...(it.guidance || []), { text: guidance, by: desk.name, at: new Date() }];
    if (body.dueDate) it.dueDate = new Date(body.dueDate);
    ev(it, desk.name, "agronomist", "added_guidance", guidance);
  } else throw new HttpError(400, "Unknown decision", "bad_decision");
  a.markModified("items");
  await a.save();
  if (body.decision === "approve" && deps.messenger) {
    const u = await User.findById(a.farmer);
    const t = localize(it.toObject(), u.lang || "en");
    await deps.messenger.dispatch(u, "new_recommendation", { problem: t.problem, action: t.action, due: fmt(it.dueDate) }, { source: { kind: "advisory", ref: it.itemId }, dedupeKey: `rec:${it.itemId}`,
      voiceText: [t.problem, t.action, ...t.steps].join(". ") });
    await deps.notifier?.toUsers?.([a.farmer], "advisory_new", { count: 1, problem: t.problem, severity: it.severity });
  }
  deps.notifier?.changed?.("advisory");
  return a;
}

export async function verify(itemId, desk, body, deps = {}) {
  const { a, it } = await findItem(itemId);
  assertDoctor(desk, a);
  if (it.status !== "completed") throw new HttpError(409, "Only actions the farmer marked completed can be verified", "bad_state");
  const result = body.result === "verified" ? "verified" : body.result === "not_effective" ? "not_effective" : null;
  if (!result) throw new HttpError(400, "Result must be verified or not_effective", "bad_result");
  const note = String(body.note || "").trim().slice(0, 1000);
  if (result === "not_effective" && note.length < 5) throw new HttpError(400, "Tell the farmer what is still needed", "note_required");
  it.verification = { result, by: desk.name, at: new Date(), note };
  it.status = result === "verified" ? "verified" : "acknowledged";
  ev(it, desk.name, "agronomist", result === "verified" ? "verified" : "not_effective", note);
  a.markModified("items");
  await a.save();
  if (deps.messenger) {
    const u = await User.findById(a.farmer);
    const t = localize(it.toObject(), u.lang || "en");
    await deps.messenger.dispatch(u, "action_verified", { problem: t.problem, result: word(result, u.lang || "en") }, { dedupeKey: `ver:${it.itemId}:${it.events.length}` });
  }
  deps.notifier?.changed?.("advisory");
  return a;
}

export async function answerHelp(itemId, desk, body, deps = {}) {
  const { a, it } = await findItem(itemId);
  assertDoctor(desk, a);
  const open = (it.assistance || []).find((x) => x.status === "open");
  if (!open) throw new HttpError(409, "No open help request", "bad_state");
  open.status = "answered"; open.response = String(body.response || "").trim().slice(0, 1000); open.by = desk.name;
  if (open.response) it.guidance = [...(it.guidance || []), { text: open.response, by: desk.name, at: new Date() }];
  ev(it, desk.name, "agronomist", "answered_help", open.response);
  a.markModified("items");
  await a.save();
  await deps.notifier?.toUsers?.([a.farmer], "advisory_help_answered", { itemId });
  deps.notifier?.changed?.("advisory");
  return a;
}

/** Reminders: due tomorrow, follow-up inspection soon, farmer-doctor visit soon. Each sent once. */
export async function runReminders(deps) {
  if (!deps.messenger) return 0;
  let n = 0;
  for (const a of await Advisory.find({})) {
    const u = await User.findById(a.farmer);
    if (!u) continue;
    const now = a.seasonNow ? new Date(a.seasonNow) : new Date(), L = u.lang || "en";
    for (const it of a.items.filter((i) => ["open", "acknowledged"].includes(i.status))) {
      const t = localize(it.toObject(), L);
      if (it.dueDate && it.dueDate - now <= DAY && it.dueDate >= now) n += (await deps.messenger.dispatch(u, "crop_care_reminder", { action: t.action, due: fmt(it.dueDate) }, { dedupeKey: `due:${it.itemId}` })).length;
      if (it.followUpDate && it.followUpDate - now <= 2 * DAY && it.followUpDate >= now) n += (await deps.messenger.dispatch(u, "reinspection_reminder", { date: fmt(it.followUpDate) }, { dedupeKey: `fu:${it.itemId}` })).length;
    }
    for (const v of a.status?.visits || []) {
      const at = new Date(v.at);
      if (at - now <= 2 * DAY && at >= now) n += (await deps.messenger.dispatch(u, "visit_upcoming", { date: fmt(at) }, { dedupeKey: `visit:${v.id}` })).length;
    }
  }
  return n;
}

export async function generateAll(deps) {
  const farmers = await User.find({ role: "farmer", farm: { $exists: true } }).select("_id");
  let n = 0;
  for (const f of farmers) { try { await generate(f._id, deps); n++; } catch { /* next farmer */ } }
  return n;
}

export { findItem, PLAYBOOK };
