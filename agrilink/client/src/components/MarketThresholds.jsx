import { useState } from "react";
import { useI18n } from "../i18n/index.jsx";
import { HBars, inr } from "./ui.jsx";

const STATUS_CLS = { good: "p-good", thin: "p-warn", loss: "p-bad" };
const MARGINS = [10, 20, 30];

/** Baseline / target price and "what you keep per kg" in local markets vs each export country. */
export default function MarketThresholds({ th, margin, setMargin }) {
  const { t } = useI18n();
  const [grade, setGrade] = useState("A");
  const rows = th.comparison[grade];
  const name = (m) => (m === "local_mandi" || m === "processing" ? t("mk_" + m) : m);
  const best = rows[0];
  const signed = (v) => `${v >= 0 ? "+" : "−"}₹${Math.abs(v)}`;

  return (
    <div className="card livecard">
      <h3>{t("th_title")}</h3>
      <div className="thresh">
        <div><span className="pill p-bad">{t("th_baseline", { kg: Math.round(th.baseline_kg) })}</span></div>
        <div><span className="pill p-good">{t("th_target", { m: th.target_margin_pct, kg: Math.round(th.target_kg) })}</span></div>
      </div>
      <div className="chips"><span className="note" style={{ alignSelf: "center" }}>{t("th_margin")}:</span>
        {MARGINS.map((m) => <button key={m} className={`chip ${margin === m ? "on" : ""}`} onClick={() => setMargin(m)}>{m}%</button>)}</div>
      <p className="insight">{t("th_offer_min", { min: th.min_offer_usd.toFixed(2), target: th.target_offer_usd.toFixed(2) })}</p>

      <h3 style={{ marginTop: 14 }}>{t("th_compare")}</h3>
      <div className="chips">{["A", "B", "C"].map((g) => <button key={g} className={`chip ${grade === g ? "on" : ""}`} onClick={() => setGrade(g)}>{t("grade")} {g}</button>)}</div>
      <p><b>{t("th_best", { g: grade, m: name(best.market), net: best.net_kg, diff: signed(best.vs_local_kg) })}</b></p>
      <HBars items={rows.map((r) => ({ l: name(r.market), v: Math.max(r.net_kg, 1), c: r.market === "local_mandi" ? "var(--warn)" : r.status === "loss" ? "var(--bad)" : r.vs_local_kg > 0 ? "var(--brand)" : "#a9c2b3" }))} fmt={(v) => inr(v)} />
      <p className="note">— {t("th_baseline", { kg: Math.round(th.baseline_kg) })}</p>

      <div className="tableWrap"><table>
        <thead><tr><th>{t("th_col_market")}</th><th>{t("th_col_price")}</th><th>{t("th_col_costs")}</th><th>{t("th_col_keep")}</th><th>{t("th_col_vs_local")}</th><th /><th>{t("th_col_min")}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.market}>
            <td><b>{name(r.market)}</b></td>
            <td>{r.price_usd ? `$${r.price_usd.toFixed(2)}` : ""} <span className="note">{inr(r.price_inr)}</span></td>
            <td className="note">{Object.entries(r.costs).map(([k, v]) => `${t("ci_" + k)} ₹${v}`).join(" · ")}</td>
            <td><b>{inr(r.net_kg)}</b></td>
            <td className={r.vs_local_kg > 0 ? "up" : r.vs_local_kg < 0 ? "down" : ""}>{r.market === "local_mandi" ? "—" : signed(r.vs_local_kg)}</td>
            <td><span className={`pill ${STATUS_CLS[r.status]}`}>{t("st_" + r.status)}</span></td>
            <td className="note">{r.min_usd_baseline ? `$${r.min_usd_baseline.toFixed(2)} / $${r.min_usd_target.toFixed(2)}` : ""}</td>
          </tr>))}</tbody>
      </table></div>
      <p className="note">{t("th_note")}</p>
    </div>
  );
}
