import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "../../lib/http.js";
import { Agreement } from "../contracts/model.js";
import { appendAudit, verifyAudit } from "../contracts/audit.js";
import { createStore, sha256 } from "../contracts/storage.js";
import { User } from "../users/model.js";
import { Certificate } from "./model.js";
import { m2Get, userIdFrom } from "./m2.js";
import { renderCertificatePdf, renderRevocationPdf, renderStageCertificatePdf } from "./pdf.js";

/**
 * Crop Quality Certification & Traceability.
 * A certificate is issued for one collected lot after checking the evidence farm operations already holds
 * (quality review PASS, farmer-doctor inspection, AI photo checks, intact trace log). The PDF is stored write-once and
 * its SHA-256 is registered on the AgreementRegistry contract under the certificate id; revocation registers a notice
 * as version 2. Module 2 is only read.
 */
export const VALID_DAYS = 14;               // perishable fruit: certificate validity after issue
export const DOCTOR_MAX_AGE_DAYS = 30;      // farmer-doctor inspection must be this recent at collection
const DAY = 86400000;
const RANK = { A: 2, B: 1, REJECT: 0, C: 0 };
const meets = (g, req) => (RANK[g] ?? -1) >= (RANK[req] ?? 99);
const DEFAULT_STORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../storage/certificates");

// Module 2 may name the crop "Alphonso mango"; the variety is shown separately
const cropName = (c) => (!c || /mango/i.test(c) ? "Mango" : c);

export const verifyUrl = (id) => `${(process.env.PUBLIC_APP_URL || "http://localhost:5173").replace(/\/$/, "")}/verify/${id}`;
export const certStore = (deps) => deps?.store || createStore(process.env.CERT_STORE_DIR || DEFAULT_STORE);

async function seasonNow() {
  try { const c = await m2Get("/system/clock"); return c?.now ? new Date(c.now) : new Date(); } catch { return new Date(); }
}

const latest = (list, pred, key) => (list || []).filter(pred).sort((a, b) => new Date(b[key]) - new Date(a[key]))[0] || null;

/** Everything farm operations knows about a lot, gathered in parallel. */
export async function gatherLot(lotId) {
  const trace = await m2Get(`/trace/lots/${encodeURIComponent(lotId)}`);
  if (!trace) return null;
  const { lot } = trace;
  const agr = await m2Get(`/agreements/${encodeURIComponent(lot.agreement_id)}`);
  const farmers = await Promise.all(lot.contributions.map(async (c) => {
    const [reviews, visits, checks] = await Promise.all([
      m2Get("/quality-reviews", { farmer_id: c.farmer_id, agreement_id: lot.agreement_id }),
      m2Get("/doctor-visits", { farmer_id: c.farmer_id, status: "COMPLETED" }),
      m2Get("/quality-checks", { farmer_id: c.farmer_id, agreement_id: lot.agreement_id }),
    ]);
    const cm = (agr?.commitments || []).find((x) => x.id === c.commitment_id) || {};
    const review = latest(reviews, (r) => r.status === "PASS", "created_at");
    const visit = latest(visits, (v) => v.finding, "completed_at");
    const check = latest(checks, (q) => q.cv, "analysed_at");
    return {
      m2Id: c.farmer_id, name: c.farmer_name, kg: c.kg, grade: c.grade, qualityStatus: cm.quality_status, finalGrade: cm.final_grade,
      evidence: {
        review: review && { id: review.id, status: review.status, grade: review.final_grade, source: review.source, at: review.created_at },
        doctor: visit && { visitId: visit.id, grade: visit.finding.grade, doctor: visit.doctor_name, at: visit.completed_at, fruitInspected: visit.finding.fruit_inspected ?? null },
        photos: check && { checkId: check.id, grade: check.cv.grade_hint ?? null, defectPct: check.cv.defect_pct, colourScore: check.cv.colour_score,
          confidence: check.cv.confidence, model: check.cv.model, photos: (check.photos || []).length, at: check.analysed_at },
      },
    };
  }));
  return { trace, lot, agr, farmers };
}

