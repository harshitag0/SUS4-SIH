import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Channel providers. Credentials only come from environment variables. Each provider reports whether it is
 * configured; when it is not (or MESSAGING_MODE=simulated) the service uses SIMULATED delivery, which is logged as
 * "simulated" and never as sent/delivered.
 *
 * send() returns { providerId } on acceptance, or throws ProviderError({ retryable }).
 */
export class ProviderError extends Error {
  constructor(message, { retryable = false, code = null } = {}) { super(message); this.retryable = retryable; this.code = code; }
}

const env = (k, d = "") => (process.env[k] ?? d).trim();
const json = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
export const indianNumber = (mobile) => (String(mobile).replace(/\D/g, "").length === 10 ? `91${String(mobile).replace(/\D/g, "")}` : String(mobile).replace(/\D/g, ""));

async function http(url, opts, label) {
  let res;
  try { res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw new ProviderError(`${label}: network error (${e.message})`, { retryable: true }); }
  const text = await res.text();
  const body = json(text, { raw: text.slice(0, 300) });
  if (!res.ok) throw new ProviderError(`${label} ${res.status}: ${body?.error?.message || body?.message || text.slice(0, 200)}`, { retryable: res.status >= 500 || res.status === 429, code: body?.error?.code || res.status });
  return body;
}

