import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../lib/http.js";

export const signToken = (user) => jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, { expiresIn: "30d" });

/** Requires a valid Bearer token; optionally restricts to roles. Sets req.auth = {id, role}. */
export const requireAuth = (...roles) => (req, _res, next) => {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, "Login required", "unauthenticated"));
  try {
    const p = jwt.verify(token, env.jwtSecret);
    req.auth = { id: p.sub, role: p.role };
  } catch {
    return next(new HttpError(401, "Session expired", "unauthenticated"));
  }
  if (roles.length && !roles.includes(req.auth.role)) return next(new HttpError(403, "Not allowed for this role", "forbidden"));
  next();
};
