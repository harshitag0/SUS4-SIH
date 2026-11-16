import { useState } from "react";
import { useI18n } from "../../i18n/index.jsx";
import { useApi } from "../../hooks/useApi.js";
import { ErrorBox, HBars, LineChart, Loading } from "../../components/ui.jsx";

const NEED_CLS = { high: "p-good", medium: "p-warn", low: "p-bad", unknown: "p-warn" };
const t1 = (v) => Math.round(v).toLocaleString("en-IN");

/** Personal plan: what this farmer should target, sized to free capacity and harvest months. */
function MyPlan({ year }) {
  const { t } = useI18n();
  const r = useApi("/farmers/me/supply-demand", { live: ["bonds"] }).data;
  if (!r) return null;
  return (
    <div className="card livecard">
      <h3>{t("sd_plan_title", { year })}</h3>
      {r.plan.map((p) => (
        <div key={p.grade} style={{ marginBottom: 10 }}>
          {p.suggested_tons > 0
            ? <div className="big" style={{ fontSize: 20 }}>{t("sd_plan_line", { tons: p.suggested_tons, grade: p.grade, month: t("m_" + p.best_month) })}</div>
            : <div>{t("sd_plan_none", { grade: p.grade })}</div>}
          <div className="note">{t("sd_window_gap", { gap: t1(p.window_gap) })} · {p.months.map((m) => t("m_" + m)).join(", ")}</div>
        </div>
      ))}
      <h3 style={{ marginTop: 14 }}>{t("sd_top_markets")}</h3>
      {r.top_markets.map((m, i) => (
        <div key={m.destination} className="mkrow">
          <b>{i + 1}. {m.destination}</b>
          <span className="note">{t("sd_growth", { g: `${m.growth_pct >= 0 ? "+" : ""}${m.growth_pct}%` })} · ${m.price_a_usd_kg}/kg</span>
          <div className="tags">{m.reasons.map((x) => <span key={x} className={`pill ${x === "needs_treatment" ? "p-warn" : "p-good"}`}>{t("r_" + x)}</span>)}</div>
        </div>
      ))}
    </div>
  );
}

function ModelCard({ model }) {
  const { t } = useI18n();
  const m = model.metrics.demand;
  return (
    <div className="card">
      <h3>{t("sd_why")}</h3>
      <HBars items={Object.entries(model.importance).map(([k, v]) => ({ l: t("drv_" + k), v, c: "var(--blue)" }))} fmt={(v) => v + "%"} />
      <p className="note">{t("sd_model", { from: model.years[0], to: model.years[1], rows: model.rows.demand, hy: m.holdout_year, err: m.mape_annual, base: m.baseline_last_year_mape_annual })}</p>
      {model.data_source === "sample" && <p className="note">{t("sd_sample")}</p>}
    </div>
  );
}

export default function Demand() {
  const { t } = useI18n();
  const [dest, setDest] = useState("Singapore");
  const markets = useApi("/market/markets");
  const o = useApi(`/market/outlook?destination=${dest}`, { live: dest === "Singapore" ? ["requirements", "bonds"] : [] });
  const d = o.data;

  return (
    <>
      <h2>{t("sd_title")}</h2>
      <p className="sub">{t("sd_sub")}</p>
      <MyPlan year={d?.year ?? 2026} />

      <div className="chips">
        {(markets.data || []).map((m) => <button key={m.destination} className={`chip ${m.destination === dest ? "on" : ""}`} onClick={() => setDest(m.destination)}>{m.destination}</button>)}
      </div>
      <ErrorBox error={o.error || markets.error} />
      {o.loading && !d && <Loading />}

      {d && (
        <>
          <div className="card">
            <h3>{t("sd_need_q", { d: d.destination })}</h3>
            <span className={`pill ${NEED_CLS[d.need || "unknown"]}`} style={{ fontSize: 18, padding: "6px 14px" }}>{t("need_" + (d.need || "unknown"))}</span>
            <div className="grid kpis" style={{ marginTop: 12 }}>
              <div className="card kpi"><div className="l">{t("sd_demand", { year: d.year })}</div><div className="v">{t1(d.demand)} <small>{t("tons")}</small></div>
                <div className="d">{t("sd_range", { lo: t1(d.demand_lo), hi: t1(d.demand_hi) })} · <span className={d.growth_pct >= 0 ? "up" : "down"}>{t("sd_growth", { g: `${d.growth_pct >= 0 ? "+" : ""}${d.growth_pct}%` })}</span></div></div>
              {d.has_supply ? (<>
                <div className="card kpi"><div className="l">{t("sd_supply")}</div><div className="v">{t1(d.supply)} <small>{t("tons")}</small></div><div className="d">{t("sd_range", { lo: t1(d.supply_lo), hi: t1(d.supply_hi) })}</div></div>
                <div className="card kpi"><div className="l">{t("sd_gap")}</div><div className={`v ${d.gap > 0 ? "up" : "down"}`}>{t1(d.gap)} <small>{t("tons")}</small></div><div className="d">{d.gap_pct}% · {t("sd_most_needed", { g: d.most_needed_grade })}</div></div>
              </>) : <p className="note">{t("sd_no_supply")}</p>}
            </div>
            {d.live && <p className="insight">{t("sd_live", { tons: d.live.byGrade.A.tons, pct: d.live.coveragePct.A })}</p>}
          </div>

          <div className="card">
            <h3>{t("sd_by_month")}</h3>
            <LineChart labels={d.by_month.map((m) => t("m_" + m.month))} label="by month"
              band={{ lo: d.by_month.map((m) => m.demand_lo), hi: d.by_month.map((m) => m.demand_hi) }}
              series={[{ name: t("lg_demand"), color: "var(--brand)", data: d.by_month.map((m) => m.demand), dots: true },
                ...(d.has_supply ? [{ name: t("sd_supply"), color: "var(--brand2)", data: d.by_month.map((m) => m.supply), dots: true }] : [])]} />
          </div>

          <div className="card">
            <h3>{t("sd_by_grade")}</h3>
            <div className="tableWrap"><table>
              <thead><tr><th>{t("grade")}</th><th>{t("sd_demand", { year: "" })}</th>{d.has_supply && <><th>{t("sd_supply")}</th><th>{t("sd_gap")}</th><th /></>}</tr></thead>
              <tbody>{d.by_grade.map((g) => (
                <tr key={g.grade}><td><b>{g.grade}</b></td><td>{t1(g.demand)} t</td>
                  {d.has_supply && <><td>{t1(g.supply)} t</td><td className={g.gap > 0 ? "up" : "down"}>{t1(g.gap)} t</td><td><span className={`pill ${NEED_CLS[g.need]}`}>{t("need_" + g.need)}</span></td></>}
                </tr>))}
              </tbody>
            </table></div>
            <p className="note">{["A", "B", "C"].map((k) => t("g" + k)).join(" · ")}</p>
          </div>

          <div className="card">
            <h3>{t("sd_history")}</h3>
            <LineChart labels={[...d.history.years, `${d.year}*`]} label="history"
              series={[{ name: t("lg_demand"), color: "var(--brand)", data: [...d.history.demand, d.demand], dots: true },
                ...(d.has_supply ? [{ name: t("sd_supply"), color: "var(--brand2)", data: [...d.history_supply, d.supply], dots: true }] : [])]} />
          </div>

          <ModelCard model={d.model} />
        </>
      )}
    </>
  );
}