/** Pre-issue checklist. Blocking checks must all pass; warnings are shown but do not block. */
export async function eligibility(lotId) {
  const g = await gatherLot(lotId);
  if (!g) throw new HttpError(404, "Lot not found in farm operations", "lot_not_found");
  const { lot, trace, agr, farmers } = g;
  const required = agr?.required_grade || trace.agreement?.required_grade;
  const collected = new Date(lot.collected_at);
  const active = await Certificate.findOne({ lotId, status: "issued", kind: { $ne: "stage" } });
  const m1 = await Agreement.findOne({ agreementId: lot.agreement_id });
  const checks = [];
  const add = (key, label, ok, detail, blocking = true) => checks.push({ key, label, ok, blocking, detail });

  add("not_certified", "Lot has no active certificate", !active, active ? `Already certified: ${active.certificateId}` : "No certificate yet");
  add("lot_status", "Lot is not disputed or rejected", !["DISPUTED", "REJECTED"].includes(lot.status), `Lot status ${lot.status}`);
  for (const f of farmers) {
    add(`quality:${f.m2Id}`, `${f.name}: quality review passed`, f.qualityStatus === "PASS" && !!f.evidence.review,
      f.evidence.review ? `PASS, grade ${f.evidence.review.grade}` : `Quality status ${f.qualityStatus || "unknown"}`);
    const d = f.evidence.doctor;
    const age = d ? (collected - new Date(d.at)) / DAY : null;
    add(`doctor:${f.m2Id}`, `${f.name}: farmer-doctor inspection`, !!d && meets(d.grade, required) && age <= DOCTOR_MAX_AGE_DAYS,
      d ? `Grade ${d.grade} on ${String(d.at).slice(0, 10)}${age > DOCTOR_MAX_AGE_DAYS ? ` (older than ${DOCTOR_MAX_AGE_DAYS} days)` : ""}` : "No inspection recorded");
    const p = f.evidence.photos;
    add(`photos:${f.m2Id}`, `${f.name}: AI photo check`, !!p, p ? `${p.photos} photo(s), AI grade ${p.grade ?? "—"}, blemish ${p.defectPct}%` : "No analysed photos", false);
  }
  add("trace", "Trace log intact", trace.chain?.ok === true, trace.chain?.ok ? `${trace.chain.checked} events verified` : `Broken at ${trace.chain?.broken_at}`);
  add("agreement", "Procurement agreement registered on blockchain", m1?.chain?.status === "registered",
    m1 ? `Agreement ${m1.agreementId}: ${m1.chain?.status || "not registered"}` : "Agreement not in AgriLink agreements", false);

  return {
    lotId, agreementId: lot.agreement_id, fpo: trace.fpo, buyer: agr?.buyer_name || trace.agreement?.buyer,
    product: { crop: cropName(trace.agreement?.crop), variety: trace.agreement?.variety || "Alphonso" },
    requiredGrade: required, totalKg: lot.total_kg, gradeMix: lot.grade_mix, collectedAt: lot.collected_at, lotStatus: lot.status,
    farmers: farmers.map(({ m2Id, name, kg, grade, evidence }) => ({ m2Id, name, kg, grade, evidence })),
    checks, eligible: checks.every((c) => c.ok || !c.blocking), existing: active?.certificateId || null,
    _gathered: g,
  };
}

async function nextId(year, code = "QC") {
  const prefix = `AGL-${code}-${year}-`;
  const last = await Certificate.findOne({ certificateId: { $regex: `^${prefix}` } }).sort({ certificateId: -1 });
  const n = last ? Number(last.certificateId.slice(prefix.length)) + 1 : 1;
  return prefix + String(n).padStart(5, "0");
}

async function opsActor(auth) {
  const u = await User.findById(auth.id);
  return { role: u?.m2Role || "admin", m2Actor: u?.m2Actor, name: u?.m2Role === "fpo" ? `FPO officer ${u.m2Actor}` : "AgriLink operations", userId: u?._id };
}

