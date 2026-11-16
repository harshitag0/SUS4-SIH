import { Link } from "react-router-dom";
import { useI18n } from "../../i18n/index.jsx";
import { useApi } from "../../hooks/useApi.js";
import Icon from "../../components/Icon.jsx";
import { ErrorBox, Loading } from "../../components/ui.jsx";
import { StatusBadge, usd, day } from "../../components/trust/ui.jsx";

/** Farmer view of their digital agreements (full workflow lives in the Agreement Registry). */
export default function Agreements() {
  const { t } = useI18n();
  const r = useApi("/contracts", { refreshMs: 60000, live: ["contracts", "bonds"] });
  const items = r.data?.items || [];
  return (
    <>
      <div className="page-head">
        <div><h2>{t("bonds_title")}</h2><p className="sub">{t("ag_sub")}</p></div>
        <Link className="btn alt" to="/contracts"><Icon name="shield" size={16} />{t("trust_link")}</Link>
      </div>
      {r.loading && !r.data && <Loading />}
      <ErrorBox error={r.error} />
      {r.data && items.length === 0 && <div className="card note">{t("ag_none")}</div>}
      <div className="offers-grid">
        {items.map((a) => {
          const me = a.signers.find((s) => s.role === "farmer");
          const mustSign = a.status === "pending_signature" && me?.status !== "signed";
          return (
            <div className="card offer" key={a.agreementId}>
              <div className="offerhead">
                <div><b>{a.agreementId}</b><div className="note">{a.parties.buyer.company} · v{a.version}</div></div>
                <StatusBadge status={a.status} />
              </div>
              <div className="facts" style={{ margin: "6px 0 12px" }}>
                <div><span>{t("qty")}</span><b>{a.terms.quantityTons} {t("tons")} · {t("grade")} {a.terms.grade}</b></div>
                <div><span>{t("ag_value")}</span><b>{usd(a.terms.totalValueUsd)}</b></div>
                <div><span>{t("deliver_by")}</span><b>{day(a.terms.deliveryDate)}</b></div>
                <div><span>{t("ag_chain")}</span><b className={a.chain?.status === "registered" ? "up" : ""}>{a.chain?.status === "registered" ? t("ag_chain_ok", { b: a.chain.blockNumber }) : t("ag_chain_no")}</b></div>
              </div>
              <Link className={`btn ${mustSign ? "" : "alt"}`} to={mustSign ? `/contracts/${a.agreementId}/sign` : `/contracts/${a.agreementId}`}>
                <Icon name={mustSign ? "pen" : "file"} size={16} />{mustSign ? t("ag_sign") : t("ag_open")}
              </Link>
            </div>
          );
        })}
      </div>
    </>
  );
}
