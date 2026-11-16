/**
 * seed-demo.js — Comprehensive demo seed for AgriLink presentation
 *
 * Seeds realistic Alphonso mango trade data:
 *   - 4 Singapore buyers with proper company names
 *   - 5 Konkan farmers with realistic farm profiles
 *   - 1 Operations user
 *   - 8 buyer requirements (realistic quantities & prices for 2027 season)
 *   - 6 bonds (farmer commitments) at various stages
 *   - 4 digital agreements (draft → signed → registered)
 *   - 3 quality certificates (issued, with lot traceability)
 *   - Crop stage assessments (4 stages completed for demo farmer)
 *   - Notifications for recent activity
 *
 * Run: cd server && node src/seed-demo.js
 */

import mongoose from "mongoose";
import crypto from "crypto";
import { env } from "./config/env.js";
import { User } from "./modules/users/model.js";
import { Requirement } from "./modules/requirements/model.js";
import { Bond } from "./modules/bonds/model.js";
import { Agreement } from "./modules/contracts/model.js";
import { Certificate } from "./modules/certificates/model.js";
import { Crop, StageAssessment } from "./modules/stages/model.js";
import { Notification } from "./modules/notifications/model.js";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const past = (d) => new Date(Date.now() - d * 86400000).toISOString();
const future = (d) => new Date(Date.now() + d * 86400000).toISOString();
const season = () => new Date().getFullYear();

await mongoose.connect(env.mongo);
console.log("Connected to MongoDB");

// ---- WIPE old demo data ----
await Promise.all([
  User.deleteMany({}),
  Requirement.deleteMany({}),
  Bond.deleteMany({}),
  Agreement.deleteMany({}),
  Certificate.deleteMany({}),
  Crop.deleteMany({}),
  StageAssessment.deleteMany({}),
  Notification.deleteMany({}),
]);
console.log("Cleared old data");

// ═══════════════════════════════════════════════════════════════════
// 1. USERS — Buyers (Singapore), Farmers (Konkan), Operations
// ═══════════════════════════════════════════════════════════════════

const buyers = await User.insertMany([
  { mobile: "6500000001", role: "buyer", name: "Tan Wei Lin", company: "FairPrice Fresh (Singapore)", lang: "en" },
  { mobile: "6500000002", role: "buyer", name: "Rajesh Iyer", company: "Mustafa Centre Imports", lang: "en" },
  { mobile: "6500000003", role: "buyer", name: "Ahmad Yusof", company: "Sheng Siong Wholesale Pte", lang: "en" },
  { mobile: "6500000004", role: "buyer", name: "Priya Menon", company: "Little India Traders LLP", lang: "en" },
]);
console.log(`Seeded ${buyers.length} buyers`);

const farmers = await User.insertMany([
  {
    mobile: "9876543210", role: "farmer", name: "Ramesh Sawant", lang: "mr",
    farm: { village: "Vijaydurg", district: "Sindhudurg", acres: 5, variety: "Alphonso", trees: 320, age: 18, irrigation: "drip", fpo: "Konkan Mango FPO" },
    costs: [{ year: season() - 1, components: { fertiliser: 42000, labour: 58000, pesticide: 18000, irrigation: 12000, transport: 15000, packaging: 22000 } }],
  },
  {
    mobile: "9876543211", role: "farmer", name: "Suresh Desai", lang: "mr",
    farm: { village: "Devgad", district: "Sindhudurg", acres: 8, variety: "Alphonso", trees: 520, age: 25, irrigation: "drip", fpo: "Konkan Mango FPO" },
    costs: [{ year: season() - 1, components: { fertiliser: 65000, labour: 82000, pesticide: 24000, irrigation: 18000, transport: 22000, packaging: 34000 } }],
  },
  {
    mobile: "9876543212", role: "farmer", name: "Anita Naik", lang: "hi",
    farm: { village: "Ratnagiri", district: "Ratnagiri", acres: 3, variety: "Alphonso", trees: 180, age: 12, irrigation: "well", fpo: "Ratnagiri Hapus Sanstha" },
    costs: [{ year: season() - 1, components: { fertiliser: 28000, labour: 35000, pesticide: 12000, irrigation: 8000, transport: 10000, packaging: 14000 } }],
  },
  {
    mobile: "9876543213", role: "farmer", name: "Ganesh Pawar", lang: "mr",
    farm: { village: "Lanja", district: "Ratnagiri", acres: 6, variety: "Alphonso", trees: 400, age: 20, irrigation: "drip", fpo: "Ratnagiri Hapus Sanstha" },
    costs: [{ year: season() - 1, components: { fertiliser: 52000, labour: 68000, pesticide: 20000, irrigation: 14000, transport: 18000, packaging: 28000 } }],
  },
  {
    mobile: "9876543214", role: "farmer", name: "Prashant Bhosale", lang: "mr",
    farm: { village: "Vengurla", district: "Sindhudurg", acres: 4, variety: "Alphonso", trees: 260, age: 15, irrigation: "drip", fpo: "Konkan Mango FPO" },
    costs: [{ year: season() - 1, components: { fertiliser: 36000, labour: 48000, pesticide: 15000, irrigation: 10000, transport: 13000, packaging: 18000 } }],
  },
]);
console.log(`Seeded ${farmers.length} farmers`);

