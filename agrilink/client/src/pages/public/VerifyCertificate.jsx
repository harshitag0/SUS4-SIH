import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { Brand } from "../../components/Layout.jsx";
import { sha256Hex } from "../../components/trust/ui.jsx";
import { CertStatus, day, gradeMix, kg, shortHash } from "../certificates/ui.jsx";
import "../certificates/certificates.css";
import "../stages/stages.css";

/**
 * Public certificate check (no login): what a buyer, importer or retailer sees after scanning the QR code.
 * Shows the live status, the consignment and quality evidence, the blockchain record, and checks a PDF by its fingerprint
 * (computed in the browser; the file is not uploaded).
 */
const pub = async (path, opts) => {
  const res = await fetch(`/api/public/certificates${path}`, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || "Not found"), { status: res.status });
  return body;
};

function FileCheck({ certificateId }) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const sha = await sha256Hex(await file.arrayBuffer());
      const v = await pub("/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: sha }) });
      setR({ ...v, sha, name: file.name });
    } catch { setR({ result: "error" }); } finally { setBusy(false); }
  };
  const ok = r?.result === "verified" && (!certificateId || r.certificateId === certificateId);
  return (
    <div className="card">
      <h3><Icon name="file" />Check a certificate PDF</h3>
      <p className="note" style={{ marginTop: 0 }}>Choose the PDF you received. Its fingerprint is calculated on your device and compared with the blockchain record; the file is not uploaded.</p>
      <label className="cert-drop">
        <input type="file" accept="application/pdf" onChange={(e) => check(e.target.files?.[0])} />
        <Icon name="file" size={20} /><span>{busy ? "Checking…" : "Choose PDF"}</span>
      </label>
      {r && r.result !== "error" && (
        <div className={`cert-verdict ${ok ? "good" : "bad"}`}>
          <Icon name={ok ? "checkCircle" : "xCircle"} size={22} />
          <div>
            <b>{ok ? "Genuine — this is the original certificate, unchanged." : r.result === "revocation_notice" ? "This file is the revocation notice of the certificate." : "Not a match — this file is not an AgriLink certificate or has been modified."}</b>
            <div className="note">{r.name} · SHA-256 {shortHash(r.sha)}{r.certificateId ? ` · ${r.certificateId}` : ""}{r.onChain ? " · found on blockchain" : ""}</div>
            {ok && r.status !== "valid" && <div className="note" style={{ color: "var(--bad)" }}>Note: the certificate itself is now {r.status}.</div>}
          </div>
        </div>
      )}
      {r?.result === "error" && <p className="down">Could not check the file. Try again.</p>}
    </div>
  );
}

function Lookup() {
  const [id, setId] = useState("");
  const nav = useNavigate();
  return (
    <div className="card">
      <h3><Icon name="search" />Find a certificate</h3>
      <form className="cert-lookup" onSubmit={(e) => { e.preventDefault(); if (id.trim()) nav(`/verify/${id.trim().toUpperCase()}`); }}>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="AGL-QC-2027-00001" aria-label="Certificate number" />
        <button className="btn">Check</button>
      </form>
    </div>
  );
}

const RES = { pass: ["p-good", "Pass"], warn: ["p-warn", "Attention"], fail: ["p-bad", "Fail"], not_assessed: ["stg-neutral", "Not assessed"] };
const SRC = { farmer: "Farmer record", ai: "AI image analysis", photo: "Photo measurement" };