function canIssue(actor, fpoId) {
  if (actor.role === "admin") return;
  if (actor.role === "fpo" && actor.m2Actor === fpoId) return;
  throw new HttpError(403, "Only AgriLink operations or this lot's FPO can issue or revoke its certificate", "forbidden");
}

export async function issue(lotId, auth, { chain, store, notify }) {
  const e = await eligibility(lotId);
  const actor = await opsActor(auth);
  canIssue(actor, e._gathered.lot.fpo_id);
  if (!e.eligible) throw new HttpError(409, "Lot is not eligible for certification: " + e.checks.filter((c) => !c.ok && c.blocking).map((c) => c.label).join("; "), "not_eligible");
  const { lot, trace, agr, farmers } = e._gathered;

  const issuedAt = await seasonNow();
  const users = await User.find({ _id: { $in: farmers.map((f) => userIdFrom(f.m2Id, "AGL-F-")).filter((x) => /^[a-f0-9]{24}$/.test(x || "")) } }).select("_id");
  const known = new Set(users.map((u) => String(u._id)));
  const buyerUser = userIdFrom(agr?.buyer_id, "AGL-B-");
  const district = (await User.findOne({ _id: { $in: [...known] } }).select("farm"))?.farm?.district;

  let cert;
  for (let attempt = 0; attempt < 3 && !cert; attempt++) {
    const certificateId = await nextId(issuedAt.getUTCFullYear());
    try {
      cert = await Certificate.create({
        certificateId, lotId, agreementId: lot.agreement_id,
        buyer: { m2Id: agr?.buyer_id, userId: /^[a-f0-9]{24}$/.test(buyerUser || "") ? buyerUser : undefined, name: agr?.buyer_name || trace.agreement?.buyer },
        fpo: { id: lot.fpo_id, name: trace.fpo },
        product: { crop: cropName(trace.agreement?.crop), variety: trace.agreement?.variety || "Alphonso", origin: district ? `${district}, Konkan, Maharashtra` : "Konkan, Maharashtra" },
        requiredGrade: e.requiredGrade, totalKg: lot.total_kg, gradeMix: lot.grade_mix,
        farmers: farmers.map((f) => { const uid = userIdFrom(f.m2Id, "AGL-F-"); return { m2Id: f.m2Id, userId: known.has(uid) ? uid : undefined, name: f.name, kg: f.kg, grade: f.grade, evidence: f.evidence }; }),
        trace: { headHash: trace.chain?.head, intact: trace.chain?.ok, events: trace.events?.length || 0, collectedAt: lot.collected_at },
        issuedAt, validUntil: new Date(issuedAt.getTime() + VALID_DAYS * DAY),
        issuedBy: { role: actor.role, name: actor.name, userId: actor.userId },
        audit: [],
      });
    } catch (err) { if (err.code !== 11000) throw err; }
  }
  if (!cert) throw new HttpError(500, "Could not allocate a certificate number");

  const pdf = await renderCertificatePdf(cert, verifyUrl(cert.certificateId));
  const saved = await store.putOnce(`${cert.certificateId}/v1-certificate.pdf`, pdf);
  cert.documents.push({ version: 1, kind: "certificate", key: saved.key, sha256: saved.sha256, size: saved.size, createdAt: new Date() });
  appendAudit(cert, { actorRole: actor.role, actorName: actor.name, action: "issued", details: { lotId, sha256: saved.sha256, checks: e.checks.length } });
  await anchor(cert, chain, saved.sha256, 1, "chain");
  await cert.save();
  await notify?.(cert, "certificate_issued");
  return cert;
}

