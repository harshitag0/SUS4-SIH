import { api } from "../api.js";
import { useI18n } from "../i18n/index.jsx";
import { inr, useToast } from "./ui.jsx";
import PreSignCheck from "./PreSignCheck.jsx";
import Icon from "./Icon.jsx";

const CLS = { draft: "p-warn", buyer_signed: "p-warn", farmer_signed: "p-warn", active: "p-good" };
const USD_INR = 88; // display only; the server stores USD

/** One agreement. `side` is the viewer's role (farmer | buyer). */
export default function BondCard({ bond: b, side, onChange }) {
  const { t } = useI18n();
  const toast = useToast();
  const mine = b.sigs?.[side]?.hash;

  const act = async (fn, msg) => {
    try { await fn(); if (msg) toast(msg); onChange(); } catch { toast(t("err_generic")); }
  };
  const sign = () => act(async () => {
    const r = await api(`/bonds/${b._id}/sign`, { method: "POST" });
    toast(t(r.status === "active" ? "toast_active" : "toast_signed"));
  });
  const verify = () => act(async () => toast(t((await api(`/bonds/${b._id}/verify`)).ok ? "verified_ok" : "verified_bad")));
  const decline = () => act(() => api(`/bonds/${b._id}`, { method: "DELETE" }));

  const sig = (who) => {
    const g = b.sigs?.[who], w = t("who_" + who);
    return g?.hash
      ? <span className="sig"><Icon name="checkCircle" size={16} /><span className="up">{t("signed_by", { who: w })}</span> <span className="note">{g.ts.slice(0, 16).replace("T", " ")} · #{g.hash.slice(0, 8)}…</span></span>
      : <span className="sig pending"><Icon name="pen" size={16} /><span className="note">{t("not_signed", { who: w })}</span></span>;
  };

  return (
    <div className="card bond">
      <div className="bondhead">
        <h3><Icon name="agreements" />{t("bond_no", { id: String(b._id).slice(-6) })}</h3>
        <span className={`pill ${CLS[b.status]}`}>{t("st_" + b.status)}</span>
      </div>
      <div className="facts">
        <div><span>{t("buyer")}</span><b>{b.buyerName}</b></div>
        <div><span>{t("seller")}</span><b>{b.farmerName}</b></div>
        <div><span>{t("qty")}</span><b>{b.tons} {t("tons")}</b></div>
        <div><span>{t("grade")}</span><b>{b.grade}</b></div>
        <div><span>{t("price")}</span><b>${b.priceUsd.toFixed(2)} / kg ({inr(b.priceUsd * USD_INR)})</b></div>
        <div><span>{t("deliver_by")}</span><b>{b.deliverBy.slice(0, 10)}</b></div>
        <div><span>{t("value")}</span><b>${Math.round(b.tons * 1000 * b.priceUsd).toLocaleString()}</b></div>
      </div>
      <ul className="clauses">
        <li>{b.escalation?.enabled ? t("c_esc", { p: b.escalation.pct }) : t("c_fix")}</li>
        <li>{t("c_quality")}</li>
        <li>{t("c_pay")}</li>
      </ul>
      <div className="sigs">{sig("buyer")}{sig("farmer")}</div>
      {side === "farmer" && !mine && <PreSignCheck bondId={b._id} />}
      <div className="actions">
        {!mine && <button className="btn" onClick={sign}>{t("sign_" + side)}</button>}
        {(b.sigs?.buyer?.hash || b.sigs?.farmer?.hash) && <button className="btn alt" onClick={verify}>{t("verify")}</button>}
        {b.status !== "active" && !mine && <button className="btn alt" onClick={decline}>{t("decline")}</button>}
      </div>
    </div>
  );
}
