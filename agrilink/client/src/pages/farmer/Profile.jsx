import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useI18n } from "../../i18n/index.jsx";
import FarmForm from "../../components/FarmForm.jsx";
import { LangChips, useToast } from "../../components/ui.jsx";

export default function Profile() {
  const { t, lang } = useI18n();
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const save = async (body) => {
    try { setUser(await api("/farmers/me", { method: "PUT", body: { ...body, lang } })); toast(t("saved")); }
    catch { toast(t("err_generic")); }
  };
  return (
    <>
      <h2>{t("profile_title")}</h2>
      <div className="card"><FarmForm initial={user} onSubmit={save} /></div>
      <div className="card"><h3>{t("choose_lang")}</h3><p className="note" style={{ marginTop: 0 }}>{t("prof_lang_note")}</p><LangChips /></div>
      <Channels user={user} setUser={setUser} t={t} toast={toast} />
      <button className="btn big alt" onClick={() => { logout(); nav("/"); }}>⎋ {t("logout")}</button>
    </>
  );
}

/** How AgriLink reaches the farmer outside the app (WhatsApp / SMS / voice notes). */
function Channels({ user, setUser, t, toast }) {
  const [n, setN] = useState({ whatsapp: user?.notify?.whatsapp !== false, sms: user?.notify?.sms !== false, voice: !!user?.notify?.voice });
  const save = async (next) => {
    setN(next);
    try { setUser(await api("/farmers/me/preferences", { method: "PATCH", body: { notify: next } })); toast(t("saved")); } catch { toast(t("err_generic")); }
  };
  const row = (k) => (
    <label key={k} className="prof-toggle"><input type="checkbox" checked={n[k]} onChange={(e) => save({ ...n, [k]: e.target.checked })} />
      <span><b>{t("prof_" + k)}</b><small className="note">{t("prof_" + k + "_d")}</small></span></label>
  );
  return (
    <div className="card">
      <h3>{t("prof_notify")}</h3>
      <p className="note" style={{ marginTop: 0 }}>{t("prof_notify_d", { mobile: user?.mobile ? `+91 ${user.mobile}` : "" })}</p>
      <div className="prof-toggles">{["whatsapp", "sms", "voice"].map(row)}</div>
    </div>
  );
}
