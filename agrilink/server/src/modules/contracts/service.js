import { HttpError } from "../../lib/http.js";
import { User } from "../users/model.js";
import { Bond } from "../bonds/model.js";
import { Requirement } from "../requirements/model.js";
import { Agreement } from "./model.js";
import { appendAudit, verifyAudit } from "./audit.js";
import { renderAgreementPdf } from "./pdf.js";
import { getProvider } from "./esign/index.js";
import { agreementRef } from "./chain.js";

/** Lifecycle: automatic steps + manual steps (who may record them). Manual steps must happen in this order. */
export const LIFECYCLE = [
  "created", "sent", "buyer_signed", "fpo_signed", "registered",
  "harvest_completed", "quality_inspected", "packing_completed", "shipment_dispatched", "goods_received", "payment_completed",
];
export const MANUAL = {
  harvest_completed: ["farmer"], quality_inspected: ["farmer", "buyer"], packing_completed: ["farmer"],
  shipment_dispatched: ["farmer"], goods_received: ["buyer"], payment_completed: ["buyer"],
};
const EDITABLE = ["quantityTons", "priceUsdPerKg", "qualitySpec", "packaging", "pickupLocation", "deliveryLocation", "deliveryDate",
  "inspection", "paymentMilestones", "rejectionTerms", "disputeTerms", "incoterm"];

const mask = (m) => (m ? `${m.slice(0, 2)}XXXXXX${m.slice(-2)}` : "");
const actorOf = (a, auth) => {
  const s = a.signers.find((x) => String(x.user) === String(auth.id));
  return { actorRole: auth.role, actorName: s?.name || auth.role };
};

const QUALITY = {
  A: "Grade A Alphonso: single fruit weight ≥ 300 g; skin ≥ 75% golden-yellow at dispatch ripeness stage; blemish ≤ 2% of surface; free from spongy tissue, sap burn, fruit fly and mechanical damage; TSS ≥ 18 °Brix at ripening; pesticide residues within Singapore Food Agency MRLs.",
  B: "Grade B Alphonso: single fruit weight 250–300 g; skin ≥ 60% golden-yellow; blemish ≤ 8% of surface; free from spongy tissue and fruit fly; pesticide residues within Singapore Food Agency MRLs.",
  C: "Grade C Alphonso: single fruit weight 200–250 g; minor blemishes allowed; free from rot and fruit fly; suitable for processing or value retail.",
};

export function defaultTerms(reqt, tons, farmer) {
  const price = reqt.priceUsd;
  return {
    product: "Fresh Alphonso mangoes (Hapus), GI-tagged Ratnagiri/Sindhudurg origin",
    variety: "Alphonso", grade: reqt.grade, quantityTons: tons, priceUsdPerKg: price, totalValueUsd: +(tons * 1000 * price).toFixed(2),
    currency: "USD", incoterm: "FOB Mumbai (air freight)",
    qualitySpec: QUALITY[reqt.grade] || QUALITY.A,
    packaging: "5-ply corrugated fibreboard cartons, 3 kg net (one dozen fruit), individual foam nets, ventilated; each carton labelled with lot QR code, grade, packhouse ID and pack date.",
    pickupLocation: `${farmer.farm.fpo || "FPO"} packhouse, ${farmer.farm.village}, ${farmer.farm.district}, Maharashtra, India`,
    deliveryLocation: "Changi Airfreight Centre, Singapore (importer's agent)",
    deliveryDate: reqt.deliverBy,
    inspection: "Pre-shipment inspection at the FPO packhouse by an AgriLink-approved inspector within 24 h of packing, sampling 5% of cartons per lot; photo-graded records attached. Arrival inspection by the buyer within 12 h of receipt. A lot is accepted if at least 95% of sampled fruit meets the grade specification.",
    // aligned with the farm-operations escrow: tranche 1 at signing, tranche 2 funded at dispatch, released on acceptance
    paymentMilestones: [
      { label: "Tranche 1 — advance released at signing", pct: 50 },
      { label: "Tranche 2 — funded into escrow at dispatch, released on buyer acceptance", pct: 50 },
    ],
    escalation: reqt.escalation,
    rejectionTerms: "Fruit failing the specification is re-graded and paid at the applicable lower-grade rate. The buyer must notify rejections within 24 h of receipt with photographic evidence and retain samples for joint inspection. No rejection after acceptance.",
    disputeTerms: "Good-faith negotiation for 7 days; then mediation through the FPO federation; failing which, arbitration administered by the Singapore International Arbitration Centre (SIAC), seat Singapore, language English. Recorded agreement hashes are admissible as evidence of the signed text.",
  };
}