const ops = await User.create({
  mobile: "9000000001", role: "operations", name: "AgriLink Operations", m2Role: "admin", m2Actor: "OPS-1", lang: "en",
});
console.log("Seeded operations user");

// ═══════════════════════════════════════════════════════════════════
// 2. REQUIREMENTS — Realistic Singapore import requirements
// ═══════════════════════════════════════════════════════════════════

const yr = season();
const reqs = await Requirement.insertMany([
  { buyer: buyers[0]._id, buyerName: "FairPrice Fresh (Singapore)", grade: "A", tons: 20, priceUsd: 5.20, floorUsd: 4.60, deliverBy: `${yr}-05-05`, escalation: { enabled: true, pct: 8 }, filled: 12, interested: 7 },
  { buyer: buyers[0]._id, buyerName: "FairPrice Fresh (Singapore)", grade: "A", tons: 10, priceUsd: 5.50, floorUsd: 5.00, deliverBy: `${yr}-04-25`, escalation: { enabled: true, pct: 5 }, filled: 10, interested: 5 },
  { buyer: buyers[1]._id, buyerName: "Mustafa Centre Imports", grade: "A", tons: 15, priceUsd: 6.00, floorUsd: 5.40, deliverBy: `${yr}-05-12`, escalation: { enabled: false, pct: 0 }, filled: 9, interested: 4 },
  { buyer: buyers[1]._id, buyerName: "Mustafa Centre Imports", grade: "B", tons: 8, priceUsd: 3.80, floorUsd: 3.20, deliverBy: `${yr}-05-15`, escalation: { enabled: true, pct: 6 }, filled: 5, interested: 3 },
  { buyer: buyers[2]._id, buyerName: "Sheng Siong Wholesale Pte", grade: "A", tons: 35, priceUsd: 4.80, floorUsd: 4.20, deliverBy: `${yr}-04-28`, escalation: { enabled: true, pct: 10 }, filled: 22, interested: 11 },
  { buyer: buyers[2]._id, buyerName: "Sheng Siong Wholesale Pte", grade: "B", tons: 18, priceUsd: 3.40, floorUsd: 2.80, deliverBy: `${yr}-05-10`, escalation: { enabled: false, pct: 0 }, filled: 12, interested: 6 },
  { buyer: buyers[3]._id, buyerName: "Little India Traders LLP", grade: "A", tons: 8, priceUsd: 5.80, floorUsd: 5.20, deliverBy: `${yr}-05-20`, escalation: { enabled: false, pct: 0 }, filled: 4, interested: 3 },
  { buyer: buyers[3]._id, buyerName: "Little India Traders LLP", grade: "A", tons: 5, priceUsd: 6.50, floorUsd: 6.00, deliverBy: `${yr}-05-08`, escalation: { enabled: true, pct: 12 }, filled: 5, interested: 2 },
]);
console.log(`Seeded ${reqs.length} buyer requirements`);

// ═══════════════════════════════════════════════════════════════════
// 3. BONDS — Farmer commitments at various stages
// ═══════════════════════════════════════════════════════════════════

const signHash = (terms, side, ts, prev) => sha(`${JSON.stringify(terms)}|${side}|${ts}|${prev || "genesis"}`);

