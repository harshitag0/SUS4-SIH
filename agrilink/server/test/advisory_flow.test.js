// Complete advisory workflow:
// inspection → gaps → recommendations (treatment ones wait for the farmer doctor) → translated WhatsApp/SMS →
// farmer acknowledges / completes with photo → farmer doctor verifies → re-inspection → comparison → update.
// Also: message log statuses, retry, webhook delivery status + signature, simulated mode, regional languages.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";

const AID = "AGL-2027-00111", FPO = "AGL-FPO-DEVGAD-GROWERS-FPO";
let fid = "";
const state = { checks: [], visits: [] };
const m2 = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname.replace(/^\/api\/m2/, "");
  const json = (b, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (p === "/system/clock") return json({ now: "2027-04-10T05:00:00Z" });
  if (p === "/meta") return json({ quality_spec: { grade_a: { max_defect_pct: 5, min_colour: 0.7, min_weight_g: 200 }, min_cv_confidence: 0.6 } });
  if (p === `/agreements/${AID}`) return json({ id: AID, buyer_name: "FairPrice Fresh", required_grade: "A", harvest_window: { start: "2027-05-20T00:00:00Z" }, commitments: [{ farmer_id: fid, quality_status: "PENDING_DOCTOR" }] });
  if (p === "/quality-checks") return json(state.checks);
  if (p === "/doctor-visits" && req.method === "GET") return json(state.visits);
  if (p === "/doctor-visits" && req.method === "POST") {
    assert.equal(req.headers["x-m2-role"], "doctor");
    const v = { id: `V${state.visits.length + 1}`, status: "SCHEDULED", due_at: "2027-04-12T05:00:00Z", doctor_name: "Dr. Sawant" };
    state.visits.push(v); return json(v, 201);
  }
  const done = p.match(/^\/doctor-visits\/(V\d+)\/complete$/);
  if (done) {
    let body = ""; for await (const c of req) body += c;
    const v = state.visits.find((x) => x.id === done[1]);
    Object.assign(v, { status: "COMPLETED", completed_at: "2027-04-12T06:00:00Z", finding: { ...JSON.parse(body) } });
    return json({ visit: v });
  }
  if (p === "/quality-reviews" || p === "/interventions") return json([]);
  return json({});
});

// fake WhatsApp / SMS providers that record calls; WhatsApp can be told to fail once (retryable)
const calls = { wa: [], sms: [] };
let waFailOnce = false;
const { ProviderError } = await import("../src/modules/messaging/providers.js");
const whatsapp = { name: "whatsapp_cloud", configured: true, async sendTemplate(m) {
  if (waFailOnce) { waFailOnce = false; throw new ProviderError("WhatsApp 503: try later", { retryable: true }); }
  calls.wa.push(m); return { providerId: `wamid.${calls.wa.length}` };
}, async sendAudio() { return { providerId: "wamid.audio" }; } };
const sms = { name: "msg91", configured: true, needsDlt: true, async send(m) { calls.sms.push(m); return { providerId: `sms-${calls.sms.length}` }; } };

let server, base, tmp, messenger;
const api = async (p, { method = "GET", token, body, headers = {} } = {}) => {
  const r = await fetch(base + "/api" + p, { method, headers: { "content-type": "application/json", ...headers, ...(token && { authorization: `Bearer ${token}` }) }, body: typeof body === "string" ? body : body && JSON.stringify(body) });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text() };
};
const login = async (m, role) => (await api("/auth/verify", { method: "POST", body: { mobile: m, otp: "1234", role } })).body;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

