import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useI18n } from "../../i18n/index.jsx";
import { useApi } from "../../hooks/useApi.js";
import OfferAdvice from "../../components/OfferAdvice.jsx";
import { ErrorBox, HBars, LineChart, Loading, inr } from "../../components/ui.jsx";

const SCENARIOS = [-20, -10, 0, 10, 20];
const sign = (v) => `${v > 0 ? "+" : ""}${v}%`;

function MandiCard() {
  const { t } = useI18n();
  const m = useApi("/market/mandi").data;
  if (!m) return null;
  return (
    <div className="card">
      <h3>{t("mandi_title")}</h3>
      {m.source !== "agmarknet" ? <p className="note">{t("mandi_none")}</p> : (
        <>
          <div className="big">{inr(m.avg_modal_kg)} <small className="note">{t("per_kg")}</small></div>
          <HBars items={m.records.slice(0, 6).map((r) => ({ l: `${r.market} · ${r.variety || ""} · ${r.date}`, v: r.modal_kg }))} fmt={inr} />
        </>
      )}
    </div>
  );
}

export default function Price() {
  const { t, wk } = useI18n();
  const { user } = useAuth();
  const [grade, setGrade] = useState("A");
  const [demand, setDemand] = useState(0);
  const p = useApi(`/market/price?grade=${grade}&district=${user.farm.district}&demand_change_pct=${demand}`);
  const offers = useApi(`/requirements?grade=${grade}`, { live: ["requirements"] });
  const d = p.data;
  const open = (offers.data || []).filter((r) => r.left > 0).sort((a, b) => b.advice.farmerNetInr - a.advice.farmerNetInr);

  return (
    <>
      <h2>{t("pr_title")}</h2>
      <p className="sub">{t("pr_sub")}</p>
      <div className="chips">{["A", "B", "C"].map((g) => <button key={g} className={`chip ${grade === g ? "on" : ""}`} onClick={() => setGrade(g)}>{t("grade")} {g}</button>)}</div>
      {p.loading && !d && <Loading />}
      <ErrorBox error={p.error} />

      {d && (
        <>
          <div className="card livecard">
            <div className="big">{inr(d.harvest_window.avg_price)} <small className="note">{t("per_kg")}</small></div>
            <p>{t("pr_window", { from: wk(d.harvest_window.start), to: wk(d.harvest_window.end), price: d.harvest_window.avg_price, best: wk(d.harvest_window.best_week), bestp: d.harvest_window.best_price })}</p>
            <p className="insight">{t("pr_fair_ask", { fair: d.harvest_window.fair_offer, usd: (d.harvest_window.fair_offer / 88).toFixed(2), cost: d.export_cost.total })}</p>
          </div>

          <div className="card">
            <h3>{t("pr_choose")}</h3>
            {open.length === 0 && <p className="note">{t("pr_no_offers")}</p>}
            {open.map((r) => (
              <div key={r._id} className="mkrow">
                <div className="offerhead" style={{ marginBottom: 0 }}><b>{r.buyerName}</b><span className="bigprice" style={{ fontSize: 20 }}>{inr(r.offerInr)}<small>${r.priceUsd.toFixed(2)}/kg</small></span></div>
                <OfferAdvice advice={r.advice} />
              </div>
            ))}
          </div>

          <div className="card">
            <h3>{t("pr_forecast_title", { year: d.year, grade })}</h3>
            <LineChart labels={d.weeks.map(wk)} band={{ lo: d.band_low, hi: d.band_high }} label="price"
              series={[
                ...(d.history["2025"] ? [{ name: "2025", color: "var(--mute)", data: d.history["2025"] }] : []),
                { name: t("pr_market_line"), color: "var(--brand)", data: d.forecast, dots: true },
                { name: t("pr_fair_line"), color: "var(--brand2)", data: d.fair_offer, dash: true },
              ]} />
            <p className="note">{t("price_note")}</p>
          </div>

          <div className="card">
            <h3>{t("pr_scenario")}</h3>
            <div className="chips">{SCENARIOS.map((s) => <button key={s} className={`chip ${demand === s ? "on" : ""}`} onClick={() => setDemand(s)}>{sign(s)}</button>)}</div>
            <p className="insight">{t("pr_scenario_line", { d: sign(d.scenario.demand_change_pct), gap: d.scenario.gap_pct, p: sign(d.scenario.price_change_pct) })}</p>
          </div>

          <MandiCard />

          <div className="card">
            <h3>{t("pr_why")}</h3>
            <HBars items={Object.entries(d.model.importance).filter(([, v]) => v >= 1).map(([k, v]) => ({ l: t(k === "history" ? "drv_last_price" : "drv_" + k), v, c: "var(--blue)" }))} fmt={(v) => v + "%"} />
            <p className="note">{t("pr_model", { from: d.model.years[0], to: d.model.years[1], rows: d.model.rows, hy: d.model.metrics.holdout_year, err: d.model.metrics.mape_weekly, base: d.model.metrics.baseline_last_year_mape })}</p>
            <p className="note">{t("pr_costs", { pg: d.export_cost.packing_grading, cc: d.export_cost.cold_chain_transport, dc: d.export_cost.docs_phyto, fee: d.export_cost.fpo_fee, comm: d.mandi_cost.commission_pct, tr: d.mandi_cost.transport_inr_kg })}</p>
            {d.model.data_source === "sample" && <p className="note">{t("pr_sample")}</p>}
          </div>
        </>
      )}
    </>
  );
}
