import { Link, useNavigate } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { ErrorBox, Loading } from "../../components/ui.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useApi } from "../../hooks/useApi.js";
import { useI18n } from "../../i18n/index.jsx";
import { CertStatus, day, gradeMix, kg } from "./ui.jsx";
import "./certificates.css";

export const CERT_BASE = { farmer: "/farmer/certificates", buyer: "/buyer/certificates", operations: "/ops/certificates" };

/** Quality certificates: growers see lots they supplied, buyers their consignments, operations everything. */
export default function Certificates() {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, error, loading } = useApi("/certificates", { live: ["certificates"] });
  const base = CERT_BASE[user.role];
  const items = data?.items || [];
  const valid = items.filter((c) => c.liveStatus === "valid");

  return (
    <div>
      <div className="page-head">
        <div><h1>{t("cert_title")}</h1><p className="sub">{t("cert_sub")}</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn alt small" href="/verify" target="_blank" rel="noreferrer"><Icon name="shield" size={15} />{t("cert_verify_any")}</a>
          {user.role === "operations" && <button className="btn small" onClick={() => nav(`${base}/issue`)}><Icon name="checkCircle" size={15} />{t("cert_issue_btn")}</button>}
        </div>
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && (
        <div className="grid kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div className="card kpi"><div className="l">{t("cert_total")}</div><div className="v">{items.length}</div></div>
          <div className="card kpi"><div className="l">{t("cert_valid")}</div><div className="v">{valid.length}</div></div>
          <div className="card kpi"><div className="l">{t("cert_qty")}</div><div className="v sm">{kg(valid.filter((c) => c.kind !== "stage").reduce((s, c) => s + (user.role === "farmer" ? c.myKg || 0 : c.totalKg), 0))}</div></div>
        </div>
      )}
      {data && !items.length && (
        <div className="card cert-empty">
          <Icon name="shield" size={28} />
          <p>{t(user.role === "operations" ? "cert_none_ops" : "cert_none")}</p>
          {user.role === "operations" && <button className="btn small" onClick={() => nav(`${base}/issue`)}>{t("cert_issue_btn")}</button>}
        </div>
      )}
      {items.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="tableWrap"><table>
            <thead><tr><th>{t("cert_no")}</th><th>{t("cert_lot")}</th><th>{user.role === "farmer" ? t("cert_mykg") : t("cert_qty")}</th>
              <th>{user.role === "buyer" ? "FPO" : t("buyer")}</th><th>{t("cert_issued")}</th><th>{t("cert_valid_until")}</th><th>{t("cert_status")}</th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.certificateId} className="cert-row" onClick={() => nav(`${base}/${c.certificateId}`)}>
                  <td><Link to={`${base}/${c.certificateId}`} className="mono" onClick={(e) => e.stopPropagation()}>{c.certificateId}</Link></td>
                  {c.kind === "stage"
                    ? <td><b>{c.stage?.name}</b><div className="note mono">{c.cropId}{c.batchId ? ` · ${c.batchId}` : ""}</div></td>
                    : <td><span className="mono">{c.lotId}</span><div className="note">{gradeMix(c.gradeMix)}</div></td>}
                  <td>{c.kind === "stage" ? <span className="note">Stage</span> : kg(user.role === "farmer" ? c.myKg : c.totalKg)}</td>
                  <td>{user.role === "buyer" ? c.fpo : c.buyer}</td>
                  <td>{day(c.issuedAt)}</td>
                  <td>{day(c.validUntil)}</td>
                  <td><CertStatus status={c.liveStatus} t={t} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
