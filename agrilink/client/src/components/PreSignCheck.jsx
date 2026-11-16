import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useI18n } from "../i18n/index.jsx";
import { lakh } from "./ui.jsx";
import Icon from "./Icon.jsx";

const ICON = { ok: "checkCircle", warn: "alert", bad: "xCircle" };
const CLS = { ok: "p-good", warn: "p-warn", bad: "p-bad" };

/**
 * "Check before you sign": demand + price + cost/profit + capacity + weather for one deal.
 * Pass either { requirementId, tons } (new commitment) or { bondId } (draft agreement).
 */
export default function PreSignCheck({ requirementId, tons, bondId }) {
  const { t, wk } = useI18n();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!bondId && !(tons > 0)) return undefined;
    let alive = true;
    const path = bondId ? `/bonds/${bondId}/precheck` : `/bonds/precheck?requirementId=${requirementId}&tons=${tons}`;
    const id = setTimeout(() => {
      api(path).then((d) => alive && (setData(d), setErr(false))).catch(() => alive && setErr(true));
    }, 300); // debounce while the farmer types the tons
    return () => { alive = false; clearTimeout(id); };
  }, [requirementId, tons, bondId]);

  if (err) return <p className="note">{t("err_generic")}</p>;
  if (!data) return <p className="note">{t("pc_loading")}</p>;
  const money = (v) => (Math.abs(v) >= 1e5 ? lakh(v, t) : "₹" + Math.round(v).toLocaleString("en-IN"));

  const line = (c) => {
    const d = c.data;
    switch (c.key) {
      case "demand": return t("pc_demand", { grade: d.grade, need: t("need_" + d.need), month: t("m_" + d.month) });
      case "price": return t("pc_price", { offer: d.offerInr, fair: d.fairInr, decision: t("dec_" + d.decision, { usd: d.counterUsd?.toFixed(2) }) }) + (d.week ? ` · ${wk(d.week)}` : "");
      case "profit": return <>{t("pc_profit", { net: d.netKg, cost: Math.round(d.costKg), profit: money(d.profit) })}<br /><span className="note">{t(d.extra >= 0 ? "pc_profit_extra" : "pc_profit_less", { amt: money(Math.abs(d.extra)) })}</span></>;
      case "capacity": return t("pc_capacity", { tons: d.tons, free: d.free });
      case "weather": return d.alerts.length ? t("pc_weather_warn", { alerts: d.alerts.map((a) => t("al_" + a)).join(", ") }) : t("pc_weather_ok");
      default: return c.key;
    }
  };

  return (
    <div className={`precheck ${data.overall}`}>
      <div className="pchead"><b><Icon name="shield" size={17} />{t("pc_title")}</b><span className={`pill ${CLS[data.overall]}`}>{t("pc_" + data.overall)}</span></div>
      <ul>{data.checks.map((c) => <li key={c.key}><span className={`st-${c.status}`}><Icon name={ICON[c.status]} size={18} /></span><div>{line(c)}</div></li>)}</ul>
    </div>
  );
}
