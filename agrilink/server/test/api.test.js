// Integration test: needs MongoDB (MONGO_URI, default local). The ML service is replaced by a fake.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { seedIfEmpty } from "../src/seed.js";
import { createNotifier } from "../src/modules/notifications/notifier.js";
import { runWeatherAlerts } from "../src/jobs/weatherAlerts.js";

const fakeMl = {
  price: async (grade = "A", district = "Sindhudurg") => ({
    season_avg: { A: 430, B: 335, C: 237 }[grade], mandi_price: { A: 344, B: 268, C: 190 }[grade],
    harvest_window: { start: "Mar W4", end: "May W1", avg_price: district === "Palghar" ? 380 : 470, drop_pct: 22 },
  }),
  outlook: async (destination = "Singapore") => ({
    destination, demand: 990, has_supply: destination === "Singapore",
    by_grade: [{ grade: "A", demand: 600, need: "high", gap: 200 }, { grade: "B", demand: 290, need: "medium", gap: 30 }, { grade: "C", demand: 100, need: "low", gap: -70 }],
    by_month: [3, 4, 5, 6].map((month) => ({ month, demand: 250, supply: 200, gap: 50 })),
  }),
  markets: async () => [{ destination: "Singapore", demand: 990 }],
  recommend: async (district, a, b) => ({ district, plan: [{ grade: "A", your_tons: a }, { grade: "B", your_tons: b }], top_markets: [] }),
  assess: async (b) => ({ grade: b.weight_g >= 300 ? "A" : "C" }),
  alerts: async (b) => ({ alerts: b.rain_mm_48h >= 50 ? [{ code: "storm", severity: "high", actions: [], params: { tons_at_risk: 1 } }] : [] }),
  evaluate: async (district, offers, usdInr) => offers.map((o) => {
    const fair = { A: 430, B: 335, C: 237 }[o.grade], offer = o.price_usd_kg * usdInr, pct = (offer - fair) / fair;
    const net = offer - 45, mnet = (fair - 45) * 0.94 - 5;
    return {
      id: o.id, offer_inr: Math.round(offer), fair_offer_inr: fair, fair_offer_usd: +(fair / usdInr).toFixed(2), farmer_net_inr: Math.round(net),
      market_net_inr: Math.round(mnet), market_price_inr: fair - 45, market_range_inr: [fair - 80, fair], week_label: "May W2",
      verdict: { status: pct >= 0.03 ? "above" : pct >= -0.07 ? "fair" : "below", pct: +(pct * 100).toFixed(1) },
      vs_mandi_pct: +(((net - mnet) / mnet) * 100).toFixed(1), decision: pct >= -0.03 ? "accept" : "negotiate",
      counter_offer_usd: pct >= -0.03 ? null : +(fair / usdInr).toFixed(2), best_case_usd: null, district,
    };
  }),
  costAnalysis: async (b) => ({
    farm: { cost_per_kg: 115, cost_total: Math.round(b.tons * 1000 * 115) },
    channels: { profit_plan: 1, extra_profit: b.offers_a?.length ? 1000 : 0 }, input: b,
  }),
  mandi: async () => ({ source: "unavailable", reason: "no_api_key", records: [], avg_modal_kg: null }),
};
// Weather is injected so tests never call the real Open-Meteo API
let weatherNow = { rain_mm_48h: 0, wind_kmh: 10, temp_c: 32, hail: false, source: "test" };
const fakeWeather = async (_farm, override = {}) => ({ ...weatherNow, ...override });

let server, base;
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const login = async (mobile, role, extra = {}) => (await api("/auth/verify", { method: "POST", body: { mobile, otp: "1234", role, ...extra } })).body;