before(async () => {
  await new Promise((r) => m2.listen(0, "127.0.0.1", r));
  process.env.M2_API_URL = `http://127.0.0.1:${m2.address().port}/api/m2`;
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  const { createApp } = await import("../src/app.js");
  const { createNotifier } = await import("../src/modules/notifications/notifier.js");
  const { createMessenger } = await import("../src/modules/messaging/service.js");
  const { createStore } = await import("../src/modules/contracts/storage.js");
  await mongoose.connect((process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agrilink_test").replace(/agrilink_test$/, "agrilink_test_advflow"));
  await mongoose.connection.dropDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agladv-"));
  process.env.ADVISORY_EVIDENCE_DIR = tmp;
  messenger = createMessenger({ whatsapp, sms, tts: { name: "google_tts", configured: false }, mode: "auto" });
  const weather = async () => ({ rain_mm_48h: 0, wind_kmh: 5, temp_c: 30, hail: false, source: "test" });
  server = createApp({ ml: { alerts: async () => ({ alerts: [] }) }, notifier: createNotifier(null), weather, messenger, evidenceStore: createStore(tmp) }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); m2.close(); await mongoose.disconnect(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("inspection → recommendation → farmer → agronomist → re-inspection → update", async () => {
  // farmer in Marathi with an agreement
  const f = await login("9876543210", "farmer");
  fid = `AGL-F-${f.user._id}`;
  await api("/farmers/me", { method: "PUT", token: f.token, body: { name: "Ramesh Patil", lang: "mr", notify: { whatsapp: true, sms: true, voice: false },
    farm: { village: "Devgad", district: "Sindhudurg", acres: 6, trees: 300, age: 15, irrigation: "drip", fpo: "Devgad Growers FPO" } } });
  await mongoose.connection.db.collection("agreements").insertOne({ agreementId: AID, farmer: new mongoose.Types.ObjectId(f.user._id), chain: { status: "registered" } });

  // 1-2. inspection report arrives: photo check 9.2% blemish + doctor saw fruit fly signs
  state.checks = [{ id: "QC-1", agreement_id: AID, status: "ANALYSED", analysed_at: "2027-04-08T05:00:00Z", cv: { defect_pct: 9.2, colour_score: 0.8, confidence: 0.9, flags: [] } }];
  state.visits = [{ id: "V0", status: "COMPLETED", completed_at: "2027-04-07T05:00:00Z", doctor_name: "Dr. Sawant", finding: { grade: "B", pest_signs: ["fruit_fly_signs"], recommendations: [] } }];

  // 3-5. gaps → recommendations → messages in Marathi
  let d = (await api("/advisory/me?refresh=1", { token: f.token })).body;
  const blemish = d.items.find((i) => i.code === "blemish_high"), fly = d.items.find((i) => i.code === "fruit_fly");
  assert.equal(blemish.status, "open");
  assert.equal(fly.status, "pending_approval");
  assert.equal(fly.awaitingApproval, true);
  assert.deepEqual(fly.steps, []);                                       // no treatment steps before approval
  assert.equal(blemish.problem, "डाग निर्यात मर्यादेपेक्षा जास्त");
  assert.equal(calls.wa.length, 1);                                      // only the approved/open one is sent
  assert.equal(calls.wa[0].key, "new_recommendation");
  assert.equal(calls.wa[0].langCode, "mr");
  assert.equal(calls.wa[0].params[0], "डाग निर्यात मर्यादेपेक्षा जास्त");
  assert.equal(calls.sms[0].key, "quality_gap");                         // high-severity gap also by SMS
  const logs = (await api("/messages/me", { token: f.token })).body;
  assert.ok(logs.every((l) => l.status === "sent" && l.mode === "live"));

  // 6. farmer acknowledges and completes with a photo
  assert.equal((await api(`/advisory/me/items/${blemish.itemId}/actions`, { method: "POST", token: f.token, body: { action: "acknowledge" } })).status, 200);
  d = (await api(`/advisory/me/items/${blemish.itemId}/actions`, { method: "POST", token: f.token, body: { action: "complete", note: "Sorted fruit, new cushioned crates", photos: [{ dataBase64: PNG }] } })).body;
  const done = d.items.find((i) => i.itemId === blemish.itemId);
  assert.equal(done.status, "completed");
  assert.equal(done.farmerEvidence.length, 1);
  assert.equal((await api(`/advisory/items/${blemish.itemId}/evidence/1`, { token: f.token })).status, 200);
  assert.deepEqual(done.events.map((e) => e.action), ["created", "acknowledged", "completed"]);

  // 7. agronomist (farmer doctor of this FPO): approve the treatment recommendation with guidance, verify the completed action
  const o = await login("9000000001", "operations");
  await api("/ops/me", { method: "PUT", token: o.token, body: { m2Role: "fpo", m2Actor: FPO } });
  assert.equal((await api(`/advisory/items/${fly.itemId}/review`, { method: "POST", token: o.token, body: { decision: "approve" } })).status, 403);   // FPO desk cannot approve
  await api("/ops/me", { method: "PUT", token: o.token, body: { m2Role: "doctor", m2Actor: `DOC-${FPO}` } });
  const q = (await api("/advisory/agronomist", { token: o.token })).body;
  assert.equal(q.approvals[0].itemId, fly.itemId);
  assert.equal(q.verifications[0].itemId, blemish.itemId);
  assert.equal((await api(`/advisory/items/${fly.itemId}/review`, { method: "POST", token: o.token, body: { decision: "approve", guidance: "Set 4 traps per acre on the east side; collect fallen fruit daily." } })).status, 200);
  d = (await api("/advisory/me", { token: f.token })).body;
  const flyNow = d.items.find((i) => i.itemId === fly.itemId);
  assert.equal(flyNow.status, "open");
  assert.ok(flyNow.steps.length > 0 && flyNow.guidance[0].text.startsWith("Set 4 traps"));
  assert.ok(calls.wa.some((c) => c.key === "new_recommendation" && c.params[0] === flyNow.problem));
  assert.equal((await api(`/advisory/items/${blemish.itemId}/verify`, { method: "POST", token: o.token, body: { result: "verified", note: "Crates checked" } })).status, 200);
  assert.ok(calls.wa.some((c) => c.key === "action_verified"));

  // farmer asks for help on the fruit fly item; the doctor answers
  await api(`/advisory/me/items/${fly.itemId}/actions`, { method: "POST", token: f.token, body: { action: "request_help", note: "Where to get traps?" } });
  assert.equal((await api("/advisory/agronomist", { token: o.token })).body.help[0].itemId, fly.itemId);
  await api(`/advisory/items/${fly.itemId}/help`, { method: "POST", token: o.token, body: { response: "Collect traps at the FPO office on Monday." } });

  // 8. a new inspection: doctor schedules and records it; next photo check is clean
  const visit = (await api(`/advisory/farmers/${f.user._id}/inspections`, { method: "POST", token: o.token, body: { note: "Re-inspection after corrective action" } })).body;
  state.checks.unshift({ id: "QC-2", agreement_id: AID, status: "ANALYSED", analysed_at: "2027-04-12T07:00:00Z", cv: { defect_pct: 2.1, colour_score: 0.82, confidence: 0.92, flags: [] } });
  const rec = (await api(`/advisory/farmers/${f.user._id}/inspections/${visit.id}`, { method: "POST", token: o.token,
    body: { grade: "A", pest_signs: [], cleared_flags: ["fruit_fly_signs"], observations: "Traps working, no new stings", fruit_inspected: 30 } })).body;
  assert.ok(rec.snapshot);

  // 9-10. comparison and updated recommendations
  d = (await api("/advisory/me", { token: f.token })).body;
  const b2 = d.items.find((i) => i.itemId === blemish.itemId);
  assert.equal(b2.status, "resolved");
  assert.deepEqual(b2.comparisons.map((c) => [c.metric, c.before, c.after, c.verdict]).find((x) => x[0] === "defect"), ["defect", 9.2, 2.1, "improved"]);
  assert.equal(d.items.find((i) => i.itemId === fly.itemId).status, "resolved");   // doctor cleared the pest sign
  assert.ok(d.snapshots.length >= 2);
  assert.ok(calls.wa.some((c) => c.key === "inspection_result"));
  // history is kept
  assert.ok(d.items.find((i) => i.itemId === blemish.itemId).events.some((e) => e.action === "verified"));
});

test("delivery: retry, webhook status + signature, simulated mode, regional languages, DLT", async () => {
  const { MessageLog } = await import("../src/modules/messaging/model.js");
  const f = await login("9876543210", "farmer");
  // retry: first attempt fails with a retryable error
  waFailOnce = true;
  const [log] = await messenger.dispatch(f.user._id, "visit_upcoming", { date: "12/04/2027" }, { channels: ["whatsapp"] });
  assert.equal(log.status, "failed");
  assert.equal(log.retryable, true);
  await MessageLog.updateOne({ _id: log._id }, { nextRetryAt: new Date(Date.now() - 1000) });
  assert.equal(await messenger.retryDue(), 1);
  const retried = await MessageLog.findById(log._id);
  assert.equal(retried.status, "sent");
  assert.equal(retried.attempts, 2);

  // WhatsApp webhook: signed status update → delivered; bad signature rejected
  const payload = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: retried.providerId, status: "delivered" }] } }] }] });
  const sig = "sha256=" + createHmac("sha256", "test-secret").update(payload).digest("hex");
  assert.equal((await api("/webhooks/whatsapp", { method: "POST", body: payload, headers: { "x-hub-signature-256": "sha256=bad" } })).status, 401);
  assert.equal((await api("/webhooks/whatsapp", { method: "POST", body: payload, headers: { "x-hub-signature-256": sig } })).status, 200);
  assert.equal((await MessageLog.findById(log._id)).status, "delivered");

  // simulated mode: nothing is called and nothing is claimed as sent
  const { createMessenger } = await import("../src/modules/messaging/service.js");
  const before = calls.wa.length;
  const sim = createMessenger({ whatsapp: { ...whatsapp, configured: false }, sms: { ...sms, configured: false }, tts: { configured: false }, mode: "auto" });
  const out = await sim.dispatch(f.user._id, "harvest_readiness", { days: 3, status: "PENDING" });
  assert.ok(out.length === 2 && out.every((l) => l.status === "simulated" && l.mode === "simulated"));
  assert.equal(calls.wa.length, before);

  // regional languages
  const { User } = await import("../src/modules/users/model.js");
  for (const [lang, word] of [["ta", "அறுவடை"], ["te", "కోత"], ["kn", "ಕೊಯ್ಲು"], ["gu", "લણણી"], ["hi", "तुड़ाई"]]) {
    await User.updateOne({ _id: f.user._id }, { lang });
    const [l] = await sim.dispatch(f.user._id, "harvest_readiness", { days: 3, status: "PASS" }, { channels: ["whatsapp"] });
    assert.ok(l.body.includes(word), `${lang}: ${l.body}`);
  }
  // advisory content in Tamil
  const ta = (await api("/advisory/me?lang=ta", { token: f.token })).body;
  assert.ok(ta.items.length && ta.items.every((i) => i.problem && !/[a-z]{4,}/.test(i.problem.replace(/AgriLink|FPO|KVK|AI/g, ""))));

  // live SMS without a DLT template id is refused, not sent
  const { smsProvider } = await import("../src/modules/messaging/providers.js");
  process.env.SMS_PROVIDER = "msg91"; process.env.MSG91_AUTH_KEY = "x"; process.env.SMS_SENDER_ID = "AGRLNK"; process.env.SMS_DLT_TEMPLATE_IDS = "{}";
  await assert.rejects(() => smsProvider().send({ to: "919876543210", key: "quality_warning", lang: "mr", params: ["x"] }), /no DLT template id/);
  delete process.env.SMS_PROVIDER;
});
