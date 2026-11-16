import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { notifText, useRealtime } from "../context/RealtimeContext.jsx";
import { useI18n } from "../i18n/index.jsx";
import Icon from "./Icon.jsx";

const ICON = { req_new: "offers", bond_new: "agreements", bond_signed: "pen", bond_active: "checkCircle", bond_declined: "xCircle", weather: "rain", contract_sign_request: "pen", contract_signed_by: "pen", contract_registered: "shield", contract_amended: "agreements", contract_milestone: "checkCircle", contract_disputed: "alert", contract_declined: "xCircle", certificate_issued: "shield", certificate_revoked: "xCircle", stage_review_request: "checkCircle", stage_decision: "sprout", advisory_new: "target" };

function target(n, role) {
  if (n.type === "advisory_new") return "/farmer/advice";
  if (n.type === "advisory_help_answered") return `/farmer/advice/${n.data?.itemId}`;
  if (n.type === "advisory_help") return "/ops/agronomist";
  if (n.type === "stage_review_request") return `/ops/stage-reviews/${n.data?.assessmentId}`;
  if (n.type === "stage_decision") return `/farmer/stages/${n.data?.cropId}`;
  if (n.type.startsWith("certificate_") && n.data?.certificateId) return `${role === "buyer" ? "/buyer" : role === "operations" ? "/ops" : "/farmer"}/certificates/${n.data.certificateId}`;
  if (n.data?.agreementId && (n.type.startsWith("contract_") || n.type === "bond_new")) return `/contracts/${n.data.agreementId}`;
  if (role === "operations") return "/ops/decisions";
  if (role === "buyer") return "/buyer";
  if (n.type === "req_new") return "/farmer/offers";
  if (n.type === "weather") return "/farmer/home";
  return "/farmer/agreements";
}

export default function NotificationBell() {
  const { user } = useAuth();
  const { t } = useI18n();
  const rt = useRealtime();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user || !rt) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && rt.unread) rt.markAllRead();
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch { /* ignore */ }
  };

  return (
    <div className="bellwrap">
      <button className="bell" onClick={toggle} aria-label={t("notif_title")} title={rt.connected ? "live" : "offline"}>
        <Icon name="bell" size={18} />
        {rt.unread > 0 && <span className="badge">{rt.unread > 9 ? "9+" : rt.unread}</span>}
        <i className={`dot ${rt.connected ? "on" : ""}`} />
      </button>
      {open && (
        <div className="notifpanel">
          <h3>{t("notif_title")}</h3>
          {rt.items.length === 0 && <p className="note">{t("notif_empty")}</p>}
          {rt.items.map((n) => (
            <button key={n._id} className={`notif ${n.read ? "" : "new"}`} onClick={() => { setOpen(false); nav(target(n, user.role)); }}>
              <span className="ic"><Icon name={ICON[n.type] || "bell"} size={16} /></span>
              <div><div>{notifText(n, t)}</div><div className="note">{new Date(n.createdAt).toLocaleString()}</div></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