async function anchor(cert, chain, sha, version, field) {
  try {
    cert[field] = chain ? await chain.register(cert.certificateId, sha, version) : { status: "pending", error: "Blockchain not configured" };
    appendAudit(cert, { actorRole: "system", actorName: "AgriLink", action: version === 1 ? "registered_on_chain" : "revocation_on_chain", details: { txHash: cert[field].txHash, block: cert[field].blockNumber } });
  } catch (err) {
    cert[field] = { status: "failed", at: new Date(), error: String(err.shortMessage || err.message).slice(0, 200) };
    appendAudit(cert, { actorRole: "system", actorName: "AgriLink", action: "chain_failed", details: { error: cert[field].error } });
  }
  cert.markModified(field);
}

export async function retryChain(cert, { chain }) {
  if (cert.chain?.status === "registered" && (cert.status !== "revoked" || cert.revocationChain?.status === "registered")) return cert;
  const v1 = cert.documents.find((d) => d.version === 1);
  if (cert.chain?.status !== "registered") await anchor(cert, chain, v1.sha256, 1, "chain");
  const v2 = cert.documents.find((d) => d.version === 2);
  if (v2 && cert.chain?.status === "registered" && cert.revocationChain?.status !== "registered") await anchor(cert, chain, v2.sha256, 2, "revocationChain");
  await cert.save();
  return cert;
}

export async function revoke(cert, reason, auth, { chain, store, notify }) {
  if (cert.status === "revoked") throw new HttpError(409, "Certificate is already revoked", "already_revoked");
  const actor = await opsActor(auth);
  canIssue(actor, cert.fpo.id);
  const at = await seasonNow();
  const pdf = await renderRevocationPdf(cert, reason, at, verifyUrl(cert.certificateId));
  const saved = await store.putOnce(`${cert.certificateId}/v2-revocation.pdf`, pdf);
  cert.documents.push({ version: 2, kind: "revocation", key: saved.key, sha256: saved.sha256, size: saved.size, createdAt: new Date() });
  cert.status = "revoked";
  cert.revoked = { at, reason, by: actor.name };
  appendAudit(cert, { actorRole: actor.role, actorName: actor.name, action: "revoked", details: { reason, sha256: saved.sha256 } });
  if (cert.chain?.status === "registered") await anchor(cert, chain, saved.sha256, 2, "revocationChain");
  await cert.save();
  await notify?.(cert, "certificate_revoked");
  return cert;
}

/** Live status: revoked > expired > valid. Season time comes from farm operations. */
export async function statusOf(cert, now) {
  if (cert.status === "revoked") return "revoked";
  if (!cert.validUntil) return "valid";            // stage certificates record an approved stage and do not expire
  return (now || (await seasonNow())) > cert.validUntil ? "expired" : "valid";
}

/** Signed-in view (parties and operations). */
export async function view(cert) {
  return { ...cert.toObject(), liveStatus: await statusOf(cert), verifyUrl: verifyUrl(cert.certificateId), auditIntact: verifyAudit(cert.audit).intact };
}