const bondData = [
  { req: 0, buyer: 0, farmer: 0, grade: "A", tons: 4, priceUsd: 5.20, status: "active", deliverBy: `${yr}-05-05` },
  { req: 0, buyer: 0, farmer: 1, grade: "A", tons: 8, priceUsd: 5.20, status: "active", deliverBy: `${yr}-05-05` },
  { req: 2, buyer: 1, farmer: 0, grade: "A", tons: 3, priceUsd: 6.00, status: "active", deliverBy: `${yr}-05-12` },
  { req: 4, buyer: 2, farmer: 1, grade: "A", tons: 10, priceUsd: 4.80, status: "buyer_signed", deliverBy: `${yr}-04-28` },
  { req: 4, buyer: 2, farmer: 3, grade: "A", tons: 6, priceUsd: 4.80, status: "farmer_signed", deliverBy: `${yr}-04-28` },
  { req: 6, buyer: 3, farmer: 2, grade: "A", tons: 2, priceUsd: 5.80, status: "active", deliverBy: `${yr}-05-20` },
];

const bonds = [];
for (const b of bondData) {
  const terms = { grade: b.grade, tons: b.tons, priceUsd: b.priceUsd, deliverBy: b.deliverBy };
  const ts = past(30 - bonds.length * 3);
  const farmerTs = past(28 - bonds.length * 3);
  const sigs = {};
  if (["buyer_signed", "active"].includes(b.status)) sigs.buyer = { ts, prev: null, hash: signHash(terms, "buyer", ts, null) };
  if (["farmer_signed", "active"].includes(b.status)) sigs.farmer = { ts: farmerTs, prev: sigs.buyer?.hash || null, hash: signHash(terms, "farmer", farmerTs, sigs.buyer?.hash) };
  bonds.push(await Bond.create({
    requirement: reqs[b.req]._id, buyer: buyers[b.buyer]._id, farmer: farmers[b.farmer]._id,
    buyerName: buyers[b.buyer].company, farmerName: farmers[b.farmer].name,
    grade: b.grade, tons: b.tons, priceUsd: b.priceUsd, deliverBy: b.deliverBy,
    escalation: reqs[b.req].escalation, status: b.status, sigs,
  }));
}
console.log(`Seeded ${bonds.length} bonds`);

// ═══════════════════════════════════════════════════════════════════
// 4. AGREEMENTS — Digital trade agreements
// ═══════════════════════════════════════════════════════════════════

const agreements = [];
const aglIds = [`AGL-${yr}-00001`, `AGL-${yr}-00002`, `AGL-${yr}-00003`, `AGL-${yr}-00004`];
const agreementData = [
  { bond: 0, status: "registered", chainStatus: "registered" },
  { bond: 1, status: "signed", chainStatus: "not_registered" },
  { bond: 2, status: "pending_signature", chainStatus: "not_registered" },
  { bond: 5, status: "registered", chainStatus: "registered" },
];