export async function nextAgreementId() {
  const y = new Date().getFullYear();
  const n = await Agreement.countDocuments({ agreementId: new RegExp(`^AGL-${y}-`) });
  return `AGL-${y}-${String(n + 1).padStart(5, "0")}`;
}

/** Create the draft agreement for a farmer's commitment (one agreement per bond). */
export async function createFromBond(bondId) {
  const existing = await Agreement.findOne({ bond: bondId });
  if (existing) return existing;
  const bond = await Bond.findById(bondId);
  const [buyer, farmer, reqt] = await Promise.all([User.findById(bond.buyer), User.findById(bond.farmer), Requirement.findById(bond.requirement)]);
  const a = new Agreement({
    agreementId: await nextAgreementId(), bond: bond._id, requirement: reqt._id, buyer: buyer._id, farmer: farmer._id,
    parties: {
      buyer: { company: buyer.company || buyer.name, contactName: buyer.name || buyer.company, country: "Singapore", maskedMobile: mask(buyer.mobile), address: "Singapore" },
      seller: { farmerName: farmer.name, fpo: farmer.farm.fpo || "—", village: farmer.farm.village, district: farmer.farm.district, maskedMobile: mask(farmer.mobile) },
    },
    terms: defaultTerms(reqt, bond.tons, farmer),
    signers: [
      { role: "buyer", user: buyer._id, name: buyer.name || buyer.company, organisation: buyer.company || "Buyer", maskedMobile: mask(buyer.mobile) },
      { role: "farmer", user: farmer._id, name: farmer.name, organisation: farmer.farm.fpo || "Individual farmer", maskedMobile: mask(farmer.mobile) },
    ],
  });
  a.ref = agreementRef(a.agreementId);
  addMilestone(a, "created", { actorRole: "system", actorName: "AgriLink" });
  appendAudit(a, { actorRole: "farmer", actorName: farmer.name, action: "agreement_created", details: { agreementId: a.agreementId, bondId: String(bond._id), tons: bond.tons } });
  await a.save();
  return a;
}

function addMilestone(a, key, actor, note) {
  a.milestones.push({ key, at: new Date(), byRole: actor.actorRole, byName: actor.actorName, note });
  appendAudit(a, { ...actor, action: `milestone:${key}`, details: note ? { note } : null });
}

/** Parties can read and act; operations staff can read every agreement (read-only) to run farm operations. */
export async function loadFor(id, auth, { read = false } = {}) {
  const a = await Agreement.findOne({ agreementId: id });
  const ok = a && ([String(a.buyer), String(a.farmer)].includes(String(auth.id)) || (read && auth.role === "operations"));
  if (!ok) throw new HttpError(404, "Agreement not found", "not_found");
  return a;
}

export function updateTerms(a, auth, patch) {
  if (a.status !== "draft") throw new HttpError(409, "Only draft agreements can be edited — create an amendment instead", "not_draft");
  const changed = [];
  const terms = { ...a.terms };
  for (const k of EDITABLE) {
    if (patch[k] === undefined) continue;
    terms[k] = patch[k];
    changed.push(k);
  }
  if (terms.paymentMilestones && terms.paymentMilestones.reduce((s, m) => s + Number(m.pct || 0), 0) !== 100) {
    throw new HttpError(400, "Payment milestones must add up to 100%", "bad_milestones");
  }
  terms.quantityTons = Number(terms.quantityTons);
  terms.priceUsdPerKg = Number(terms.priceUsdPerKg);
  terms.totalValueUsd = +(terms.quantityTons * 1000 * terms.priceUsdPerKg).toFixed(2);
  a.terms = terms;
  a.markModified("terms");
  appendAudit(a, { ...actorOf(a, auth), action: "terms_updated", details: { fields: changed } });
}