/** Public view behind the QR code: no phone numbers, ids of people or internal notes. */
export async function publicView(cert) {
  const v1 = cert.documents.find((d) => d.version === 1);
  if (cert.kind === "stage") {
    const f = cert.farmers[0] || {};
    return {
      kind: "stage", certificateId: cert.certificateId, status: await statusOf(cert), issuedAt: cert.issuedAt,
      revoked: cert.status === "revoked" ? { at: cert.revoked.at, reason: cert.revoked.reason } : null,
      stage: cert.stage, cropId: cert.cropId, batchId: cert.batchId || null, agreementId: cert.agreementId || null,
      grower: f.name, fpo: cert.fpo.name, product: cert.product,
      assessment: { id: cert.assessmentId, qualityScore: f.evidence?.qualityScore ?? null, coverage: f.evidence?.coverage || null,
        consultant: f.evidence?.consultant || null, approvedAt: f.evidence?.approvedAt || null, remarks: f.evidence?.remarks || null,
        checks: f.evidence?.checks || [], notAssessable: f.evidence?.notAssessable || [] },
      issuedBy: cert.issuedBy?.name, document: v1 && { sha256: v1.sha256, size: v1.size },
      chain: cert.chain?.status === "registered" ? pick(cert.chain) : { status: cert.chain?.status || "pending" },
      revocationChain: cert.revocationChain?.status === "registered" ? pick(cert.revocationChain) : null,
    };
  }
  return {
    kind: "lot", certificateId: cert.certificateId, status: await statusOf(cert), issuedAt: cert.issuedAt, validUntil: cert.validUntil,
    revoked: cert.status === "revoked" ? { at: cert.revoked.at, reason: cert.revoked.reason } : null,
    lotId: cert.lotId, agreementId: cert.agreementId, buyer: cert.buyer.name, fpo: cert.fpo.name, product: cert.product,
    requiredGrade: cert.requiredGrade, totalKg: cert.totalKg, gradeMix: cert.gradeMix,
    growers: cert.farmers.map((f) => ({ name: f.name, kg: f.kg, grade: f.grade, doctorGrade: f.evidence?.doctor?.grade || null,
      doctorAt: f.evidence?.doctor?.at || null, photoGrade: f.evidence?.photos?.grade || null, photoChecks: f.evidence?.photos?.photos || 0 })),
    trace: cert.trace, issuedBy: cert.issuedBy?.name,
    document: v1 && { sha256: v1.sha256, size: v1.size },
    chain: cert.chain?.status === "registered" ? pick(cert.chain) : { status: cert.chain?.status || "pending" },
    revocationChain: cert.revocationChain?.status === "registered" ? pick(cert.revocationChain) : null,
  };
}
const pick = (c) => ({ status: c.status, network: c.network, chainId: c.chainId, contract: c.contract, txHash: c.txHash, blockNumber: c.blockNumber, registeredAt: c.registeredAt, docHash: c.docHash });

/** Does this file (by SHA-256) belong to a certificate, and does the blockchain agree? */
export async function verifyHash(hex, chain) {
  const cert = await Certificate.findOne({ "documents.sha256": hex });
  let onChain = null;
  if (chain) { try { onChain = await chain.lookup(hex); } catch { onChain = { error: "Blockchain not reachable" }; } }
  if (!cert) return { result: "unknown", onChain: !!(onChain && !onChain.error) };
  const doc = cert.documents.find((d) => d.sha256 === hex);
  return {
    result: doc.kind === "certificate" ? "verified" : "revocation_notice", certificateId: cert.certificateId,
    status: await statusOf(cert), version: doc.version, onChain: onChain ? !onChain.error : null, chainError: onChain?.error || null,
  };
}

/** Lots from farm operations with their certification state (operations desk). */
export async function lotsOverview(actor) {
  const agreements = (await m2Get("/agreements")) || [];
  const details = await Promise.all(agreements.map((a) => m2Get(`/agreements/${encodeURIComponent(a.id)}`)));
  const lots = details.filter(Boolean).flatMap((d) => (d.lots || []).map((l) => ({
    lotId: l.id, agreementId: d.id, buyer: d.buyer_name, fpoId: l.fpo_id, fpo: (d.fpos || []).find((f) => f.id === l.fpo_id)?.name || l.fpo_id,
    totalKg: l.total_kg, gradeMix: l.grade_mix, status: l.status, collectedAt: l.collected_at, growers: (l.contributions || []).length,
  })));
  const visible = actor.role === "fpo" ? lots.filter((l) => l.fpoId === actor.m2Actor) : lots;
  const certs = await Certificate.find({ lotId: { $in: visible.map((l) => l.lotId) }, kind: { $ne: "stage" } }).sort({ createdAt: -1 });
  return visible.map((l) => {
    const c = certs.find((x) => x.lotId === l.lotId && x.status === "issued") || certs.find((x) => x.lotId === l.lotId);
    return { ...l, certificate: c ? { certificateId: c.certificateId, status: c.status } : null };
  }).sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));
}

export { opsActor };

/**
 * Stage certificate: called only after an authorised consultant approved a stage assessment.
 * Same pipeline as lot certificates: PDF with QR -> write-once store -> SHA-256 on the registry -> audit -> notify.
 */
