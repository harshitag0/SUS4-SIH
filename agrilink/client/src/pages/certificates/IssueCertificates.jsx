import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../api.js";
import Icon from "../../components/Icon.jsx";
import { ErrorBox, Loading, useToast } from "../../components/ui.jsx";
import { useApi } from "../../hooks/useApi.js";
import { CertStatus, Check, day, gradeMix, kg } from "./ui.jsx";
import "./certificates.css";

/** Operations: lots collected in farm operations → evidence checklist → issue the certificate. */
export default function IssueCertificates() {
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const lotId = params.get("lot");
  const lots = useApi("/certificates/lots", { live: ["certificates", "farmops"] });
  const elig = useApi(lotId ? `/certificates/eligibility/${lotId}` : "/certificates/lots", { enabled: !!lotId, live: ["certificates", "farmops"] });
  const [busy, setBusy] = useState(false);
  const e = lotId ? elig.data : null;

  const issue = async () => {
    setBusy(true);
    try {
      const c = await api("/certificates", { method: "POST", body: { lotId } });
      toast(`${c.certificateId} issued and registered on blockchain`);
      nav(`/ops/certificates/${c.certificateId}`);
    } catch (err) { toast(err.message, { long: true }); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="crumbs"><Link to="/ops/certificates">Certificates</Link> / Certify lots</div>
      <div className="page-head">
        <div><h1>Certify lots</h1><p className="sub">Every lot collected at an FPO can carry an AgriLink Quality Certificate. The evidence comes from farm operations: quality reviews, farmer-doctor inspections, AI photo checks and the trace log.</p></div>
      </div>

      <div className="cert-layout">
        <div className="card" style={{ padding: 0 }}>
          <h3 style={{ padding: "16px 20px 0" }}><Icon name="box" />Collected lots</h3>
          {lots.loading && !lots.data && <Loading />}
          {lots.error && <div style={{ padding: 16 }}><ErrorBox error={lots.error} /></div>}
          {lots.data && !lots.data.length && <p className="note" style={{ padding: "0 20px 16px" }}>No lots yet. Lots are recorded by the FPO at collection (Farm operations → agreement → Harvest).</p>}
          {lots.data?.length > 0 && (
            <div className="tableWrap"><table>
              <thead><tr><th>Lot</th><th>Agreement · buyer</th><th>Quantity</th><th>Collected</th><th>Certificate</th></tr></thead>
              <tbody>{lots.data.map((l) => (
                <tr key={l.lotId} className={`cert-row ${l.lotId === lotId ? "on" : ""}`} onClick={() => setParams({ lot: l.lotId })}>
                  <td><span className="mono">{l.lotId}</span><div className="note">{l.fpo} · {l.growers} grower(s)</div></td>
                  <td><span className="mono">{l.agreementId}</span><div className="note">{l.buyer}</div></td>
                  <td>{kg(l.totalKg)}<div className="note">{gradeMix(l.gradeMix)}</div></td>
                  <td>{day(l.collectedAt)}</td>
                  <td>{l.certificate ? <Link to={`/ops/certificates/${l.certificate.certificateId}`} onClick={(ev) => ev.stopPropagation()} className="mono">{l.certificate.certificateId}</Link>
                    : <span className="pill p-warn">Not certified</span>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </div>

        <div>
          {!lotId && <div className="card cert-empty"><Icon name="checkCircle" size={26} /><p>Select a lot to check its evidence.</p></div>}
          {lotId && elig.loading && !e && <div className="card"><Loading /></div>}
          {lotId && elig.error && <div className="card"><ErrorBox error={elig.error} /></div>}
          {e && (
            <div className="card">
              <h3><Icon name="shield" />Lot <span className="mono">{e.lotId}</span></h3>
              <p className="note" style={{ marginTop: 0 }}>{e.product.variety} · {kg(e.totalKg)} · {gradeMix(e.gradeMix)} · {e.fpo} → {e.buyer} · requires Grade {e.requiredGrade}+</p>
              <ul className="cert-checks">{e.checks.map((c) => <Check key={c.key} {...c} />)}</ul>
              {e.existing ? (
                <p className="insight">Already certified: <Link to={`/ops/certificates/${e.existing}`} className="mono">{e.existing}</Link> <CertStatus status="valid" /></p>
              ) : (
                <>
                  <p className="note">Issuing creates the PDF with a QR code, stores it so it can never be overwritten, registers its fingerprint on the blockchain and notifies the buyer and growers. Valid for 14 days.</p>
                  <button className="btn" disabled={!e.eligible || busy} onClick={issue}><Icon name="checkCircle" size={16} />{busy ? "Issuing…" : e.eligible ? "Issue certificate" : "Not eligible yet"}</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
