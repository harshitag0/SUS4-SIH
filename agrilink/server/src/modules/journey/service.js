import { User } from "../users/model.js";
import { Requirement } from "../requirements/model.js";
import { Bond } from "../bonds/model.js";
import { enrichMany } from "../requirements/routes.js";
import { expectedYield, committedTons, costInputs } from "../farmers/service.js";
import { alertsFor, currentWeather } from "../alerts/routes.js";
import { Certificate } from "../certificates/model.js";

/**
 * AI decision pipeline: one deal, end to end, across both modules.
 * All sources are queried CONCURRENTLY (Promise.allSettled); each stage then gets a status, an AI decision and the
 * next action for whoever is looking (farmer / buyer / operations). Stages run in sequence: a stage is "active" only
 * when the ones before it are satisfied, so the platform moves the deal forward one decision after another.
 */
const M2 = process.env.M2_API_URL || "http://127.0.0.1:8100/api/m2";
const SCORE = { done: 100, ok: 100, active: 75, pending: 60, warn: 45, bad: 10, skipped: 60 };
const BASE = { farmer: { m1: "/farmer", m2: "/farmer/ops" }, buyer: { m1: "/buyer", m2: "/buyer/ops" }, operations: { m1: "/ops", m2: "/ops/farm" } };

async function m2Get(path) {
  const res = await fetch(`${M2}${path}`, { headers: { "X-M2-Role": "admin", "X-M2-Actor": "agrilink-module1" }, signal: AbortSignal.timeout(6000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Module 2 ${res.status}`);
  return res.json();
}

async function timed(name, fn) {
  const t0 = Date.now();
  try { const value = await fn(); return { name, ok: true, ms: Date.now() - t0, value }; }
  catch (e) { return { name, ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 120) }; }
}

export async function buildJourney(a, viewer, { ml, chain, weather = currentWeather }) {
  const t0 = Date.now();
  const [reqt, farmer, bond] = await Promise.all([Requirement.findById(a.requirement), User.findById(a.farmer), a.bond ? Bond.findById(a.bond) : null]);

  // ---- every independent source at the same time
  const runs = await Promise.all([
    timed("Supply–Demand model", () => ml.outlook("Singapore")),
    timed("Price model", async () => (await enrichMany([reqt], ml, farmer.farm.district))[0]),
    timed("Cost & profit model", () => ml.costAnalysis(costInputs(farmer))),
    timed("Live weather + alerts", () => alertsFor(farmer, ml, weather)),
    timed("Farmer capacity", async () => ({ gradeA: expectedYield(farmer.farm).gradeATons, committed: await committedTons(farmer._id) })),
    timed("Blockchain (Polygon)", () => (chain ? chain.latest(a.agreementId) : Promise.resolve(null))),
    timed("Farm operations (Module 2)", () => m2Get(`/agreements/${encodeURIComponent(a.agreementId)}`)),
  ]);
  const src = Object.fromEntries(runs.map((r) => [r.name, r]));
  const val = (n) => (src[n]?.ok ? src[n].value : null);
  const outlook = val("Supply–Demand model"), deal = val("Price model"), cost = val("Cost & profit model");
  const wx = val("Live weather + alerts"), cap = val("Farmer capacity"), onChain = val("Blockchain (Polygon)"), m2 = val("Farm operations (Module 2)");
  const role = viewer.role, L = BASE[role] || BASE.operations;
  const iAm = (r) => role === r;
  const stages = [];
  const add = (s) => stages.push({ module: "AI", ...s });

  // 1. Demand
  const g = outlook?.by_grade?.find((x) => x.grade === a.terms.grade);
  add({ key: "demand", title: "Demand check", module: "AI · Supply–Demand", status: !g ? "pending" : g.need === "low" ? "warn" : "ok",
    summary: g ? `Singapore Grade ${a.terms.grade} need: ${g.need} · shortage ${Math.round(g.gap)} t of ${Math.round(g.demand)} t forecast` : "Model unavailable",
    decision: g ? (g.need === "low" ? "Oversupplied for this grade — keep volume small, consider local or processing." : "Export demand confirmed for this grade and season.") : null,
    action: role === "farmer" ? { label: "See demand", to: "/farmer/demand" } : null });

  // 2. Price
  const adv = deal?.advice;
  add({ key: "price", title: "Price decision", module: "AI · Price model", status: !adv ? "pending" : adv.decision === "accept" ? "ok" : adv.decision === "negotiate" ? "warn" : "bad",
    summary: adv ? `Offer ₹${deal.offerInr}/kg vs fair ₹${deal.forecastInr}/kg (${adv.week}) · local market ₹${adv.marketNetInr}/kg` : "Model unavailable",
    decision: adv ? ({ accept: "Fair or better for the delivery week — accept.", negotiate: `Below fair — counter at $${adv.counterOfferUsd}/kg.`, local_better: "Local market pays more — do not export at this price." })[adv.decision] : null,
    action: role === "farmer" ? { label: "Compare buyers", to: "/farmer/price" } : null });

  // 3. Profit
  const costKg = cost?.farm?.cost_per_kg;
  const margin = adv && costKg ? adv.farmerNetInr - costKg : null;
  add({ key: "profit", title: "Profit check", module: "AI · Cost model", status: margin == null ? "pending" : margin < 0 ? "bad" : margin < costKg * 0.2 ? "warn" : "ok",
    summary: margin != null ? `Farmer keeps ₹${adv.farmerNetInr}/kg vs growing cost ₹${Math.round(costKg)}/kg → ₹${Math.round(margin * a.terms.quantityTons * 1000).toLocaleString("en-IN")} on ${a.terms.quantityTons} t` : "Model unavailable",
    decision: margin == null ? null : margin < 0 ? "Loss-making — do not sign." : margin < costKg * 0.2 ? "Thin margin — negotiate before signing." : `Healthy margin (${Math.round((margin / adv.farmerNetInr) * 100)}%).`,
    action: role === "farmer" ? { label: "Cost & profit", to: "/farmer/profit" } : null });

  // 4. Pre-sign verdict (capacity + weather + the three above)
  const free = cap ? Math.max(0, cap.gradeA - cap.committed + (bond?.tons || 0)) : null;
  const severe = (wx?.alerts || []).filter((x) => x.severity === "high");
  const capStatus = free == null ? "pending" : a.terms.quantityTons > free ? "bad" : a.terms.quantityTons > free * 0.9 ? "warn" : "ok";
  const worst = [stages[0].status, stages[1].status, stages[2].status, capStatus, severe.length ? "warn" : "ok"].reduce((w, s) => (SCORE[s] < SCORE[w] ? s : w), "ok");
  add({ key: "verdict", title: "Pre-sign verdict", module: "AI · Decision engine", status: worst,
    summary: `Capacity ${a.terms.quantityTons} t of ${free?.toFixed?.(1) ?? "?"} t free · ${severe.length ? `${severe.map((x) => x.code).join(", ")} alert` : "no severe weather"}`,
    decision: worst === "ok" ? "All checks pass — safe to sign." : worst === "warn" ? "Sign only after addressing the warnings above." : "Not recommended in current form.",
    action: null });

  // 5. Agreement signatures
  const signed = a.signers.filter((s) => s.status === "signed").length;
  const mySigner = a.signers.find((s) => (s.role === "buyer" && iAm("buyer")) || (s.role === "farmer" && iAm("farmer")));
  add({ key: "agreement", title: "Digital agreement", module: "Module 1 · Agreements",
    status: signed === 2 ? "done" : a.status === "draft" ? "active" : "active",
    summary: a.status === "draft" ? "Draft — terms being completed" : `${signed}/2 signatures (OTP-verified e-sign)`,
    decision: signed === 2 ? "Both parties signed the exact same document." : a.status === "draft" ? "Complete terms and send for signature." : "Waiting for signatures.",
    action: a.status === "draft" && !iAm("operations") ? { label: "Complete terms", to: `/contracts/${a.agreementId}/edit` }
      : a.status === "pending_signature" && mySigner && mySigner.status !== "signed" ? { label: "Review & sign", to: `/contracts/${a.agreementId}/sign` } : { label: "Open agreement", to: `/contracts/${a.agreementId}` } });

  // 6. Blockchain
  const dbHash = a.chain?.docHash;
  const matches = onChain && dbHash && onChain.docHash.toLowerCase() === dbHash.toLowerCase();
  add({ key: "blockchain", title: "Blockchain proof", module: "Module 1 · Polygon PoS",
    status: a.chain?.status === "registered" ? (matches ? "done" : onChain === null && src["Blockchain (Polygon)"].ok ? "warn" : "done") : a.chain?.status === "failed" ? "bad" : "pending",
    summary: a.chain?.status === "registered" ? `Block ${a.chain.blockNumber} · ${matches ? "on-chain hash matches the signed PDF" : "re-check pending"}` : "Registered automatically when both have signed",
    decision: a.chain?.status === "registered" ? "Tamper-evident: any change to the PDF will fail verification." : null,
    action: a.chain?.status === "registered" ? { label: "Verify document", to: `/contracts/verify?id=${a.agreementId}` } : null });

  // 7. Handoff
  const h = a.module2?.status;
  add({ key: "handoff", title: "Handed to farm operations", module: "Module 1 → Module 2",
    status: m2 ? "done" : h === "failed" ? "bad" : h === "skipped" ? "skipped" : "pending",
    summary: m2 ? `Monitoring ${m2.quantity_kg} kg · grade ${m2.required_grade}+ · harvest ${String(m2.harvest_window?.start).slice(0, 10)} → ${String(m2.harvest_window?.end).slice(0, 10)}` : h === "failed" ? a.module2.error : h === "skipped" ? a.module2.reason : "Starts automatically after blockchain registration",
    decision: m2 ? "Quality monitoring, risk tracking and escrow now run automatically." : null, action: null });

  // 8–12 from Module 2
  const sup = m2?.supply, c0 = m2?.commitments?.[0], esc = m2?.escrow;
  const q = sup?.quality || {};
  const qStatus = !m2 ? "pending" : q.FAIL ? "bad" : (q.PASS || 0) === sup.farmers ? "done" : sup.missed_checks ? "warn" : "active";
  add({ key: "quality", title: "Quality monitoring", module: "Module 2 · AI vision + farmer doctor", status: qStatus,
    summary: m2 ? `Pass ${q.PASS || 0} · fail ${q.FAIL || 0} · awaiting doctor ${q.PENDING_DOCTOR || 0} · open photo checks ${sup.open_checks} · missed ${sup.missed_checks}` : "Starts after handoff",
    decision: !m2 ? null : q.FAIL ? "Below contract grade — intervention opened; doctor must verify the fix." : q.PENDING_DOCTOR ? "AI flagged fruit — farmer doctor visit decides the grade." : sup.open_checks ? "Photo check due — upload 3 daylight photos." : (q.PASS || 0) === sup.farmers ? "Contract grade confirmed for all farmers." : "Waiting for the first quality review.",
    action: !m2 ? null : role === "farmer" ? { label: "Upload photos", to: `${L.m2}/farmer` } : role === "operations" ? { label: "Quality reviews", to: `${L.m2}/reviews` } : { label: "Supply board", to: `${L.m2}/agreements/${a.agreementId}` } });

  const fill = sup?.fill_expected_pct;
  add({ key: "risk", title: "Risk & supply assurance", module: "Module 2 · Scenario lab", status: !m2 ? "pending" : fill < 95 ? "warn" : severe.length ? "warn" : "ok",
    summary: m2 ? `Expected supply ${Math.round(fill)}% of order${severe.length ? ` · live ${severe[0].code} alert` : ""}${m2.recovery_requests?.length ? ` · ${m2.recovery_requests.length} recovery request(s)` : ""}` : "Starts after handoff",
    decision: !m2 ? null : fill < 95 ? "Supply at risk — start supply recovery from FPOs outside the affected area." : severe.length ? "Severe weather ahead — harvest ripe fruit early, cover crates." : "Supply on track.",
    action: !m2 ? null : role === "operations" ? { label: fill < 95 ? "Start recovery" : "Risks & scenario lab", to: `${L.m2}/${fill < 95 ? "recovery" : "risks"}` } : role === "buyer" && fill < 95 ? { label: "Supply recovery", to: `${L.m2}/recovery` } : null });

  const st = m2?.status;
  add({ key: "harvest", title: "Harvest & lots", module: "Module 2 · FPO collection",
    status: !m2 ? "pending" : ["READY_FOR_DISPATCH", "FUNDED", "DISPATCHED", "RECEIVED", "COMPLETE"].includes(st) ? "done" : st === "HARVESTING" ? "active" : qStatus === "done" ? "active" : "pending",
    summary: m2 ? `${m2.lots?.length || 0} lot(s) · delivered ${sup.delivered_kg} kg of ${sup.order_kg} kg (${Math.round(sup.fill_delivered_pct)}%)` : "After quality passes",
    decision: !m2 ? null : st === "ACTIVE" && qStatus === "done" ? "Quality passed — open harvest and record graded lots." : st === "ACTIVE" ? "Harvest opens once quality passes." : st === "HARVESTING" ? "Record lots; below-grade fruit is diverted locally." : "Lots recorded with QR traceability.",
    action: role === "operations" && m2 ? { label: "Harvest plan", to: `${L.m2}/agreements/${a.agreementId}` } : null });

  // certification: every collected lot gets an AgriLink Quality Certificate (QR + blockchain) before dispatch
  const lotIds = (m2?.lots || []).map((l) => l.id);
  const certs = lotIds.length ? await Certificate.find({ lotId: { $in: lotIds } }) : [];
  const certified = lotIds.filter((id) => certs.some((c) => c.lotId === id && c.status === "issued"));
  const revokedAny = certs.some((c) => c.status === "revoked") && certified.length < lotIds.length;
  add({ key: "certification", title: "Quality certificate", module: "Module 1 · Certification + blockchain",
    status: !lotIds.length ? "pending" : certified.length === lotIds.length ? "done" : revokedAny ? "bad" : "active",
    summary: lotIds.length ? `${certified.length} of ${lotIds.length} lot(s) certified · QR verifiable by anyone` : "Issued per lot after collection",
    decision: !lotIds.length ? null : certified.length === lotIds.length ? "Every lot carries a verifiable quality certificate." : "Certify the remaining lots before dispatch.",
    action: !lotIds.length ? null : role === "operations" ? { label: certified.length === lotIds.length ? "Certificates" : "Certify lots", to: "/ops/certificates" }
      : certs.length ? { label: "View certificates", to: `${L.m1}/certificates` } : null });

  const es = esc?.status;
  add({ key: "escrow", title: "Escrow & delivery", module: "Module 2 · Escrow",
    status: !esc ? "pending" : es === "RELEASED" ? "done" : ["REFUNDED", "DISPUTED"].includes(es) ? "bad" : st === "READY_FOR_DISPATCH" ? "active" : ["FUNDED", "RECEIVED"].includes(es) ? "active" : "pending",
    summary: esc ? `${es} · paid to FPO ${esc.currency} ${Math.round(esc.paid_to_fpo).toLocaleString()} · held ${esc.currency} ${Math.round(esc.held).toLocaleString()}` : "Advance released at signing; balance on delivery",
    decision: !esc ? null : st === "READY_FOR_DISPATCH" ? "Ready for dispatch — buyer funds the balance into escrow." : es === "RECEIVED" ? "Goods received — buyer confirms or disputes within the window." : es === "RELEASED" ? "Paid in full." : es === "DISPUTED" ? "Disputed — surveyor decides origin vs transit." : "Balance is released after handover and buyer acceptance.",
    action: role === "buyer" && ["READY_FOR_DISPATCH", "RECEIVED"].includes(st) ? { label: st === "READY_FOR_DISPATCH" ? "Fund balance" : "Confirm receipt", to: `${L.m2}/agreements/${a.agreementId}` } : null });

  add({ key: "ratings", title: "Ratings & feedback", module: "Module 2 · Monthly ratings", status: st === "COMPLETE" ? "done" : "pending",
    summary: m2?.feedback?.length ? `${m2.feedback.length} review(s) recorded` : "After payment: two-way reviews feed next season's ranking",
    decision: st === "COMPLETE" ? "Ratings update monthly and drive next season's allocation." : null,
    action: m2 ? { label: "Ratings", to: `${L.m2}/ratings` } : null });

  // sequence: the current stage is the first one not finished; later stages wait
  const ORDER = ["demand", "price", "profit", "verdict", "agreement", "blockchain", "handoff", "quality", "risk", "harvest", "certification", "escrow", "ratings"];
  const isDone = (s) => ["done", "ok", "skipped"].includes(s.status);
  const current = stages.find((s) => s.key !== "risk" && !isDone(s) && s.status !== "pending") || stages.find((s) => !isDone(s));
  const next = stages.find((s) => s.action && ["active", "warn", "bad"].includes(s.status)) || current;
  const health = Math.round(stages.reduce((t, s) => t + SCORE[s.status], 0) / stages.length);
  stages.sort((x, y) => ORDER.indexOf(x.key) - ORDER.indexOf(y.key));

  return {
    agreementId: a.agreementId, version: a.version, buyer: a.parties.buyer.company, farmer: a.parties.seller.farmerName, fpo: a.parties.seller.fpo,
    product: `Alphonso Grade ${a.terms.grade}`, tons: a.terms.quantityTons, valueUsd: a.terms.totalValueUsd, deliveryDate: a.terms.deliveryDate,
    health, currentStage: current?.key, nextAction: next ? { stage: next.key, title: next.title, decision: next.decision, action: next.action } : null,
    stages,
    sources: runs.map(({ name, ok, ms, error }) => ({ name, ok, ms, error })),
    computedInMs: Date.now() - t0,
  };
}
