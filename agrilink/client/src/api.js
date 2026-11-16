const TOKEN_KEY = "agrilink_token";

// Each tab keeps its own login (sessionStorage), so a farmer and a buyer can be open side by side.
// localStorage remembers the last login for new tabs / next visit.
export const getToken = () => {
  try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try {
    for (const s of [sessionStorage, localStorage]) t ? s.setItem(TOKEN_KEY, t) : s.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
};

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** JSON fetch against the Express API with the bearer token attached. */
export async function api(path, { method = "GET", body } = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body && { "content-type": "application/json" }), ...(token && { authorization: `Bearer ${token}` }) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "Network error");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || "error", data.message || "Request failed");
  return data;
}
