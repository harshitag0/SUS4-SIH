import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, getToken } from "../api.js";
import { useAuth } from "./AuthContext.jsx";
import { useI18n } from "../i18n/index.jsx";
import { useToast } from "../components/ui.jsx";

const RealtimeCtx = createContext(null);
export const useRealtime = () => useContext(RealtimeCtx);

/** Turn a stored notification (type + data) into a sentence in the current language. */
export function notifText(n, t) {
  const d = n.data || {};
  const name = d.by === "buyer" ? d.buyer : d.farmer;
  switch (n.type) {
    case "req_new": return t("n_req_new", { buyer: d.buyer, tons: d.tons, grade: d.grade, price: d.offerInr });
    case "bond_new": return t("n_bond_new", { farmer: d.farmer, tons: d.tons, grade: d.grade, id: d.bondId });
    case "bond_signed": return t("n_bond_signed", { name, id: d.bondId });
    case "bond_active": return t("n_bond_active", { id: d.bondId });
    case "bond_declined": return t("n_bond_declined", { name, id: d.bondId });
    case "contract_sign_request": return t("n_contract_sign_request", { id: d.agreementId });
    case "contract_signed_by": return t("n_contract_signed_by", { who: t("who_" + d.by), id: d.agreementId });
    case "contract_registered": return t("n_contract_registered", { id: d.agreementId, block: d.block });
    case "contract_amended": return t("n_contract_amended", { id: d.agreementId, v: d.version });
    case "contract_milestone": return t("n_contract_milestone", { id: d.agreementId, m: d.key });
    case "contract_disputed": return t("n_contract_disputed", { id: d.agreementId });
    case "contract_declined": return t("n_contract_declined", { id: d.agreementId });
    case "certificate_issued": return t("n_certificate_issued", { id: d.certificateId, lot: d.lotId });
    case "certificate_revoked": return t("n_certificate_revoked", { id: d.certificateId, lot: d.lotId });
    case "stage_review_request": return t("n_stage_review_request", { farmer: d.farmer, stage: d.stage });
    case "stage_decision": return t("n_stage_decision_" + d.decision, { stage: d.stage });
    case "advisory_help": return t("n_advisory_help", { farmer: d.farmer });
    case "advisory_help_answered": return t("n_advisory_help_answered");
    case "advisory_new": return t("n_advisory_new", { count: d.count, problem: d.problem });
    case "weather": return t("n_weather", { alert: t("al_" + d.code), tons: d.tons_at_risk ?? 0 });
    default: return n.type;
  }
}

export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set());
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    try {
      const r = await api("/notifications");
      setItems(r.items);
      setUnread(r.unread);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    if (!user) { setItems([]); setUnread(0); return undefined; }
    load();
    const socket = io({ auth: { token: getToken() }, transports: ["websocket", "polling"] });
    socket.on("connect", () => { setConnected(true); load(); }); // catch up on anything missed while offline
    socket.on("disconnect", () => setConnected(false));
    socket.on("notification", (n) => {
      setItems((xs) => [n, ...xs].slice(0, 30));
      setUnread((u) => u + 1);
      const text = notifText(n, tRef.current);
      toast(text, { long: true });
      try {
        if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("AgriLink", { body: text });
      } catch { /* not supported */ }
    });
    socket.on("data:changed", ({ resource }) => listeners.current.forEach((fn) => fn(resource)));
    return () => socket.disconnect();
  }, [user, load, toast]);

  /** Subscribe to "data changed" pushes; returns an unsubscribe function. */
  const onChange = useCallback((fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn); }, []);

  const markAllRead = useCallback(async () => {
    setUnread(0);
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    try { await api("/notifications/read-all", { method: "POST" }); } catch { /* retry next time */ }
  }, []);

  return <RealtimeCtx.Provider value={{ items, unread, connected, onChange, markAllRead }}>{children}</RealtimeCtx.Provider>;
}