/** Public view of a crop-stage certificate. */
function PublicStage({ c }) {
  const a = c.assessment;
  return (
    <>
      <div className={`cert-verdict big ${c.status === "valid" ? "good" : "bad"}`}>
        <Icon name={c.status === "valid" ? "checkCircle" : "xCircle"} size={28} />
        <div><b>{c.status === "valid" ? "Valid stage certificate" : "Certificate revoked"}</b>
          <div>{c.certificateId} · {c.stage.name} · {c.grower} · {c.status === "valid" ? `approved ${day(a.approvedAt)} by ${a.consultant}` : `revoked ${day(c.revoked?.at)} — ${c.revoked?.reason}`}</div></div>
      </div>
      <div className="cert-layout">
        <div>
          <div className="card">
            <h3><Icon name="sprout" />Crop stage</h3>
            <dl className="cert-facts">
              <dt>Stage</dt><dd>{c.stage.name}</dd><dt>Grower</dt><dd>{c.grower}</dd><dt>FPO</dt><dd>{c.fpo}</dd>
              <dt>Product</dt><dd>{c.product.variety} · {c.product.origin}</dd>
              <dt>Crop record</dt><dd className="mono">{c.cropId}</dd>
              <dt>Batch (lot)</dt><dd>{c.batchId ? <Link to={`/trace/${c.batchId}`} className="mono">{c.batchId}</Link> : "Not yet in a lot"}</dd>
              <dt>Quality score</dt><dd>{a.qualityScore ?? "—"} / 100 ({a.coverage?.evaluated} of {a.coverage?.total} checks assessed)</dd>
              <dt>Approved by</dt><dd>{a.consultant} · {day(a.approvedAt)}</dd>
            </dl>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <h3 style={{ padding: "16px 20px 0" }}><Icon name="checkCircle" />Checks at approval</h3>
            <div className="tableWrap"><table>
              <thead><tr><th>Check</th><th>Source</th><th>Result</th></tr></thead>
              <tbody>{a.checks.map((k, i) => { const [cls, txt] = RES[k.status] || RES.not_assessed; return <tr key={i}><td>{k.label}</td><td className="note">{SRC[k.source]}</td><td><span className={`pill ${cls}`}>{txt}</span></td></tr>; })}</tbody>
            </table></div>
          </div>
          <p className="note">Photo analysis covers only what a photo can show. Confirmed by the consultant instead: {a.notAssessable.join("; ")}.</p>
          <FileCheck certificateId={c.certificateId} />
        </div>
        <div>
          <div className="card cert-qr">
            <img src={`/api/public/certificates/${c.certificateId}/qr.svg`} alt="" width="140" height="140" />
            <div><b>Certificate PDF</b><div className="note">SHA-256 {shortHash(c.document?.sha256)}</div>
              <a className="btn small" style={{ marginTop: 8 }} href={`/api/public/certificates/${c.certificateId}/document`} target="_blank" rel="noreferrer"><Icon name="file" size={14} />Open PDF</a></div>
          </div>
          <div className="card">
            <h3><Icon name="shield" />Blockchain record</h3>
            {c.chain?.status === "registered" ? (
              <dl className="cert-facts compact"><dt>Network</dt><dd>{c.chain.network}</dd><dt>Block</dt><dd>{c.chain.blockNumber}</dd>
                <dt>Fingerprint</dt><dd className="mono" title={c.chain.docHash}>{shortHash(c.chain.docHash)}</dd></dl>) : <p className="note">Registration pending.</p>}
          </div>
        </div>
      </div>
    </>
  );
}

