/** Read-only access to farm operations (Module 2) for certification: lots, quality reviews, doctor visits, photo checks. */
const base = () => process.env.M2_API_URL || "http://127.0.0.1:8100/api/m2";

export async function m2Get(path, query) {
  const url = new URL(base().replace(/\/$/, "") + path);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { headers: { "X-M2-Role": "admin", "X-M2-Actor": "agrilink-certification" }, signal: AbortSignal.timeout(8000) });
  } catch {
    const e = new Error("Farm operations service (Module 2) is not reachable"); e.status = 502; throw e;
  }
  if (res.status === 404) return null;
  if (!res.ok) { const e = new Error(`Module 2 responded ${res.status}`); e.status = 502; throw e; }
  return res.json();
}

/** Module 2 ids for people Module 1 synced: AGL-F-<userId> (farmer), AGL-B-<userId> (buyer). */
export const userIdFrom = (m2Id, prefix) => (m2Id && m2Id.startsWith(prefix) ? m2Id.slice(prefix.length) : null);
