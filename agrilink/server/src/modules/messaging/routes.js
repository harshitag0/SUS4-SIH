import { Router } from "express";
import { z } from "zod";
import { HttpError, wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { desk as deskOf } from "../stages/service.js";
import { m2Id } from "../module2/handoff.js";
import { User } from "../users/model.js";
import { MessageLog } from "./model.js";
import { verifyMetaSignature } from "./providers.js";
import { TEMPLATES } from "./templates.js";
import { handleInboundChat, whatsappLink } from "./whatsappChat.js";

/** Message log for farmers (their own) and operations (their FPO / all), channel status, test send. */
export default function messagesModule({ messenger }) {
  const r = Router();
  r.use(requireAuth());
  r.get("/me", wrap(async (req, res) => {
    if (req.auth.role !== "farmer") throw new HttpError(403, "Farmers only", "forbidden");
    res.json(await MessageLog.find({ user: req.auth.id }).sort({ createdAt: -1 }).limit(100).select("-params -dedupeKey"));
  }));
  r.get("/", wrap(async (req, res) => {
    if (req.auth.role !== "operations") throw new HttpError(403, "Operations only", "forbidden");
    const d = await deskOf(req.auth);
    let users = null;
    if (d.role !== "admin") users = (await User.find({ role: "farmer", farm: { $exists: true } }).select("farm")).filter((u) => m2Id.fpo(u.farm) === d.fpoId).map((u) => u._id);
    const q = { ...(users && { user: { $in: users } }), ...(req.query.status && { status: req.query.status }), ...(req.query.channel && { channel: req.query.channel }) };
    const rows = await MessageLog.find(q).sort({ createdAt: -1 }).limit(200).populate("user", "name lang");
    const stats = await MessageLog.aggregate([{ $match: users ? { user: { $in: users } } : {} }, { $group: { _id: { channel: "$channel", status: "$status" }, n: { $sum: 1 } } }]);
    res.json({ status: messenger.status(), stats: stats.map((s) => ({ ...s._id, n: s.n })), rows });
  }));
  // Farmer: "send me today's update now" — the same reminders the hourly job sends, on demand.
  r.post("/me/update", wrap(async (req, res) => {
    if (req.auth.role !== "farmer") throw new HttpError(403, "Farmers only", "forbidden");
    const { Advisory, present } = await import("../advisory/service.js");
    const user = await User.findById(req.auth.id);
    const a = await Advisory.findOne({ farmer: user._id });
    const items = a ? present(a, user.lang || "en").items.filter((i) => ["open", "acknowledged"].includes(i.status)) : [];
    const stamp = Date.now(), source = { kind: "farmer_request", ref: req.auth.id }, sent = [];
    const due = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");
    for (const i of items.slice(0, 2)) sent.push(...await messenger.dispatch(user, "crop_care_reminder", { action: i.action || i.problem, due: due(i.dueDate) }, { source, dedupeKey: `req:${stamp}:${i.itemId}` }));
    const high = items.filter((i) => i.severity === "high");
    if (high.length) sent.push(...await messenger.dispatch(user, "quality_gap", { count: String(high.length), problem: high[0].problem }, { source, dedupeKey: `req:${stamp}:gap`, channels: ["sms"] }));
    res.json({ sent: sent.length, mode: messenger.status().mode, items: items.length });
  }));
  r.post("/test", wrap(async (req, res) => {
    if (req.auth.role !== "operations" || (await deskOf(req.auth)).role !== "admin") throw new HttpError(403, "AgriLink operations only", "forbidden");
    const b = z.object({ userId: z.string(), template: z.enum(Object.keys(TEMPLATES)), params: z.record(z.string()).optional() }).parse(req.body);
    res.json(await messenger.dispatch(b.userId, b.template, b.params || {}, { source: { kind: "test", ref: req.auth.id } }));
  }));
  return { path: "/messages", router: r };
}

/** Public provider webhooks (no login): WhatsApp Cloud API and SMS delivery reports. */
export function webhooksModule({ messenger }) {
  const r = Router();
  // Meta verification handshake
  r.get("/whatsapp", (req, res) => {
    const ok = req.query["hub.mode"] === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN;
    return ok ? res.status(200).send(req.query["hub.challenge"]) : res.sendStatus(403);
  });
  r.post("/whatsapp", wrap(async (req, res) => {
    if (!verifyMetaSignature(req.rawBody, req.get("x-hub-signature-256"))) return res.sendStatus(401);
    await messenger.handleWhatsApp(req.body);
    res.sendStatus(200);
    // Reply after acknowledging: Meta expects a fast 200 and retries slow webhooks.
    handleInboundChat(req.body).catch((e) => console.warn("[whatsapp chat]", e.message));
  }));
  r.post("/sms", wrap(async (req, res) => {
    if (!process.env.SMS_WEBHOOK_TOKEN || req.query.token !== process.env.SMS_WEBHOOK_TOKEN) return res.sendStatus(401);
    await messenger.handleSms(String(req.query.provider || process.env.SMS_PROVIDER || "http").toLowerCase(), req.body);
    res.sendStatus(200);
  }));
  // Public: link that opens WhatsApp chat with the AgriLink business number
  r.get("/whatsapp/link", (req, res) => res.json(whatsappLink(String(req.query.text || "Hi Mitra").slice(0, 200))));
  return { path: "/webhooks", router: r };
}
