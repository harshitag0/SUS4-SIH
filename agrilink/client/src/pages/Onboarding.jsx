import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/index.jsx";
import FarmForm from "../components/FarmForm.jsx";
import { LangChips } from "../components/ui.jsx";
import { Brand } from "../components/Layout.jsx";

export default function Onboarding() {
  const { t, lang } = useI18n();
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async (body) => {
    setBusy(true); setErr("");
    try {
      setUser(await api("/farmers/me", { method: "PUT", body: { ...body, lang } }));
      nav("/farmer/home", { replace: true });
    } catch { setErr(t("err_generic")); setBusy(false); }
  };
  return (
    <div className="onboard">
      <div className="card livecard">
        <div className="auth-top"><Brand /><LangChips /></div>
        <h2>{t("setup_title")}</h2>
        <p className="sub">{t("setup_sub")}</p>
        <FarmForm initial={user} onSubmit={save} busy={busy} />
        <p className="down">{err}</p>
      </div>
    </div>
  );
}