/** WhatsApp Business Cloud API (Meta Graph). Business-initiated messages must use approved templates. */
export function whatsappProvider() {
  const token = env("WHATSAPP_ACCESS_TOKEN"), phoneId = env("WHATSAPP_PHONE_NUMBER_ID"), ver = env("WHATSAPP_API_VERSION", "v21.0");
  const prefix = env("WHATSAPP_TEMPLATE_PREFIX", "agrilink_");
  const base = `https://graph.facebook.com/${ver}/${phoneId}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    name: "whatsapp_cloud", configured: !!(token && phoneId),
    async sendTemplate({ to, key, langCode, params }) {
      const body = { messaging_product: "whatsapp", to, type: "template",
        template: { name: `${prefix}${key}`, language: { code: langCode }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } };
      const r = await http(`${base}/messages`, { method: "POST", headers, body: JSON.stringify(body) }, "WhatsApp");
      return { providerId: r.messages?.[0]?.id };
    },
    /** Free-form text reply: only allowed inside the 24-hour window opened by the farmer's own message. */
    async sendText({ to, text }) {
      const r = await http(`${base}/messages`, { method: "POST", headers, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text.slice(0, 4000) } }) }, "WhatsApp");
      return { providerId: r.messages?.[0]?.id };
    },
    /** Free-form audio: only allowed inside the 24-hour customer-service window opened by the farmer's own message. */
    async sendAudio({ to, audio, mime = "audio/ogg" }) {
      const fd = new FormData();
      fd.append("messaging_product", "whatsapp");
      fd.append("type", mime);
      fd.append("file", new Blob([audio], { type: mime }), "advice.ogg");
      const up = await http(`${base}/media`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd }, "WhatsApp media");
      const r = await http(`${base}/messages`, { method: "POST", headers, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "audio", audio: { id: up.id } }) }, "WhatsApp");
      return { providerId: r.messages?.[0]?.id };
    },
  };
}

/**
 * SMS gateway, chosen by SMS_PROVIDER:
 *   msg91  — MSG91 Flow API (India, DLT): template ids per message/language in SMS_DLT_TEMPLATE_IDS
 *   twilio — Twilio Messages API (international numbers; DLT still applies for Indian recipients via Twilio's registration)
 *   http   — generic JSON webhook: POST SMS_HTTP_URL {to, message, dltTemplateId, entityId, senderId}
 * India: commercial SMS must use a DLT-registered sender (header) and a DLT-registered template; we refuse to send a
 * message whose template id is not configured rather than sending unregistered content.
 */
export function smsProvider() {
  const kind = env("SMS_PROVIDER").toLowerCase();
  const dltIds = json(env("SMS_DLT_TEMPLATE_IDS", "{}"), {});
  const sender = env("SMS_SENDER_ID"), entity = env("SMS_DLT_ENTITY_ID");
  const dltFor = (key, lang) => dltIds[`${key}:${lang}`] || dltIds[key] || null;
  if (kind === "msg91") {
    const auth = env("MSG91_AUTH_KEY");
    return { name: "msg91", configured: !!(auth && sender), needsDlt: true, dltFor,
      async send({ to, key, lang, params }) {
        const tid = dltFor(key, lang);
        if (!tid) throw new ProviderError(`no DLT template id configured for ${key}:${lang}`);
        const recipient = { mobiles: to };
        params.forEach((p, i) => { recipient[`var${i + 1}`] = p; });
        const r = await http("https://control.msg91.com/api/v5/flow/", { method: "POST", headers: { authkey: auth, "content-type": "application/json" },
          body: JSON.stringify({ template_id: tid, sender, short_url: "0", recipients: [recipient] }) }, "MSG91");
        if (r.type && r.type !== "success") throw new ProviderError(`MSG91: ${r.message}`);
        return { providerId: r.message || r.request_id };
      } };
  }
  if (kind === "twilio") {
    const sid = env("TWILIO_ACCOUNT_SID"), tok = env("TWILIO_AUTH_TOKEN"), from = env("TWILIO_FROM");
    return { name: "twilio", configured: !!(sid && tok && from), needsDlt: false, dltFor,
      async send({ to, body }) {
        const form = new URLSearchParams({ To: `+${to}`, From: from, Body: body });
        const cb = env("PUBLIC_API_URL") ? `${env("PUBLIC_API_URL").replace(/\/$/, "")}/api/webhooks/sms?provider=twilio&token=${encodeURIComponent(env("SMS_WEBHOOK_TOKEN"))}` : null;
        if (cb) form.set("StatusCallback", cb);
        const r = await http(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST",
          headers: { authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: form }, "Twilio");
        return { providerId: r.sid };
      } };
  }
  if (kind === "http") {
    const url = env("SMS_HTTP_URL"), token = env("SMS_HTTP_TOKEN");
    return { name: "http", configured: !!url, needsDlt: true, dltFor,
      async send({ to, body, key, lang }) {
        const tid = dltFor(key, lang);
        if (!tid) throw new ProviderError(`no DLT template id configured for ${key}:${lang}`);
        const r = await http(url, { method: "POST", headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
          body: JSON.stringify({ to, message: body, dltTemplateId: tid, entityId: entity, senderId: sender, unicode: /[^\x00-\x7F]/.test(body) }) }, "SMS gateway");
        return { providerId: r.id || r.messageId || r.requestId };
      } };
  }
  return { name: "none", configured: false, needsDlt: false, dltFor, async send() { throw new ProviderError("SMS_PROVIDER not set"); } };
}

/** Optional text-to-speech for regional-language voice notes (Google Cloud Text-to-Speech, OGG/Opus). */
export function ttsProvider() {
  const key = env("GOOGLE_TTS_API_KEY");
  return { name: "google_tts", configured: env("TTS_PROVIDER").toLowerCase() === "google" && !!key,
    async synthesize(text, languageCode) {
      const r = await http(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { text: text.slice(0, 4500) }, voice: { languageCode }, audioConfig: { audioEncoding: "OGG_OPUS" } }) }, "TTS");
      return Buffer.from(r.audioContent, "base64");
    } };
}

/** Meta signs webhook payloads with the app secret (X-Hub-Signature-256). */
export function verifyMetaSignature(rawBody, header) {
  const secret = env("WHATSAPP_APP_SECRET");
  if (!secret) return false;
  if (!header?.startsWith("sha256=") || !rawBody) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function messagingMode() {
  const m = env("MESSAGING_MODE", "auto").toLowerCase();
  return ["auto", "simulated", "live"].includes(m) ? m : "auto";
}
