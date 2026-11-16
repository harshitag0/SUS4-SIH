import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api.js";
import { useApi } from "../../hooks/useApi.js";
import Icon from "../../components/Icon.jsx";
import PreSignCheck from "../../components/PreSignCheck.jsx";
import { ErrorBox, Loading, Modal, useToast } from "../../components/ui.jsx";
import LegalPreview from "../../components/trust/LegalPreview.jsx";
import { Hash, MILESTONE_LABEL, StatusBadge, actionLabel, downloadPdf, dt, usd } from "../../components/trust/ui.jsx";

const MANUAL = { harvest_completed: ["farmer"], quality_inspected: ["farmer", "buyer"], packing_completed: ["farmer"], shipment_dispatched: ["farmer"], goods_received: ["buyer"], payment_completed: ["buyer"] };
const LIFECYCLE = Object.keys(MILESTONE_LABEL);
const TABS = [["document", "Document"], ["signatures", "Signatures"], ["chain", "Blockchain"], ["timeline", "Timeline"], ["audit", "Audit trail"], ["versions", "Versions"]];

function ChainPanel({ a, explorer }) {
  const nav = useNavigate();
  const c = a.chain || {};
  const signed = a.documents.find((d) => d.version === a.version && d.kind === "signed");
  return (
    <div className="card chain-hero">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}><Icon name="shield" />Blockchain verification</h3>
        {c.status === "registered" ? <span className="seal"><Icon name="checkCircle" size={16} />Registered · tamper-evident</span>
          : c.status === "failed" ? <span className="seal bad"><Icon name="xCircle" size={16} />Registration failed</span>
          : <span className="seal off"><Icon name="alert" size={16} />Not yet registered — needs both signatures</span>}
      </div>
      <dl className="kv">
        <dt>Agreement ID</dt><dd>{a.agreementId} · version {a.version}</dd>
        <dt>On-chain reference</dt><dd><Hash value={a.ref} /></dd>
        <dt>SHA-256 of signed PDF</dt><dd><Hash value={signed?.sha256 ? "0x" + signed.sha256 : null} short={false} /></dd>
        <dt>Network</dt><dd>{c.network || "—"}{c.chainId ? ` · chainId ${c.chainId}` : ""}</dd>
        <dt>Registry contract</dt><dd><Hash value={c.contract} /></dd>
        <dt>Transaction hash</dt><dd><Hash value={c.txHash} />{explorer && c.txHash && <a href={`${explorer}/tx/${c.txHash}`} target="_blank" rel="noreferrer" style={{ color: "#67e8f9", marginLeft: 8, fontSize: 13 }}>View on explorer</a>}</dd>
        <dt>Block number</dt><dd>{c.blockNumber ?? "—"}</dd>
        <dt>Registered at</dt><dd>{dt(c.registeredAt)}{c.reanchoredAt ? " (re-anchored after local chain reset)" : ""}</dd>
        <dt>Previous version hash</dt><dd>{c.prevDocHash && !/^0x0+$/.test(c.prevDocHash) ? <Hash value={c.prevDocHash} /> : "— (original version)"}</dd>
        <dt>Registrar wallet</dt><dd><Hash value={c.registrar} /> <span style={{ color: "#8ea3bf", fontSize: 12 }}>AgriLink registrar</span></dd>
        <dt>Signer wallets</dt><dd style={{ color: "#8ea3bf", fontWeight: 400 }}>Not required — signers are identified by the e-signature provider (OTP); only the registrar wallet writes on-chain.</dd>
        {c.error && <><dt>Error</dt><dd style={{ color: "#fca5a5" }}>{c.error}</dd></>}
      </dl>
      <p style={{ color: "#8ea3bf", fontSize: 13, margin: "16px 0 12px" }}>On-chain: only the agreement reference (keccak256 of the ID), the SHA-256 of the signed PDF, the version and timestamps. The PDF, names, phone numbers and prices stay off-chain in write-once storage.</p>
      <button className="btn cyan" onClick={() => nav(`/contracts/verify?id=${a.agreementId}`)}><Icon name="shield" size={16} />Verify document integrity</button>
    </div>
  );
}