for (let i = 0; i < agreementData.length; i++) {
  const ad = agreementData[i];
  const b = bonds[ad.bond];
  const buyer = buyers[bondData[ad.bond].buyer];
  const farmer = farmers[bondData[ad.bond].farmer];
  const ref = sha(aglIds[i]);
  const docHash = sha(`doc-${aglIds[i]}-v1`);

  const signers = [
    {
      role: "buyer", user: buyer._id, name: buyer.name, organisation: buyer.company,
      maskedMobile: buyer.mobile.replace(/.{6}/, "******"),
      status: ad.status === "draft" ? "pending" : "signed",
      identity: { method: "otp", verifiedAt: new Date(past(20 - i * 3)), provider: "agrilink" },
      signature: ad.status !== "draft" ? { type: "typed", typedName: buyer.name, signedAt: new Date(past(20 - i * 3)), signedDocHash: docHash } : undefined,
    },
    {
      role: "farmer", user: farmer._id, name: farmer.name, organisation: farmer.farm?.fpo || "",
      maskedMobile: farmer.mobile.replace(/.{6}/, "******"),
      status: ad.status === "pending_signature" ? "pending" : ad.status === "draft" ? "pending" : "signed",
      identity: ad.status !== "pending_signature" ? { method: "otp", verifiedAt: new Date(past(19 - i * 3)), provider: "agrilink" } : undefined,
      signature: !["draft", "pending_signature"].includes(ad.status) ? { type: "typed", typedName: farmer.name, signedAt: new Date(past(19 - i * 3)), signedDocHash: docHash } : undefined,
    },
  ];

  agreements.push(await Agreement.create({
    agreementId: aglIds[i], ref, bond: b._id, requirement: b.requirement,
    buyer: buyer._id, farmer: farmer._id, version: 1, status: ad.status,
    parties: {
      buyer: { name: buyer.name, company: buyer.company, mobile: buyer.mobile, country: "Singapore" },
      seller: { farmerName: farmer.name, fpo: farmer.farm?.fpo || "", mobile: farmer.mobile, village: farmer.farm?.village, district: farmer.farm?.district },
    },
    terms: {
      product: "Alphonso Mango", variety: "Alphonso", origin: `${farmer.farm?.district}, Maharashtra`,
      grade: b.grade, quantityTons: b.tons, pricePerKgUsd: b.priceUsd,
      totalValueUsd: b.tons * b.priceUsd * 1000,
      deliveryDate: b.deliverBy,
      paymentTerms: "50% advance on signing, 50% balance on verified delivery",
      advancePct: 50, qualityStandard: "AgriLink Grade A (≥300g, deep golden, ≤5% blemish)",
      packagingSpec: "Ventilated corrugated cartons, 4–6 kg per carton",
      shippingMode: "Air freight, cold chain 13°C",
      disputeResolution: "AgriLink mediation, then Sindhudurg District Court",
    },
    signers,
    documents: ad.status !== "draft" ? [{ version: 1, kind: ad.status === "pending_signature" ? "draft" : "signed", key: `agreements/${aglIds[i]}/v1.pdf`, sha256: docHash, size: 142500, createdAt: new Date(past(20 - i * 3)) }] : [],
    chain: {
      status: ad.chainStatus,
      ...(ad.chainStatus === "registered" ? { network: "Hardhat Local", chainId: 31337, contract: "0x5FbDB2315678afecb367f032d93F642f64180aa3", agreementRef: ref, docHash, version: 1, txHash: `0x${sha(`tx-${aglIds[i]}`).slice(0, 64)}`, blockNumber: 2 + i, registeredAt: new Date(past(18 - i * 3)) } : {}),
    },
    milestones: [
      { key: "created", at: new Date(past(22 - i * 3)), byRole: "system", byName: "AgriLink", note: "Agreement created from farmer commitment" },
      ...(ad.status !== "draft" ? [{ key: "buyer_signed", at: new Date(past(20 - i * 3)), byRole: "buyer", byName: buyer.name }] : []),
      ...(!["draft", "pending_signature"].includes(ad.status) ? [{ key: "farmer_signed", at: new Date(past(19 - i * 3)), byRole: "farmer", byName: farmer.name }] : []),
      ...(ad.chainStatus === "registered" ? [{ key: "registered", at: new Date(past(18 - i * 3)), byRole: "system", byName: "AgriLink", note: "SHA-256 registered on Polygon-compatible chain" }] : []),
    ],
    audit: [
      { at: new Date(past(22 - i * 3)), actorRole: "system", actorName: "AgriLink", action: "created", details: {}, prevHash: null, hash: sha(`audit-${aglIds[i]}-0`) },
    ],
  }));
}
console.log(`Seeded ${agreements.length} agreements`);

// ═══════════════════════════════════════════════════════════════════
// 5. CERTIFICATES — Quality certificates for completed lots
// ═══════════════════════════════════════════════════════════════════

