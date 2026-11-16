import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api.js";
import Icon from "../../components/Icon.jsx";
import { ErrorBox, Loading, Modal, useToast } from "../../components/ui.jsx";
import { downloadPdf } from "../../components/trust/ui.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useApi } from "../../hooks/useApi.js";
import { useI18n } from "../../i18n/index.jsx";
import { CERT_BASE } from "./Certificates.jsx";
import { CertStatus, day, gradeMix, kg, shortHash } from "./ui.jsx";
import "./certificates.css";
import "../stages/stages.css";
import StageCertificateView from "./StageCertificateView.jsx";

const ACTION = { issued: "Certificate issued", registered_on_chain: "Fingerprint registered on blockchain", revoked: "Certificate revoked",
  revocation_on_chain: "Revocation registered on blockchain", chain_failed: "Blockchain registration failed", reanchored_after_chain_reset: "Re-registered after chain reset" };

export default function CertificateDetail() {
  const { id } = useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const { data: c, error, loading, reload } = useApi(`/certificates/${id}`, { live: ["certificates"] });
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ops = user.role === "operations";

  if (loading && !c) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (c.kind === "stage") return <StageCertificateView c={c} base={CERT_BASE[user.role]} ops={ops} reload={reload} t={t} />;
  const ch = c.chain || {};
  const act = async (fn, msg) => { setBusy(true); try { await fn(); toast(msg); reload(); } catch (e) { toast(e.message, { long: true }); } finally { setBusy(false); } };

  return (
    <div>
      <div className="crumbs"><Link to={CERT_BASE[user.role]}>{t("cert_title")}</Link> / <span className="mono">{c.certificateId}</span></div>
      <div className="page-head">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{c.certificateId} <CertStatus status={c.liveStatus} t={t} /></h1>
          <p className="sub">{c.product.variety} · {kg(c.totalKg)} · lot <span className="mono">{c.lotId}</span> · {c.fpo.name} → {c.buyer.name}</p>
        </div>
        <div className="cert-actions">
          <button className="btn small" onClick={() => downloadPdf(`/certificates/${c.certificateId}/document`, `${c.certificateId}.pdf`).catch(() => toast("PDF not available"))}><Icon name="file" size={15} />{t("cert_download")}</button>
          <a className="btn alt small" href={`/verify/${c.certificateId}`} target="_blank" rel="noreferrer"><Icon name="globe" size={15} />{t("cert_public_page")}</a>
          {ops && ch.status !== "registered" && <button className="btn alt small" disabled={busy} onClick={() => act(() => api(`/certificates/${c.certificateId}/retry-chain`, { method: "POST" }), "Registered on blockchain")}>Retry blockchain</button>}
          {ops && c.status === "issued" && <button className="btn alt small cert-danger" onClick={() => setRevoking(true)}>Revoke</button>}
        </div>
      </div>

      {c.status === "revoked" && <div className="alertbox"><span className="ic"><Icon name="xCircle" /></span><div><b>Revoked on {day(c.revoked.at)}</b> by {c.revoked.by}. {c.revoked.reason}</div></div>}

      <div className="cert-layout">
        <div>
          <div className="card">
            <h3><Icon name="box" />{t("cert_consignment")}</h3>
            <dl className="cert-facts">
              <dt>{t("cert_lot")}</dt><dd className="mono">{c.lotId}</dd>
              <dt>Agreement</dt><dd className="mono">{c.agreementId}</dd>
              <dt>{t("buyer")}</dt><dd>{c.buyer.name}</dd>
              <dt>FPO</dt><dd>{c.fpo.name}</dd>
              <dt>{t("cert_product")}</dt><dd>{c.product.variety} {c.product.crop.toLowerCase()} · {c.product.origin}</dd>
              <dt>{t("cert_qty")}</dt><dd>{kg(c.totalKg)} · {gradeMix(c.gradeMix)}</dd>
              <dt>{t("cert_required")}</dt><dd>Grade {c.requiredGrade} or better</dd>
              <dt>{t("cert_collected")}</dt><dd>{day(c.trace.collectedAt)}</dd>
              <dt>{t("cert_issued")}</dt><dd>{day(c.issuedAt)} · {c.issuedBy?.name}</dd>
              <dt>{t("cert_valid_until")}</dt><dd>{day(c.validUntil)}</dd>
            </dl>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <h3 style={{ padding: "16px 20px 0" }}><Icon name="farmer" />{t("cert_growers")}</h3>
            <div className="tableWrap"><table>
              <thead><tr><th>{t("cert_grower")}</th><th>{t("cert_qty")}</th><th>{t("cert_lot_grade")}</th><th>{t("cert_doctor")}</th><th>{t("cert_ai_photo")}</th></tr></thead>
              <tbody>{c.farmers.map((f) => {
                const d = f.evidence?.doctor, p = f.evidence?.photos;
                return (
                  <tr key={f.m2Id}>
                    <td><b>{f.name}</b></td><td>{kg(f.kg)}</td><td>Grade {f.grade}</td>
                    <td>{d ? <>Grade {d.grade}<div className="note">{d.doctor} · {day(d.at)}{d.fruitInspected ? ` · ${d.fruitInspected} fruit` : ""}</div></> : "—"}</td>
                    <td>{p ? <>{p.grade ? `Grade ${p.grade}` : "—"}<div className="note">{p.photos} photo(s) · blemish {p.defectPct}% · colour {p.colourScore} · conf. {p.confidence}</div></> : "—"}</td>
                  </tr>);
              })}</tbody>
            </table></div>
          </div>

          <div className="card">
            <h3><Icon name="checkCircle" />{t("cert_basis")}</h3>
            <ul className="cert-basis">
              <li>{t("cert_basis_1")}</li><li>{t("cert_basis_2")}</li><li>{t("cert_basis_3")}</li>
            </ul>
            <p className="note" style={{ marginBottom: 0 }}>{t("cert_disclaimer")}</p>
          </div>
        </div>

        <div>
          <div className="card cert-qr">
            <img src={`/api/public/certificates/${c.certificateId}/qr.svg`} alt={`QR code for ${c.certificateId}`} width="168" height="168" />
            <div><b>{t("cert_scan")}</b><div className="note" style={{ wordBreak: "break-all" }}>{c.verifyUrl}</div></div>
          </div>

          <div className="card">
            <h3><Icon name="shield" />{t("cert_chain")}</h3>
            {ch.status === "registered" ? (
              <dl className="cert-facts compact">
                <dt>Network</dt><dd>{ch.network}</dd>
                <dt>Block</dt><dd>{ch.blockNumber}</dd>
                <dt>Transaction</dt><dd className="mono" title={ch.txHash}>{shortHash(ch.txHash)}</dd>
                <dt>PDF SHA-256</dt><dd className="mono" title={ch.docHash}>{shortHash(ch.docHash)}</dd>
                <dt>Recorded</dt><dd>{new Date(ch.registeredAt).toLocaleString("en-GB")}</dd>
                {c.revocationChain?.status === "registered" && <><dt>Revocation</dt><dd>Block {c.revocationChain.blockNumber}</dd></>}
              </dl>
            ) : <p className="note">{ch.status === "failed" ? `Not registered yet: ${ch.error}` : "Waiting for blockchain registration."}</p>}
          </div>

          <div className="card">
            <h3><Icon name="truck" />{t("cert_trace")}</h3>
            <p style={{ margin: "0 0 8px" }}>{c.trace.events} events · log {c.trace.intact ? <span className="pill p-good">intact</span> : <span className="pill p-bad">broken</span>}</p>
            <div className="note mono" title={c.trace.headHash}>Head {shortHash(c.trace.headHash)}</div>
            <a className="btn alt small" style={{ marginTop: 10 }} href={`/trace/${c.lotId}`} target="_blank" rel="noreferrer">{t("cert_open_trace")}</a>
          </div>

          <div className="card">
            <h3><Icon name="calendar" />Audit trail {c.auditIntact ? <span className="pill p-good">intact</span> : <span className="pill p-bad">broken</span>}</h3>
            <ol className="cert-audit">{[...c.audit].reverse().map((e) => (
              <li key={e.hash}><b>{ACTION[e.action] || e.action}</b><div className="note">{new Date(e.at).toLocaleString("en-GB")} · {e.actorName}</div></li>))}</ol>
          </div>
        </div>
      </div>

      {revoking && (
        <Modal onClose={() => setRevoking(false)}>
          <h3 style={{ marginTop: 0 }}>Revoke {c.certificateId}?</h3>
          <p className="note">The certificate stays on record. A revocation notice is stored and registered on the blockchain, and anyone scanning the QR code sees it as revoked.</p>
          <label className="note" htmlFor="rv">Reason (visible on the public page)</label>
          <textarea id="rv" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button className="btn alt small" onClick={() => setRevoking(false)}>Cancel</button>
            <button className="btn small cert-danger-solid" disabled={busy || reason.trim().length < 5}
              onClick={() => act(() => api(`/certificates/${c.certificateId}/revoke`, { method: "POST", body: { reason } }), "Certificate revoked").then(() => setRevoking(false))}>Revoke certificate</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
