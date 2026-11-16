import Icon from "../../components/Icon.jsx";

/** Shared bits for certificate screens (portal and public pages). */
export const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const kg = (v) => `${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
export const tonnes = (v) => `${(Number(v || 0) / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} t`;
export const gradeMix = (m) => Object.entries(m || {}).map(([g, v]) => `Grade ${g} · ${kg(v)}`).join(", ") || "—";
export const shortHash = (h) => (h ? `${String(h).slice(0, 12)}…${String(h).slice(-8)}` : "—");

const S = {
  valid: ["p-good", "checkCircle", "cert_valid"],
  expired: ["p-warn", "calendar", "cert_expired"],
  revoked: ["p-bad", "xCircle", "cert_revoked"],
};

export function CertStatus({ status, t }) {
  const [cls, icon, key] = S[status] || S.valid;
  return <span className={`pill ${cls}`}><Icon name={icon} size={13} />{t ? t(key) : key.replace("cert_", "")}</span>;
}

/** Lab-style checklist row. */
export function Check({ ok, blocking, label, detail }) {
  const tone = ok ? "p-good" : blocking ? "p-bad" : "p-warn";
  return (
    <li className="cert-check">
      <span className={`pill ${tone}`} style={{ padding: "3px 6px" }}><Icon name={ok ? "check" : blocking ? "x" : "alert"} size={13} /></span>
      <div><b>{label}</b><div className="note">{detail}{!ok && !blocking ? " · warning, does not block" : ""}</div></div>
    </li>
  );
}
