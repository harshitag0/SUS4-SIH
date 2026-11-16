import mongoose from "mongoose";
import { Router } from "express";
import { wrap } from "../../lib/http.js";
import { DISTRICT_COORDS, fetchWeather } from "../../lib/weather.js";
import { Agreement } from "../contracts/model.js";
import { Certificate } from "../certificates/model.js";
import { liveDemand } from "../market/routes.js";
import { MessageLog } from "../messaging/model.js";
import { StageAssessment } from "../stages/model.js";

const settle = async (fn) => { try { return { ok: true, ...(await fn()) }; } catch (e) { return { ok: false, error: e.message }; } };
const m2 = () => mongoose.connection.client.db(process.env.M2_DB || "agrilink_m2");

/**
 * Public, aggregate-only live feed for the landing page (no personal data):
 * every number is read from the running system at request time, and each block says where it came from.
 */
export default function liveModule({ ml, contractDeps }) {
  const r = Router();
  let cache = null;

  async function snapshot() {
    const dayAgo = new Date(Date.now() - 864e5);
    const [demand, price, weather, stages, chain, escrow, messages, certs] = await Promise.all([
      settle(async () => liveDemand()),
      settle(async () => {
        const p = await ml.price("A", "Ratnagiri", 0);
        return { fairOffer: p.harvest_window?.fair_offer, bestWeek: p.harvest_window?.best_week, bestPrice: p.harvest_window?.best_price, mandiPrice: p.mandi_price,
          source: p.model?.data_source === "sample" ? "model_sample" : "model", mape: p.model?.metrics?.mape_weekly };
      }),
      settle(async () => {
        const rows = await Promise.all(Object.keys(DISTRICT_COORDS).map(async (d) => ({ district: d, ...(await fetchWeather(d)) })));
        return { districts: rows.map(({ district, rain_mm_48h, temp_c, wind_kmh, hail }) => ({ district, rain_mm_48h, temp_c, wind_kmh, hail,
          alert: hail || rain_mm_48h >= 20 || wind_kmh >= 45 || temp_c >= 40 })), source: rows.every((x) => x.source === "open-meteo") ? "open-meteo" : "fallback" };
      }),
      settle(async () => {
        const [pending, approved, last] = await Promise.all([StageAssessment.countDocuments({ status: "pending_review" }), StageAssessment.countDocuments({ status: "approved" }),
          StageAssessment.findOne().sort({ updatedAt: -1 }).select("updatedAt")]);
        return { pending, approved, updatedAt: last?.updatedAt };
      }),
      settle(async () => {
        const [registered, total, info] = await Promise.all([Agreement.countDocuments({ status: { $in: ["registered", "in_progress", "completed"] } }), Agreement.countDocuments(),
          contractDeps?.chain ? contractDeps.chain.info() : Promise.reject(new Error("no chain"))]);
        return { registered, total, network: info.network, block: info.block };
      }),
      settle(async () => {
        const [s] = await m2().collection("escrow_accounts").aggregate([{ $group: { _id: null, accounts: { $sum: 1 }, released: { $sum: "$paid_to_fpo" }, held: { $sum: "$held" } } }]).toArray();
        return { accounts: s?.accounts || 0, released: s?.released || 0, held: s?.held || 0, simulated: true };
      }),
      settle(async () => {
        const rows = await MessageLog.aggregate([{ $match: { createdAt: { $gte: dayAgo } } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
        const by = Object.fromEntries(rows.map((x) => [x._id, x.n]));
        return { last24h: rows.reduce((a, x) => a + x.n, 0), delivered: (by.delivered || 0) + (by.read || 0) + (by.sent || 0), simulated: by.simulated || 0, failed: by.failed || 0 };
      }),
      settle(async () => {
        const [issued, latest] = await Promise.all([Certificate.countDocuments({ status: "issued" }), Certificate.findOne({ status: "issued" }).sort({ createdAt: -1 }).select("certificateId createdAt")]);
        return { issued, latestId: latest?.certificateId, latestAt: latest?.createdAt };
      }),
    ]);
    return { at: new Date().toISOString(), demand, price, weather, stages, chain, escrow, messages, certs };
  }

  r.get("/", wrap(async (_req, res) => {
    if (!cache || Date.now() - cache.t > 20000) cache = { t: Date.now(), v: await snapshot() };
    res.json(cache.v);
  }));
  return { path: "/public/live", router: r };
}
