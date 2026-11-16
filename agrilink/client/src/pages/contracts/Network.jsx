import { Fragment } from "react";
import { useApi } from "../../hooks/useApi.js";
import Icon from "../../components/Icon.jsx";
import { Loading } from "../../components/ui.jsx";
import { Hash } from "../../components/trust/ui.jsx";

const ONCHAIN = [
  ["Agreement reference", "keccak256(agreement ID)", "On-chain"], ["Signed PDF SHA-256", "32-byte hash", "On-chain"],
  ["Version and previous-version hash", "amendment chain", "On-chain"], ["Registration time and registrar", "block timestamp", "On-chain"],
  ["Signed PDF", "write-once versioned storage (S3 Object Lock in production)", "Off-chain"],
  ["Names, phone numbers, addresses", "MongoDB (access-controlled)", "Off-chain"], ["Prices and commercial terms", "inside the PDF / database", "Off-chain"],
  ["Signature evidence (OTP, IP, certificate)", "signature certificate page + database", "Off-chain"],
];
const STACK = [["Smart contract", "Solidity 0.8.24 · OpenZeppelin AccessControl + Pausable · append-only versions"], ["Blockchain", "Polygon PoS (local Hardhat chain in development; Amoy testnet / mainnet by config)"],
  ["Integration", "ethers.js v6 from the Node.js API"], ["Documents", "PDF generated server-side (pdfkit), SHA-256, write-once storage"],
  ["E-signature", "Provider interface: AgriLink Sign · Zoho Sign · DocuSign"], ["Frontend", "React (Vite)"], ["Backend", "Node.js + Express, role-based access"]];

export default function Network() {
  const m = useApi("/contracts/meta").data;
  if (!m) return <Loading />;
  const c = m.chain || {};
  return (
    <>
      <div className="page-head"><div><h2>Network &amp; contract</h2><p className="sub">Where agreement hashes are anchored and what is (and is not) stored on-chain.</p></div></div>
      <div className="grid two" style={{ alignItems: "start" }}>
        <div className="card chain-hero">
          <h3><Icon name="globe" />Blockchain</h3>
          {c.error ? <span className="seal bad"><Icon name="xCircle" size={16} />{c.error}</span> : (
            <dl className="kv" style={{ gridTemplateColumns: "150px 1fr" }}>
              <dt>Network</dt><dd>{c.network}</dd><dt>Chain ID</dt><dd>{c.chainId}</dd>
              <dt>Registry contract</dt><dd><Hash value={c.contract} short={false} /></dd>
              <dt>Registrar wallet</dt><dd><Hash value={c.registrar} short={false} /></dd>
              <dt>Latest block</dt><dd>{c.block}</dd>
              <dt>Explorer</dt><dd>{c.explorer ? <a href={`${c.explorer}/address/${c.contract}`} target="_blank" rel="noreferrer" style={{ color: "#67e8f9" }}>{c.explorer}</a> : "Local chain — no public explorer"}</dd>
            </dl>
          )}
          {c.chainId === 31337 && <p style={{ color: "#8ea3bf", fontSize: 13, marginTop: 14 }}>Development network: an EVM chain identical in behaviour to Polygon PoS. Set CHAIN_RPC, CHAIN_PRIVATE_KEY and deploy with <span className="mono">npm run deploy:amoy</span> to anchor on Polygon Amoy testnet.</p>}
        </div>
        <div className="card">
          <h3><Icon name="pen" />E-signature and storage</h3>
          <dl className="kv" style={{ gridTemplateColumns: "150px 1fr" }}>
            <dt>Active provider</dt><dd>{m.esign.active}</dd>
            <dt>Available</dt><dd>{m.esign.providers.map((p) => `${p.name}${p.active ? "" : " (needs API keys)"}`).join(" · ")}</dd>
            <dt>Document storage</dt><dd>{m.storage.kind}</dd>
          </dl>
        </div>
      </div>
      <div className="card">
        <h3><Icon name="shield" />Data placement</h3>
        <div className="tableWrap"><table><thead><tr><th>Data</th><th>Form</th><th>Location</th></tr></thead>
          <tbody>{ONCHAIN.map(([d, f, l]) => <tr key={d}><td><b>{d}</b></td><td className="note">{f}</td><td><span className={`badge ${l === "On-chain" ? "b-in_progress" : "b-draft"}`}>{l}</span></td></tr>)}</tbody></table></div>
      </div>
      <div className="card">
        <h3><Icon name="dashboard" />Technology</h3>
        <dl className="kv">{STACK.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      </div>
    </>
  );
}
