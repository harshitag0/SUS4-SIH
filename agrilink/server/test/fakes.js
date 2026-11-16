// Shared fakes for tests: ML service shaped like services/ml responses.
export const fakeMl = {
  price: async (grade = "A", district = "Sindhudurg") => ({
    season_avg: { A: 430, B: 335, C: 237 }[grade], mandi_price: { A: 344, B: 268, C: 190 }[grade],
    harvest_window: { start: "Mar W4", end: "May W1", avg_price: district === "Palghar" ? 380 : 470, drop_pct: 22 },
  }),
  outlook: async (destination = "Singapore") => ({
    destination, demand: 990, has_supply: destination === "Singapore",
    by_grade: [{ grade: "A", demand: 600, need: "high", gap: 200 }, { grade: "B", demand: 290, need: "medium", gap: 30 }, { grade: "C", demand: 100, need: "low", gap: -70 }],
    by_month: [3, 4, 5, 6].map((month) => ({ month, demand: 250, supply: 200, gap: 50 })),
  }),
  markets: async () => [{ destination: "Singapore", demand: 990 }],
  recommend: async (district, a, b) => ({ district, plan: [{ grade: "A", your_tons: a }, { grade: "B", your_tons: b }], top_markets: [] }),
  assess: async (b) => ({ grade: b.weight_g >= 300 ? "A" : "C" }),
  alerts: async (b) => ({ alerts: b.rain_mm_48h >= 50 ? [{ code: "storm", severity: "high", actions: [], params: { tons_at_risk: 1 } }] : [] }),
  evaluate: async (district, offers, usdInr) => offers.map((o) => {
    const fair = { A: 430, B: 335, C: 237 }[o.grade], offer = o.price_usd_kg * usdInr, pct = (offer - fair) / fair;
    const net = offer - 45, mnet = (fair - 45) * 0.94 - 5;
    return {
      id: o.id, offer_inr: Math.round(offer), fair_offer_inr: fair, fair_offer_usd: +(fair / usdInr).toFixed(2), farmer_net_inr: Math.round(net),
      market_net_inr: Math.round(mnet), market_price_inr: fair - 45, market_range_inr: [fair - 80, fair], week_label: "May W2",
      verdict: { status: pct >= 0.03 ? "above" : pct >= -0.07 ? "fair" : "below", pct: +(pct * 100).toFixed(1) },
      vs_mandi_pct: +(((net - mnet) / mnet) * 100).toFixed(1), decision: pct >= -0.03 ? "accept" : "negotiate",
      counter_offer_usd: pct >= -0.03 ? null : +(fair / usdInr).toFixed(2), best_case_usd: null, district,
    };
  }),
  costAnalysis: async (b) => ({
    farm: { cost_per_kg: 115, cost_total: Math.round(b.tons * 1000 * 115) },
    channels: { profit_plan: 1, extra_profit: b.offers_a?.length ? 1000 : 0 }, input: b,
  }),
  mandi: async () => ({ source: "unavailable", reason: "no_api_key", records: [], avg_modal_kg: null }),
};
