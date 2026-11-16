import mongoose from "mongoose";
import { m2Get, userIdFrom } from "../certificates/m2.js";
import { PLAYBOOK } from "../advisory/knowledge.js";
import { User } from "../users/model.js";
import { word } from "./templates.js";

/**
 * Bridges existing events to WhatsApp / SMS:
 *   1. in-app notifications of farmers (agreements, certificates, stage decisions, storm/hail alerts)
 *   2. farmer messages created by farm operations (Module 2): photo check due, overdue reminder, retake, harvest notice.
 * Each source message is forwarded once (dedupe key = its id).
 */
const fmt = (d) => { const x = new Date(d); return Number.isNaN(+x) ? String(d) : x.toLocaleDateString("en-GB"); };

export function bridgeNotifications(notifier, messenger) {
  notifier.subscribe?.(async (docs) => {
    for (const n of docs) {
      try {
        const u = await User.findById(n.user).select("role lang mobile notify waLastInboundAt");
        if (u?.role !== "farmer") continue;
        const L = u.lang || "en", d = n.data || {};
        const map = {
          contract_sign_request: ["agreement_update", { id: d.agreementId, event: word("ev_sign_request", L) }],
          contract_signed_by: ["agreement_update", { id: d.agreementId, event: word("ev_signed", L) }],
          contract_registered: ["agreement_update", { id: d.agreementId, event: word("ev_registered", L) }],
          certificate_issued: ["agreement_update", { id: d.certificateId, event: word("ev_certificate", L) }],
          stage_decision: ["inspection_result", { result: `${d.stage}: ${word(`dec_${d.decision}`, L)}` }],
          weather: ["quality_warning", { problem: (PLAYBOOK[d.code === "rain" ? "weather_rain" : d.code === "heat" ? "weather_heat" : "weather_storm"][L] || PLAYBOOK.weather_storm.en).problem }],
        }[n.type];
        if (map) await messenger.dispatch(u, map[0], map[1], { source: { kind: "notification", ref: String(n._id) }, dedupeKey: `n:${n._id}` });
      } catch (e) { console.warn("message bridge:", e.message); }
    }
  });
}

const Cursor = mongoose.models.MessagingCursor || mongoose.model("MessagingCursor", new mongoose.Schema({ _id: String, at: Date }));

/** Forward Module 2 farmer messages (sms / whatsapp channel rows) for AgriLink farmers. */
export async function forwardModule2(messenger) {
  let rows;
  try { rows = await m2Get("/notifications", { to_type: "farmer", limit: 300 }); } catch { return 0; }
  const cur = await Cursor.findById("module2");
  const since = cur?.at ? new Date(cur.at) : new Date(Date.now() - 2 * 86400000);
  let n = 0, newest = since;
  for (const r of rows || []) {
    const at = new Date(r.created_at);
    if (!(at > since) || r.channel === "app") continue;
    if (at > newest) newest = at;
    const uid = userIdFrom(r.to_id, "AGL-F-");
    if (!uid || !/^[a-f0-9]{24}$/.test(uid)) continue;
    const subj = String(r.subject || ""), body = String(r.body || "");
    let key = null, params = {};
    if (/^Photo check due/i.test(subj)) { key = "photo_check_due"; params = { deadline: (body.match(/by (.+?)\.?$/) || [])[1] || "" }; }
    else if (/overdue/i.test(subj)) { key = "reinspection_reminder"; params = { date: (body.match(/by (.+?)\.?$/) || [])[1] || "" }; }
    else if (/retake/i.test(subj)) { key = "reinspection_reminder"; params = { date: fmt(at) }; }
    else if (/^Harvest notice/i.test(subj)) { const m = body.match(/Pick ([\d.]+) kg around (\S+)/); key = "harvest_schedule"; params = { kg: m?.[1] || "", date: m?.[2] ? fmt(m[2]) : "" }; }
    if (!key) continue;
    const out = await messenger.dispatch(uid, key, params, { source: { kind: "module2", ref: r.id }, dedupeKey: `m2:${r.id}` });
    if (out.length) n++;
  }
  await Cursor.findByIdAndUpdate("module2", { at: newest }, { upsert: true });
  return n;
}
