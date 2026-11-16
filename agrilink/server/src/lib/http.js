import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// wrap async route handlers so rejections reach the error middleware
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "validation", details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code || err.message, message: err.message });
  console.error(err);
  res.status(500).json({ error: "internal", message: "Something went wrong" });
}
