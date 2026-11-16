// Personalised advisory: gaps only from real evidence, buyer-spec comparison, dated recommendations with follow-up,
// multilingual output, progress kept across refreshes, resolution when evidence clears, notifications, desk scoping.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";

const AID = "AGL-2027-00099";
let fid = "", defect = 9.2;
const NOW = "2027-04-10T05:00:00Z";

const m2 = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname.replace(/^\/api\/m2/, "");
  const json = (b) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  const mine = u.searchParams.get("farmer_id") === fid;
  if (p === "/system/clock") return json({ now: NOW });
  if (p === "/meta") return json({ quality_spec: { grade_a: { max_defect_pct: 5, min_colour: 0.7, min_weight_g: 200 }, grade_b: { max_defect_pct: 15, min_colour: 0.5, min_weight_g: 170 }, min_cv_confidence: 0.6 } });
  if (p === `/agreements/${AID}`) return json({ id: AID, buyer_name: "FairPrice Fresh", required_grade: "A", harvest_window: { start: "2027-04-17T00:00:00Z" },
    commitments: [{ farmer_id: fid, quality_status: "PENDING_DOCTOR" }] });
  if (p === "/quality-checks") return json(mine ? [{ id: "QC-1", agreement_id: AID, status: "ANALYSED", analysed_at: "2027-04-08T05:00:00Z", cv: { defect_pct: defect, colour_score: 0.81, confidence: 0.9, flags: [] } }] : []);
  if (p === "/quality-reviews") return json([]);
  if (p === "/doctor-visits") return json(mine ? [
    { id: "V1", status: "COMPLETED", completed_at: "2027-04-06T05:00:00Z", finding: { grade: "B", pest_signs: ["fruit_fly_signs"], observations: "Stung fruit near the boundary", recommendations: ["Set traps on the east boundary"] } },
    { id: "V2", status: "SCHEDULED", due_at: "2027-04-19T05:00:00Z" }] : []);
  if (p === "/interventions") return json([]);
  return json({});
});