export async function sendForSignature(a, auth, store) {
  if (a.status !== "draft") throw new HttpError(409, "Agreement is not a draft", "not_draft");
  const n = a.documents.filter((d) => d.version === a.version && d.kind === "draft").length + 1;
  const pdf = await renderAgreementPdf(a);
  const put = await store.putOnce(`${a.agreementId}/v${a.version}-draft-${n}.pdf`, pdf);
  a.documents.push({ version: a.version, kind: "draft", key: put.key, sha256: put.sha256, size: put.size, createdAt: new Date() });
  for (const s of a.signers) { s.status = "pending"; s.identity = undefined; s.signature = undefined; s.sentAt = new Date(); }
  a.status = "pending_signature";
  const actor = actorOf(a, auth);
  addMilestone(a, "sent", actor);
  appendAudit(a, { ...actor, action: "sent_for_signature", details: { draftSha256: put.sha256, provider: getProvider().name } });
  return put;
}

const currentDraft = (a) => [...a.documents].reverse().find((d) => d.version === a.version && d.kind === "draft");

export function startIdentity(a, auth) {
  if (a.status !== "pending_signature") throw new HttpError(409, "Agreement is not awaiting signatures", "not_pending");
  const s = a.signers.find((x) => x.role === auth.role);
  if (s.status === "signed") throw new HttpError(409, "Already signed", "already_signed");
  const out = getProvider().startIdentity(s);
  appendAudit(a, { ...actorOf(a, auth), action: "identity_otp_sent", details: { method: out.method, to: out.sentTo } });
  return out;
}

export function verifyIdentity(a, auth, otp) {
  const s = a.signers.find((x) => x.role === auth.role);
  getProvider().verifyIdentity(s, otp);
  appendAudit(a, { ...actorOf(a, auth), action: "identity_verified", details: { method: "mobile_otp" } });
}

/** Sign; when both parties have signed, produce the signed PDF and register its hash on-chain. */
export async function sign(a, auth, body, meta, { store, chain, onRegistered }) {
  if (a.status !== "pending_signature") throw new HttpError(409, "Agreement is not awaiting signatures", "not_pending");
  const s = a.signers.find((x) => x.role === auth.role);
  if (s.status === "signed") throw new HttpError(409, "Already signed", "already_signed");
  const draft = currentDraft(a);
  getProvider().sign(s, { ...body, ...meta, docHash: draft.sha256 });
  const actor = actorOf(a, auth);
  addMilestone(a, auth.role === "buyer" ? "buyer_signed" : "fpo_signed", actor);
  appendAudit(a, { ...actor, action: "signed", details: { certificateId: s.signature.certificateId, signedDocHash: draft.sha256 } });
  if (a.signers.every((x) => x.status === "signed")) await finalize(a, { store, chain, onRegistered });
}

export async function finalize(a, { store, chain, onRegistered }) {
  const draft = currentDraft(a);
  let signed = a.documents.find((d) => d.version === a.version && d.kind === "signed");
  if (!signed) {
    const pdf = await renderAgreementPdf(a, { signed: true, draftHash: draft.sha256 });
    const put = await store.putOnce(`${a.agreementId}/v${a.version}-signed.pdf`, pdf);
    signed = { version: a.version, kind: "signed", key: put.key, sha256: put.sha256, size: put.size, createdAt: new Date() };
    a.documents.push(signed);
    a.status = "signed";
    appendAudit(a, { actorRole: "system", actorName: "AgriLink", action: "signed_pdf_stored", details: { sha256: put.sha256, key: put.key, storage: "write-once versioned store" } });
  }
  await registerOnChain(a, signed, { chain, onRegistered });
}

