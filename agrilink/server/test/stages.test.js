// Stage-wise crop quality assessment: crop record, submission with photos, provisional AI report (never approved by
// itself), consultant review workflow and authorisation, stage certificate through the existing certificate pipeline,
// batch linking, AI outage handling and stage configuration.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";

const AID = "AGL-2027-00077";
let farmerM2 = "";
const FPO = "AGL-FPO-DEVGAD-GROWERS-FPO";

const m2 = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname.replace(/^\/api\/m2/, "");
  const json = (code, b) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (p === "/system/clock") return json(200, { now: "2027-04-21T05:00:00Z" });
  if (p === "/meta") return json(200, { actors: { doctor: [{ id: `DOC-${FPO}`, name: "Dr. Sawant (farmer doctor)" }] } });
  if (p === `/agreements/${AID}`) return json(200, { id: AID, lots: [{ id: "LOT-STG01", total_kg: 900, status: "COLLECTED", collected_at: "2027-04-20T05:00:00Z",
    contributions: [{ farmer_id: farmerM2, kg: 900, grade: "A" }] }] });
  return json(404, {});
});

// AI stand-in with switchable answers; a real outage is simulated by available:false
let visionMode = "ok";
const fakeVision = {
  async assess(stage) {
    if (visionMode === "down") return { available: false, error: "vision service 503", photoQuality: null, fruit: null };
    const pq = { model: "agrilink-photo-quality-v1", photos: [{ usable: visionMode !== "blurry", issues: visionMode === "blurry" ? ["blurry"] : [], brightness: 140, sharpness: 300, vegetation_pct: 62 }] };
    const fruit = stage.aiMode === "fruit" ? { model: "agrilink-vision-v1", photos_used: 1, confidence: 0.92, defect_pct: visionMode === "spotty" ? 9.5 : 1.2, colour_score: 0.6, flags: [], notes: [], photos: [{ is_fruit: true, defect_pct: 1.2, colour_score: 0.6 }] } : null;
    return { available: true, photoQuality: pq, fruit };
  },
};
const fakeChain = () => { const v = new Map(); let block = 1; return {
  async register(id, sha, version) { const l = v.get(id) || []; if (version !== l.length + 1) throw new Error("WrongVersion"); l.push(sha); v.set(id, l);
    return { status: "registered", network: "Test chain", chainId: 31337, docHash: "0x" + sha, version, txHash: "0xabc" + version, blockNumber: ++block, registeredAt: new Date() }; },
  async lookup() { return null; } }; };

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const photos = (n) => Array.from({ length: n }, (_, i) => ({ name: `p${i}.jpg`, dataBase64: JPEG }));

