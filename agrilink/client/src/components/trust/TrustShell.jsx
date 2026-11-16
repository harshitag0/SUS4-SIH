import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import Icon from "../Icon.jsx";
import NotificationBell from "../NotificationBell.jsx";

const NAV = [["/contracts", "dashboard", "Dashboard", true], ["/contracts/verify", "shield", "Verify document"], ["/contracts/network", "globe", "Network & contract"]];

/** Navy enterprise shell for the Agreement Registry (shared by buyers and farmers). */
export default function TrustShell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const portal = { farmer: "/farmer/home", buyer: "/buyer", operations: "/ops/decisions" }[user?.role] || "/";
  const name = user?.role === "farmer" ? user?.name : user?.role === "operations" ? "AgriLink operations" : user?.company || user?.name;
  const title = pathname.startsWith("/contracts/verify") ? "Verify document" : pathname.startsWith("/contracts/network") ? "Network & contract"
    : pathname.split("/").length > 2 ? "Agreement" : "Dashboard";
  return (
    <div className="shell trust">
      <aside className="sidebar">
        <a className="brand" href="/contracts" onClick={(e) => { e.preventDefault(); nav("/contracts"); }}>
          <span className="brand-mark"><Icon name="shield" size={19} /></span>
          <span><div className="brand-name">AgriLink <span>Trust</span></div><div className="brand-tag">Agreement Registry · Polygon PoS</div></span>
        </a>
        <div className="side-label">Agreements</div>
        <nav className="side-nav">
          {NAV.map(([to, icon, label, end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "on" : "")}><Icon name={icon} />{label}</NavLink>)}
        </nav>
        <div className="side-label" style={{ marginTop: 14 }}>AgriLink</div>
        <nav className="side-nav"><NavLink to={portal}><Icon name="arrowLeft" />Back to {{ farmer: "farmer portal", buyer: "buyer portal", operations: "operations" }[user?.role]}</NavLink>
          <NavLink to="/m2"><Icon name="sprout" />Farm operations (Module 2)</NavLink></nav>
        <div className="side-foot">
          <div className="user-card">
            <span className="avatar">{(name || "A").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
            <div className="who"><b>{name}</b><span>{{ farmer: "Farmer / FPO signatory", buyer: "Buyer signatory", operations: "Operations (read-only)" }[user?.role]}</span></div>
          </div>
          <button className="linkbtn" style={{ padding: "6px 8px" }} onClick={() => { logout(); nav("/"); }}><Icon name="logout" size={16} />Sign out</button>
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className="crumb">AgriLink Trust / <b>{title}</b></div>
          <div className="mobile-brand"><span className="brand-mark" style={{ background: "#0891b2" }}><Icon name="shield" size={15} /></span><b>AgriLink <span style={{ color: "#0891b2" }}>Trust</span></b></div>
          <div className="top-actions">
            <NotificationBell />
            <button className="bell" title="Back to portal" onClick={() => nav(portal)}><Icon name="home" size={17} /></button>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
      <nav className="bnav">
        {NAV.map(([to, icon, label, end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "on" : "")}><Icon name={icon} size={20} />{label.split(" ")[0]}</NavLink>)}
        <NavLink to={portal}><Icon name="arrowLeft" size={20} />Portal</NavLink>
      </nav>
    </div>
  );
}
