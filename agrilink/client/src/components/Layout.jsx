import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/index.jsx";
import { LangChips } from "./ui.jsx";
import Icon from "./Icon.jsx";
import NotificationBell from "./NotificationBell.jsx";
import { ChatBubble } from "../pages/assistant/Assistant.jsx";
import { FarmOpsProvider, OpsRolePicker, ROLE_LABEL, useOpsNav } from "../pages/m2/FarmOps.jsx";

export function Brand({ to = "/" }) {
  const nav = useNavigate();
  const { t } = useI18n();
  return (
    <a className="brand" href={to} onClick={(e) => { e.preventDefault(); nav(to); }}>
      <span className="brand-mark"><Icon name="leaf" size={20} /></span>
      <span><div className="brand-name">Agri<span>Link</span></div><div className="brand-tag">{t("brand_tag")}</div></span>
    </a>
  );
}

const NAV = {
  farmer: [
    ["/farmer/home", "home", "n_home"], ["/farmer/assistant", "chat", "n_assistant"], ["/farmer/advice", "target", "n_advice"], ["/farmer/decisions", "zap", "n_decisions"], ["/farmer/offers", "offers", "n_offers"], ["/farmer/demand", "demand", "n_demand"],
    ["/farmer/price", "price", "n_price"], ["/farmer/profit", "profit", "n_profit"], ["/farmer/agreements", "agreements", "n_bonds"], ["/farmer/stages", "sprout", "n_stages"], ["/farmer/certificates", "shield", "n_certs"],
    ["/farmer/profile", "profile", "n_profile"],
  ],
  buyer: [["/buyer/decisions", "zap", "n_decisions"], ["/buyer", "dashboard", "n_dashboard", true], ["/buyer/certificates", "shield", "n_certs"]],
  operations: [["/ops/decisions", "zap", "n_decisions"], ["/ops/stage-reviews", "checkCircle", "n_stage_reviews"], ["/ops/agronomist", "target", "n_agronomist"], ["/ops/messages", "bell", "n_messages_ops"], ["/ops/certificates", "shield", "n_certs"]],
};
const PORTAL = { farmer: "portal_farmer", buyer: "portal_buyer", operations: "portal_ops" };

const initials = (s = "") => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "A";

/** Logged-in shell: one sidebar for the whole platform — AI decisions, the portal's own pages, farm operations
 *  (Module 2) and digital agreements — top bar, content, bottom nav (mobile). */
export function Shell({ role }) {
  return <FarmOpsProvider><ShellInner role={role} /></FarmOpsProvider>;
}

function ShellInner({ role }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const items = NAV[role];
  const ops = useOpsNav();
  const opsItems = ops.flatMap((g) => g.items);
  const current = items.find(([to, , , end]) => (end ? pathname === to : pathname.startsWith(to)));
  const currentOps = !current && [...opsItems].sort((a, b) => b.to.length - a.to.length).find((i) => pathname.startsWith(i.to));
  const name = role === "farmer" ? user?.name : role === "operations" ? ROLE_LABEL[user?.m2Role || "admin"] : user?.company || user?.name || t("buyer");
  const subtitle = role === "farmer" ? `${user?.farm?.village || ""}${user?.farm?.district ? ", " + t("d_" + user.farm.district) : ""}` : role === "operations" ? user?.m2Actor || "" : t("portal_buyer");
  const out = () => { logout(); nav("/"); };

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand to={items[0][0]} />
        <div className="side-label">{t(PORTAL[role])}</div>
        <nav className="side-nav">
          {items.map(([to, icon, label, end]) => (
            <NavLink key={to} to={to} end={!!end} className={({ isActive }) => (isActive ? "on" : "")}><Icon name={icon} />{t(label)}</NavLink>
          ))}
        </nav>
        {ops.length > 0 && <div className="side-label" style={{ marginTop: 14 }}>{t("m2_link")}</div>}
        <nav className="side-nav">
          {ops.flatMap((g) => g.items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? "on" : "")}><Icon name={g.icon} />{i.label}</NavLink>
          )))}
        </nav>
        <div className="side-label" style={{ marginTop: 14 }}>{t("trust_label")}</div>
        <nav className="side-nav">
          <NavLink to="/contracts"><Icon name="shield" />{t("trust_link")}</NavLink>
        </nav>
        <div className="side-foot">
          <div className="user-card">
            <span className="avatar">{initials(name)}</span>
            <div className="who"><b>{name}</b><span>{subtitle}</span></div>
          </div>
          <button className="linkbtn" style={{ padding: "6px 8px" }} onClick={out}><Icon name="logout" size={16} />{t("logout")}</button>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <div className="crumb">{t(currentOps ? "m2_link" : PORTAL[role])} / <b>{current ? t(current[2]) : currentOps?.label || ""}</b></div>
          <div className="mobile-brand"><span className="brand-mark"><Icon name="leaf" size={16} /></span><b>Agri<span>Link</span></b></div>
          <div className="top-actions">
            <OpsRolePicker />
            <LangChips />
            <NotificationBell />
            <button className="bell" onClick={out} title={t("logout")} aria-label={t("logout")}><Icon name="logout" size={17} /></button>
          </div>
        </header>
        <main className="content"><Outlet /></main>
        {role === "farmer" && <ChatBubble />}
      </div>

      <nav className="bnav">
        {items.slice(0, 4).map(([to, icon, label, end]) => (
          <NavLink key={to} to={to} end={!!end} className={({ isActive }) => (isActive ? "on" : "")}><Icon name={icon} size={20} />{t(label)}</NavLink>
        ))}
        {opsItems[0] && <NavLink to={opsItems[0].to} end={opsItems[0].end}><Icon name="sprout" size={20} />{t("n_ops")}</NavLink>}
      </nav>
    </div>
  );
}
