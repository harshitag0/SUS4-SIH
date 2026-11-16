import { HttpError } from "./http.js";

/** Client for the Python ML service. Inject a fake in tests. Price forecasts are cached briefly. */
export function createMl(baseUrl) {
  const cache = new Map();
  const TTL = 10 * 60 * 1000;

  async function call(path, { params, body } = {}) {
    const url = new URL(path, baseUrl);
    if (params) Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    let res;
    try {
      res = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new HttpError(502, "Forecast service unavailable", "ml_unavailable");
    }
    if (!res.ok) throw new HttpError(res.status === 404 || res.status === 422 ? 400 : 502, `ML service error (${res.status})`, "ml_error");
    return res.json();
  }

  async function cached(key, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  return {
    price: (grade = "A", district = "Sindhudurg", demandChangePct = 0) =>
      cached(`p:${grade}:${district}:${Math.round(demandChangePct)}`, () => call("/price/outlook", { params: { grade, district, demand_change_pct: Math.round(demandChangePct) } })),
    costAnalysis: (body) => call("/cost/analysis", { body }),
    evaluate: (district, offers, usdInr) => call("/price/evaluate", { body: { district, offers, usd_inr: usdInr } }),
    outlook: (destination = "Singapore") => cached(`o:${destination}`, () => call("/supply-demand/outlook", { params: { destination } })),
    markets: () => cached("markets", () => call("/supply-demand/markets")),
    recommend: (district, gradeATons, gradeBTons) => call("/supply-demand/recommend", { params: { district, grade_a_tons: gradeATons, grade_b_tons: gradeBTons } }),
    mandi: () => cached("mandi", () => call("/mandi/latest")),
    assess: (body) => call("/grading/assess", { body }),
    alerts: (body) => call("/alerts/evaluate", { body }),
  };
}
