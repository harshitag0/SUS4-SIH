import mongoose from "mongoose";
import { User } from "../users/model.js";

/**
 * Module 1 → Module 2 handoff (see module2/docs/INTEGRATION.md §5).
 * When a Module 1 agreement is fully signed and registered on-chain, AgriLink:
 *   1. syncs the shared entities into Module 2's reference collections (farmer, FPO, farmer doctor, buyer) —
 *      Module 1 owns them, Module 2 keeps copies with the SAME ids;
 *   2. POSTs the activated agreement to Module 2 (`POST /api/m2/agreements`, role `system`).
 * Module 2 then runs quality monitoring, farmer-doctor visits, risks, harvest, escrow tranche 2 and ratings.
 */
const M2_API = process.env.M2_API_URL || "http://127.0.0.1:8100/api/m2";
const M2_DB = process.env.M2_DB_NAME || "agrilink_m2";
const TALUKA = { Sindhudurg: "Devgad", Ratnagiri: "Ratnagiri", Raigad: "Alibag", Palghar: "Dahanu" };
const LANGUAGE = { en: "English", hi: "Hindi", mr: "Marathi" };

const slug = (s) => String(s || "FPO").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
export const m2Id = {
  farmer: (userId) => `AGL-F-${userId}`,
  buyer: (userId) => `AGL-B-${userId}`,
  fpo: (farm) => `AGL-FPO-${slug(farm.fpo || farm.village)}`,
};
const day = (d) => new Date(d).toISOString().slice(0, 10);

function m2Db() {
  return mongoose.connection.useDb(M2_DB, { useCache: true }).db;
}

export async function syncReference(farmer, buyer) {
  const db = m2Db();
  const f = farmer.farm;
  const fpoId = m2Id.fpo(f);
  const taluka = TALUKA[f.district] || f.district;
  const set = (coll, _id, doc, insertOnly = {}) =>
    db.collection(coll).updateOne({ _id }, { $set: { ...doc, source: "agrilink", synthetic: false }, $setOnInsert: insertOnly }, { upsert: true });
  await set("fpos", fpoId, { name: f.fpo || `${f.village} farmers group`, taluka, district: f.district, newly_formed: true, visit_interval_days: 7 },
    { registered_on: day(Date.now()), spare_capacity_kg: 0, capacity_posted_at: null });
  await set("farmer_doctors", `DOC-${fpoId}`, { name: `${f.fpo || f.village} farmer doctor`, fpo_id: fpoId, active: true });
  await set("farmers", m2Id.farmer(farmer._id), {
    name: farmer.name, fpo_id: fpoId, village: f.village, taluka, district: f.district,
    orchard_ha: +(Number(f.acres || 0) * 0.4047).toFixed(2), trees: f.trees, channel: "whatsapp",
    language: LANGUAGE[farmer.lang] || "Marathi", phone: `+91 ${farmer.mobile.slice(0, 2)}XXX XXX${farmer.mobile.slice(-2)}`, consent_recorded: true,
  }, { registered_at: new Date() });
  await set("buyers", m2Id.buyer(buyer._id), { name: buyer.company || buyer.name, country: "SG" });
  return { fpoId, farmerId: m2Id.farmer(farmer._id), buyerId: m2Id.buyer(buyer._id) };
}

/** Hand a registered agreement to Module 2. Returns a status object stored on the agreement. */
export async function handToModule2(a, fetchImpl = fetch) {
  if (!["A", "B"].includes(a.terms.grade)) return { status: "skipped", reason: "Module 2 monitors contract grades A and B only", at: new Date() };
  const [farmer, buyer] = await Promise.all([User.findById(a.farmer), User.findById(a.buyer)]);
  const ids = await syncReference(farmer, buyer);
  const deliver = new Date(a.terms.deliveryDate);
  const signedOn = a.signers.find((s) => s.role === "farmer")?.signature?.signedAt || new Date();
  const body = {
    id: a.agreementId, buyer_id: ids.buyerId, quantity_kg: Math.round(a.terms.quantityTons * 1000), required_grade: a.terms.grade,
    harvest_window_start: day(deliver.getTime() - 21 * 864e5), harvest_window_end: day(deliver.getTime() - 3 * 864e5), dispatch_deadline: day(deliver),
    contract_value: a.terms.totalValueUsd, currency: "USD", tranche1_released: true, source: "agrilink-module1",
    // Module 2 requires a signed commitment; in AgriLink it is the OTP-verified e-signature on the registered agreement.
    commitments: [{ farmer_id: ids.farmerId, committed_kg: Math.round(a.terms.quantityTons * 1000), signed_on: day(signedOn), signed_in_person: true }],
  };
  const res = await fetchImpl(`${M2_API}/agreements`, {
    method: "POST", headers: { "content-type": "application/json", "X-M2-Role": "system", "X-M2-Actor": "agrilink-module1" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  if (res.status === 409) return { status: "handed_over", at: new Date(), m2AgreementId: a.agreementId, note: "already received" };
  if (!res.ok) {
    const t = await res.text();
    return { status: "failed", at: new Date(), error: `Module 2 replied ${res.status}: ${t.slice(0, 200)}` };
  }
  return { status: "handed_over", at: new Date(), m2AgreementId: a.agreementId, ...ids };
}
