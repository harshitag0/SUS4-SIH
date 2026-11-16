import { useI18n } from "../i18n/index.jsx";

const CLS = { accept: "p-good", negotiate: "p-warn", local_better: "p-bad" };

/** Price-model advice for one buyer offer: decision, what the farmer keeps, vs local market. */
export default function OfferAdvice({ advice: a }) {
  const { t, wk } = useI18n();
  if (!a) return null;
  return (
    <div className="advice">
      <span className={`pill ${CLS[a.decision]}`}>{t("dec_" + a.decision, { usd: a.counterOfferUsd?.toFixed(2) })}</span>
      <div className="note">{t("pr_net_line", { net: a.farmerNetInr, mkt: a.marketNetInr, week: wk(a.week) })}</div>
      {a.bestCaseUsd && <div className="note">{t("pr_best_case", { usd: a.bestCaseUsd.toFixed(2) })}</div>}
    </div>
  );
}
