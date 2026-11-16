import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useRealtime } from "../context/RealtimeContext.jsx";

/**
 * GET a path. `live` lists resources ("requirements", "bonds") whose server-side changes trigger an instant reload
 * over the socket; `refreshMs` is a slow fallback poll in case the socket is down.
 */
export function useApi(path, { refreshMs = 0, enabled = true, live = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const alive = useRef(true);
  const rt = useRealtime();
  const liveKey = live.join(",");

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const d = await api(path);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path, enabled]);

  useEffect(() => {
    alive.current = true;
    setLoading(enabled);
    load();
    const id = refreshMs ? setInterval(load, refreshMs) : null;
    return () => { alive.current = false; if (id) clearInterval(id); };
  }, [load, refreshMs, enabled]);

  useEffect(() => {
    if (!rt || !liveKey) return undefined;
    const wanted = liveKey.split(",");
    return rt.onChange((resource) => { if (wanted.includes(resource)) load(); });
  }, [rt, liveKey, load]);

  return { data, error, loading, reload: load };
}
