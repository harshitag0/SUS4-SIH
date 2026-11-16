import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api.js";
import { useApi } from "../../hooks/useApi.js";
import Icon from "../../components/Icon.jsx";
import { ErrorBox, Loading, Modal, useToast } from "../../components/ui.jsx";
import { Hash, StatusBadge, actionLabel, dt, usd } from "../../components/trust/ui.jsx";

const FILTERS = [["all", "All"], ["draft", "Drafts"], ["pending_signature", "Awaiting signature"], ["registered", "On-chain"], ["in_progress", "In progress"], ["disputed", "Disputed"]];

function NewAgreement({ onClose, existing }) {
  const toast = useToast();
  const nav = useNavigate();
  const bonds = useApi("/bonds").data || [];
  const open = bonds.filter((b) => !existing.has(String(b._id)));
  const create = async (id) => {
    try { const a = await api(`/contracts/from-bond/${id}`, { method: "POST" }); nav(`/contracts/${a.agreementId}/edit`); }
    catch { toast("Could not create the agreement"); }
  };
  return (
    <Modal onClose={onClose}>
      <h3><Icon name="file" />New agreement</h3>
      <p className="note">Agreements are created from a farmer's commitment to a buyer requirement, so quantity, grade and price come from the accepted offer. Pick a commitment without an agreement:</p>
      {open.length === 0 && <div className="insight">Every commitment already has an agreement. New ones are created automatically when a farmer commits to a requirement.</div>}
      {open.map((b) => (
        <div className="mkrow" key={b._id}>
          <b>{b.buyerName} ← {b.farmerName}</b>
          <span className="note">{b.tons} t · Grade {b.grade} · ${b.priceUsd}/kg</span>
          <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => create(b._id)}>Create agreement</button>
        </div>
      ))}
      <div className="mrow"><button className="btn alt" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const [filter, setFilter] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const r = useApi("/contracts", { live: ["contracts", "bonds"] });
  const meta = useApi("/contracts/meta").data;
  const d = r.data;
  const items = useMemo(() => (d?.items || []).filter((a) => filter === "all" || a.status === filter), [d, filter]);
  if (r.loading && !d) return <Loading />;
  if (!d) return <ErrorBox error={r.error} />;
  const s = d.stats;
  const KPI = [
    ["file", "", "Total agreements", s.total, `${usd(s.contractValueUsd)} contract value`],
    ["pen", "amber", "Awaiting signatures", s.awaiting, "Sent, not yet signed by both"],
    ["checkCircle", "", "Fully signed", s.signed, "Both parties signed"],
    ["shield", "green", "Blockchain verified", s.verified, meta?.chain?.network || "Polygon PoS"],
    ["alert", "red", "Requires attention", s.attention, "Your signature, disputes, delivery due"],
  ];

  return (
    <>
      <div className="page-head">
        <div><h2>Agreement Registry</h2><p className="sub">Digitally signed procurement agreements with blockchain-anchored integrity.</p></div>
        <div className="page-actions">
          <button className="btn alt" onClick={() => nav("/contracts/verify")}><Icon name="shield" size={16} />Verify document</button>
          <button className="btn" onClick={() => setShowNew(true)}><Icon name="file" size={16} />New agreement</button>
        </div>
      </div>

      <div className="grid kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {KPI.map(([ic, tone, l, v, sub]) => (
          <div className="card kpi" key={l}><span className={`ic ${tone}`}><Icon name={ic} /></span><div className="l">{l}</div><div className="v">{v}</div><div className="d">{sub}</div></div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)", alignItems: "start" }}>
        <div className="card">
          <h3>Agreements</h3>
          <div className="chips">{FILTERS.map(([k, l]) => <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
          <div className="tableWrap"><table className="nowrap">
            <thead><tr><th>Agreement</th><th>Parties</th><th>Product</th><th>Value</th><th>Status</th><th>Integrity</th><th>Updated</th></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.agreementId} style={{ cursor: "pointer" }} onClick={() => nav(`/contracts/${a.agreementId}`)}>
                  <td><Link to={`/contracts/${a.agreementId}`}>{a.agreementId}</Link><div className="note">v{a.version}{a.amendmentOf ? " · amendment" : ""}</div></td>
                  <td>{a.parties.buyer.company}<div className="note">{a.parties.seller.farmerName} · {a.parties.seller.fpo}</div></td>
                  <td>Alphonso · {a.terms.grade}<div className="note">{a.terms.quantityTons} t</div></td>
                  <td>{usd(a.terms.totalValueUsd)}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>{a.chain?.status === "registered" ? <span className="badge b-registered">Block {a.chain.blockNumber}</span> : a.chain?.status === "failed" ? <span className="badge b-failed">Retry needed</span> : <span className="note">Not anchored</span>}</td>
                  <td className="note">{dt(a.updatedAt)}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan="7" className="note">No agreements here yet. They appear when a farmer commits to a buyer requirement.</td></tr>}
            </tbody>
          </table></div>
        </div>

        <div>
          <div className="card chain-hero">
            <h3><Icon name="globe" />Network</h3>
            {meta?.chain?.error ? <span className="seal bad"><Icon name="xCircle" size={16} />Blockchain node unreachable</span> : (
              <dl className="kv" style={{ gridTemplateColumns: "1fr" }}>
                <dt>Network</dt><dd>{meta?.chain?.network || "…"}</dd>
                <dt>Registry contract</dt><dd><Hash value={meta?.chain?.contract} /></dd>
                <dt>Latest block</dt><dd>{meta?.chain?.block ?? "…"}</dd>
                <dt>E-signature</dt><dd>{meta?.esign?.active}</dd>
              </dl>
            )}
          </div>
          <div className="card">
            <h3><Icon name="trending" />Recent activity</h3>
            <ul className="feed">
              {d.activity.map((e, i) => (
                <li key={i}>
                  <span className="ic"><Icon name={e.action.includes("chain") ? "shield" : e.action.includes("sign") ? "pen" : e.action.startsWith("milestone") ? "checkCircle" : "file"} size={15} /></span>
                  <div><b>{actionLabel(e.action)}</b> · <Link to={`/contracts/${e.agreementId}`} style={{ textDecoration: "none" }}>{e.agreementId}</Link><div className="note">{e.actorName} · {dt(e.at)}</div></div>
                </li>
              ))}
              {d.activity.length === 0 && <li className="note">No activity yet.</li>}
            </ul>
          </div>
        </div>
      </div>
      {showNew && <NewAgreement onClose={() => setShowNew(false)} existing={new Set(d.items.map((a) => String(a.bond)))} />}
    </>
  );
}
