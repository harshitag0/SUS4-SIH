import { useMemo } from "react";
import { M2Provider, Module2Routes, m2NavFor, useM2 } from "@module2";
import { useAction } from "@module2/context.jsx";
import { api, getToken } from "../../api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import Icon from "../../components/Icon.jsx";
import "./m2-theme.css";

/**
 * Farm operations (Module 2) as part of each AgriLink portal — one sign-in, one navigation.
 * The browser sends only the AgriLink token; the API gateway (/api/m2) decides the Module 2 identity on the server:
 * farmer → AGL-F-<id>, buyer → AGL-B-<id>, operations → the role chosen below (AgriLink operations / FPO officer / farmer doctor).
 */
export const OPS_BASE = { farmer: "/farmer/ops", buyer: "/buyer/ops", operations: "/ops/farm" };
export const ROLE_LABEL = { admin: "AgriLink operations", fpo: "FPO officer", doctor: "Farmer doctor", farmer: "Farmer", buyer: "Buyer" };
const GROUP_ICON = { Supply: "truck", Quality: "checkCircle", Risk: "alert", Records: "file" };

const myUserId = () => { try { return JSON.parse(atob(getToken().split(".")[1])).sub; } catch { return null; } };

export function m2AuthFor(user) {
  if (!user) return {};
  if (user.role === "farmer") return { role: "farmer", actorId: `AGL-F-${myUserId()}` };
  if (user.role === "buyer") return { role: "buyer", actorId: `AGL-B-${myUserId()}` };
  return { role: user.m2Role || "admin", actorId: user.m2Actor || "OPS-1" };
}

/** Wraps a whole portal so its sidebar and pages share one Module 2 client. */
export function FarmOpsProvider({ children }) {
  const { user } = useAuth();
  const auth = useMemo(() => m2AuthFor(user), [user]);
  const headers = () => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; };
  return (
    <M2Provider apiBase="/api/m2" basePath={OPS_BASE[user?.role] || "/ops/farm"} auth={auth} getHeaders={headers} key={`${auth.role}:${auth.actorId}`}>
      {children}
    </M2Provider>
  );
}

/** Sidebar groups for the portal: Module 2 pages filtered for this user's role. */
export function useOpsNav() {
  const { auth, to } = useM2();
  return m2NavFor(auth.role).map((g) => ({ group: g.group, icon: GROUP_ICON[g.group] || "file", items: g.items.map((i) => ({ to: to(i.path), label: i.label, end: i.path === "" })) }));
}

function Clock() {
  const { api: m2, auth, meta } = useM2();
  const { run, busy } = useAction();
  if (!meta) return null;
  const now = new Date(meta.now).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const adv = (h, l) => run(() => m2.post("/system/clock/advance", { hours: h }), `Clock moved ${l}; scheduled jobs ran`);
  return (
    <div className="m2x-clock">
      <span className="note">"Season time" · <b>{now} IST</b></span>
      {meta.demo_controls && auth.role === "admin" && (
        <span className="m2x-clock-btns">
          <button className="btn alt small" disabled={busy} onClick={() => adv(6, "+6 h")}>+6 h</button>
          <button className="btn alt small" disabled={busy} onClick={() => adv(24, "+1 day")}>+1 day</button>
          <button className="btn alt small" disabled={busy} onClick={() => adv(168, "+1 week")}>+1 week</button>
          <button className="btn alt small" disabled={busy} onClick={() => window.confirm("Reset all farm-operations data to the start of the season?") && run(() => m2.post("/system/reset-demo"), "Farm operations reset")}>Reset</button>
        </span>
      )}
    </div>
  );
}

/** Operations staff choose which farm-operations desk they work at; saved on their AgriLink account. */
export function OpsRolePicker() {
  const { user, setUser } = useAuth();
  const { meta } = useM2();
  if (user?.role !== "operations") return null;
  const role = user.m2Role || "admin";
  const people = meta?.actors?.[role] || [];
  const save = async (m2Role, m2Actor) => setUser(await api("/ops/me", { method: "PUT", body: { m2Role, m2Actor } }));
  return (
    <div className="m2x-viewas">
      <label className="note">Desk</label>
      <select value={role} onChange={(e) => { const r = e.target.value; save(r, r === "admin" ? "OPS-1" : meta?.actors?.[r]?.[0]?.id || (r === "fpo" ? "FPO-RTN" : "DOC-RTN")); }}>
        {["admin", "fpo", "doctor"].map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}
      </select>
      {role !== "admin" && (
        <select value={user.m2Actor} onChange={(e) => save(role, e.target.value)}>
          {!people.some((p) => p.id === user.m2Actor) && <option value={user.m2Actor}>{user.m2Actor}</option>}
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
    </div>
  );
}

/** The Module 2 pages, rendered inside the portal's content area. */
export default function FarmOpsPage() {
  const { metaError } = useM2();
  return (
    <div className="m2x">
      <div className="m2x-bar"><Clock /></div>
      {metaError && <div className="alertbox"><span className="ic"><Icon name="alert" /></span><div><b>Farm operations service is not running.</b> Start it: <span className="mono">cd module2/backend &amp;&amp; python -m uvicorn app.main:app --port 8100</span></div></div>}
      <Module2Routes />
    </div>
  );
}
