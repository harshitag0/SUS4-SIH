import { Router } from "express";
import { z } from "zod";
import { HttpError, wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { Agreement } from "../contracts/model.js";
import { User } from "../users/model.js";
import { buildJourney } from "./service.js";

/** AI Decision Center: every deal as one pipeline across Module 1 + Module 2, computed concurrently. */
export default function journeyModule({ ml, contractDeps, weather }) {
  const r = Router();
  r.use(requireAuth());
  const scope = (auth) => (auth.role === "operations" ? {} : { [auth.role === "farmer" ? "farmer" : "buyer"]: auth.id });
  const deps = () => ({ ml, chain: contractDeps?.chain, weather });

  r.get("/", wrap(async (req, res) => {
    const t0 = Date.now();
    const list = await Agreement.find(scope(req.auth)).sort({ updatedAt: -1 }).limit(20);
    // all deals in parallel, and inside each deal all sources in parallel
    const items = await Promise.all(list.map((a) => buildJourney(a, req.auth, deps())));
    res.json({ items, computedInMs: Date.now() - t0, deals: items.length });
  }));

  r.get("/:id", wrap(async (req, res) => {
    const a = await Agreement.findOne({ agreementId: req.params.id, ...scope(req.auth) });
    if (!a) throw new HttpError(404, "Deal not found");
    res.json(await buildJourney(a, req.auth, deps()));
  }));

  return { path: "/journey", router: r };
}

/** Operations users: which farm-operations role they act in (AgriLink operations, FPO officer, farmer doctor). */
export function opsModule() {
  const r = Router();
  r.use(requireAuth("operations"));
  r.get("/me", wrap(async (req, res) => res.json(await User.findById(req.auth.id))));
  r.put("/me", wrap(async (req, res) => {
    const b = z.object({ m2Role: z.enum(["admin", "fpo", "doctor"]), m2Actor: z.string().min(2).max(40) }).parse(req.body);
    res.json(await User.findByIdAndUpdate(req.auth.id, { m2Role: b.m2Role, m2Actor: b.m2Role === "admin" ? "OPS-1" : b.m2Actor }, { new: true }));
  }));
  return { path: "/ops", router: r };
}
