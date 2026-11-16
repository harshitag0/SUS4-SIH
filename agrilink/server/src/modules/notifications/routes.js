import { Router } from "express";
import { wrap } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { Notification } from "./model.js";

export default function notificationsModule() {
  const r = Router();
  r.use(requireAuth());

  // Latest notifications + unread count (used on login and as a fallback when the socket is down)
  r.get("/", wrap(async (req, res) => {
    const [items, unread] = await Promise.all([
      Notification.find({ user: req.auth.id }).sort({ createdAt: -1 }).limit(30),
      Notification.countDocuments({ user: req.auth.id, read: false }),
    ]);
    res.json({ items, unread });
  }));

  r.post("/read-all", wrap(async (req, res) => {
    await Notification.updateMany({ user: req.auth.id, read: false }, { read: true });
    res.json({ ok: true });
  }));

  return { path: "/notifications", router: r };
}
