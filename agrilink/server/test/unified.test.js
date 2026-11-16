// One platform: single sign-in gateway to Module 2, operations role, and the AI decision pipeline across both modules.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";
import { fakeMl } from "./fakes.js";

// fake Module 2: records the identity headers it receives and serves one agreement
const seen = [];
const m2 = http.createServer((req, res) => {
  seen.push({ url: req.url, role: req.headers["x-m2-role"], actor: req.headers["x-m2-actor"], auth: req.headers.authorization });
  const json = (code, b) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (req.url === "/api/m2/meta") return json(200, { actors: {} });
  const m = req.url.match(/^\/api\/m2\/agreements\/([^/?]+)$/);
  if (m) return json(200, {
    agreement_id: m[1], status: "ACTIVE", quantity_kg: 2000, required_grade: "A", harvest_window: { start: "2027-04-20", end: "2027-05-08" },
    supply: { farmers: 1, quality: { PASS: 0, PENDING_DOCTOR: 1 }, open_checks: 1, missed_checks: 0, fill_expected_pct: 100, delivered_kg: 0, order_kg: 2000, fill_delivered_pct: 0 },
    lots: [], escrow: { status: "TRANCHE1_RELEASED", currency: "USD", paid_to_fpo: 5000, held: 0 }, recovery_requests: [], feedback: [],
  });
  return json(200, { ok: true, path: req.url });
});

let server, base;
const api = async (p, { method = "GET", token, body, headers = {} } = {}) => {
  const res = await fetch(base + "/api" + p, { method, headers: { "content-type": "application/json", ...headers, ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const login = async (mobile, role) => (await api("/auth/verify", { method: "POST", body: { mobile, otp: "1234", role } })).body;

before(async () => {
  await new Promise((r) => m2.listen(0, "127.0.0.1", r));
  process.env.M2_API_URL = `http://127.0.0.1:${m2.address().port}/api/m2`; // read when the gateway/journey modules load
  const { createApp } = await import("../src/app.js");
  const { seedIfEmpty } = await import("../src/seed.js");
  const { createNotifier } = await import("../src/modules/notifications/notifier.js");
  await mongoose.connect((process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agrilink_test").replace(/agrilink_test$/, "agrilink_test_unified"));
  await mongoose.connection.dropDatabase();
  await seedIfEmpty();
  const chain = { latest: async () => null, info: async () => ({}) };
  const weather = async () => ({ rain_mm_48h: 0, wind_kmh: 10, temp_c: 32, hail: false, source: "test" });
  server = createApp({ ml: fakeMl, notifier: createNotifier(null), weather, contractDeps: { chain, store: null } }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); m2.close(); await mongoose.disconnect(); });

test("gateway: one sign-in, identity set by the server, spoofed headers dropped", async () => {
  assert.equal((await api("/m2/agreements")).status, 401);          // no AgriLink login → no farm operations
  assert.equal((await api("/m2/meta")).status, 200);                // public
  const f = await login("9876543210", "farmer");
  seen.length = 0;
  const r = await api("/m2/farmer/checks", { token: f.token, headers: { "X-M2-Role": "admin", "X-M2-Actor": "OPS-1" } });
  assert.equal(r.status, 200);
  assert.equal(seen[0].role, "farmer");
  assert.equal(seen[0].actor, `AGL-F-${f.user._id}`);
  assert.equal(seen[0].auth, undefined);                            // AgriLink token never leaves the gateway
});

test("operations role picks its farm-operations desk", async () => {
  const o = await login("9000000001", "operations");
  assert.equal(o.user.m2Role, "admin");
  const me = (await api("/ops/me", { method: "PUT", token: o.token, body: { m2Role: "fpo", m2Actor: "FPO-RTN" } })).body;
  assert.equal(me.m2Role, "fpo");
  seen.length = 0;
  await api("/m2/agreements", { token: o.token });
  assert.deepEqual([seen[0].role, seen[0].actor], ["fpo", "FPO-RTN"]);
  const f = await login("9876543210", "farmer");
  assert.equal((await api("/ops/me", { token: f.token })).status, 403);
});

test("AI decision pipeline: every source in parallel, stages in order, next action per role", async () => {
  const f = await login("9876543210", "farmer");
  await api("/farmers/me", { method: "PUT", token: f.token, body: { name: "Ramesh Patil", farm: { village: "Devgad", district: "Sindhudurg", acres: 6, trees: 300, age: 15, irrigation: "drip", fpo: "Devgad Growers FPO" } } });
  const reqs = (await api("/requirements?grade=A", { token: f.token })).body;
  const target = reqs.find((r) => r.buyerName.startsWith("Mustafa"));
  assert.equal((await api("/bonds", { method: "POST", token: f.token, body: { requirementId: target._id, tons: 2 } })).status, 201);

  const j = (await api("/journey", { token: f.token })).body;
  assert.equal(j.deals, 1);
  const d = j.items[0];
  assert.deepEqual(d.stages.map((s) => s.key), ["demand", "price", "profit", "verdict", "agreement", "blockchain", "handoff", "quality", "risk", "harvest", "certification", "escrow", "ratings"]);
  assert.equal(d.sources.length, 7);
  assert.ok(d.sources.every((s) => s.ok), JSON.stringify(d.sources));
  assert.equal(d.stages.find((s) => s.key === "demand").status, "ok");
  assert.equal(d.stages.find((s) => s.key === "price").status, "ok");       // $6.2/kg is above fair
  assert.equal(d.stages.find((s) => s.key === "agreement").action.label, "Complete terms");
  assert.equal(d.stages.find((s) => s.key === "quality").action.to, "/farmer/ops/farmer"); // farmer is sent to photo upload
  assert.ok(d.health > 0 && d.health <= 100);
  assert.equal(d.currentStage, "agreement");

  // same deal, other viewers
  const o = await login("9000000001", "operations");
  const od = (await api(`/journey/${d.agreementId}`, { token: o.token })).body;
  assert.equal(od.stages.find((s) => s.key === "quality").action.to, "/ops/farm/reviews");
  assert.equal((await api(`/contracts/${d.agreementId}`, { token: o.token })).status, 200);  // read-only access
  assert.equal((await api(`/contracts/${d.agreementId}/send`, { method: "POST", token: o.token })).status, 404);
  const other = await login("6500000004", "buyer");
  assert.equal((await api(`/journey/${d.agreementId}`, { token: other.token })).status, 404);
});

test("landing contact form: public send, operations can read", async () => {
  assert.equal((await api("/contact", { method: "POST", body: { name: "A", contact: "x", message: "" } })).status, 400);
  const ok = await api("/contact", { method: "POST", body: { name: "Sunita More", contact: "9800000000", role: "Farmer", message: "How do I join my FPO?" } });
  assert.equal(ok.status, 201);
  const f = await login("9876543210", "farmer");
  assert.equal((await api("/contact", { token: f.token })).status, 403);
  const o = await login("9000000001", "operations");
  const list = (await api("/contact", { token: o.token })).body;
  assert.equal(list[0].name, "Sunita More");
  assert.equal(list[0].ip, undefined);
});
