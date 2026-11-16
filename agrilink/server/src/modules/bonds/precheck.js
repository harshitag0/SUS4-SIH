import { enrichMany } from "../requirements/routes.js";
import { expectedYield, committedTons, costInputs } from "../farmers/service.js";
import { alertsFor, currentWeather } from "../alerts/routes.js";

/**
 * "Check before you sign": one view of everything the farmer should know about THIS deal.
 *  demand   - is this grade needed in Singapore in the delivery month? (Supply-Demand engine)
 *  price    - is the offer fair for that week? accept / negotiate / sell locally (Price engine)
 *  profit   - what I keep per kg vs what it costs me to grow; profit on these tons vs selling locally (Cost engine)
 *  capacity - do I really have this much Grade A left after my other agreements?
 *  weather  - any severe weather ahead that could make me miss delivery?
 * Each check is ok / warn / bad; the overall verdict is the worst one.
 */
export async function precheck({ user, reqt, tons, ml, weather = currentWeather, excludeTons = 0 }) {
  const farm = user.farm;
  const [deal] = await enrichMany([reqt], ml, farm.district);
  const a = deal.advice;
  const y = expectedYield(farm);
  const free = Math.max(0, +(y.gradeATons - (await committedTons(user._id)) + excludeTons).toFixed(1));
  const [outlook, cost] = await Promise.all([
    ml.outlook("Singapore"),
    ml.costAnalysis(costInputs(user)),
  ]);
  const month = new Date(reqt.deliverBy).getUTCMonth() + 1;
  const g = outlook.by_grade.find((x) => x.grade === reqt.grade) || {};
  const m = outlook.by_month.find((x) => x.month === month);
  const costKg = cost.farm.cost_per_kg;
  const kg = tons * 1000;
  const profit = Math.round(kg * (a.farmerNetInr - costKg));
  const profitLocal = Math.round(kg * (a.marketNetInr - costKg));

  let wx = { alerts: [] };
  try { wx = await alertsFor(user, ml, weather); } catch { /* weather is advisory */ }
  const severe = wx.alerts.filter((x) => x.severity === "high");

  const checks = [
    { key: "demand", status: g.need === "low" ? "warn" : "ok",
      data: { need: g.need || "unknown", grade: reqt.grade, gap: g.gap ?? null, month, monthGap: m?.gap ?? null } },
    { key: "price", status: a.decision === "accept" ? "ok" : a.decision === "negotiate" ? "warn" : "bad",
      data: { decision: a.decision, offerInr: deal.offerInr, fairInr: deal.forecastInr, counterUsd: a.counterOfferUsd, week: a.week } },
    { key: "profit", status: a.farmerNetInr < costKg ? "bad" : a.farmerNetInr < costKg * 1.2 ? "warn" : "ok",
      data: { netKg: a.farmerNetInr, costKg, marginKg: Math.round(a.farmerNetInr - costKg), profit, profitLocal, extra: profit - profitLocal } },
    { key: "capacity", status: tons > free ? "bad" : tons > free * 0.9 ? "warn" : "ok", data: { tons, free } },
    { key: "weather", status: severe.length ? "warn" : "ok", data: { alerts: severe.map((x) => x.code), source: wx.weather?.source } },
  ];
  const rank = { ok: 0, warn: 1, bad: 2 };
  const overall = checks.reduce((w, c) => (rank[c.status] > rank[w] ? c.status : w), "ok");
  return { overall, checks, deal: { buyer: reqt.buyerName, grade: reqt.grade, tons, priceUsd: reqt.priceUsd, deliverBy: reqt.deliverBy } };
}