const certs = await Certificate.insertMany([
  {
    certificateId: `CERT-${yr}-00001`, kind: "lot", lotId: `LOT-${yr}-0001`, agreementId: aglIds[0],
    buyer: { userId: buyers[0]._id, name: "FairPrice Fresh (Singapore)" },
    fpo: { id: "FPO-SDK", name: "Konkan Mango FPO" },
    product: { crop: "Mango", variety: "Alphonso", origin: "Sindhudurg, Maharashtra" },
    requiredGrade: "A", totalKg: 2200,
    gradeMix: { A: 1980, B: 220 },
    farmers: [
      { userId: farmers[0]._id, name: "Ramesh Sawant", kg: 1400, grade: "A", evidence: { photos: 6, doctor: true, review: "pass" } },
      { userId: farmers[4]._id, name: "Prashant Bhosale", kg: 800, grade: "A", evidence: { photos: 4, doctor: true, review: "pass" } },
    ],
    trace: { headHash: sha("trace-lot-1"), intact: true, events: 14, collectedAt: new Date(past(5)) },
    issuedAt: new Date(past(3)), validUntil: new Date(future(90)),
    issuedBy: { role: "operations", name: "AgriLink Operations", userId: ops._id },
    status: "issued",
    documents: [{ version: 1, kind: "certificate", key: `certs/CERT-${yr}-00001.pdf`, sha256: sha(`cert-1`), size: 98000, createdAt: new Date(past(3)) }],
    chain: { status: "registered", network: "Hardhat Local", chainId: 31337, txHash: `0x${sha("cert-tx-1").slice(0, 64)}`, blockNumber: 5 },
    audit: [{ at: new Date(past(3)), actorRole: "operations", actorName: "AgriLink Operations", action: "issued", details: {}, prevHash: null, hash: sha("cert-audit-1") }],
  },
  {
    certificateId: `CERT-${yr}-00002`, kind: "lot", lotId: `LOT-${yr}-0002`, agreementId: aglIds[3],
    buyer: { userId: buyers[3]._id, name: "Little India Traders LLP" },
    fpo: { id: "FPO-RTN", name: "Ratnagiri Hapus Sanstha" },
    product: { crop: "Mango", variety: "Alphonso", origin: "Ratnagiri, Maharashtra" },
    requiredGrade: "A", totalKg: 1500,
    gradeMix: { A: 1425, B: 75 },
    farmers: [
      { userId: farmers[2]._id, name: "Anita Naik", kg: 900, grade: "A", evidence: { photos: 5, doctor: true, review: "pass" } },
      { userId: farmers[3]._id, name: "Ganesh Pawar", kg: 600, grade: "A", evidence: { photos: 4, doctor: true, review: "pass" } },
    ],
    trace: { headHash: sha("trace-lot-2"), intact: true, events: 11, collectedAt: new Date(past(8)) },
    issuedAt: new Date(past(6)), validUntil: new Date(future(90)),
    issuedBy: { role: "operations", name: "AgriLink Operations", userId: ops._id },
    status: "issued",
    documents: [{ version: 1, kind: "certificate", key: `certs/CERT-${yr}-00002.pdf`, sha256: sha(`cert-2`), size: 95000, createdAt: new Date(past(6)) }],
    chain: { status: "registered", network: "Hardhat Local", chainId: 31337, txHash: `0x${sha("cert-tx-2").slice(0, 64)}`, blockNumber: 6 },
    audit: [{ at: new Date(past(6)), actorRole: "operations", actorName: "AgriLink Operations", action: "issued", details: {}, prevHash: null, hash: sha("cert-audit-2") }],
  },
  {
    certificateId: `CERT-${yr}-00003`, kind: "lot", lotId: `LOT-${yr}-0003`, agreementId: aglIds[1],
    buyer: { userId: buyers[0]._id, name: "FairPrice Fresh (Singapore)" },
    fpo: { id: "FPO-SDK", name: "Konkan Mango FPO" },
    product: { crop: "Mango", variety: "Alphonso", origin: "Sindhudurg, Maharashtra" },
    requiredGrade: "A", totalKg: 3200,
    gradeMix: { A: 3040, B: 160 },
    farmers: [
      { userId: farmers[1]._id, name: "Suresh Desai", kg: 2000, grade: "A", evidence: { photos: 8, doctor: true, review: "pass" } },
      { userId: farmers[0]._id, name: "Ramesh Sawant", kg: 1200, grade: "A", evidence: { photos: 5, doctor: true, review: "pass" } },
    ],
    trace: { headHash: sha("trace-lot-3"), intact: true, events: 18, collectedAt: new Date(past(2)) },
    issuedAt: new Date(past(1)), validUntil: new Date(future(90)),
    issuedBy: { role: "operations", name: "AgriLink Operations", userId: ops._id },
    status: "issued",
    documents: [{ version: 1, kind: "certificate", key: `certs/CERT-${yr}-00003.pdf`, sha256: sha(`cert-3`), size: 102000, createdAt: new Date(past(1)) }],
    chain: { status: "registered", network: "Hardhat Local", chainId: 31337, txHash: `0x${sha("cert-tx-3").slice(0, 64)}`, blockNumber: 7 },
    audit: [{ at: new Date(past(1)), actorRole: "operations", actorName: "AgriLink Operations", action: "issued", details: {}, prevHash: null, hash: sha("cert-audit-3") }],
  },
]);
console.log(`Seeded ${certs.length} certificates`);

// ═══════════════════════════════════════════════════════════════════
// 6. CROP STAGES — Assessments for demo farmer (Ramesh Sawant)
// ═══════════════════════════════════════════════════════════════════

const cropId = `CRP-${yr}-00001`;
await Crop.create({
  cropId, farmer: farmers[0]._id, m2FarmerId: `AGL-F-${farmers[0]._id}`,
  fpo: { id: "FPO-SDK", name: "Konkan Mango FPO" },
  variety: "Alphonso", season: yr, plot: "amrabavati orchard", trees: 320, district: "Sindhudurg",
  agreementId: aglIds[0], status: "active",
});

