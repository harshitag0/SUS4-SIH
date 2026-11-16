import { Router } from "express";
import { wrap, HttpError } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { fetchWeather } from "../../lib/weather.js";
import { User } from "../users/model.js";
import { expectedYield, committedTons } from "../farmers/service.js";

/** Live weather for the farm district; query params (e.g. ?rain_mm_48h=80) simulate a scenario for demos. */
export async function currentWeather(farm, override = {}) {
  const live = await fetchWeather(farm.district);
  return Object.keys(override).length ? { ...live, ...override, source: "simulated" } : live;
}

export async function alertsFor(user, ml, weather, override = {}) {
  const w = await weather(user.farm, override);
  const { source, ...input } = w;
  const out = await ml.alerts({ ...input, grade_a_tons_ready: expectedYield(user.farm).gradeATons, committed_tons: await committedTons(user._id) });
  return { weather: w, alerts: out.alerts };
}

export default function alertsModule({ ml, weather = currentWeather }) {
  const r = Router();
  r.get("/me", requireAuth("farmer"), wrap(async (req, res) => {
    const user = await User.findById(req.auth.id);
    if (!user?.farm) throw new HttpError(409, "Complete your farm profile first", "needs_onboarding");
    const q = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, k === "hail" ? v === "true" : Number(v)]));
    res.json(await alertsFor(user, ml, weather, q));
  }));
  return { path: "/alerts", router: r };
}