let server, base, notifier;
const api = async (p, { method = "GET", token, body } = {}) => {
  const r = await fetch(base + "/api" + p, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const login = async (m, role) => (await api("/auth/verify", { method: "POST", body: { mobile: m, otp: "1234", role } })).body;
const farm = { village: "Devgad", district: "Sindhudurg", acres: 6, trees: 300, age: 15, irrigation: "drip", fpo: "Devgad Growers FPO" };

before(async () => {
  await new Promise((r) => m2.listen(0, "127.0.0.1", r));
  process.env.M2_API_URL = `http://127.0.0.1:${m2.address().port}/api/m2`;
  const { createApp } = await import("../src/app.js");
  const { createNotifier } = await import("../src/modules/notifications/notifier.js");
  await mongoose.connect((process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agrilink_test").replace(/agrilink_test$/, "agrilink_test_advisory"));
  await mongoose.connection.dropDatabase();
  notifier = createNotifier(null);
  const ml = { alerts: async (b) => ({ alerts: b.rain_mm_48h >= 70 ? [{ code: "storm", severity: "high", actions: [], params: {} }] : [] }) };
  const weather = async () => ({ rain_mm_48h: 85, wind_kmh: 55, temp_c: 29, hail: false, source: "open-meteo" });
  server = createApp({ ml, notifier, weather }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); m2.close(); await mongoose.disconnect(); });

test("recommendations come from evidence and compare against the buyer grade", async () => {
  const f = await login("9876543210", "farmer");
  fid = `AGL-F-${f.user._id}`;
  await api("/farmers/me", { method: "PUT", token: f.token, body: { name: "Ramesh Patil", farm } });
  const db = mongoose.connection.db;
  await db.collection("agreements").insertOne({ agreementId: AID, farmer: new mongoose.Types.ObjectId(f.user._id), chain: { status: "registered" } });
  await db.collection("crops").insertOne({ cropId: "CRP-2027-00001", farmer: new mongoose.Types.ObjectId(f.user._id), status: "active", season: 2027 });
  await db.collection("stageassessments").insertOne({ assessmentId: "SA-1", cropId: "CRP-2027-00001", stage: { key: "flowering_fruiting", name: "Flowering and Fruiting" },
    version: 1, status: "pending_review", entries: { flowering_pct: 70, fruit_set: true, hopper_or_mildew: false, spray_log_kept: false }, createdAt: new Date("2027-03-01") });

  const r = await api("/advisory/me?refresh=1", { token: f.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const codes = r.body.items.map((i) => i.code);
  for (const c of ["blemish_high", "fruit_fly", "harvest_readiness", "no_spray_log", "weather_storm"]) assert.ok(codes.includes(c), `${c} missing: ${codes}`);
  assert.ok(!codes.includes("colour_low"));            // 0.81 meets the 0.70 minimum
  assert.ok(!codes.includes("hopper_mildew"));         // farmer reported none

  const b = r.body.items.find((i) => i.code === "blemish_high");
  assert.match(b.reason, /9\.2% blemished skin; buyer's Grade A allows at most 5%/);
  assert.ok(b.steps.length >= 3 && b.action && b.expected && !/guarantee/i.test(b.expected));
  assert.equal(new Date(b.dueDate).toISOString().slice(0, 10), "2027-04-17");            // season time + 7 days
  const fly = r.body.items.find((i) => i.code === "fruit_fly");
  assert.ok(fly.notes.some((n) => n.text === "Set traps on the east boundary"));         // agronomist feedback kept verbatim
  assert.equal(r.body.items.find((i) => i.code === "weather_storm").followUpBy, "photo check / farmer doctor");   // visit is outside its 2-day window
  assert.equal(b.followUpBy, "scheduled farmer-doctor visit");                             // V2 falls inside blemish follow-up window
  assert.equal(r.body.items[0].severity, "high");

  const row = r.body.specRows[0].rows;
  assert.equal(row.find((x) => x.key === "blemish").ok, false);
  assert.equal(row.find((x) => x.key === "colour").ok, true);
  assert.equal(row.find((x) => x.key === "weight").current, null);                         // not measurable from photos

  // multilingual
  const hi = (await api("/advisory/me?lang=hi", { token: f.token })).body;
  assert.equal(hi.items.find((i) => i.code === "blemish_high").problem, "दाग़ निर्यात सीमा से ज़्यादा");
  const mr = (await api("/advisory/me?lang=mr", { token: f.token })).body;
  assert.match(mr.items.find((i) => i.code === "blemish_high").reason, /ग्रेड A/);

  // notification for new gaps
  const n = (await api("/notifications", { token: f.token })).body;
  assert.ok((n.items || n).some((x) => x.type === "advisory_new" && x.data.count >= 4));
});

test("progress is kept, cleared gaps resolve, desks are scoped, no evidence means no advice", async () => {
  const f = await login("9876543210", "farmer");
  const key = (await api("/advisory/me", { token: f.token })).body.items.find((i) => i.code === "no_spray_log").key;
  const d = await api(`/advisory/me/items/${encodeURIComponent(key)}`, { method: "PATCH", token: f.token, body: { status: "done" } });
  assert.equal(d.body.items.find((i) => i.key === key).status, "completed");
  defect = 2.1;                                              // next photo check is within the limit
  const r = (await api("/advisory/me?refresh=1", { token: f.token })).body;
  assert.equal(r.items.find((i) => i.key === key).status, "completed");            // farmer's progress survives a refresh
  assert.equal(r.items.find((i) => i.code === "blemish_high").status, "resolved");  // evidence cleared

  // a farmer with no inspections, records or alerts gets no invented advice
  const other = await login("9876500000", "farmer");
  await api("/farmers/me", { method: "PUT", token: other.token, body: { name: "Sunita More", farm: { ...farm, village: "Rajapur", district: "Ratnagiri", fpo: "Rajapur FPO" } } });
  const none = (await api("/advisory/me?refresh=1", { token: other.token })).body;
  assert.deepEqual(none.items.filter((i) => !i.code.startsWith("weather")), []);

  // desks: farmer doctor sees own FPO only; buyer cannot read
  const o = await login("9000000001", "operations");
  await api("/ops/me", { method: "PUT", token: o.token, body: { m2Role: "doctor", m2Actor: "DOC-AGL-FPO-DEVGAD-GROWERS-FPO" } });
  const list = (await api("/advisory/farmers", { token: o.token })).body;
  assert.deepEqual(list.map((x) => x.name), ["Ramesh Patil"]);
  const one = (await api(`/advisory/farmers/${list[0].id}?lang=mr`, { token: o.token })).body;
  assert.ok(one.items.length > 0 && one.farmer.name === "Ramesh Patil");
  assert.equal((await api(`/advisory/farmers/${none ? (await login("9876500000", "farmer")).user._id : ""}`, { token: o.token })).status, 404);
  const buyer = await login("6500000001", "buyer");
  assert.equal((await api("/advisory/farmers", { token: buyer.token })).status, 403);
  assert.equal((await api("/advisory/me", { token: buyer.token })).status, 403);
});
