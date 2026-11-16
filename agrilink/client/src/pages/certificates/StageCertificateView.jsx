import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import Icon from "../../components/Icon.jsx";
import { Modal, useToast } from "../../components/ui.jsx";
import { downloadPdf } from "../../components/trust/ui.jsx";
import { CertStatus, day, shortHash } from "./ui.jsx";

/** Signed-in view of a crop-stage certificate (issued after consultant approval). */
const RES = { pass: ["p-good", "Pass"], warn: ["p-warn", "Attention"], fail: ["p-bad", "Fail"], not_assessed: ["stg-neutral", "Not assessed"] };
const SRC = { farmer: "Farmer record", ai: "AI image analysis", photo: "Photo measurement" };
const fmt = (v) => (v === true ? "Yes" : v === false ? "No" : v == null ? "—" : String(v));

export default function StageCertificateView({ c, base, ops, reload, t }) {
  const toast = useToast();
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const f = c.farmers[0] || {}, ev = f.evidence || {}, ch = c.chain || {};
  const revoke = async () => {
    try { await api(`/certificates/${c.certificateId}/revoke`, { method: "POST", body: { reason } }); toast("Certificate revoked"); setRevoking(false); reload(); }
    catch (e) { toast(e.message, { long: true }); }
  };
  return (
    <div>
      <div className="crumbs"><Link to={base}>{t("cert_title")}</Link> / <span className="mono">{c.certificateId}</span></div>
      <div className="page-head">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{c.stage.name} <CertStatus status={c.liveStatus} t={t} /></h1>
          <p className="sub"><span className="mono">{c.certificateId}</span> · {f.name} · crop <span className="mono">{c.cropId}</span>{c.batchId ? <> · batch <span className="mono">{c.batchId}</span></> : ""}</p>
        </div>
        <div className="cert-actions">
          <button className="btn small" onClick={() => downloadPdf(`/certificates/${c.certificateId}/document`, `${c.certificateId}.pdf`).catch(() => toast("PDF not available"))}><Icon name="file" size={15} />{t("cert_download")}</button>
          <a className="btn alt small" href={`/verify/${c.certificateId}`} target="_blank" rel="noreferrer"><Icon name="globe" size={15} />{t("cert_public_page")}</a>
          {ops && c.status === "issued" && <button className="btn alt small cert-danger" onClick={() => setRevoking(true)}>Revoke</button>}
        </div>
      </div>
      {c.status === "revoked" && <div className="alertbox"><span className="ic"><Icon name="xCircle" /></span><div><b>Revoked on {day(c.revoked.at)}</b> by {c.revoked.by}. {c.revoked.reason}</div></div>}

      <div className="cert-layout">
        <div>
          <div className="card">
            <h3><Icon name="sprout" />Stage approval</h3>
            <dl className="cert-facts">
              <dt>Stage</dt><dd>{c.stage.name}</dd>
              <dt>Grower</dt><dd>{f.name}</dd>
              <dt>FPO</dt><dd>{c.fpo?.name}</dd>
              <dt>Crop record</dt><dd className="mono">{c.cropId}</dd>
              <dt>Batch (lot)</dt><dd className="mono">{c.batchId || "Not yet in a lot"}</dd>
              <dt>Assessment</dt><dd className="mono">{c.assessmentId}</dd>
              <dt>Quality score</dt><dd>{ev.qualityScore ?? "—"} / 100 · {ev.coverage?.evaluated} of {ev.coverage?.total} checks assessed</dd>
              <dt>Approved by</dt><dd>{ev.consultant} · {day(ev.approvedAt)}</dd>
              {ev.remarks && <><dt>Remarks</dt><dd>{ev.remarks}</dd></>}
            </dl>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <h3 style={{ padding: "16px 20px 0" }}><Icon name="checkCircle" />Checks at approval</h3>
            <div className="tableWrap"><table>
              <thead><tr><th>Check</th><th>Source</th><th>Recorded</th><th>Result</th></tr></thead>
              <tbody>{(ev.checks || []).map((k, i) => { const [cls, txt] = RES[k.status] || RES.not_assessed; return (
                <tr key={i}><td>{k.label}</td><td className="note">{SRC[k.source]}</td><td>{fmt(k.value)}</td><td><span className={`pill ${cls}`}>{txt}</span></td></tr>); })}</tbody>
            </table></div>
          </div>
          <div className="card"><p className="note" style={{ margin: 0 }}>Confirmed by the consultant (not verifiable from photos): {(ev.notAssessable || []).join("; ")}.</p></div>
        </div>
        <div>
          <div className="card cert-qr">
            <img src={`/api/public/certificates/${c.certificateId}/qr.svg`} alt={`QR code for ${c.certificateId}`} width="160" height="160" />
            <div><b>{t("cert_scan")}</b><div className="note" style={{ wordBreak: "break-all" }}>{c.verifyUrl}</div></div>
          </div>
          <div className="card">
            <h3><Icon name="shield" />{t("cert_chain")}</h3>
            {ch.status === "registered" ? (
              <dl className="cert-facts compact">
                <dt>Network</dt><dd>{ch.network}</dd><dt>Block</dt><dd>{ch.blockNumber}</dd>
                <dt>Transaction</dt><dd className="mono" title={ch.txHash}>{shortHash(ch.txHash)}</dd>
                <dt>PDF SHA-256</dt><dd className="mono" title={ch.docHash}>{shortHash(ch.docHash)}</dd>
              </dl>) : <p className="note">{ch.status === "failed" ? `Not registered yet: ${ch.error}` : "Waiting for blockchain registration."}</p>}
          </div>
          <div className="card">
            <h3><Icon name="calendar" />Audit trail {c.auditIntact ? <span className="pill p-good">intact</span> : <span className="pill p-bad">broken</span>}</h3>
            <ol className="cert-audit">{[...c.audit].reverse().map((e) => <li key={e.hash}><b>{e.action.replace(/_/g, " ")}</b><div className="note">{new Date(e.at).toLocaleString("en-GB")} · {e.actorName}</div></li>)}</ol>
          </div>
        </div>
      </div>
      {revoking && (
        <Modal onClose={() => setRevoking(false)}>
          <h3 style={{ marginTop: 0 }}>Revoke {c.certificateId}?</h3>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shown on the public page)" style={{ width: "100%", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button className="btn alt small" onClick={() => setRevoking(false)}>Cancel</button>
            <button className="btn small cert-danger-solid" disabled={reason.trim().length < 5} onClick={revoke}>Revoke certificate</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
