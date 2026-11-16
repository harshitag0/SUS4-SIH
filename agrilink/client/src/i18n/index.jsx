import { createContext, useCallback, useContext, useMemo, useState } from "react";
import en from "./en.json";
import hi from "./hi.json";
import mr from "./mr.json";
import gu from "./gu.json";
import ta from "./ta.json";
import te from "./te.json";
import kn from "./kn.json";

// en / hi / mr cover the whole app; gu / ta / te / kn cover the farmer screens (advice, stages, profile, navigation)
// and fall back to English elsewhere.
const DICT = { en, hi, mr, gu, ta, te, kn };
export const LANGS = [["en", "English"], ["hi", "हिंदी"], ["mr", "मराठी"], ["gu", "ગુજરાતી"], ["ta", "தமிழ்"], ["te", "తెలుగు"], ["kn", "ಕನ್ನಡ"]];
const KEY = "agrilink_lang";
const SPEECH = { en: "en-IN", hi: "hi-IN", mr: "mr-IN", gu: "gu-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN" };

const I18nCtx = createContext(null);
export const useI18n = () => useContext(I18nCtx);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { const l = localStorage.getItem(KEY); return DICT[l] ? l : "en"; } catch { return "en"; }
  });
  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
    document.documentElement.lang = l;
  }, []);

  const value = useMemo(() => {
    const t = (k, v) => {
      let s = (DICT[lang] || DICT.en)[k] ?? DICT.en[k] ?? k;
      if (v) for (const x in v) s = s.split(`{${x}}`).join(v[x]);
      return s;
    };
    // "Mar W4" -> localised month + week
    const wk = (s) => s.replace(/(\w{3}) W(\d)/, (_m, mo, n) => `${t("mo_" + mo)} ${t("wk")}${n}`);
    const speak = (text) => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = SPEECH[lang];
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      } catch { /* no speech support */ }
    };
    return { lang, setLang, t, wk, speak };
  }, [lang, setLang]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}
