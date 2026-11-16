import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/index.jsx";
import { LangChips } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { WelcomePhoto } from "./Landing.jsx";

const DEMOS = {
  farmer: [
    { mobile: "9876543210", label: "Ramesh Sawant", sub: "Vijaydurg, Sindhudurg · 5 acres · 320 trees" },
    { mobile: "9876543211", label: "Suresh Desai", sub: "Devgad, Sindhudurg · 8 acres · 520 trees" },
    { mobile: "9876543212", label: "Anita Naik", sub: "Ratnagiri · 3 acres · 180 trees" },
  ],
  buyer: [
    { mobile: "6500000001", label: "FairPrice Fresh (Singapore)", sub: "Tan Wei Lin · 30 t this season" },
    { mobile: "6500000002", label: "Mustafa Centre Imports", sub: "Rajesh Iyer · 23 t this season" },
  ],
  operations: [
    { mobile: "9000000001", label: "AgriLink Operations", sub: "Admin desk · All FPOs" },
  ],
};

export default function Login() {
  const { role } = useParams();
  const { t } = useI18n();
  const { login } = useAuth();
  const nav = useNavigate();
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [company, setCompany] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const isFarmer = role === "farmer";
  const isOps = role === "operations";
  const demos = DEMOS[role] || [];

  const go = async (m, o, extra = {}) => {
    setErr("");
    if (!/^\d{10}$/.test(m)) return setErr(t("bad_mobile"));
    try {
      setBusy(true);
      const r = await login({ mobile: m, otp: o, role, ...extra });
      return r;
    } catch (e) {
      setErr(e.code === "bad_otp" ? t("bad_otp") : e.code === "role_mismatch" ? t("err_role") : t("err_generic"));
    } finally { setBusy(false); }
  };
  const after = (r) => r && nav(isFarmer ? (r.needsOnboarding ? "/farmer/onboarding" : "/farmer/home") : isOps ? "/ops/decisions" : "/buyer", { replace: true });

  const submit = async (e) => { e.preventDefault(); after(await go(mobile.trim(), otp.trim(), { company: company.trim() || undefined })); };
  const quick = async (m) => { after(await go(m, "1234")); };

  return (
    <div className="welcome">
      <WelcomePhoto />
      <section className="welcome-panel"><div className="auth-card">
      <div className="auth-top"><button className="linkbtn" onClick={() => nav("/")}><Icon name="arrowLeft" size={16} />{t("back")}</button><LangChips /></div>
      <h2>{isFarmer ? t("login_title") : isOps ? t("i_ops") : t("portal_buyer")}</h2>
      <p className="sub">{t("login_sub")}</p>

      {/* Quick demo logins */}
      {demos.length > 0 && (
        <div className="demo-logins">
          <div className="demo-label">{t("demo_pick") || "Quick login"}</div>
          {demos.map((d) => (
            <button key={d.mobile} type="button" className="demo-user" disabled={busy} onClick={() => quick(d.mobile)}>
              <span className="demo-avatar">{d.label.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}</span>
              <span><b>{d.label}</b><small>{d.sub}</small></span>
              <Icon name="arrowRight" size={16} />
            </button>
          ))}
        </div>
      )}

      <div className="demo-divider"><span>{t("or") || "or"}</span></div>

      <form className="authform" onSubmit={submit}>
        <label>{t("mobile")}</label>
        <input inputMode="numeric" maxLength={10} placeholder="98XXXXXXXX" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        {role === "buyer" && (<><label>Company</label><input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="(first login only)" /></>)}
        <label>{t("otp")}</label>
        <input inputMode="numeric" maxLength={4} placeholder="1234" value={otp} onChange={(e) => setOtp(e.target.value)} />
        <p className="down">{err}</p>
        <button className="btn big" type="submit" disabled={busy}>{busy ? "..." : t("login")}</button>
      </form>
      </div></section>
    </div>
  );
}
