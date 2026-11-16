import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, getToken } from "../../api.js";
import Icon from "../../components/Icon.jsx";
import WhatsAppButton from "../../components/WhatsAppButton.jsx";
import { useI18n } from "../../i18n/index.jsx";
import "./assistant.css";

/** "Mitra" — farmer chat assistant. Type or speak; replies can be read aloud. */
const SPEECH = { en: "en-IN", hi: "hi-IN", mr: "mr-IN", gu: "gu-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN" };
const S = {
  en: { title: "Mitra", sub: "Your farm friend", hi: "Hi! Ask me anything about your mangoes. Tap the mic to speak.", ph: "Type or tap the mic…", listening: "Listening…", basic: "Basic mode", voiceOn: "Voice on", voiceOff: "Voice off", err: "Couldn't reach me. Check internet and try again.", q: ["What should I do today?", "Will it rain?", "When is my harvest?", "How is my mango quality?"] },
  hi: { title: "मित्र", sub: "आपका खेती साथी", hi: "नमस्ते! आम के बारे में कुछ भी पूछिए। बोलने के लिए माइक दबाएँ।", ph: "लिखें या माइक दबाएँ…", listening: "सुन रहा हूँ…", basic: "सामान्य मोड", voiceOn: "आवाज़ चालू", voiceOff: "आवाज़ बंद", err: "जुड़ नहीं पाया। इंटरनेट देखकर फिर कोशिश करें।", q: ["आज क्या करूँ?", "बारिश होगी?", "कटाई कब है?", "मेरे आम की गुणवत्ता कैसी है?"] },
  mr: { title: "मित्र", sub: "तुमचा शेती मित्र", hi: "नमस्कार! आंब्याबद्दल काहीही विचारा. बोलण्यासाठी माइक दाबा.", ph: "लिहा किंवा माइक दाबा…", listening: "ऐकतोय…", basic: "साधा मोड", voiceOn: "आवाज चालू", voiceOff: "आवाज बंद", err: "जोडता आलं नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.", q: ["आज काय करू?", "पाऊस येईल का?", "काढणी कधी?", "माझ्या आंब्याचा दर्जा कसा आहे?"] },
  gu: { title: "મિત્ર", sub: "તમારો ખેતી સાથી", hi: "નમસ્તે! કેરી વિશે કંઈ પણ પૂછો. બોલવા માટે માઇક દબાવો.", ph: "લખો અથવા માઇક દબાવો…", listening: "સાંભળું છું…", basic: "સાદો મોડ", voiceOn: "અવાજ ચાલુ", voiceOff: "અવાજ બંધ", err: "જોડાઈ શક્યું નહીં. ફરી પ્રયાસ કરો.", q: ["આજે શું કરું?", "વરસાદ આવશે?", "લણણી ક્યારે?", "મારી કેરીની ગુણવત્તા કેવી છે?"] },
  ta: { title: "மித்ரா", sub: "உங்கள் விவசாய நண்பர்", hi: "வணக்கம்! மாம்பழம் பற்றி எதுவும் கேளுங்கள். பேச மைக்கை அழுத்துங்கள்.", ph: "எழுதுங்கள் அல்லது மைக்கை அழுத்துங்கள்…", listening: "கேட்கிறேன்…", basic: "அடிப்படை முறை", voiceOn: "குரல் இயக்கம்", voiceOff: "குரல் நிறுத்தம்", err: "இணைக்க முடியவில்லை. மீண்டும் முயலுங்கள்.", q: ["இன்று என்ன செய்வது?", "மழை வருமா?", "அறுவடை எப்போது?", "என் மாம்பழ தரம் எப்படி?"] },
  te: { title: "మిత్ర", sub: "మీ వ్యవసాయ మిత్రుడు", hi: "నమస్తే! మామిడి గురించి ఏదైనా అడగండి. మాట్లాడటానికి మైక్ నొక్కండి.", ph: "టైప్ చేయండి లేదా మైక్ నొక్కండి…", listening: "వింటున్నాను…", basic: "బేసిక్ మోడ్", voiceOn: "వాయిస్ ఆన్", voiceOff: "వాయిస్ ఆఫ్", err: "కనెక్ట్ కాలేదు. మళ్లీ ప్రయత్నించండి.", q: ["ఈ రోజు ఏం చేయాలి?", "వర్షం పడుతుందా?", "కోత ఎప్పుడు?", "నా మామిడి నాణ్యత ఎలా ఉంది?"] },
  kn: { title: "ಮಿತ್ರ", sub: "ನಿಮ್ಮ ಕೃಷಿ ಗೆಳೆಯ", hi: "ನಮಸ್ಕಾರ! ಮಾವಿನ ಬಗ್ಗೆ ಏನಾದರೂ ಕೇಳಿ. ಮಾತನಾಡಲು ಮೈಕ್ ಒತ್ತಿ.", ph: "ಟೈಪ್ ಮಾಡಿ ಅಥವಾ ಮೈಕ್ ಒತ್ತಿ…", listening: "ಕೇಳುತ್ತಿದ್ದೇನೆ…", basic: "ಬೇಸಿಕ್ ಮೋಡ್", voiceOn: "ಧ್ವನಿ ಆನ್", voiceOff: "ಧ್ವನಿ ಆಫ್", err: "ಸಂಪರ್ಕ ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.", q: ["ಇಂದು ಏನು ಮಾಡಲಿ?", "ಮಳೆ ಬರುತ್ತಾ?", "ಕೊಯ್ಲು ಯಾವಾಗ?", "ನನ್ನ ಮಾವಿನ ಗುಣಮಟ್ಟ ಹೇಗಿದೆ?"] },
};
const STORE = "agrilink_chat";
const Recognition = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