before(async () => {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agrilink_test");
  await mongoose.connection.dropDatabase();
  await seedIfEmpty();
  server = createApp({ ml: fakeMl, notifier: createNotifier(null), weather: fakeWeather }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await mongoose.disconnect(); });

const farm = { name: "Ramesh Patil", farm: { village: "Devgad", district: "Sindhudurg", acres: 6, trees: 300, age: 15, irrigation: "drip", fpo: "Devgad Growers FPO" } };

test("auth: wrong OTP rejected, bad mobile rejected, role mismatch rejected", async () => {
  assert.equal((await api("/auth/verify", { method: "POST", body: { mobile: "9876543210", otp: "0000", role: "farmer" } })).status, 401);
  assert.equal((await api("/auth/otp", { method: "POST", body: { mobile: "123" } })).status, 400);
  await login("9111111111", "farmer");
  assert.equal((await api("/auth/verify", { method: "POST", body: { mobile: "9111111111", otp: "1234", role: "buyer" } })).status, 409);
});

test("protected routes need a token and the right role", async () => {
  assert.equal((await api("/requirements")).status, 401);
  const f = await login("9222222222", "farmer");
  assert.equal((await api("/requirements", { method: "POST", token: f.token, body: {} })).status, 403);
});

test("farmer onboarding and personalised summary", async () => {
  const f = await login("9876543210", "farmer");
  assert.equal(f.needsOnboarding, true);
  assert.equal((await api("/farmers/me/summary", { token: f.token })).status, 409);
  assert.equal((await api("/farmers/me", { method: "PUT", token: f.token, body: { name: "X", farm: { village: "V" } } })).status, 400);
  assert.equal((await api("/farmers/me", { method: "PUT", token: f.token, body: farm })).status, 200);
  const s = (await api("/farmers/me/summary", { token: f.token })).body;
  assert.equal(s.expectedTons, 10.5); // 300 trees x 35 kg marketable
  assert.equal(s.gradeATons, 6.3);    // 60% with drip
  assert.equal(s.freeTons, 6.3);
  assert.equal(s.windowAvgPrice, 470);
});

test("buyer posts requirement; farmer sees it enriched with forecast verdict", async () => {
  const b = await login("6599999999", "buyer", { company: "Test Importer" });
  const created = await api("/requirements", { method: "POST", token: b.token, body: { grade: "A", tons: 10, priceUsd: 4.0, deliverBy: "2026-05-10", escalation: { enabled: true, pct: 6 } } });
  assert.equal(created.status, 201);
  assert.equal(created.body.verdict.status, "below"); // 4.0*88=352 vs forecast 430
  const f = await login("9876543210", "farmer");
  const list = (await api("/requirements", { token: f.token })).body;
  assert.ok(list.length >= 5);
  assert.ok(list.some((r) => r.buyerName === "Test Importer"));
  assert.equal((await api("/requirements?grade=B", { token: f.token })).body.every((r) => r.grade === "B"), true);
  const mine = list.find((r) => r.buyerName === "Test Importer");
  assert.equal(mine.advice.decision, "negotiate");
  assert.equal(mine.advice.counterOfferUsd, +(430 / 88).toFixed(2));
  assert.equal(mine.advice.district, "Sindhudurg"); // farmer's own district
});

test("bond flow: capacity check, dual signing, activation, fill update, tamper detection", async () => {
  const f = await login("9876543210", "farmer");
  const reqs = (await api("/requirements", { token: f.token })).body;
  const target = reqs.find((r) => r.buyerName.startsWith("FairPrice"));
  const tooMany = await api("/bonds", { method: "POST", token: f.token, body: { requirementId: target._id, tons: 100 } });
  assert.equal(tooMany.status, 400);
  const draft = await api("/bonds", { method: "POST", token: f.token, body: { requirementId: target._id, tons: 4 } });
  assert.equal(draft.status, 201);
  const id = draft.body._id;
  assert.equal((await api("/farmers/me/summary", { token: f.token })).body.freeTons, 2.3);

  // second bond beyond remaining capacity is rejected
  assert.equal((await api("/bonds", { method: "POST", token: f.token, body: { requirementId: target._id, tons: 3 } })).body.error, "exceeds_capacity");

  const fs = await api(`/bonds/${id}/sign`, { method: "POST", token: f.token });
  assert.equal(fs.body.status, "farmer_signed");
  assert.equal((await api(`/bonds/${id}/sign`, { method: "POST", token: f.token })).status, 409);
  const stranger = await login("9333333333", "farmer");
  assert.equal((await api(`/bonds/${id}/sign`, { method: "POST", token: stranger.token })).status, 404);

  const buyer = await login("6500000001", "buyer");
  const bs = await api(`/bonds/${id}/sign`, { method: "POST", token: buyer.token });
  assert.equal(bs.body.status, "active");
  assert.equal(bs.body.sigs.buyer.prev, bs.body.sigs.farmer.hash);
  assert.equal((await api(`/bonds/${id}/verify`, { token: f.token })).body.ok, true);
  assert.equal((await api(`/bonds/${id}`, { method: "DELETE", token: f.token })).status, 409);

  const after = (await api("/requirements", { token: f.token })).body.find((r) => r._id === target._id);
  assert.equal(after.filled, target.filled + 4);

  await mongoose.connection.collection("bonds").updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { priceUsd: 9 } });
  assert.equal((await api(`/bonds/${id}/verify`, { token: f.token })).body.ok, false);
});

