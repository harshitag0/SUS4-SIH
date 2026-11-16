import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { HttpError, wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { User } from "../users/model.js";
import { Requirement } from "./model.js";

const input = z.object({
  grade: z.enum(["A", "B", "C"]),
  tons: z.coerce.number().min(1),
  priceUsd: z.coerce.number().min(0.1),
  floorUsd: z.coerce.number().min(0).optional(),
  deliverBy: z.coerce.date(),
  escalation: z.object({ enabled: z.boolean(), pct: z.coerce.number().min(0).max(30) }).default({ enabled: false, pct: 0 }),
});

/** Live mandi modal price (Rs/kg, Grade A level) if the Agmarknet feed is connected, else null. */
async function liveMandi(ml) {
  try {
    const m = await ml.mandi();
    return m.source === "agmarknet" && m.avg_modal_kg ? m.avg_modal_kg : null;
  } catch { return null; } // mandi feed is optional
}

/**
 * Evaluate offers with the price model for the viewer's district and each offer's delivery week:
 * what the farmer keeps, vs selling at the local market, vs the fair price -> accept / negotiate / sell locally.
 */
export async function enrichMany(rows, ml, district = "Sindhudurg") {
  if (!rows.length) return [];
  const evals = await ml.evaluate(district, rows.map((r) => ({
    id: String(r._id), grade: r.grade, price_usd_kg: r.priceUsd,
    deliver_by: new Date(r.deliverBy).toISOString().slice(0, 10), escalation_pct: r.escalation?.enabled ? r.escalation.pct : 0,
  })), env.usdInr);
  const live = await liveMandi(ml);
  const byId = Object.fromEntries(evals.map((e) => [e.id, e]));
  return rows.map((r) => {
    const e = byId[String(r._id)];
    let vsMandiPct = e.vs_mandi_pct, mandiSource = "model";
    if (live) { // live market price replaces the modelled one for the local-market comparison
      const net = live * { A: 1, B: 0.78, C: 0.55 }[r.grade] * 0.94 - 5;
      vsMandiPct = +(((e.farmer_net_inr - net) / net) * 100).toFixed(1);
      mandiSource = "live";
    }
    return {
      ...r.toObject(),
      left: +(r.tons - r.filled).toFixed(1),
      offerInr: e.offer_inr, forecastInr: e.fair_offer_inr, verdict: e.verdict, vsMandiPct, mandiSource,
      advice: {
        decision: e.decision, farmerNetInr: e.farmer_net_inr, marketNetInr: e.market_net_inr, marketPriceInr: e.market_price_inr,
        marketRangeInr: e.market_range_inr, fairOfferUsd: e.fair_offer_usd, counterOfferUsd: e.counter_offer_usd,
        bestCaseUsd: e.best_case_usd, week: e.week_label, district,
      },
    };
  });
}

export default function requirementsModule({ ml, notifier }) {
  const r = Router();

  r.get("/", requireAuth(), wrap(async (req, res) => {
    const filter = {};
    if (req.query.grade) filter.grade = String(req.query.grade);
    if (req.auth.role === "buyer") filter.buyer = req.auth.id;
    const rows = await Requirement.find(filter).sort({ createdAt: -1 });
    // farmers see advice for their own district (harvest timing changes the market price they would get)
    const me = req.auth.role === "farmer" ? await User.findById(req.auth.id).select("farm") : null;
    res.json(await enrichMany(rows, ml, me?.farm?.district || "Sindhudurg"));
  }));

  r.post("/", requireAuth("buyer"), wrap(async (req, res) => {
    const body = input.parse(req.body);
    const buyer = await User.findById(req.auth.id);
    const doc = await Requirement.create({ ...body, buyer: buyer._id, buyerName: buyer.company || buyer.name || buyer.mobile });
    const [out] = await enrichMany([doc], ml);
    // Notify every onboarded farmer immediately (saved for offline farmers too)
    await notifier.toFarmers("req_new", { reqId: String(doc._id), buyer: doc.buyerName, grade: doc.grade, tons: doc.tons, offerInr: out.offerInr, verdict: out.verdict.status });
    notifier.changed("requirements");
    res.status(201).json(out);
  }));

  r.delete("/:id", requireAuth("buyer"), wrap(async (req, res) => {
    const doc = await Requirement.findOneAndDelete({ _id: req.params.id, buyer: req.auth.id });
    if (!doc) throw new HttpError(404, "Requirement not found");
    notifier.changed("requirements");
    res.json({ ok: true });
  }));

  return { path: "/requirements", router: r };
}