// A second crop for farmer 2
const cropId2 = `CRP-${yr}-00002`;
await Crop.create({
  cropId: cropId2, farmer: farmers[1]._id, m2FarmerId: `AGL-F-${farmers[1]._id}`,
  fpo: { id: "FPO-SDK", name: "Konkan Mango FPO" },
  variety: "Alphonso", season: yr, plot: "devgad estate", trees: 520, district: "Sindhudurg",
  agreementId: aglIds[1], status: "active",
});

const stageData = [
  {
    key: "seed_selection", name: "Seed Selection", order: 1, cropId,
    entries: { source_type: "Certified nursery", supplier: "Konkan Krishi Vidyapeeth", variety_confirmed: true, success_pct: 92 },
    report: { score: 95, pass: 3, warn: 0, fail: 0, checks: [
      { key: "certified_source", result: "pass", label: "Planting material from certified nursery" },
      { key: "variety_confirmed", result: "pass", label: "Variety confirmed by label" },
      { key: "success_rate", result: "pass", label: "Germination success 92%" },
    ]},
    status: "approved", daysBefore: 60,
  },
  {
    key: "sowing_planting", name: "Sowing and Planting", order: 2, cropId,
    entries: { planting_date: `${yr - 18}-06-15`, spacing_m: 10, pits_with_manure: true, irrigation: "Drip" },
    report: { score: 100, pass: 2, warn: 0, fail: 0, checks: [
      { key: "spacing", result: "pass", label: "Spacing 10m within 7-12m range" },
      { key: "pits", result: "pass", label: "Pits prepared with manure" },
    ]},
    status: "approved", daysBefore: 55,
  },
  {
    key: "crop_growth", name: "Crop Growth", order: 3, cropId,
    entries: { last_nutrient_date: `${yr}-01-10`, pest_pressure: "Low", disease_signs: false, irrigation_ok: true },
    report: { score: 88, pass: 3, warn: 1, fail: 0, checks: [
      { key: "pests", result: "pass", label: "No severe pest pressure" },
      { key: "disease", result: "pass", label: "No disease signs reported" },
      { key: "irrigation", result: "pass", label: "Irrigation on schedule" },
      { key: "plant_visible", result: "warn", label: "Vegetation 18% (above 15% minimum)" },
    ]},
    status: "approved", daysBefore: 40,
  },
  {
    key: "flowering_fruiting", name: "Flowering and Fruiting", order: 4, cropId,
    entries: { flowering_pct: 85, fruit_set: true, hopper_or_mildew: false, spray_log_kept: true },
    report: { score: 92, pass: 3, warn: 0, fail: 0, checks: [
      { key: "hopper", result: "pass", label: "No hopper/mildew reported" },
      { key: "spray_log", result: "pass", label: "Spray record kept" },
      { key: "fruit_blemish", result: "pass", label: "Developing fruit blemish 3% (within 10%)" },
    ]},
    status: "approved", daysBefore: 20,
  },
  {
    key: "harvesting", name: "Harvesting", order: 5, cropId,
    entries: { harvest_date: past(7).slice(0, 10), maturity_check: "Shoulders developed", harvest_time: "Early morning", with_stalk: true, quantity_kg: 2200 },
    report: { score: 96, pass: 4, warn: 0, fail: 0, checks: [
      { key: "maturity", result: "pass", label: "Maturity check used" },
      { key: "time", result: "pass", label: "Harvested early morning" },
      { key: "stalk", result: "pass", label: "Harvested with stalk" },
      { key: "blemish", result: "pass", label: "Blemish 2% (within 5%)" },
    ]},
    status: "approved", daysBefore: 7,
  },
];

