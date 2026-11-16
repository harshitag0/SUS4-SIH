import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "../api.js";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // Restore session from the stored token. Farmers: /farmers/me; buyers have no profile endpoint, so decode role from the token.
  useEffect(() => {
    (async () => {
      const token = getToken();
      if (!token) return setReady(true);
      try {
        const role = JSON.parse(atob(token.split(".")[1])).role;
        const u = role === "farmer" ? await api("/farmers/me") : role === "operations" ? await api("/ops/me") : { role, ...JSON.parse(localStorage.getItem("agrilink_buyer") || "{}") };
        setUser(u);
        try { localStorage.setItem("agrilink_last_user", JSON.stringify(u)); } catch { /* ignore */ }
      } catch (e) {
        // offline: keep the session and use the last known profile; only a rejected token logs out
        if (e?.status === 0) { try { setUser(JSON.parse(localStorage.getItem("agrilink_last_user"))); } catch { setUser(null); } }
        else setToken(null);
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback(async ({ mobile, otp, role, company }) => {
    const r = await api("/auth/verify", { method: "POST", body: { mobile, otp, role, ...(company && { company }) } });
    setToken(r.token);
    if (r.user.role === "buyer") { try { localStorage.setItem("agrilink_buyer", JSON.stringify({ company: r.user.company, name: r.user.name })); } catch { /* ignore */ } }
    setUser(r.user);
    return r;
  }, []);

  const logout = useCallback(() => {
    setToken(null); setUser(null);
    try { localStorage.removeItem("agrilink_last_user"); localStorage.removeItem("agrilink_outbox"); } catch { /* ignore */ }
    try { caches.delete("agrilink-v1"); } catch { /* no cache API */ }     // offline copies belong to this user only
  }, []);
  const refresh = useCallback(async () => { if (user?.role === "farmer") setUser(await api("/farmers/me")); }, [user]);

  return <AuthCtx.Provider value={{ user, ready, login, logout, refresh, setUser }}>{children}</AuthCtx.Provider>;
}
