import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api.js";
import { useI18n } from "../../i18n/index.jsx";
import { useApi } from "../../hooks/useApi.js";
import { ErrorBox, Loading, Modal, inr, useToast } from "../../components/ui.jsx";
import OfferAdvice from "../../components/OfferAdvice.jsx";
import PreSignCheck from "../../components/PreSignCheck.jsx";

const VK = { above: "p-good", fair: "p-warn", below: "p-bad" };

function CommitModal({ offer, max, onClose, onDone }) {
  const { t } = useI18n();
  const [v, setV] = useState(String(+Math.min(max, 10).toFixed(1)));
  const [err, setErr] = useState("");
  const submit = async () => {
    const n = parseFloat(v);
    if (!(n > 0) || n > max) return setErr(t("over_commit", { max }));
    try {
      await api("/bonds", { method: "POST", body: { requirementId: offer._id, tons: n } });
      onDone();
    } catch (e) {
      setErr(e.code === "exceeds_capacity" ? t("over_commit", { max }) : e.code === "exceeds_need" ? t("err_exceeds_need") : t("err_generic"));
    }
  };
  return (
    <Modal onClose={onClose}>
      <h3>{t("commit_q", { max })}</h3>
      <input type="number" step="0.1" min="0.1" max={max} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      <p className="down">{err}</p>
      <PreSignCheck requirementId={offer._id} tons={parseFloat(v)} />
      <div className="mrow"><button className="btn alt" onClick={onClose}>{t("cancel")}</button><button className="btn" onClick={submit}>{t("confirm")}</button></div>
    </Modal>
  );
}

export default function Offers() {
  const { t } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const [grade, setGrade] = useState("all");
  const [pick, setPick] = useState(null);
  const offers = useApi(grade === "all" ? "/requirements" : `/requirements?grade=${grade}`, { refreshMs: 60000, live: ["requirements"] });
  const sum = useApi("/farmers/me/summary", { live: ["bonds"] });
  const th = useApi("/farmers/me/costs").data?.thresholds; // break-even -> minimum offer to accept
  const free = sum.data?.freeTons ?? 0;

  return (
    <>
      <h2>{t("offers_title")}</h2>
      <p className="sub">{t("offers_sub")}</p>
      {th && <p className="insight">{t("th_banner", { base: Math.round(th.baseline_kg), min: th.min_offer_usd.toFixed(2), target: th.target_offer_usd.toFixed(2) })}</p>}
      <div className="chips">
        {["all", "A", "B", "C"].map((g) => <button key={g} className={`chip ${grade === g ? "on" : ""}`} onClick={() => setGrade(g)}>{g === "all" ? t("all_grades") : `${t("grade")} ${g}`}</button>)}
      </div>
      {offers.loading && <Loading />}
      <ErrorBox error={offers.error} />
      {offers.data?.length === 0 && <p className="note">{t("no_match")}</p>}
      <div className="offers-grid">
      {offers.data?.map((r) => (
        <div className="card offer" key={r._id}>
          <div className="offerhead">
            <div><b>{r.buyerName}</b><div className="note">{t("grade")} {r.grade} · {t("left", { n: r.left })}</div></div>
            <div className="bigprice">{inr(r.offerInr)}<small>{t("per_kg")}</small></div>
          </div>
          <div className="bar"><i style={{ width: `${(r.filled / r.tons) * 100}%` }} /></div>
          <div className="tags">
            <span className={`pill ${VK[r.verdict.status]}`}>{t(r.verdict.status === "above" ? "above" : r.verdict.status === "fair" ? "fair" : "below")}</span>
            <span className={`pill ${r.vsMandiPct >= 0 ? "p-good" : "p-bad"}`}>{t("vs_mandi", { p: `${r.vsMandiPct >= 0 ? "+" : ""}${Math.round(r.vsMandiPct)}%` })}</span>
          </div>
          <OfferAdvice advice={r.advice} />
          <p className="note">{t("deliver_by")} {r.deliverBy.slice(0, 10)}{r.escalation?.enabled && ` · ${t("escalation", { p: r.escalation.pct })}`}</p>
          <button className="btn" disabled={r.left <= 0} onClick={() => (free > 0 ? setPick(r) : toast(t("over_commit", { max: 0 })))}>{t("draft_bond")}</button>
        </div>
      ))}
      </div>
      {pick && <CommitModal offer={pick} max={+Math.min(pick.left, free).toFixed(1)} onClose={() => setPick(null)}
        onDone={() => { setPick(null); toast(t("bond_created")); nav("/farmer/agreements"); }} />}
    </>
  );
}
