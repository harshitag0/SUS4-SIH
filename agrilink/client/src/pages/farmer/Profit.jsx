import { useState } from "react";
import { api } from "../../api.js";
import { useI18n } from "../../i18n/index.jsx";
import { useApi } from "../../hooks/useApi.js";
import { ErrorBox, HBars, LineChart, Loading, inr, lakh, useToast } from "../../components/ui.jsx";
import MarketThresholds from "../../components/MarketThresholds.jsx";

const COMPONENTS = ["labour", "fertilizer", "plant_protection", "irrigation", "bagging_materials", "harvest_transport"];
const SCENARIOS = {
  none: "", wage: "wage_pct=10", diesel: "diesel_pct=20", fert: "fertilizer_pct=15", all: "wage_pct=10&diesel_pct=20&fertilizer_pct=15",
};
const pct = (v) => `${v > 0 ? "+" : ""}${v}%`;

function MyCosts({ data, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const prevYear = data.year - 1;
  const b = data.benchmark;
  const [v, setV] = useState(() => Object.fromEntries(COMPONENTS.map((c) => [c, b?.items.find((i) => i.component === c)?.mine ?? ""])));
  const save = async (e) => {
    e.preventDefault();
    const components = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && !Number.isNaN(+x)).map(([k, x]) => [k, +x]));
    try { await api("/farmers/me/costs", { method: "PUT", body: { year: prevYear, components } }); toast(t("saved")); onSaved(); }
    catch { toast(t("err_generic")); }
  };
  return (
    <div className="card">
      <h3>{t("pf_mine")} ({prevYear})</h3>
      <p className="note">{t("pf_mine_sub")}</p>
      {b && (
        <div style={{ marginBottom: 12 }}>
          {b.items.map((i) => (
            <div key={i.component} className="mkrow">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b>{t("cc_" + i.component)}</b>
                <span className={`pill ${i.flag ? "p-bad" : i.diff_pct > 0 ? "p-warn" : "p-good"}`}>{t(i.diff_pct >= 0 ? "pf_more" : "pf_less", { p: Math.abs(Math.round(i.diff_pct)) })}</span>
              </div>
              <span className="note">{inr(i.mine)} · {inr(i.district_avg)}</span>
              {i.flag && <span className="note">{t("tip_cost_" + i.component)}</span>}
            </div>
          ))}
        </div>
      )}
      <form onSubmit={save}>
        <div className="row">
          {COMPONENTS.map((c) => (
            <div key={c}><label>{t("cc_" + c)} (₹)</label>
              <input type="number" min="0" value={v[c]} onChange={(e) => setV({ ...v, [c]: e.target.value })} placeholder={inr(data.farm.components[c].last)} /></div>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 12, width: "100%" }} type="submit">{t("pf_save")}</button>
      </form>
    </div>
  );
}