export async function registerOnChain(a, signed, { chain, onRegistered }) {
  try {
    const rec = await chain.register(a.agreementId, signed.sha256, a.version);
    a.chain = rec;
    a.status = "registered";
    addMilestone(a, "registered", { actorRole: "system", actorName: "AgriLink" }, `${rec.network} · block ${rec.blockNumber}`);
    appendAudit(a, { actorRole: "system", actorName: "AgriLink", action: "registered_on_chain", details: { txHash: rec.txHash, blockNumber: rec.blockNumber, network: rec.network, docHash: rec.docHash } });
    if (onRegistered) await onRegistered(a);
  } catch (e) {
    a.chain = { ...(a.chain?.toObject?.() || {}), status: "failed", error: String(e.shortMessage || e.message).slice(0, 300) };
    appendAudit(a, { actorRole: "system", actorName: "AgriLink", action: "chain_registration_failed", details: { error: a.chain.error } });
  }
}

export function decline(a, auth, reason) {
  if (a.status !== "pending_signature") throw new HttpError(409, "Agreement is not awaiting signatures", "not_pending");
  const s = a.signers.find((x) => x.role === auth.role);
  if (s.status === "signed") throw new HttpError(409, "You already signed", "already_signed");
  s.status = "declined";
  a.status = "draft"; // back to draft for changes; a new draft must be sent and signed by both
  appendAudit(a, { ...actorOf(a, auth), action: "declined", details: { reason: reason || "" } });
}

/** Amendment: freeze the current version (incl. its signed PDF + chain record), open version n+1 for re-signing. */
export function amend(a, auth, changes, reason) {
  if (!["registered", "in_progress", "signed"].includes(a.status)) throw new HttpError(409, "Only signed agreements can be amended", "not_signed");
  if (!reason || reason.trim().length < 5) throw new HttpError(400, "Give a reason for the amendment", "reason_required");
  a.history.push({ version: a.version, terms: a.terms, signers: a.signers, documents: a.documents.filter((d) => d.version === a.version),
    chain: a.chain, supersededAt: new Date(), reason });
  const from = a.version;
  a.version += 1;
  a.amendmentOf = from;
  a.amendmentReason = reason;
  a.status = "draft";
  a.signers = a.signers.map((s) => ({ role: s.role, user: s.user, name: s.name, organisation: s.organisation, maskedMobile: s.maskedMobile, status: "pending" }));
  a.chain = { status: "not_registered" };
  updateTerms(a, auth, changes || {});
  appendAudit(a, { ...actorOf(a, auth), action: "amendment_created", details: { fromVersion: from, toVersion: a.version, reason } });
}

export function recordMilestone(a, auth, key, note) {
  if (!MANUAL[key]) throw new HttpError(400, "Unknown milestone", "bad_milestone");
  if (!MANUAL[key].includes(auth.role)) throw new HttpError(403, "Your role cannot record this milestone", "forbidden");
  if (!["registered", "in_progress"].includes(a.status)) throw new HttpError(409, "Milestones start after blockchain registration", "not_registered");
  const done = new Set(a.milestones.map((m) => m.key));
  if (done.has(key)) throw new HttpError(409, "Milestone already recorded", "duplicate");
  const order = Object.keys(MANUAL);
  const missing = order.slice(0, order.indexOf(key)).find((k) => !done.has(k));
  if (missing) throw new HttpError(409, `Record "${missing}" first`, "out_of_order");
  addMilestone(a, key, actorOf(a, auth), note);
  a.status = key === "payment_completed" ? "completed" : "in_progress";
}

export function raiseDispute(a, auth, reason) {
  if (!reason || reason.trim().length < 5) throw new HttpError(400, "Describe the dispute", "reason_required");
  a.disputed = { open: true, reason, raisedBy: auth.role, at: new Date(), prevStatus: a.status };
  a.status = "disputed";
  appendAudit(a, { ...actorOf(a, auth), action: "dispute_raised", details: { reason } });
}

