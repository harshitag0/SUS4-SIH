import { Router } from "express";
import { z } from "zod";
import { HttpError, wrap } from "../../lib/http.js";
import { env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { User } from "../users/model.js";
import { farmSummary, expectedYield, committedTons, costInputs } from "./service.js";
import { Requirement } from "../requirements/model.js";
import { enrichMany } from "../requirements/routes.js";

export const COST_COMPONENTS = ["labour", "fertilizer", "plant_protection", "irrigation", "bagging_materials", "harvest_transport"];

const farmInput = z.object({
  name: z.string().min(1),
  lang: z.enum(["en", "hi", "mr", "gu", "ta", "te", "kn"]).optional(),
  notify: z.object({ whatsapp: z.boolean(), sms: z.boolean(), voice: z.boolean() }).partial().optional(),
  farm: z.object({
    village: z.string().min(1),
    district: z.enum(["Sindhudurg", "Ratnagiri", "Raigad", "Palghar"]),
    acres: z.coerce.number().positive(),
    variety: z.literal("Alphonso").default("Alphonso"),
    trees: z.coerce.number().int().positive(),
    age: z.coerce.number().int().min(1).max(100),
    irrigation: z.enum(["drip", "well", "rain"]),
    fpo: z.string().optional().default(""),
  }),
});

export default function farmersModule({ ml }) {
  const r = Router();
  r.use(requireAuth("farmer"));

  r.get("/me", wrap(async (req, res) => {
    const user = await User.findById(req.auth.id);
    if (!user) throw new HttpError(404, "User not found");
    res.json(user);
  }));

  /** Language and message channels only (the language picker and profile settings call this). */
  r.patch("/me/preferences", wrap(async (req, res) => {
    const b = z.object({ lang: z.enum(["en", "hi", "mr", "gu", "ta", "te", "kn"]).optional(),
      notify: z.object({ whatsapp: z.boolean(), sms: z.boolean(), voice: z.boolean() }).partial().optional() }).parse(req.body);
    const set = { ...(b.lang && { lang: b.lang }), ...Object.fromEntries(Object.entries(b.notify || {}).map(([k, v]) => [`notify.${k}`, v])) };
    res.json(await User.findByIdAndUpdate(req.auth.id, set, { new: true }));
  }));

  r.put("/me", wrap(async (req, res) => {
    const body = farmInput.parse(req.body);
    const user = await User.findByIdAndUpdate(req.auth.id, { name: body.name, farm: body.farm, ...(body.lang && { lang: body.lang }), ...(body.notify && Object.fromEntries(Object.entries(body.notify).map(([k, v]) => [`notify.${k}`, v]))) }, { new: true });
    res.json(user);
  }));

  // Personalised numbers: expected yield, harvest window, price, capacity, earning
  r.get("/me/summary", wrap(async (req, res) => {
    const user = await User.findById(req.auth.id);
    if (!user?.farm) throw new HttpError(409, "Complete your farm profile first", "needs_onboarding");
    res.json(await farmSummary(user, ml));
  }));

  // Personal supply-demand plan: which market / grade / month to target, sized to the farmer's free capacity
  r.get("/me/supply-demand", wrap(async (req, res) => {
    const user = await User.findById(req.auth.id);
    if (!user?.farm) throw new HttpError(409, "Complete your farm profile first", "needs_onboarding");
    const y = expectedYield(user.farm);
    const free = Math.max(0, +(y.gradeATons - (await committedTons(user._id))).toFixed(1));
    const gradeB = Math.max(0, +(y.tons - y.gradeATons - y.tons * 0.15).toFixed(1)); // ~15% is Grade C / local
    res.json({ freeGradeATons: free, gradeBTons: gradeB, ...(await ml.recommend(user.farm.district, free, gradeB)) });
  }));

  // Cost & Profit study: year-by-year, this season's cost, channels (AgriLink vs local), what-if, my costs vs district
  r.get("/me/costs", wrap(async (req, res) => {
    const user = await User.findById(req.auth.id);
    if (!user?.farm) throw new HttpError(409, "Complete your farm profile first", "needs_onboarding");
    const reqs = await Requirement.find({ $expr: { $gt: ["$tons", "$filled"] } });
    const adv = await enrichMany(reqs, ml, user.farm.district);
    // each open offer: what the farmer keeps per kg + how many tons that buyer still needs
    const offers = (g) => adv.filter((r) => r.grade === g && r.left > 0 && r.advice.farmerNetInr > 0)
      .map((r) => ({ net_kg: r.advice.farmerNetInr, tons: r.left }));
    const q = (k) => (req.query[k] !== undefined && req.query[k] !== "" ? Number(req.query[k]) : undefined);
    res.json(await ml.costAnalysis(costInputs(user, {
      offers_a: offers("A"), offers_b: offers("B"),
      wage_pct: q("wage_pct"), diesel_pct: q("diesel_pct"), fertilizer_pct: q("fertilizer_pct"),
      target_margin_pct: q("target_margin_pct") ?? 20, usd_inr: env.usdInr,
    })));
  }));

  // Save what I actually spent last season (per component, Rs) -> compared with the district average
  r.put("/me/costs", wrap(async (req, res) => {
    const body = z.object({
      year: z.coerce.number().int().min(2000).max(2100),
      components: z.record(z.enum(COST_COMPONENTS), z.coerce.number().min(0)),
    }).parse(req.body);
    const user = await User.findById(req.auth.id);
    user.costs = [...(user.costs || []).filter((c) => c.year !== body.year), body];
    await user.save();
    res.json(user.costs);
  }));

  return { path: "/farmers", router: r };
}