function Signatures({ a, provider }) {
  return (
    <div className="grid two">
      {a.signers.map((s) => (
        <div className="card" key={s.role}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <h3 style={{ margin: 0 }}><Icon name={s.role === "buyer" ? "building" : "sprout"} />{s.role === "buyer" ? "Buyer" : "Farmer / FPO"}</h3>
            <span className={`badge ${s.status === "signed" ? "b-registered" : s.status === "declined" ? "b-disputed" : s.status === "identity_verified" ? "b-in_progress" : "b-pending_signature"}`}>
              {s.status === "signed" ? "Signed" : s.status === "identity_verified" ? "Identity verified" : s.status === "declined" ? "Declined" : "Awaiting signature"}</span>
          </div>
          <dl className="kv" style={{ marginTop: 14, gridTemplateColumns: "150px 1fr" }}>
            <dt>Signatory</dt><dd>{s.name}</dd>
            <dt>Organisation</dt><dd>{s.organisation}</dd>
            <dt>Identity check</dt><dd>{s.identity?.verifiedAt ? <>Mobile OTP to {s.maskedMobile}<div className="note">{dt(s.identity.verifiedAt)}</div></> : <span className="note">Not verified yet</span>}</dd>
            <dt>Sent for signature</dt><dd>{dt(s.sentAt)}</dd>
            <dt>Signed</dt><dd>{dt(s.signature?.signedAt)}</dd>
            <dt>Signature</dt><dd>{s.signature?.type === "drawn" ? <img src={s.signature.image} alt="signature" style={{ maxHeight: 44 }} /> : s.signature?.typedName ? <span style={{ fontFamily: "Segoe Script, cursive", fontSize: 20 }}>{s.signature.typedName}</span> : "—"}</dd>
            <dt>Certificate ID</dt><dd className="mono">{s.signature?.certificateId || "—"}</dd>
            <dt>Signed document</dt><dd>{s.signature?.signedDocHash ? <Hash value={"0x" + s.signature.signedDocHash} /> : "—"}</dd>
            <dt>IP / device</dt><dd className="note">{s.signature?.ip || "—"} {s.signature?.userAgent ? `· ${s.signature.userAgent.slice(0, 60)}…` : ""}</dd>
            <dt>Provider</dt><dd>{provider}</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

function Timeline({ a, onRecord }) {
  const done = Object.fromEntries(a.milestones.map((m) => [m.key, m]));
  const next = LIFECYCLE.find((k) => !done[k]);
  const canRecord = (k) => k === next && MANUAL[k]?.includes(a.myRole) && ["registered", "in_progress"].includes(a.status);
  return (
    <div className="card">
      <h3><Icon name="calendar" />Agreement lifecycle</h3>
      <ol className="tl">
        {LIFECYCLE.map((k) => {
          const m = done[k];
          return (
            <li key={k} className={m ? "done" : k === next ? "next" : ""}>
              <span className="dot"><Icon name={m ? "check" : "calendar"} size={14} /></span>
              <div><div className="t-title">{MILESTONE_LABEL[k]}</div>
                <div className="t-meta">{m ? `${dt(m.at)} · ${m.byName}${m.note ? ` · ${m.note}` : ""}` : MANUAL[k] ? `Recorded by ${MANUAL[k].map((r) => (r === "farmer" ? "farmer / FPO" : "buyer")).join(" or ")}` : "Automatic"}</div></div>
              {canRecord(k) ? <button className="btn small" onClick={() => onRecord(k)}>Record</button> : <span />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Audit({ id }) {
  const r = useApi(`/contracts/${id}/audit`, { live: ["contracts"] }).data;
  if (!r) return <Loading />;
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <h3><Icon name="file" />Audit trail</h3>
        <span className={`badge ${r.intact ? "b-registered" : "b-disputed"}`}>{r.intact ? `Hash chain intact · ${r.entries.length} entries` : `Chain broken at entry ${r.brokenAt}`}</span>
      </div>
      <p className="note">Append-only: every entry stores the SHA-256 of the previous entry, so editing or deleting any record breaks the chain.</p>
      <div className="tableWrap"><table>
        <thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Details</th><th>Entry hash</th></tr></thead>
        <tbody>{[...r.entries].reverse().map((e) => (
          <tr key={e.hash}><td className="note">{dt(e.at)}</td><td>{e.actorName}<div className="note">{e.actorRole}</div></td><td><b>{actionLabel(e.action)}</b></td>
            <td className="note mono" style={{ maxWidth: 260 }}>{e.details ? Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ").slice(0, 140) : ""}</td>
            <td><Hash value={e.hash} /></td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

function Versions({ a }) {
  const toast = useToast();
  const all = [...a.history.map((h) => ({ ...h, superseded: true })), { version: a.version, documents: a.documents.filter((d) => d.version === a.version), chain: a.chain, current: true }];
  const dl = (v) => downloadPdf(`/contracts/${a.agreementId}/document?version=${v}`, `${a.agreementId}-v${v}-signed.pdf`).catch(() => toast("Signed PDF not available yet"));
  return (
    <div className="card">
      <h3><Icon name="agreements" />Versions</h3>
      <p className="note">Signed versions are never overwritten. An amendment creates a new version that both parties sign again; its on-chain record links to the previous hash.</p>
      <div className="tableWrap"><table>
        <thead><tr><th>Version</th><th>Status</th><th>Signed PDF SHA-256</th><th>Transaction</th><th>Block</th><th /></tr></thead>
        <tbody>{[...all].reverse().map((v) => {
          const signed = v.documents.find((d) => d.kind === "signed");
          return (
            <tr key={v.version}>
              <td><b>v{v.version}</b>{v.reason && <div className="note">{v.reason}</div>}</td>
              <td>{v.superseded ? <span className="badge b-amended">Amended · superseded</span> : <StatusBadge status={a.status} />}</td>
              <td>{signed ? <Hash value={"0x" + signed.sha256} /> : <span className="note">—</span>}</td>
              <td>{v.chain?.txHash ? <Hash value={v.chain.txHash} /> : <span className="note">—</span>}</td>
              <td>{v.chain?.blockNumber ?? "—"}</td>
              <td>{signed && <button className="btn alt small" onClick={() => dl(v.version)}>Download</button>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </div>
  );
}

export default function Detail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState("document");
  const [modal, setModal] = useState(null); // {kind:'amend'|'dispute'|'milestone', key}
  const [text, setText] = useState("");
  const [price, setPrice] = useState("");
  const r = useApi(`/contracts/${id}`, { live: ["contracts"] });
  const meta = useApi("/contracts/meta").data;
  const a = r.data;
  if (r.loading && !a) return <Loading />;
  if (!a) return <ErrorBox error={r.error} />;

  const me = a.signers.find((s) => s.role === a.myRole);
  const signed = a.documents.find((d) => d.version === a.version && d.kind === "signed");
  const act = async (path, body, msg) => {
    try { await api(`/contracts/${id}${path}`, { method: "POST", body }); if (msg) toast(msg); r.reload(); setModal(null); setText(""); }
    catch (e) { toast(e.message || "Action failed"); }
  };
  const dl = (kind) => downloadPdf(`/contracts/${id}/document?kind=${kind}`, `${id}-v${a.version}-${kind}.pdf`).catch(() => toast("Document not available yet"));

  return (
    <>
      <Link to="/contracts" className="linkbtn" style={{ textDecoration: "none" }}><Icon name="arrowLeft" size={16} />All agreements</Link>
      <div className="page-head" style={{ marginTop: 6 }}>
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{a.agreementId} <StatusBadge status={a.status} />{a.amendmentOf && <span className="badge b-amended">Amendment v{a.version}</span>}</h2>
          <p className="sub">{a.parties.buyer.company} ↔ {a.parties.seller.farmerName} ({a.parties.seller.fpo}) · Alphonso Grade {a.terms.grade} · {a.terms.quantityTons} t · <b>{usd(a.terms.totalValueUsd)}</b></p>
        </div>
        <div className="page-actions">
          {a.status === "draft" && <><button className="btn alt" onClick={() => nav(`/contracts/${id}/edit`)}><Icon name="pen" size={16} />Edit terms</button>
            <button className="btn" onClick={() => act("/send", undefined, "Sent to both parties for signature")}><Icon name="arrowRight" size={16} />Send for signature</button></>}
          {a.status === "pending_signature" && me?.status !== "signed" && <><button className="btn cyan" onClick={() => nav(`/contracts/${id}/sign`)}><Icon name="pen" size={16} />Review &amp; sign</button>
            <button className="btn danger" onClick={() => act("/decline", { reason: "Changes requested" }, "Declined — agreement returned to draft")}>Decline</button></>}
          {a.status === "pending_signature" && <button className="btn alt" onClick={() => dl("draft")}><Icon name="file" size={16} />Draft PDF</button>}
          {signed && <button className="btn alt" onClick={() => dl("signed")}><Icon name="file" size={16} />Download signed PDF</button>}
          {signed && <button className="btn alt" onClick={() => nav(`/contracts/verify?id=${id}`)}><Icon name="shield" size={16} />Verify</button>}
          {["registered", "in_progress"].includes(a.status) && <><button className="btn alt" onClick={() => setModal({ kind: "amend" })}>Amend</button>
            <button className="btn danger" onClick={() => setModal({ kind: "dispute" })}>Raise dispute</button></>}
          {a.status === "disputed" && <button className="btn alt" onClick={() => act("/dispute/resolve", { note: "Resolved by parties" }, "Dispute resolved")}>Mark dispute resolved</button>}
          {a.chain?.status === "failed" && <button className="btn" onClick={() => act("/retry-chain", undefined, "Registration retried")}>Retry blockchain registration</button>}
        </div>
      </div>

      {a.status === "disputed" && <div className="alertbox"><span className="ic"><Icon name="alert" /></span><div><b>Dispute open</b> — raised by {a.disputed?.raisedBy} on {dt(a.disputed?.at)}: {a.disputed?.reason}</div></div>}
      {a.myRole === "farmer" && a.status === "pending_signature" && me?.status !== "signed" && a.bond && <PreSignCheck bondId={a.bond} />}

      <div className="tabs2">{TABS.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "document" && <LegalPreview a={a} />}
      {tab === "signatures" && <Signatures a={a} provider={meta?.esign?.active || "—"} />}
      {tab === "chain" && <ChainPanel a={a} explorer={meta?.chain?.explorer} />}
      {tab === "timeline" && <Timeline a={a} onRecord={(key) => setModal({ kind: "milestone", key })} />}
      {tab === "audit" && <Audit id={id} />}
      {tab === "versions" && <Versions a={a} />}

      {modal && (
        <Modal onClose={() => setModal(null)}>
          {modal.kind === "milestone" && <><h3>Record: {MILESTONE_LABEL[modal.key]}</h3><label>Note (optional)</label><input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 1.5 t harvested, lot L-0423" />
            <div className="mrow"><button className="btn alt" onClick={() => setModal(null)}>Cancel</button><button className="btn" onClick={() => act("/milestones", { key: modal.key, note: text || undefined }, "Milestone recorded")}>Record milestone</button></div></>}
          {modal.kind === "dispute" && <><h3>Raise a dispute</h3><p className="note">Starts the dispute-resolution clause (negotiation → mediation → SIAC arbitration). Recorded in the audit trail.</p><label>Describe the issue</label><input value={text} onChange={(e) => setText(e.target.value)} />
            <div className="mrow"><button className="btn alt" onClick={() => setModal(null)}>Cancel</button><button className="btn danger" onClick={() => act("/dispute", { reason: text })}>Raise dispute</button></div></>}
          {modal.kind === "amend" && <><h3>Create amendment (version {a.version + 1})</h3><p className="note">The signed version {a.version} and its blockchain record stay preserved. Both parties must sign the new version again.</p>
            <label>New price (USD/kg, optional)</label><input type="number" step="0.05" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={String(a.terms.priceUsdPerKg)} />
            <label>Reason for amendment</label><input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Price revised under escalation clause" />
            <div className="mrow"><button className="btn alt" onClick={() => setModal(null)}>Cancel</button><button className="btn" onClick={() => act("/amend", { reason: text, changes: price ? { priceUsdPerKg: Number(price) } : {} }, "Amendment created as a new draft version")}>Create amendment</button></div></>}
        </Modal>
      )}
    </>
  );
}
