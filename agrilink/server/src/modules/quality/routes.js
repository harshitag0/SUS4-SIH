import { Router } from "express";
import { z } from "zod";
import { wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";

/** Quality grading gateway. Today: measurements in -> grade out. Next: photo upload -> CV model -> measurements. */
export default function qualityModule({ ml }) {
  const r = Router();
  r.post("/assess", requireAuth(), wrap(async (req, res) => {
    const body = z.object({
      weight_g: z.coerce.number().positive(),
      colour_idx: z.coerce.number().min(0).max(1),
      blemish_pct: z.coerce.number().min(0).max(100),
      target_grade: z.enum(["A", "B", "C"]).optional(),
    }).parse(req.body);
    res.json(await ml.assess(body));
  }));
  return { path: "/quality", router: r };
}
