import http from "node:http";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { User } from "../users/model.js";
import { m2Id } from "./handoff.js";

/**
 * One sign-in for the whole platform: every Module 2 call goes through the AgriLink API.
 * The gateway verifies the AgriLink JWT and sets Module 2's identity headers on the server:
 *   farmer     → X-M2-Role farmer, X-M2-Actor AGL-F-<userId>   (the id Module 1 synced into Module 2)
 *   buyer      → X-M2-Role buyer,  X-M2-Actor AGL-B-<userId>
 *   operations → the farm-operations role chosen by that user (admin / fpo / doctor) and its actor id
 * Browser-supplied X-M2-* headers are discarded. Public endpoints (lot QR trace, photos, meta, health) need no login.
 * Bodies are streamed untouched, so multipart photo uploads work.
 */
const TARGET = new URL(process.env.M2_API_URL || "http://127.0.0.1:8100/api/m2");
const PUBLIC = [/^\/health$/, /^\/meta$/, /^\/trace\//, /^\/photos\//, /^\/system\/clock$/];

export async function m2Identity(auth) {
  if (auth.role === "farmer") return { role: "farmer", actor: m2Id.farmer(auth.id) };
  if (auth.role === "buyer") return { role: "buyer", actor: m2Id.buyer(auth.id) };
  if (auth.role === "operations") {
    const u = await User.findById(auth.id).select("m2Role m2Actor");
    return { role: u?.m2Role || "admin", actor: u?.m2Actor || "OPS-1" };
  }
  return null;
}

export function forward(req, res, path, identity) {
  const headers = { ...req.headers };
  for (const h of Object.keys(headers)) if (h.toLowerCase().startsWith("x-m2-") || h === "authorization" || h === "host") delete headers[h];
  if (identity) { headers["x-m2-role"] = identity.role; if (identity.actor) headers["x-m2-actor"] = identity.actor; }
  const up = http.request({ hostname: TARGET.hostname, port: TARGET.port, method: req.method, path: TARGET.pathname.replace(/\/$/, "") + path, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) res.status(502).json({ error: { message: "Farm operations service (Module 2) is not running" } }); });
  req.pipe(up);
}

export function m2Gateway({ notifier } = {}) {
  return async (req, res) => {
    // any successful change in farm operations refreshes the AI Decision Center live
    if (req.method !== "GET") res.on("finish", () => { if (res.statusCode < 400) notifier?.changed?.("farmops"); });
    const path = req.url; // already stripped of /api/m2
    const h = req.headers.authorization || "";
    let auth = null;
    if (h.startsWith("Bearer ")) { try { const p = jwt.verify(h.slice(7), env.jwtSecret); auth = { id: p.sub, role: p.role }; } catch { /* invalid */ } }
    const isPublic = PUBLIC.some((re) => re.test(path.split("?")[0]));
    if (!auth && !isPublic) return res.status(401).json({ error: { message: "Login required" } });
    forward(req, res, path, auth ? await m2Identity(auth) : null);
  };
}