export async function issueStageCertificate({ assessment, crop, consultant, farmerName }, { chain, store, notify }) {
  if (assessment.status !== "approved") throw new HttpError(409, "Only an approved stage assessment can be certified", "not_approved");
  const existing = await Certificate.findOne({ assessmentId: assessment.assessmentId, status: "issued" });
  if (existing) return existing;
  const issuedAt = await seasonNow();
  const r = assessment.report || {};
  let buyer = { name: null };
  if (crop.agreementId) {
    const a = await Agreement.findOne({ agreementId: crop.agreementId });
    if (a) buyer = { userId: a.buyer, name: a.parties?.buyer?.company };
  }
  let cert;
  for (let attempt = 0; attempt < 3 && !cert; attempt++) {
    const certificateId = await nextId(issuedAt.getUTCFullYear(), "SC");
    try {
      cert = await Certificate.create({
        certificateId, kind: "stage", stage: assessment.stage, cropId: crop.cropId, assessmentId: assessment.assessmentId,
        batchId: assessment.batchId || undefined, agreementId: crop.agreementId || undefined,
        buyer, fpo: crop.fpo,
        product: { crop: "Mango", variety: crop.variety, origin: crop.district ? `${crop.district}, Konkan, Maharashtra` : "Konkan, Maharashtra" },
        farmers: [{ m2Id: crop.m2FarmerId, userId: crop.farmer, name: farmerName,
          evidence: { qualityScore: r.qualityScore, coverage: r.coverage, consultant: consultant.name, approvedAt: assessment.review.at,
            remarks: assessment.review.remarks, checks: (r.checks || []).map(({ label, source, status, value, expected }) => ({ label, source, status, value, expected })),
            notAssessable: r.notAssessable || [], photos: (assessment.photos || []).map((p) => p.sha256) } }],
        trace: { headHash: null, intact: null, events: 0, collectedAt: null },
        issuedAt, validUntil: null,
        issuedBy: { role: "doctor", name: consultant.name, userId: consultant.userId },
        audit: [],
      });
    } catch (err) { if (err.code !== 11000) throw err; }
  }
  if (!cert) throw new HttpError(500, "Could not allocate a certificate number");
  const pdf = await renderStageCertificatePdf(cert, verifyUrl(cert.certificateId));
  const saved = await store.putOnce(`${cert.certificateId}/v1-certificate.pdf`, pdf);
  cert.documents.push({ version: 1, kind: "certificate", key: saved.key, sha256: saved.sha256, size: saved.size, createdAt: new Date() });
  appendAudit(cert, { actorRole: "doctor", actorName: consultant.name, action: "issued", details: { assessmentId: assessment.assessmentId, stage: assessment.stage.key, sha256: saved.sha256 } });
  await anchor(cert, chain, saved.sha256, 1, "chain");
  await cert.save();
  await notify?.(cert, "certificate_issued");
  return cert;
}

/** Local chains lose state on restart: register every certificate (and revocation) again. */
export async function reanchorCertificates(chain) {
  let n = 0;
  for (const c of await Certificate.find({ "chain.status": "registered" })) {
    const v1 = c.documents.find((d) => d.version === 1);
    c.chain = { ...(await chain.register(c.certificateId, v1.sha256, 1)), reanchoredAt: new Date() };
    n++;
    const v2 = c.documents.find((d) => d.version === 2);
    if (v2 && c.revocationChain?.status === "registered") { c.revocationChain = { ...(await chain.register(c.certificateId, v2.sha256, 2)), reanchoredAt: new Date() }; n++; }
    c.markModified("chain"); c.markModified("revocationChain");
    appendAudit(c, { actorRole: "system", actorName: "AgriLink", action: "reanchored_after_chain_reset", details: null });
    await c.save();
  }
  return n;
}

export const storeFor = certStore;
export const _internal = { DEFAULT_STORE, sha256 };