test("market, quality and alerts gateways", async () => {
  const f = await login("9876543210", "farmer");
  const o = (await api("/market/outlook?destination=Singapore", { token: f.token })).body;
  assert.equal(o.demand, 990);
  assert.ok(o.live.byGrade.A.tons > 0);
  assert.equal(o.live.coveragePct.A, +((o.live.byGrade.A.tons / 600) * 100).toFixed(1));
  assert.equal((await api("/market/outlook?destination=UK", { token: f.token })).body.live, undefined);
  const sd = (await api("/farmers/me/supply-demand", { token: f.token })).body;
  assert.equal(sd.district, "Sindhudurg");
  assert.equal(sd.plan[0].your_tons, sd.freeGradeATons);
  assert.equal((await api("/quality/assess", { method: "POST", token: f.token, body: { weight_g: 320, colour_idx: 0.8, blemish_pct: 1 } })).body.grade, "A");
  assert.equal((await api("/alerts/me?rain_mm_48h=80", { token: f.token })).body.alerts[0].code, "storm");
  assert.equal((await api("/alerts/me", { token: f.token })).body.alerts.length, 0);
});

test("notifications: new requirement reaches farmers; bond events reach the other party", async () => {
  const f = await login("9876543210", "farmer");
  const before = (await api("/notifications", { token: f.token })).body.unread;
  const b = await login("6588888888", "buyer", { company: "Notify Foods" });
  const created = await api("/requirements", { method: "POST", token: b.token, body: { grade: "A", tons: 5, priceUsd: 5.5, deliverBy: "2026-05-15" } });
  assert.equal(created.status, 201);

  const nf = (await api("/notifications", { token: f.token })).body;
  assert.equal(nf.unread, before + 1);
  assert.equal(nf.items[0].type, "req_new");
  assert.equal(nf.items[0].data.buyer, "Notify Foods");
  assert.equal(nf.items[0].data.tons, 5);

  // a farmer without a farm profile is not notified
  const bare = await login("9444444444", "farmer");
  assert.equal((await api("/notifications", { token: bare.token })).body.items.length, 0);

  const bond = (await api("/bonds", { method: "POST", token: f.token, body: { requirementId: created.body._id, tons: 2 } })).body;
  const nb = (await api("/notifications", { token: b.token })).body;
  assert.equal(nb.items[0].type, "bond_new");
  assert.equal(nb.items[0].data.tons, 2);

  await api(`/bonds/${bond._id}/sign`, { method: "POST", token: b.token });
  assert.equal((await api("/notifications", { token: f.token })).body.items[0].type, "bond_signed");
  await api(`/bonds/${bond._id}/sign`, { method: "POST", token: f.token });
  assert.equal((await api("/notifications", { token: f.token })).body.items[0].type, "bond_active");
  assert.equal((await api("/notifications", { token: b.token })).body.items[0].type, "bond_active");

  await api("/notifications/read-all", { method: "POST", token: f.token });
  assert.equal((await api("/notifications", { token: f.token })).body.unread, 0);
});

test("live demand is computed from real requirements", async () => {
  const f = await login("9876543210", "farmer");
  const live = (await api("/market/live", { token: f.token })).body;
  const reqs = (await api("/requirements", { token: f.token })).body;
  const expected = +reqs.filter((r) => r.left > 0).reduce((a, r) => a + r.left, 0).toFixed(1);
  assert.equal(live.openTons, expected);
  assert.ok(live.byGrade.A.tons > 0 && live.byGrade.A.avgOfferInr > 0);
  assert.ok(live.newThisWeek >= 1);
  assert.equal((await api("/market/mandi", { token: f.token })).body.source, "unavailable");
});

