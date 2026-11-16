import { createContext, useCallback, useContext, useRef, useState } from "react";
import { LANGS, useI18n } from "../i18n/index.jsx";
import { api, getToken } from "../api.js";

export const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
export const lakh = (v, t) => `₹${(v / 1e5).toFixed(1)} ${t("lakh")}`;

/** Language picker (7 languages). A signed-in farmer's choice is saved to their profile, so WhatsApp/SMS use it too. */
export function LangChips() {
  const { lang, setLang } = useI18n();
  const choose = (c) => {
    setLang(c);
    try {
      const tok = getToken();
      if (tok && JSON.parse(atob(tok.split(".")[1])).role === "farmer") api("/farmers/me/preferences", { method: "PATCH", body: { lang: c } }).catch(() => {});
    } catch { /* not signed in */ }
  };
  return (
    <label className="langsel">
      <span className="sr-only">Language</span>
      <select value={lang} onChange={(e) => choose(e.target.value)} aria-label="Language">
        {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
      </select>
    </label>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState("");
  const timer = useRef(null);
  const show = useCallback((m, opts = {}) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(""), opts.long ? 6000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div id="toast" className={msg ? "show" : ""}>{msg}</div>
    </ToastCtx.Provider>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <p className="note">{t("loading")}</p>;
}

export function ErrorBox({ error }) {
  const { t } = useI18n();
  if (!error) return null;
  return <p className="down">{error.code === "ml_unavailable" ? t("err_ml") : t("err_generic")}</p>;
}

export function Modal({ children, onClose }) {
  return (
    <div className="modal show" onClick={onClose}>
      <div className="mbox" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// ---- charts (inline SVG, no dependency) ----
export function LineChart({ series, labels, band, label = "chart" }) {
  const W = 620, H = 250, p = { l: 46, r: 12, t: 12, b: 34 };
  const all = series.flatMap((s) => s.data.filter((v) => v != null));
  const lo = Math.min(...all, ...(band ? band.lo : [])) * 0.9, hi = Math.max(...all, ...(band ? band.hi : [])) * 1.05;
  const x = (i) => p.l + (i * (W - p.l - p.r)) / Math.max(1, labels.length - 1);
  const y = (v) => p.t + (1 - (v - lo) / (hi - lo)) * (H - p.t - p.b);
  const step = Math.ceil(labels.length / 6);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
        {[0, 1, 2, 3, 4].map((k) => {
          const v = lo + ((hi - lo) * k) / 4;
          return <g key={k}><line x1={p.l} x2={W - p.r} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={p.l - 6} y={y(v) + 4} textAnchor="end">{Math.round(v)}</text></g>;
        })}
        {labels.map((l, i) => i % step === 0 && <text key={i} x={x(i)} y={H - 12} textAnchor="middle">{l}</text>)}
        {band && <path d={`M${band.hi.map((v, i) => `${x(i)},${y(v)}`).join("L")}L${band.lo.map((v, i) => `${x(i)},${y(v)}`).reverse().join("L")}Z`} fill="var(--brand)" opacity=".15" />}
        {series.map((s) => (
          <g key={s.name}>
            <polyline fill="none" stroke={s.color} strokeWidth="2.2" strokeDasharray={s.dash ? "6 4" : undefined}
              points={s.data.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ")} />
            {s.dots && s.data.map((v, i) => v != null && <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={s.color}><title>{`${labels[i]}: ${v}`}</title></circle>)}
          </g>
        ))}
      </svg>
      <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
    </>
  );
}

export function HBars({ items, fmt = (v) => v }) {
  const mx = Math.max(...items.map((i) => i.v));
  return items.map((i) => (
    <div key={i.l} style={{ margin: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, gap: 8 }}><span>{i.l}</span><b>{fmt(i.v)}</b></div>
      <div className="bar"><i style={{ width: `${(i.v / mx) * 100}%`, background: i.c || "var(--brand2)" }} /></div>
    </div>
  ));
}