for (const s of stageData) {
  const assId = `ASS-${yr}-${s.cropId.slice(-5)}-${s.key}`;
  const scertId = s.status === "approved" ? `SCERT-${yr}-${s.key}` : undefined;
  await StageAssessment.create({
    assessmentId: `ASS-${yr}-${s.cropId.slice(-5)}-${s.key}`,
    assessmentId: assId,
    cropId: s.cropId, farmer: farmers[0]._id, m2FarmerId: `AGL-F-${farmers[0]._id}`,
    fpoId: "FPO-SDK", stage: { key: s.key, name: s.name, order: s.order },
    version: 1, entries: s.entries, photos: [{ n: 1, key: `photos/${s.key}-1.jpg`, sha256: sha(`photo-${s.key}-1`), size: 285000, type: "image/jpeg" }],
    report: s.report, status: s.status,
    review: s.status === "approved" ? { decision: "approved", remarks: "Quality is as expected for this stage. Approved.", by: "Dr. Suhas Patil", byUser: ops._id, at: new Date(past(s.daysBefore - 1)) } : undefined,
    certificateId: s.status === "approved" ? `SCERT-${yr}-${s.key}` : undefined,
    certificateId: scertId,
    audit: [{ at: new Date(past(s.daysBefore)), actorRole: "farmer", actorName: "Ramesh Sawant", action: "submitted", details: {}, prevHash: null, hash: sha(`sa-${s.key}`) }],
  });

  if (scertId) {
    await Certificate.create({
      certificateId: scertId,
      kind: "stage",
      stage: { key: s.key, name: s.name, order: s.order },
      cropId: s.cropId,
      assessmentId: assId,
      buyer: { userId: buyers[0]._id, name: "FairPrice Fresh (Singapore)" },
      fpo: { id: "FPO-SDK", name: "Konkan Mango FPO" },
      product: { crop: "Mango", variety: "Alphonso", origin: "Sindhudurg, Maharashtra" },
      requiredGrade: "A", totalKg: 2200,
      gradeMix: { A: 2200 },
      farmers: [
        { userId: farmers[0]._id, name: "Ramesh Sawant", kg: 2200, grade: "A", evidence: { photos: 4, doctor: true, review: "pass" } },
      ],
      trace: { headHash: sha(`trace-stage-${s.key}`), intact: true, events: 5, collectedAt: new Date(past(s.daysBefore)) },
      issuedAt: new Date(past(s.daysBefore - 1)), validUntil: new Date(future(120)),
      issuedBy: { role: "operations", name: "AgriLink Operations", userId: ops._id },
      status: "issued",
      documents: [{ version: 1, kind: "certificate", key: `certs/${scertId}.pdf`, sha256: sha(`scert-${s.key}`), size: 85000, createdAt: new Date(past(s.daysBefore - 1)) }],
      chain: { status: "registered", network: "Hardhat Local", chainId: 31337, txHash: `0x${sha(`scert-tx-${s.key}`).slice(0, 64)}`, blockNumber: 8 },
      audit: [{ at: new Date(past(s.daysBefore - 1)), actorRole: "operations", actorName: "AgriLink Operations", action: "issued", details: {}, prevHash: null, hash: sha(`scert-audit-${s.key}`) }],
    });
  }
}
console.log(`Seeded ${stageData.length} stage assessments for farmer 1`);

// ALSO SEED 2027 CROP AND STAGES SO EITHER SEASON 2026 OR 2027 IS FULLY POPULATED!
const crop2027Id = `CRP-2027-00001`;
await Crop.create({
  cropId: crop2027Id, farmer: farmers[0]._id, m2FarmerId: `AGL-F-${farmers[0]._id}`,
  fpo: { id: "FPO-SDK", name: "Konkan Mango FPO" },
  variety: "Alphonso", season: 2027, plot: "amrabavati orchard", trees: 320, district: "Sindhudurg",
  agreementId: aglIds[0], status: "active",
});

for (const s of stageData) {
  const assId = `ASS-2027-00001-${s.key}`;
  const scertId = s.status === "approved" ? `SCERT-2027-${s.key}` : undefined;
  await StageAssessment.create({
    assessmentId: assId,
    cropId: crop2027Id, farmer: farmers[0]._id, m2FarmerId: `AGL-F-${farmers[0]._id}`,
    fpoId: "FPO-SDK", stage: { key: s.key, name: s.name, order: s.order },
    version: 1, entries: s.entries, photos: [{ n: 1, key: `photos/${s.key}-1.jpg`, sha256: sha(`photo-${s.key}-1-27`), size: 285000, type: "image/jpeg" }],
    report: s.report, status: s.status,
    review: s.status === "approved" ? { decision: "approved", remarks: "Quality is as expected for this stage. Approved.", by: "Dr. Suhas Patil", byUser: ops._id, at: new Date(past(s.daysBefore - 1)) } : undefined,
    certificateId: scertId,
    audit: [{ at: new Date(past(s.daysBefore)), actorRole: "farmer", actorName: "Ramesh Sawant", action: "submitted", details: {}, prevHash: null, hash: sha(`sa27-${s.key}`) }],
  });
}
console.log(`Seeded stage assessments and stage certificates for farmer 1 (2026 & 2027)`);

