import { answer } from "../assistant/routes.js";
import { User } from "../users/model.js";
import { MessageLog } from "./model.js";
import { indianNumber, messagingMode, whatsappProvider } from "./providers.js";

/**
 * Two-way WhatsApp chat with Mitra. A farmer messages the AgriLink business number; the webhook hands each text
 * message here and Mitra replies inside WhatsApp's 24-hour customer-service window (free-form text, no template needed).
 * Short per-number history is kept in memory so replies follow the conversation.
 */
const seen = new Set();
const history = new Map(); // mobile -> { at, turns: [{role, content}] }
const HOURS_24 = 24 * 3600 * 1000;
const mask = (n) => (n ? `${String(n).slice(0, 4)}••••${String(n).slice(-2)}` : "");

const NOT_REGISTERED = (url) =>
  `Namaste! I'm Mitra from AgriLink. This number isn't registered as an AgriLink farmer yet.\n` +
  `नमस्ते! यह नंबर अभी AgriLink पर पंजीकृत नहीं है।\n` +
  `नमस्कार! हा नंबर अजून AgriLink वर नोंदलेला नाही.\n` +
  (url ? `Sign up / नोंदणी: ${url}/login/farmer` : "");
const VOICE_NOTE = {
  en: "I can't listen to voice notes on WhatsApp yet. Please type your question, or use the mic in the AgriLink app.",
  hi: "मैं अभी WhatsApp पर वॉइस नोट नहीं सुन सकता। कृपया सवाल लिखें, या AgriLink ऐप में माइक दबाएँ।",
  mr: "मी अजून WhatsApp वर व्हॉइस नोट ऐकू शकत नाही. कृपया प्रश्न लिहा, किंवा AgriLink ॲपमध्ये माइक दाबा.",
};

/** Text of an inbound message (typed text or a tapped quick-reply button), or null for other types. */
const textOf = (m) => m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || null;

async function send(user, to, text, lang, inject) {
  const wa = inject.whatsapp || whatsappProvider();
  const mode = inject.mode || messagingMode();
  const log = new MessageLog({ user: user?._id, channel: "whatsapp", template: "chat_reply", lang, to: mask(to), body: text, status: "queued",
    source: { kind: "whatsapp_chat" }, events: [{ at: new Date(), status: "queued" }] });
  if (mode === "simulated" || !wa.configured) {
    log.status = "simulated"; log.events.push({ at: new Date(), status: "simulated", detail: "WhatsApp credentials not set" });
  } else {
    try { const r = await wa.sendText({ to, text }); log.providerId = r.providerId; log.status = "sent"; log.events.push({ at: new Date(), status: "sent" }); }
    catch (e) { log.status = "failed"; log.events.push({ at: new Date(), status: "failed", detail: String(e.message).slice(0, 300) }); }
  }
  if (user) await log.save();
  return log;
}

/** Handle the `messages` part of a WhatsApp webhook payload. Returns the replies sent (for logs/tests). */
export async function handleInboundChat(payload, inject = {}) {
  const out = [];
  for (const entry of payload?.entry || []) for (const ch of entry.changes || []) {
    for (const m of ch.value?.messages || []) {
      if (!m.id || seen.has(m.id)) continue; // Meta retries webhooks: answer each message once
      seen.add(m.id); if (seen.size > 5000) seen.delete(seen.values().next().value);
      const from = String(m.from || ""), mobile = from.slice(-10), to = indianNumber(mobile) || from;
      const user = await User.findOne({ mobile, role: "farmer" });
      const lang = user?.lang || "en";
      if (!user) { out.push(await send(null, to, NOT_REGISTERED(process.env.PUBLIC_APP_URL), "en", inject)); continue; }
      const text = textOf(m);
      if (!text) { if (m.type === "audio") out.push(await send(user, to, VOICE_NOTE[lang] || VOICE_NOTE.en, lang, inject)); continue; }

      const h = history.get(mobile);
      const turns = h && Date.now() - h.at < HOURS_24 ? h.turns : [];
      turns.push({ role: "user", content: text.slice(0, 1500) });
      const { reply } = await answer(user._id, turns.slice(-12), lang, inject);
      turns.push({ role: "assistant", content: reply });
      history.set(mobile, { at: Date.now(), turns: turns.slice(-12) });
      out.push(await send(user, to, reply, lang, inject));
    }
  }
  return out;
}

/** wa.me link to the business number, with a greeting pre-filled (WHATSAPP_BUSINESS_NUMBER, digits with country code). */
export function whatsappLink(text = "Hi Mitra") {
  const n = String(process.env.WHATSAPP_BUSINESS_NUMBER || "").replace(/\D/g, "");
  return n ? { number: n, link: `https://wa.me/${n}?text=${encodeURIComponent(text)}` } : { number: null, link: null };
}
