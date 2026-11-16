import { Router } from "express";
import { env } from "../../config/env.js";
import { wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { Requirement } from "../requirements/model.js";

/** Live demand computed from real buyer requirements on the platform (no dummy data). */
export async function liveDemand() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const open = await Requirement.aggregate([
    { $addFields: { left: { $subtract: ["$tons", "$filled"] } } },
    { $match: { left: { $gt: 0 } } },
    { $group: { _id: "$grade", tons: { $sum: "$left" }, buyers: { $addToSet: "$buyer" }, avgUsd: { $avg: "$priceUsd" }, count: { $sum: 1 } } },
  ]);
  const byGrade = Object.fromEntries(["A", "B", "C"].map((g) => {
    const row = open.find((o) => o._id === g);
    return [g, row ? { tons: +row.tons.toFixed(1), requirements: row.count, avgOfferInr: Math.round(row.avgUsd * env.usdInr) } : { tons: 0, requirements: 0, avgOfferInr: null }];
  }));
  return {
    openTons: +open.reduce((a, o) => a + o.tons, 0).toFixed(1),
    buyers: new Set(open.flatMap((o) => o.buyers.map(String))).size,
    newThisWeek: await Requirement.countDocuments({ createdAt: { $gte: weekAgo } }),
    byGrade,
    updatedAt: new Date().toISOString(),
  };
}

/** Gateway to the Python forecasting service (adds auth + caching) plus live platform data. */
export default function marketModule({ ml }) {
  const r = Router();
  r.use(requireAuth());
  r.get("/live", wrap(async (_req, res) => res.json(await liveDemand())));
  r.get("/mandi", wrap(async (_req, res) => res.json(await ml.mandi())));
  r.get("/markets", wrap(async (_req, res) => res.json(await ml.markets())));
  // ML outlook + live AgriLink signal: how much of the forecast need is already confirmed by real buyers
  r.get("/outlook", wrap(async (req, res) => {
    const destination = String(req.query.destination || "Singapore");
    const o = await ml.outlook(destination);
    if (destination !== "Singapore") return res.json(o); // platform buyers are on the Singapore corridor today
    const live = await liveDemand();
    const coverage = Object.fromEntries(o.by_grade.map((g) => [g.grade, g.demand ? +((live.byGrade[g.grade].tons / g.demand) * 100).toFixed(1) : 0]));
    res.json({ ...o, live: { ...live, coveragePct: coverage } });
  }));
  // price outlook; ?demand_change_pct=10 shows how the price reacts if export demand rises 10%
  r.get("/price", wrap(async (req, res) => res.json(await ml.price(req.query.grade, req.query.district, Number(req.query.demand_change_pct || 0)))));
  return { path: "/market", router: r };
}