export default function Profit() {
  const { t } = useI18n();
  const [scen, setScen] = useState("none");
  const [margin, setMargin] = useState(20);
  const qs = [SCENARIOS[scen], `target_margin_pct=${margin}`].filter(Boolean).join("&");
  const r = useApi(`/farmers/me/costs?${qs}`, { live: ["requirements", "bonds"] });
  const d = r.data;
  if (r.loading && !d) return <Loading />;
  if (!d) return <ErrorBox error={r.error} />;
  const f = d.farm, ch = d.channels, m = d.model;
  const L = (v) => lakh(v, t);
  const shown = d.years.filter((y) => y.year >= d.year - 6);
  const comps = COMPONENTS.map((c) => ({ c, ...f.components[c] })).sort((a, b) => b.mid - a.mid);

  return (
    <>
      <h2>{t("pf_title")}</h2>
      <p className="sub">{t("pf_sub")}</p>

      <div className="grid kpis">
        <div className="card kpi"><div className="l">{t("pf_cost", { year: d.year })}</div><div className="v">{L(f.cost_total)}</div>
          <div className="d">{t("pf_cost_range", { lo: L(f.cost_lo), hi: L(f.cost_hi), last: L(f.cost_last_year) })}</div></div>
        <div className="card kpi"><div className="l">{t("pf_col_costkg")}</div><div className="v">₹{f.cost_per_kg}</div>
          <div className="d">{t("pf_breakeven", { kg: f.breakeven_kg })}</div></div>
        <div className="card kpi"><div className="l">{t("pf_profit_plan")}</div><div className="v up">{L(ch.profit_plan)}</div>
          <div className="d">{t("pf_col_margin")} {ch.margin_plan_pct}%</div></div>
        <div className="card kpi"><div className="l">{t("pf_profit_local")}</div><div className="v">{L(ch.profit_local)}</div>
          {ch.extra_profit > 0 && <div className="d up">{t("pf_extra", { amt: L(ch.extra_profit) })}</div>}</div>
      </div>

      <MarketThresholds th={d.thresholds} margin={margin} setMargin={setMargin} />

      <div className="card">
        <h3>{t("pf_channels")}</h3>
        <div className="tableWrap"><table>
          <thead><tr><th>{t("grade")}</th><th>{t("qty")}</th><th>{t("pf_channels")}</th><th>₹/kg</th><th>₹</th><th>{t("ch_local_market")}</th></tr></thead>
          <tbody>{ch.plan.map((p, i) => (
            <tr key={p.grade}><td><b>{p.grade}</b></td><td>{(p.kg / 1000).toFixed(1)} t</td><td>{t("ch_" + p.channel)}</td><td>{inr(p.net_kg)}</td><td>{L(p.revenue)}</td><td className="note">{inr(ch.local[i].net_kg)}</td></tr>
          ))}</tbody>
        </table></div>
      </div>

      <div className="card">
        <h3>{t("pf_years")}</h3>
        <LineChart labels={d.years.map((y) => (y.forecast ? `${y.year}*` : String(y.year)))} label="cost vs price"
          series={[{ name: t("pf_col_price"), color: "var(--brand2)", data: d.years.map((y) => y.price_kg), dots: true },
            { name: t("pf_col_costkg"), color: "var(--bad)", data: d.years.map((y) => y.cost_kg), dots: true }]} />
        <p className="note">{t("pf_chart")}</p>
        <div className="tableWrap"><table>
          <thead><tr><th>{t("pf_col_year")}</th><th>{t("pf_col_cost")}</th><th>{t("pf_col_yield")}</th><th>{t("pf_col_costkg")}</th><th>{t("pf_col_price")}</th><th>{t("pf_col_profit")}</th><th>{t("pf_col_margin")}</th></tr></thead>
          <tbody>{shown.map((y) => (
            <tr key={y.year} className={y.forecast ? "fcrow" : ""}>
              <td><b>{y.year}</b>{y.forecast && <span className="note"> {t("pf_forecast")}</span>}{y.shock ? <span className="note"> {t("pf_bad_year")}</span> : null}</td>
              <td>{inr(y.cost_acre)}</td><td>{y.yield_kg_acre}</td><td>{inr(y.cost_kg)}</td><td>{inr(y.price_kg)}</td>
              <td className={y.profit_acre >= 0 ? "up" : "down"}>{inr(y.profit_acre)}</td><td>{y.margin_pct}%</td>
            </tr>))}</tbody>
        </table></div>
      </div>

      <div className="card">
        <h3>{t("pf_breakdown", { year: d.year })}</h3>
        {comps.map((c) => (
          <div key={c.c} style={{ margin: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, gap: 8 }}>
              <span>{t("cc_" + c.c)}</span>
              <span><b>{inr(c.mid)}</b> <span className={c.mid >= c.last ? "down" : "up"} style={{ fontSize: 12 }}>{t("sd_growth", { g: pct(Math.round((c.mid / c.last - 1) * 100)) })}</span></span>
            </div>
            <div className="bar"><i style={{ width: `${(c.mid / comps[0].mid) * 100}%`, background: "var(--blue)" }} /></div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>{t("pf_whatif")}</h3>
        <div className="chips">{Object.keys(SCENARIOS).map((k) => <button key={k} className={`chip ${scen === k ? "on" : ""}`} onClick={() => setScen(k)}>{t("wi_" + k)}</button>)}</div>
        <p className="insight">{t("pf_whatif_line", { c: pct(d.scenario.cost_change_pct), amt: (d.scenario.cost_change >= 0 ? "+" : "−") + inr(Math.abs(d.scenario.cost_change)), p: L(d.scenario.profit_plan) })}</p>
      </div>

      <MyCosts data={d} onSaved={r.reload} key={d.benchmark ? "b" : "n"} />

      <div className="card">
        <p className="note">{t("pf_model", { from: m.years[0], to: m.years[1], rows: m.rows, hy: m.metrics.holdout_year, err: m.metrics.mape_total_cost, base: m.metrics.baseline_last_year_mape, lab: Math.round(((1.1 ** (m.elasticities.labour?.d_wage ?? 1)) - 1) * 100) })}</p>
        {m.data_source === "sample" && <p className="note">{t("pf_sample")}</p>}
      </div>
    </>
  );
}
