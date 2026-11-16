import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api.js";
import { useApi } from "../../hooks/useApi.js";
import Icon from "../../components/Icon.jsx";
import { useToast } from "../../components/ui.jsx";
import { Hash, dt, fetchPdf, sha256Hex } from "../../components/trust/ui.jsx";

/**
 * Verify Document Integrity: the SHA-256 is computed in the browser (the file never leaves the device),
 * then compared with the hash registered on Polygon.
 */
export default function Verify() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [agreementId, setAgreementId] = useState(params.get("id") || "");
  const [file, setFile] = useState(null);
  const [hash, setHash] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const list = useApi("/contracts").data?.items?.filter((a) => a.chain?.status === "registered" || a.history?.length) || [];

  const check = async (name, buffer) => {
    setBusy(true); setRes(null);
    try {
      const h = await sha256Hex(buffer);
      setFile({ name, size: buffer.byteLength }); setHash(h);
      setRes(await api("/contracts/verify", { method: "POST", body: { sha256: h, agreementId: agreementId || undefined } }));
    } catch (e) { toast(e.message || "Verification failed"); } finally { setBusy(false); }
  };
  const onFile = async (f) => { if (f) check(f.name, await f.arrayBuffer()); };
  // quick checks: the genuine signed PDF, and a copy with one character changed
  const sample = async (tamper) => {
    if (!agreementId) return toast("Choose an agreement first");
    try {
      const { blob } = await fetchPdf(`/contracts/${agreementId}/document`);
      const buf = new Uint8Array(await blob.arrayBuffer());
      if (tamper) { const i = Math.floor(buf.length / 2); buf[i] = buf[i] ^ 1; } // flip one bit in the middle of the file
      check(`${agreementId}-signed${tamper ? "-MODIFIED" : ""}.pdf`, buf.buffer);
    } catch { toast("Signed PDF not available for this agreement"); }
  };

  const ok = res?.result === "verified";
  return (
    <>
      <div className="page-head">
        <div><h2>Verify document integrity</h2><p className="sub">Check that a signed agreement is the exact original. The file is hashed in your browser and never uploaded.</p></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(260px, 1fr)", alignItems: "start" }}>
        <div className="card">
          <label>Agreement (optional — to compare with its latest on-chain version)</label>
          <select value={agreementId} onChange={(e) => setAgreementId(e.target.value)}>
            <option value="">Find it from the document hash</option>
            {list.map((a) => <option key={a.agreementId} value={a.agreementId}>{a.agreementId} · {a.parties.buyer.company} · v{a.version}</option>)}
          </select>
          <div className={`drop ${over ? "over" : ""}`} style={{ marginTop: 16 }} onClick={() => input.current.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }}>
            <Icon name="file" size={34} />
            <p style={{ margin: "10px 0 4px", fontWeight: 600 }}>Drop the signed agreement PDF here</p>
            <p className="note" style={{ margin: 0 }}>or click to choose a file · SHA-256 is computed locally</p>
            <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => onFile(e.target.files[0])} />
          </div>
          <div className="page-actions" style={{ marginTop: 12 }}>
            <button className="btn alt small" disabled={!agreementId || busy} onClick={() => sample(false)}>Check the original signed PDF</button>
            <button className="btn alt small" disabled={!agreementId || busy} onClick={() => sample(true)}>Check a modified copy</button>
          </div>

          {busy && <p className="note">Computing SHA-256 and querying the blockchain…</p>}
          {res && (
            <div className={`result ${ok ? "ok" : "bad"}`}>
              <h2><Icon name={ok ? "checkCircle" : "xCircle"} size={26} />{ok ? "Verified — Original document unchanged." : "Verification failed — Document may have been modified."}</h2>
              <p style={{ margin: 0 }}>{ok
                ? `This file is ${res.agreementId} version ${res.version}${res.isLatest === false ? ` — note: superseded by version ${res.latestVersion} (amendment)` : ", the latest signed version"}.`
                : res.expected ? `The hash does not match the registered hash of ${res.expected.agreementId} (version ${res.expected.version}).` : "This hash is not registered on the blockchain."}</p>
              <div className="cmp">
                <span className="note">File</span><span>{file?.name} · {(file?.size / 1024).toFixed(1)} KB</span>
                <span className="note">Computed SHA-256</span><span><Hash value={res.computedHash} short={false} /></span>
                <span className="note">On-chain SHA-256</span><span>{ok ? <Hash value={res.onChain?.docHash} short={false} /> : res.expected ? <Hash value={res.expected.docHash} short={false} /> : "— not found"}</span>
                {ok && <><span className="note">Registered</span><span>{dt(res.onChain?.registeredAt)} · block {res.tx?.blockNumber}</span>
                  <span className="note">Transaction</span><span><Hash value={res.tx?.txHash} /></span>
                  <span className="note">Agreement</span><span><Link to={`/contracts/${res.agreementId}`}>{res.agreementId}</Link></span></>}
                <span className="note">Network</span><span>{res.network} · contract <Hash value={res.contract} /></span>
              </div>
            </div>
          )}
        </div>
        <div className="card">
          <h3><Icon name="shield" />How verification works</h3>
          <ol style={{ paddingLeft: 18, margin: 0, fontSize: 14, color: "var(--text-2)", lineHeight: 1.7 }}>
            <li>Your browser computes the SHA-256 hash of the PDF.</li>
            <li>AgriLink looks the hash up in the AgreementRegistry smart contract on Polygon.</li>
            <li>The hashes are compared. Changing even one character of the PDF changes the hash completely.</li>
            <li>Match: <b style={{ color: "#047857" }}>Verified</b>. No match: <b style={{ color: "#b91c1c" }}>Verification failed</b>.</li>
          </ol>
          <p className="note" style={{ marginTop: 12 }}>Anyone with the PDF can verify it independently by calling <span className="mono">lookup(sha256)</span> on the registry contract.</p>
        </div>
      </div>
    </>
  );
}