// Stages for farmer 2 (first 3 stages completed)
for (const s of stageData.slice(0, 3)) {
  await StageAssessment.create({
    assessmentId: `ASS-${yr}-${cropId2.slice(-5)}-${s.key}`,
    cropId: cropId2, farmer: farmers[1]._id, m2FarmerId: `AGL-F-${farmers[1]._id}`,
    fpoId: "FPO-SDK", stage: { key: s.key, name: s.name, order: s.order },
    version: 1, entries: s.entries, photos: [{ n: 1, key: `photos/${s.key}-2.jpg`, sha256: sha(`photo-${s.key}-2`), size: 290000, type: "image/jpeg" }],
    report: s.report, status: s.status,
    review: { decision: "approved", remarks: "Good condition. Approved.", by: "Dr. Suhas Patil", byUser: ops._id, at: new Date(past(s.daysBefore - 1)) },
    audit: [{ at: new Date(past(s.daysBefore)), actorRole: "farmer", actorName: "Suresh Desai", action: "submitted", details: {}, prevHash: null, hash: sha(`sa2-${s.key}`) }],
  });
}
console.log("Seeded 3 stage assessments for farmer 2");

// ═══════════════════════════════════════════════════════════════════
// 7. NOTIFICATIONS — Recent activity
// ═══════════════════════════════════════════════════════════════════

const notifs = [
  // For demo farmer (Ramesh)
  { user: farmers[0]._id, type: "req_new", data: { buyer: "FairPrice Fresh (Singapore)", grade: "A", tons: 20, priceUsd: 5.20 } },
  { user: farmers[0]._id, type: "req_new", data: { buyer: "Mustafa Centre Imports", grade: "A", tons: 15, priceUsd: 6.00 } },
  { user: farmers[0]._id, type: "bond_active", data: { buyer: "FairPrice Fresh (Singapore)", tons: 4 } },
  { user: farmers[0]._id, type: "bond_active", data: { buyer: "Mustafa Centre Imports", tons: 3 } },
  { user: farmers[0]._id, type: "weather", data: { code: "rain_heavy", district: "Sindhudurg" }, read: true },
  { user: farmers[0]._id, type: "n_stage_decision_approved", data: { stage: "Flowering and Fruiting" } },
  { user: farmers[0]._id, type: "n_stage_decision_approved", data: { stage: "Harvesting" } },
  // For buyer 1
  { user: buyers[0]._id, type: "bond_new", data: { farmer: "Ramesh Sawant", grade: "A", tons: 4 } },
  { user: buyers[0]._id, type: "bond_new", data: { farmer: "Suresh Desai", grade: "A", tons: 8 } },
  // For other farmers
  { user: farmers[1]._id, type: "req_new", data: { buyer: "FairPrice Fresh (Singapore)", grade: "A", tons: 20, priceUsd: 5.20 } },
  { user: farmers[1]._id, type: "bond_active", data: { buyer: "FairPrice Fresh (Singapore)", tons: 8 } },
  { user: farmers[2]._id, type: "req_new", data: { buyer: "Little India Traders LLP", grade: "A", tons: 8, priceUsd: 5.80 } },
  { user: farmers[2]._id, type: "bond_active", data: { buyer: "Little India Traders LLP", tons: 2 } },
];

await Notification.insertMany(notifs);
console.log(`Seeded ${notifs.length} notifications`);

// ═══════════════════════════════════════════════════════════════════
// DONE
// ═══════════════════════════════════════════════════════════════════

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║  ✅  Demo data seeded successfully!                         ║");
console.log("║                                                              ║");
console.log("║  Logins (OTP: 1234):                                        ║");
console.log("║  ─────────────────────────────────────────────               ║");
console.log("║  Farmer:  9876543210  (Ramesh Sawant, Sindhudurg)           ║");
console.log("║  Farmer:  9876543211  (Suresh Desai, Devgad)                ║");
console.log("║  Farmer:  9876543212  (Anita Naik, Ratnagiri)              ║");
console.log("║  Buyer:   6500000001  (FairPrice Fresh Singapore)           ║");
console.log("║  Buyer:   6500000002  (Mustafa Centre Imports)              ║");
console.log("║  Ops:     9000000001  (AgriLink Operations)                 ║");
console.log("║                                                              ║");
console.log("╚══════════════════════════════════════════════════════════════╝");

await mongoose.disconnect();
process.exit(0);