export function resolveDispute(a, auth, note) {
  if (a.status !== "disputed") throw new HttpError(409, "No open dispute", "no_dispute");
  const back = a.disputed?.prevStatus || "registered";
  a.disputed = { ...a.disputed, open: false };
  a.markModified("disputed");
  a.status = back;
  appendAudit(a, { ...actorOf(a, auth), action: "dispute_resolved", details: { note: note || "" } });
}

/** Verify a document hash against the chain. Only the hash is sent — the file never leaves the user's device. */
export async function verifyHash(sha, agreementId, chain) {
  const info = await chain.info();
  const hit = await chain.lookup(sha);
  if (hit) {
    const a = await Agreement.findOne({ ref: hit.agreementRef });
    const onChain = a ? await chain.getVersion(a.agreementId, hit.version) : null;
    const latest = a ? await chain.latest(a.agreementId) : null;
    const rec = a && (a.version === hit.version ? a.chain : a.history.find((v) => v.version === hit.version)?.chain);
    return {
      result: "verified", computedHash: "0x" + sha, agreementId: a?.agreementId, version: hit.version,
      isLatest: latest ? latest.version === hit.version : null, latestVersion: latest?.version,
      onChain: onChain && { docHash: onChain.docHash, prevDocHash: onChain.prevDocHash, registeredAt: onChain.registeredAt, registrar: onChain.registrar },
      tx: rec && { txHash: rec.txHash, blockNumber: rec.blockNumber }, network: info.network, chainId: info.chainId, contract: info.contract, explorer: info.explorer,
    };
  }
  let expected = null;
  if (agreementId) {
    const latest = await chain.latest(agreementId).catch(() => null);
    if (latest) expected = { agreementId, version: latest.version, docHash: latest.docHash, registeredAt: latest.registeredAt };
  }
  return { result: "mismatch", computedHash: "0x" + sha, expected, network: info.network, chainId: info.chainId, contract: info.contract };
}

export function stats(list, userId) {
  const by = (s) => list.filter((a) => s.includes(a.status)).length;
  const soon = Date.now() + 7 * 864e5;
  const attention = list.filter((a) => a.status === "disputed" || a.chain?.status === "failed"
    || (a.status === "pending_signature" && a.signers.some((s) => String(s.user) === String(userId) && s.status !== "signed"))
    || (["registered", "in_progress"].includes(a.status) && new Date(a.terms.deliveryDate).getTime() < soon && !a.milestones.some((m) => m.key === "shipment_dispatched")));
  return {
    total: list.length, awaiting: by(["pending_signature"]), signed: list.filter((a) => a.signers.every((s) => s.status === "signed")).length,
    verified: list.filter((a) => a.chain?.status === "registered").length, attention: attention.length,
    attentionIds: attention.map((a) => a.agreementId),
    contractValueUsd: list.reduce((s, a) => s + (a.terms?.totalValueUsd || 0), 0),
  };
}

export function publicView(a) {
  const o = a.toObject();
  delete o.__v;
  o.auditIntact = verifyAudit(a.audit).intact;
  return o;
}

/** After a local chain reset: re-register every recorded version in order. */
export async function reanchorAll(chain) {
  const list = await Agreement.find({ $or: [{ "chain.status": "registered" }, { "history.0": { $exists: true } }] }).sort({ createdAt: 1 });
  let n = 0;
  for (const a of list) {
    for (const h of a.history) {
      const doc = h.documents.find((d) => d.kind === "signed");
      if (!doc || h.chain?.status !== "registered") continue;
      h.chain = { ...(await chain.register(a.agreementId, doc.sha256, h.version)), reanchoredAt: new Date() };
      n++;
    }
    const doc = a.documents.find((d) => d.version === a.version && d.kind === "signed");
    if (doc && a.chain?.status === "registered") {
      a.chain = { ...(await chain.register(a.agreementId, doc.sha256, a.version)), reanchoredAt: new Date() };
      n++;
    }
    a.markModified("history");
    appendAudit(a, { actorRole: "system", actorName: "AgriLink", action: "reanchored_after_chain_reset", details: { network: a.chain?.network } });
    await a.save();
  }
  return n;
}
