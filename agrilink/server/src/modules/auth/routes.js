import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { HttpError, wrap } from "../../lib/http.js";
import { signToken } from "../../middleware/auth.js";
import { User } from "../users/model.js";

const mobile = z.string().regex(/^\d{10}$/, "10-digit mobile number");

export default function authModule() {
  const r = Router();

  // Step 1: send OTP. Stub: nothing is sent; the demo OTP works for everyone.
  r.post("/otp", wrap(async (req, res) => {
    mobile.parse(req.body.mobile);
    res.json({ sent: true });
  }));

  // Step 2: verify OTP, create the user on first login, return a JWT.
  r.post("/verify", wrap(async (req, res) => {
    const body = z.object({
      mobile,
      otp: z.string(),
      role: z.enum(["farmer", "buyer", "operations"]),
      name: z.string().min(1).optional(),
      company: z.string().min(1).optional(),
    }).parse(req.body);
    if (body.otp !== env.devOtp) throw new HttpError(401, "Wrong OTP", "bad_otp");
    let user = await User.findOne({ mobile: body.mobile });
    if (user && user.role !== body.role) throw new HttpError(409, `This number is registered as a ${user.role}`, "role_mismatch");
    if (!user) user = await User.create({ mobile: body.mobile, role: body.role, name: body.name || (body.role === "operations" ? "AgriLink operations" : undefined), company: body.company,
      ...(body.role === "operations" && { m2Role: "admin", m2Actor: "OPS-1" }) });
    res.json({ token: signToken(user), user, needsOnboarding: user.role === "farmer" && !user.farm });
  }));

  return { path: "/auth", router: r };
}