test("weather job notifies on severe weather once per day", async () => {
  const notifier = createNotifier(null);
  weatherNow = { ...weatherNow, rain_mm_48h: 90 };
  const sent1 = await runWeatherAlerts({ ml: fakeMl, notifier, weather: fakeWeather });
  const sent2 = await runWeatherAlerts({ ml: fakeMl, notifier, weather: fakeWeather });
  weatherNow = { ...weatherNow, rain_mm_48h: 0 };
  assert.ok(sent1 >= 1);
  assert.equal(sent2, 0);
  const f = await login("9876543210", "farmer");
  assert.ok((await api("/notifications", { token: f.token })).body.items.some((n) => n.type === "weather" && n.data.code === "storm"));
});

test("cost & profit study: inputs from the farm, best offers, scenario and saved actual costs", async () => {
  const f = await login("9876543210", "farmer");
  let r = (await api("/farmers/me/costs?diesel_pct=20", { token: f.token })).body;
  assert.equal(r.input.district, "Sindhudurg");
  assert.equal(r.input.tons, 10.5);
  assert.equal(r.input.diesel_pct, 20);
  assert.equal(r.input.target_margin_pct, 20);
  assert.equal(r.input.usd_inr, 88);
  assert.ok(r.input.offers_a.length > 0 && r.input.offers_a.every((o) => o.net_kg > 0 && o.tons > 0)); // open Grade A offers with tons still needed
  assert.equal(r.input.actual, undefined);
  assert.equal((await api("/farmers/me/costs", { method: "PUT", token: f.token, body: { year: 2025, components: { bogus: 1 } } })).status, 400);
  const saved = await api("/farmers/me/costs", { method: "PUT", token: f.token, body: { year: 2025, components: { labour: 400000, irrigation: 60000 } } });
  assert.equal(saved.status, 200);
  r = (await api("/farmers/me/costs", { token: f.token })).body;
  assert.deepEqual(r.input.actual, { year: 2025, components: { labour: 400000, irrigation: 60000 } });
});

test("check before you sign: demand, price, profit, capacity, weather in one verdict", async () => {
  const f = await login("9876543210", "farmer");
  const reqs = (await api("/requirements?grade=A", { token: f.token })).body.filter((x) => x.left > 0);
  const good = reqs.sort((a, b) => b.priceUsd - a.priceUsd)[0];
  let c = (await api(`/bonds/precheck?requirementId=${good._id}&tons=0.2`, { token: f.token })).body;
  const by = Object.fromEntries(c.checks.map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(by), ["demand", "price", "profit", "capacity", "weather"]);
  assert.equal(by.profit.data.costKg, 115);
  assert.equal(by.profit.data.profit, Math.round(200 * (by.profit.data.netKg - 115)));
  assert.equal(by.capacity.status, "ok");
  assert.equal(by.demand.status, "ok");
  assert.equal(by.demand.data.need, "high");
  c = (await api(`/bonds/precheck?requirementId=${good._id}&tons=50`, { token: f.token })).body;
  assert.equal(c.checks.find((x) => x.key === "capacity").status, "bad");
  assert.equal(c.overall, "bad");
  weatherNow = { ...weatherNow, rain_mm_48h: 90 };
  c = (await api(`/bonds/precheck?requirementId=${good._id}&tons=0.2`, { token: f.token })).body;
  weatherNow = { ...weatherNow, rain_mm_48h: 0 };
  assert.equal(c.checks.find((x) => x.key === "weather").status, "warn");
  // existing draft: its own tons don't count against capacity
  const bond = (await api("/bonds", { method: "POST", token: f.token, body: { requirementId: good._id, tons: 0.1 } })).body;
  const own = (await api(`/bonds/${bond._id}/precheck`, { token: f.token })).body;
  assert.equal(own.checks.find((x) => x.key === "capacity").data.tons, 0.1);
  assert.ok(own.checks.find((x) => x.key === "capacity").data.free >= 0.1);
});
