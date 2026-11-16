import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";

/** Landing-page contact form. Public POST (saved for the operations team); operations staff can read them. */
const ContactMessage = mongoose.models.ContactMessage || mongoose.model("ContactMessage", new mongoose.Schema({
  name: String, contact: String, role: String, message: String, ip: String,
}, { timestamps: true }));

const recent = new Map(); // ip -> timestamps, light flood protection
function tooMany(ip) {
  const now = Date.now(), list = (recent.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  list.push(now); recent.set(ip, list);
  return list.length > 5;
}

export default function contactModule({ notifier }) {
  const r = Router();
  r.post("/", wrap(async (req, res) => {
    const b = z.object({
      name: z.string().trim().min(2).max(80), contact: z.string().trim().min(5).max(120),
      role: z.string().trim().max(40).optional(), message: z.string().trim().min(5).max(2000),
    }).parse(req.body);
    if (tooMany(req.ip)) return res.status(429).json({ error: "too_many", message: "Please try again later" });
    const m = await ContactMessage.create({ ...b, ip: req.ip });
    notifier?.changed?.("contact");
    res.status(201).json({ ok: true, id: m._id });
  }));
  r.get("/", requireAuth("operations"), wrap(async (_req, res) => res.json(await ContactMessage.find().sort({ createdAt: -1 }).limit(100).select("-ip"))));
  return { path: "/contact", router: r };
}