function say(text, lang) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH[lang] || "en-IN";
    const v = speechSynthesis.getVoices().find((x) => x.lang?.toLowerCase().startsWith(u.lang.slice(0, 2).toLowerCase()));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch { /* no speech output */ }
}

export function Chat({ compact = false, onNavigate }) {
  const { lang } = useI18n();
  const s = S[lang] || S.en;
  const [msgs, setMsgs] = useState(() => { try { return JSON.parse(sessionStorage.getItem(STORE)) || []; } catch { return []; } });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem("agrilink_voice") !== "off"; } catch { return true; } });
  const [mode, setMode] = useState(null);
  const [links, setLinks] = useState([]);
  const end = useRef(null), rec = useRef(null);

  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-30))); } catch { /* ignore */ } end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);
  useEffect(() => { api("/assistant/status").then((r) => setMode(r.mode)).catch(() => {}); return () => { try { speechSynthesis.cancel(); rec.current?.abort(); } catch { /* ignore */ } }; }, []);

  const send = async (q) => {
    const content = (q ?? text).trim();
    if (!content || busy) return;
    const next = [...msgs, { role: "user", content }];
    setMsgs(next); setText(""); setBusy(true); setLinks([]);
    try {
      const res = await fetch("/api/assistant/stream", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ lang, messages: next.filter((m) => !m.error).map(({ role, content: c }) => ({ role, content: c })) }) });
      if (!res.ok || !res.body) throw new Error("bad");
      const rd = res.body.getReader(), dec = new TextDecoder();
      let buf = "", acc = "", started = false, final = null;
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const ln = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!ln) continue;
          const ev = JSON.parse(ln);
          if (ev.t === "text") {
            acc += ev.v;
            if (!started) { started = true; setBusy(false); setMsgs((m) => [...m, { role: "assistant", content: acc }]); }
            else setMsgs((m) => m.map((x, k) => (k === m.length - 1 ? { ...x, content: acc } : x)));
          } else if (ev.t === "done") final = ev;
        }
      }
      if (!final) throw new Error("incomplete");
      if (started) setMsgs((m) => m.map((x, k) => (k === m.length - 1 ? { ...x, content: final.reply, lang: final.lang } : x)));
      else setMsgs((m) => [...m, { role: "assistant", content: final.reply, lang: final.lang }]);
      setMode(final.mode); setLinks(final.links || []);
      if (voice) say(final.reply, final.lang || lang);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: s.err, error: true }]);
    } finally { setBusy(false); }
  };

  const mic = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = new Recognition();
    r.lang = SPEECH[lang] || "en-IN"; r.interimResults = true; r.maxAlternatives = 1;
    let final = "";
    r.onresult = (e) => { const t = [...e.results].map((x) => x[0].transcript).join(""); setText(t); if (e.results[e.results.length - 1].isFinal) final = t; };
    r.onend = () => { setListening(false); if (final.trim()) send(final); };
    r.onerror = () => setListening(false);
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
    rec.current = r; setListening(true); r.start();
  };

  const toggleVoice = () => { const v = !voice; setVoice(v); try { localStorage.setItem("agrilink_voice", v ? "on" : "off"); if (!v) speechSynthesis.cancel(); } catch { /* ignore */ } };

  return (
    <div className={`chat ${compact ? "compact" : ""}`}>
      <div className="chat-head">
        <span className="chat-av"><Icon name="leaf" size={20} /></span>
        <div style={{ flex: 1 }}><b>{s.title}</b><div className="chat-sub">{s.sub}</div></div>
        {!compact && <WhatsAppButton className="small" label="WhatsApp" />}
        <button className="chat-icon" onClick={toggleVoice} title={voice ? s.voiceOn : s.voiceOff} aria-label={voice ? s.voiceOn : s.voiceOff}>
          <Icon name={voice ? "volume" : "x"} size={18} />
        </button>
      </div>

      <div className="chat-body">
        <div className="bub bot">{s.hi}</div>
        {msgs.map((m, i) => (
          <div key={i} className={`bub ${m.role === "user" ? "me" : "bot"} ${m.error ? "err" : ""}`}>
            {m.content}
            {m.role === "assistant" && !m.error && <button className="bub-say" onClick={() => say(m.content, m.lang || lang)} aria-label="Listen"><Icon name="volume" size={14} /></button>}
          </div>
        ))}
        {busy && <div className="bub bot typing"><i /><i /><i /></div>}
        {!busy && links.length > 0 && <div className="chat-links">{links.map((l) => <Link key={l.to} to={l.to} onClick={onNavigate}>{l.label}<Icon name="arrowRight" size={13} /></Link>)}</div>}
        {!msgs.length && <div className="chat-quick">{s.q.map((q) => <button key={q} onClick={() => send(q)}>{q}</button>)}</div>}
        <div ref={end} />
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {Recognition && <button type="button" className={`chat-mic ${listening ? "on" : ""}`} onClick={mic} aria-label="Speak"><Icon name={listening ? "stop" : "mic"} size={22} /></button>}
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? s.listening : s.ph} maxLength={1500} />
        <button className="chat-send" disabled={!text.trim() || busy} aria-label="Send"><Icon name="send" size={19} /></button>
      </form>
    </div>
  );
}

/** Full page: /farmer/assistant */
export default function AssistantPage() {
  return <div className="chat-page"><Chat /></div>;
}

/** Floating button on every farmer screen (hidden on the assistant page itself). */
export function ChatBubble() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  if (pathname.startsWith("/farmer/assistant")) return null;
  return (
    <>
      {open && <div className="chat-pop"><button className="chat-close" onClick={() => setOpen(false)} aria-label="Close"><Icon name="x" size={18} /></button><Chat compact onNavigate={() => setOpen(false)} /></div>}
      <button className={`chat-fab ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label="Mitra"><Icon name={open ? "x" : "chat"} size={26} /></button>
    </>
  );
}