export default function VerifyCertificate() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    document.title = id ? `${id} — AgriLink certificate` : "Verify a certificate — AgriLink";
    setC(null); setErr(null);
    if (id) pub(`/${encodeURIComponent(id)}`).then(setC).catch(setErr);
  }, [id]);

  return (
    <div className="pubpage">
      <header className="pub-top"><div className="pub-wrap"><Brand to="/" /><span className="note">Certificate verification</span></div></header>
      <main className="pub-wrap">
        {!id && (<><h1>Verify an AgriLink Quality Certificate</h1><p className="sub">Enter the certificate number printed on the PDF, or check the PDF file itself.</p><Lookup /><FileCheck /></>)}
        {id && err && (<><div className="cert-verdict bad big"><Icon name="xCircle" size={26} /><div><b>No certificate found with number {id}.</b><div className="note">Check the number, or the certificate may not be genuine.</div></div></div><Lookup /></>)}
        {id && !c && !err && <p className="note">Loading…</p>}
        {c && c.kind === "stage" && <PublicStage c={c} />}
        {c && c.kind !== "stage" && (
          <>
            <div className={`cert-verdict big ${c.status === "valid" ? "good" : c.status === "expired" ? "warn" : "bad"}`}>
              <Icon name={c.status === "valid" ? "checkCircle" : c.status === "expired" ? "calendar" : "xCircle"} size={28} />
              <div>
                <b>{c.status === "valid" ? "Valid certificate" : c.status === "expired" ? "Certificate expired" : "Certificate revoked"}</b>
                <div>{c.certificateId} · {c.product.variety} · {kg(c.totalKg)} · {c.status === "valid" ? `valid until ${day(c.validUntil)}` : c.status === "expired" ? `expired ${day(c.validUntil)}` : `revoked ${day(c.revoked?.at)} — ${c.revoked?.reason}`}</div>
              </div>
            </div>

            <div className="cert-layout">
              <div>
                <div className="card">
                  <h3><Icon name="box" />Consignment</h3>
                  <dl className="cert-facts">
                    <dt>Product</dt><dd>{c.product.variety} {c.product.crop.toLowerCase()} · {c.product.origin}</dd>
                    <dt>Lot</dt><dd><Link to={`/trace/${c.lotId}`} className="mono">{c.lotId}</Link></dd>
                    <dt>Quantity</dt><dd>{kg(c.totalKg)} · {gradeMix(c.gradeMix)}</dd>
                    <dt>Contract grade</dt><dd>Grade {c.requiredGrade} or better</dd>
                    <dt>FPO</dt><dd>{c.fpo}</dd>
                    <dt>Buyer</dt><dd>{c.buyer}</dd>
                    <dt>Issued</dt><dd>{day(c.issuedAt)} · {c.issuedBy}</dd>
                    <dt>Status</dt><dd><CertStatus status={c.status} /></dd>
                  </dl>
                </div>
                <div className="card" style={{ padding: 0 }}>
                  <h3 style={{ padding: "16px 20px 0" }}><Icon name="farmer" />Growers and quality evidence</h3>
                  <div className="tableWrap"><table>
                    <thead><tr><th>Grower</th><th>Quantity</th><th>Lot grade</th><th>Farmer doctor</th><th>AI photo check</th></tr></thead>
                    <tbody>{c.growers.map((g) => (
                      <tr key={g.name}><td><b>{g.name}</b></td><td>{kg(g.kg)}</td><td>Grade {g.grade}</td>
                        <td>{g.doctorGrade ? <>Grade {g.doctorGrade}<div className="note">{day(g.doctorAt)}</div></> : "—"}</td>
                        <td>{g.photoGrade ? `Grade ${g.photoGrade}` : "—"}<div className="note">{g.photoChecks} photo(s)</div></td></tr>))}</tbody>
                  </table></div>
                </div>
                <FileCheck certificateId={c.certificateId} />
              </div>
              <div>
                <div className="card cert-qr">
                  <img src={`/api/public/certificates/${c.certificateId}/qr.svg`} alt="" width="140" height="140" />
                  <div><b>Certificate PDF</b><div className="note">SHA-256 {shortHash(c.document?.sha256)}</div>
                    <a className="btn small" style={{ marginTop: 8 }} href={`/api/public/certificates/${c.certificateId}/document`} target="_blank" rel="noreferrer"><Icon name="file" size={14} />Open PDF</a></div>
                </div>
                <div className="card">
                  <h3><Icon name="shield" />Blockchain record</h3>
                  {c.chain?.status === "registered" ? (
                    <dl className="cert-facts compact">
                      <dt>Network</dt><dd>{c.chain.network}</dd><dt>Block</dt><dd>{c.chain.blockNumber}</dd>
                      <dt>Transaction</dt><dd className="mono" title={c.chain.txHash}>{shortHash(c.chain.txHash)}</dd>
                      <dt>Fingerprint</dt><dd className="mono" title={c.chain.docHash}>{shortHash(c.chain.docHash)}</dd>
                      {c.revocationChain && <><dt>Revocation</dt><dd>Block {c.revocationChain.blockNumber}</dd></>}
                    </dl>) : <p className="note">Registration pending.</p>}
                </div>
                <div className="card">
                  <h3><Icon name="truck" />Traceability</h3>
                  <p style={{ margin: "0 0 6px" }}>{c.trace.events} recorded events · log {c.trace.intact ? <span className="pill p-good">intact</span> : <span className="pill p-bad">broken</span>}</p>
                  <Link className="btn alt small" to={`/trace/${c.lotId}`}>See the lot's journey</Link>
                </div>
                <p className="note">AgriLink platform quality certificate. It is not an APEDA, AGMARK or GI certificate and does not replace phytosanitary certification.</p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
