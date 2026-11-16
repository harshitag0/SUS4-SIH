import { User } from "../users/model.js";
import { MessageLog } from "./model.js";
import { ProviderError, indianNumber, messagingMode, smsProvider, ttsProvider, whatsappProvider } from "./providers.js";
import { LANG_CODES, SPEECH_CODES, TEMPLATES, render } from "./templates.js";

/**
 * Farmer messaging over WhatsApp, SMS and (optionally) WhatsApp voice notes.
 *   - Templates are rendered in the farmer's language (templates.js).
 *   - Every attempt is written to MessageLog with its real outcome; simulated mode is labelled as such.
 *   - Retryable failures (network, 5xx, 429) are retried with backoff (2, 10, 30 minutes), max 3 attempts.
 *   - Provider webhooks update delivered / read / failed.
 * Providers are created from environment variables; tests inject fakes.
 */
const BACKOFF_MIN = [2, 10, 30];
const MAX_ATTEMPTS = 3;
const mask = (n) => (n ? `${String(n).slice(0, 4)}••••${String(n).slice(-2)}` : "");

export function createMessenger(inject = {}) {
  const P = () => ({ whatsapp: inject.whatsapp || whatsappProvider(), sms: inject.sms || smsProvider(), tts: inject.tts || ttsProvider() });
  const mode = () => inject.mode || messagingMode();

  function status() {
    const p = P();
    return { mode: mode(),
      whatsapp: { provider: p.whatsapp.name, configured: p.whatsapp.configured, live: mode() !== "simulated" && p.whatsapp.configured },
      sms: { provider: p.sms.name, configured: p.sms.configured, live: mode() !== "simulated" && p.sms.configured, dltRequired: !!p.sms.needsDlt },
      voice: { provider: p.tts.name, configured: p.tts.configured && p.whatsapp.configured },
      webhooks: { whatsappVerifyToken: !!process.env.WHATSAPP_VERIFY_TOKEN, whatsappAppSecret: !!process.env.WHATSAPP_APP_SECRET, smsToken: !!process.env.SMS_WEBHOOK_TOKEN } };
  }

  const event = (log, status, detail) => { log.events.push({ at: new Date(), status, detail: detail ? String(detail).slice(0, 300) : undefined }); };

  async function attempt(log, user, extra = {}) {
    const p = P(), m = mode();
    const prov = log.channel === "sms" ? p.sms : p.whatsapp;
    log.attempts += 1;
    if (log.channel === "voice") {
      const windowOpen = user?.waLastInboundAt && Date.now() - new Date(user.waLastInboundAt) < 24 * 3600 * 1000;
      if (m !== "simulated" && (!p.tts.configured || !p.whatsapp.configured)) { log.status = "skipped"; event(log, "skipped", "voice needs TTS_PROVIDER + WhatsApp credentials"); return log.save(); }
      if (m !== "simulated" && !windowOpen) { log.status = "skipped"; event(log, "skipped", "WhatsApp only allows free-form audio within 24 h of the farmer's last message"); return log.save(); }
    }
    if (m === "simulated" || (!prov.configured && m === "auto") || (log.channel === "voice" && m === "auto" && !p.tts.configured)) {
      log.status = "simulated"; log.mode = "simulated"; log.provider = prov.name;
      event(log, "simulated", m === "simulated" ? "MESSAGING_MODE=simulated" : `${prov.name} not configured — development mode, nothing was sent`);
      return log.save();
    }
    if (!prov.configured) { log.status = "failed"; log.mode = "live"; log.lastError = `${prov.name} not configured`; event(log, "failed", log.lastError); return log.save(); }
    log.mode = "live"; log.provider = prov.name;
    try {
      let r;
      const to = indianNumber(user.mobile);
      if (log.channel === "whatsapp") r = await p.whatsapp.sendTemplate({ to, key: log.template, langCode: LANG_CODES[log.lang] || "en", params: log.params });
      else if (log.channel === "sms") r = await p.sms.send({ to, key: log.template, lang: log.lang, body: log.body, params: log.params });
      else {
        const audio = await p.tts.synthesize(extra.voiceText || log.body, SPEECH_CODES[log.lang] || "en-IN");
        r = await p.whatsapp.sendAudio({ to, audio });
      }
      log.status = "sent"; log.providerId = r.providerId; log.retryable = false; log.nextRetryAt = undefined; log.lastError = undefined;
      event(log, "sent", `accepted by ${prov.name}`);
    } catch (e) {
      const retry = e instanceof ProviderError ? e.retryable : true;
      log.status = "failed"; log.lastError = String(e.message).slice(0, 300);
      log.retryable = retry && log.attempts < MAX_ATTEMPTS;
      log.nextRetryAt = log.retryable ? new Date(Date.now() + BACKOFF_MIN[log.attempts - 1] * 60000) : undefined;
      event(log, "failed", `${log.lastError}${log.retryable ? " — will retry" : ""}`);
    }
    return log.save();
  }

  /** Send one template to a farmer on every channel they allow. Returns the log rows. */
  async function dispatch(userOrId, key, params, { source, dedupeKey, voiceText, channels } = {}) {
    const user = userOrId?._id ? userOrId : await User.findById(userOrId);
    if (!user || user.role !== "farmer" || !TEMPLATES[key]) return [];
    if (dedupeKey && await MessageLog.exists({ user: user._id, template: key, dedupeKey })) return [];
    const r = render(key, user.lang || "en", params);
    const want = channels || [
      user.notify?.whatsapp !== false && "whatsapp",
      r.sms && user.notify?.sms !== false && "sms",
      user.notify?.voice && voiceText && "voice",
    ].filter(Boolean);
    const out = [];
    for (const channel of want) {
      const log = new MessageLog({ user: user._id, channel, template: key, lang: r.lang, to: mask(indianNumber(user.mobile)), body: channel === "voice" ? voiceText : r.body,
        params: r.ordered, status: "queued", dedupeKey, source, events: [{ at: new Date(), status: "queued" }] });
      out.push(await attempt(log, user, { voiceText }));
    }
    return out;
  }

  async function retryDue() {
    const due = await MessageLog.find({ status: "failed", retryable: true, nextRetryAt: { $lte: new Date() }, attempts: { $lt: MAX_ATTEMPTS } }).limit(50);
    for (const log of due) await attempt(log, await User.findById(log.user));
    return due.length;
  }

  const MAP = { sent: "sent", delivered: "delivered", read: "read", failed: "failed", undelivered: "failed", delivrd: "delivered", "1": "delivered", "2": "failed" };
  async function updateByProviderId(providerId, raw, detail) {
    const st = MAP[String(raw).toLowerCase()];
    if (!providerId || !st) return false;
    const log = await MessageLog.findOne({ providerId });
    if (!log) return false;
    const order = ["queued", "sent", "delivered", "read"];
    if (st === "failed" || order.indexOf(st) > order.indexOf(log.status)) { log.status = st; if (st === "failed") { log.lastError = detail || "reported failed by provider"; log.retryable = false; } }
    event(log, st, detail || "provider webhook");
    await log.save();
    return true;
  }

  /** WhatsApp webhook payload: delivery statuses and inbound messages (opens the 24-h window for voice notes). */
  async function handleWhatsApp(payload) {
    let n = 0;
    for (const entry of payload?.entry || []) for (const ch of entry.changes || []) {
      const v = ch.value || {};
      for (const s of v.statuses || []) if (await updateByProviderId(s.id, s.status, s.errors?.[0]?.title)) n++;
      for (const m of v.messages || []) {
        const last10 = String(m.from || "").slice(-10);
        await User.updateOne({ mobile: last10 }, { waLastInboundAt: new Date() });
      }
    }
    return n;
  }

  /** SMS delivery reports (MSG91 / Twilio / generic). */
  async function handleSms(provider, body) {
    if (provider === "twilio") return updateByProviderId(body.MessageSid, body.MessageStatus, body.ErrorMessage);
    const rows = Array.isArray(body) ? body : body?.data || [body];
    let n = 0;
    for (const r of rows) if (await updateByProviderId(r.requestId || r.request_id || r.id, r.status || r.report?.[0]?.status, r.description || r.reason)) n++;
    return n;
  }

  return { status, dispatch, retryDue, handleWhatsApp, handleSms, attempt };
}