let server, base, tmp;
const api = async (p, { method = "GET", token, body } = {}) => {
  const res = await fetch(base + "/api" + p, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const login = async (mobile, role) => (await api("/auth/verify", { method: "POST", body: { mobile, otp: "1234", role } })).body;
const desk = (token, m2Role, m2Actor) => api("/ops/me", { method: "PUT", token, body: { m2Role, m2Actor } });

before(async () => {
  await new Promise((r) => m2.listen(0, "127.0.0.1", r));
  process.env.M2_API_URL = `http://127.0.0.1:${m2.address().port}/api/m2`;
  const { createApp } = await import("../src/app.js");
  const { createNotifier } = await import("../src/modules/notifications/notifier.js");
  const { createStore } = await import("../src/modules/contracts/storage.js");
  await mongoose.connect((process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agrilink_test").replace(/agrilink_test$/, "agrilink_test_stages"));
  await mongoose.connection.dropDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aglstg-"));
  server = createApp({ ml: {}, notifier: createNotifier(null), contractDeps: { chain: fakeChain() },
    certDeps: { store: createStore(path.join(tmp, "certs")) }, stageDeps: { vision: fakeVision, photoStore: createStore(path.join(tmp, "photos")) } }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); m2.close(); await mongoose.disconnect(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("stage workflow: submit → provisional report → consultant → stage certificate", async () => {
  const f = await login("9876543210", "farmer");
  farmerM2 = `AGL-F-${f.user._id}`;
  await api("/farmers/me", { method: "PUT", token: f.token, body: { name: "Ramesh Patil", farm: { village: "Devgad", district: "Sindhudurg", acres: 6, trees: 300, age: 15, irrigation: "drip", fpo: "Devgad Growers FPO" } } });
  await mongoose.connection.db.collection("agreements").insertOne({ agreementId: AID, farmer: new mongoose.Types.ObjectId(f.user._id), parties: { buyer: { company: "FairPrice Fresh" } } });

  // crop record linked to the farmer's agreement
  assert.equal((await api("/crops", { method: "POST", token: f.token, body: { agreementId: "AGL-NOT-MINE" } })).status, 400);
  const crop = (await api("/crops", { method: "POST", token: f.token, body: { season: 2027, agreementId: AID } })).body;
  assert.match(crop.cropId, /^CRP-2027-\d{5}$/);
  assert.equal(crop.fpo.id, FPO);
  const cv = (await api(`/crops/${crop.cropId}`, { token: f.token })).body;
  assert.equal(cv.stages.length, 7);
  assert.equal(cv.stages[0].key, "seed_selection");

  // validation: required fields and photos
  assert.equal((await api(`/crops/${crop.cropId}/stages/seed_selection/assessments`, { method: "POST", token: f.token, body: { entries: {}, photos: photos(1) } })).status, 400);
  assert.equal((await api(`/crops/${crop.cropId}/stages/seed_selection/assessments`, { method: "POST", token: f.token,
    body: { entries: { source_type: "Certified nursery", supplier: "Dapoli KVK nursery", variety_confirmed: true }, photos: [{ dataBase64: "aGVsbG8=" }] } })).status, 400);

  // submit: provisional report, pending review — never approved by the AI
  const sub = await api(`/crops/${crop.cropId}/stages/seed_selection/assessments`, { method: "POST", token: f.token,
    body: { entries: { source_type: "Certified nursery", supplier: "Dapoli KVK nursery", variety_confirmed: true, success_pct: 92 }, photos: photos(1) } });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  const a = sub.body;
  assert.equal(a.status, "pending_review");
  assert.equal(a.report.provisional, true);
  assert.equal(a.report.qualityScore, 100);
  assert.ok(a.report.notAssessable.includes("Seed viability"));
  assert.ok(a.report.remarks.some((r) => /no image model for this stage/.test(r)));
  assert.equal(a.photos.length, 1);
  assert.equal((await api(`/crops/${crop.cropId}/stages/seed_selection/assessments`, { method: "POST", token: f.token,
    body: { entries: { source_type: "Certified nursery", supplier: "x y", variety_confirmed: true }, photos: photos(1) } })).status, 409);

  // who may decide: not the farmer, not admin, not another FPO's doctor
  const o = await login("9000000001", "operations");
  await desk(o.token, "admin", "OPS-1");
  assert.equal((await api(`/stage-assessments/${a.assessmentId}/decision`, { method: "POST", token: f.token, body: { decision: "approved", confirmNotAssessable: true } })).status, 403);
  assert.equal((await api(`/stage-assessments/${a.assessmentId}/decision`, { method: "POST", token: o.token, body: { decision: "approved", confirmNotAssessable: true } })).status, 403);
  await desk(o.token, "doctor", "DOC-AGL-FPO-OTHER");
  assert.equal((await api(`/stage-assessments/${a.assessmentId}`, { token: o.token })).status, 404);   // other FPO cannot even see it
  await desk(o.token, "doctor", `DOC-${FPO}`);
  const queue = (await api("/stage-assessments?status=pending_review", { token: o.token })).body;
  assert.deepEqual(queue.map((x) => x.assessmentId), [a.assessmentId]);
  assert.equal((await api(`/stage-assessments/${a.assessmentId}/decision`, { method: "POST", token: o.token, body: { decision: "approved" } })).status, 400); // must confirm non-photo parameters

  // approval -> existing certificate pipeline (stage certificate)
  const ok = (await api(`/stage-assessments/${a.assessmentId}/decision`, { method: "POST", token: o.token, body: { decision: "approved", remarks: "Nursery bill checked", confirmNotAssessable: true } })).body;
  assert.equal(ok.status, "approved");
  assert.match(ok.certificateId, /^AGL-SC-2027-\d{5}$/);
  assert.equal(ok.review.by, "Dr. Sawant (farmer doctor)");
  const certs = (await api("/certificates", { token: f.token })).body.items;
  assert.equal(certs[0].kind, "stage");
  assert.equal(certs[0].cropId, crop.cropId);
  const pub = (await api(`/public/certificates/${ok.certificateId}`)).body;
  assert.equal(pub.kind, "stage");
  assert.equal(pub.stage.key, "seed_selection");
  assert.equal(pub.assessment.consultant, "Dr. Sawant (farmer doctor)");
  assert.equal(pub.status, "valid");
  assert.equal((await api(`/stage-assessments/${a.assessmentId}/decision`, { method: "POST", token: o.token, body: { decision: "rejected", remarks: "changed mind" } })).status, 409);
  const notes = (await api("/notifications", { token: f.token })).body;
  assert.ok((notes.items || notes).some((n) => n.type === "stage_decision"));
});

test("AI outage, correction loop, batch requirement, configuration", async () => {
  const f = await login("9876543210", "farmer");
  const o = await login("9000000001", "operations");
  const crop = (await api("/crops", { token: f.token })).body[0];

  // AI unavailable: image checks are NOT assessed, nothing is invented
  visionMode = "down";
  const h = (await api(`/crops/${crop.cropId}/stages/harvesting/assessments`, { method: "POST", token: f.token,
    body: { entries: { harvest_date: "2027-04-18", maturity_check: "Shoulders developed", harvest_time: "Early morning", with_stalk: true }, photos: photos(3) } })).body;
  assert.equal(h.report.ai.available, false);
  assert.ok(h.report.checks.filter((c) => c.source === "ai").every((c) => c.status === "not_assessed"));
  assert.equal(h.report.provisionalCompliance, "insufficient_evidence");
  assert.equal(h.status, "pending_review");

  // consultant asks for correction -> farmer resubmits version 2
  await desk(o.token, "doctor", `DOC-${FPO}`);
  assert.equal((await api(`/stage-assessments/${h.assessmentId}/decision`, { method: "POST", token: o.token, body: { decision: "requires_correction" } })).status, 400); // remarks required
  await api(`/stage-assessments/${h.assessmentId}/decision`, { method: "POST", token: o.token, body: { decision: "requires_correction", remarks: "Photos not analysed — please resubmit" } });
  visionMode = "spotty";
  const h2 = (await api(`/crops/${crop.cropId}/stages/harvesting/assessments`, { method: "POST", token: f.token,
    body: { entries: { harvest_date: "2027-04-18", maturity_check: "Shoulders developed", harvest_time: "Early morning", with_stalk: true }, photos: photos(3) } })).body;
  assert.equal(h2.version, 2);
  assert.equal(h2.previousId, h.assessmentId);
  const blemish = h2.report.checks.find((c) => c.key === "blemish");
  assert.equal(blemish.status, "warn");      // 9.5% > 5% but below the 15% fail line
  assert.ok(h2.report.qualityScore < 100);
  assert.equal(h2.history.length, 2);

  // grading needs the batch (lot) that holds this farmer's fruit
  visionMode = "ok";
  const g = { entries: { declared_grade: "A", carton_type: "Ventilated corrugated", labelled: true }, photos: photos(3) };
  assert.equal((await api(`/crops/${crop.cropId}/stages/grading_packaging/assessments`, { method: "POST", token: f.token, body: g })).status, 400);
  assert.equal((await api(`/crops/${crop.cropId}/stages/grading_packaging/assessments`, { method: "POST", token: f.token, body: { ...g, batchId: "LOT-NOT-MINE" } })).status, 400);
  const gr = (await api(`/crops/${crop.cropId}/stages/grading_packaging/assessments`, { method: "POST", token: f.token, body: { ...g, batchId: "LOT-STG01" } })).body;
  assert.equal(gr.batchId, "LOT-STG01");
  const ap = (await api(`/stage-assessments/${gr.assessmentId}/decision`, { method: "POST", token: o.token, body: { decision: "approved", confirmNotAssessable: true } })).body;
  assert.equal((await api(`/public/certificates/${ap.certificateId}`)).body.batchId, "LOT-STG01");

  // a lot certificate for LOT-STG01 is still possible: stage certificates do not occupy the lot
  const { Certificate } = await import("../src/modules/certificates/model.js");
  assert.equal(await Certificate.countDocuments({ lotId: "LOT-STG01" }), 0);

  // configuration: only AgriLink operations (admin desk) edits; disabled stages cannot be submitted
  assert.equal((await api("/stages/config", { method: "PUT", token: o.token, body: { stages: [] } })).status, 403);
  await desk(o.token, "admin", "OPS-1");
  const cfg = (await api("/stages/config", { token: o.token })).body;
  const next = cfg.map(({ key, name, order, guidance }) => ({ key, name: key === "crop_growth" ? "Vegetative growth" : name, order, guidance, enabled: key !== "sowing_planting" }));
  const saved = (await api("/stages/config", { method: "PUT", token: o.token, body: { stages: next } })).body;
  assert.equal(saved.find((s) => s.key === "crop_growth").name, "Vegetative growth");
  assert.equal((await api(`/crops/${crop.cropId}`, { token: f.token })).body.stages.length, 6);
  assert.equal((await api(`/crops/${crop.cropId}/stages/sowing_planting/assessments`, { method: "POST", token: f.token,
    body: { entries: { planting_date: "2010-06-01", spacing_m: 10, pits_with_manure: true, irrigation: "Drip" }, photos: photos(1) } })).status, 404);
});
