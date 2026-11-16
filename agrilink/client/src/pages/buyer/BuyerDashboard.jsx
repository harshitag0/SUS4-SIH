import { useState } from "react";
import { api } from "../../api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useApi } from "../../hooks/useApi.js";
import { Link } from "react-router-dom";
import { ErrorBox, LineChart, Loading, inr, useToast } from "../../components/ui.jsx";

const USD_INR = 88;
const GRADES = { A: "A · ≥300 g, deep golden, no blemish", B: "B · 250–300 g, minor blemish", C: "C · 200–250 g, processing/local" };

/** Buyer portal (English only for now: buyers are in Singapore). */
export default function BuyerDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const reqs = useApi("/requirements", { refreshMs: 60000, live: ["requirements", "bonds"] });
  const contracts = useApi("/contracts", { refreshMs: 60000, live: ["contracts", "bonds"] });
  const agreements = contracts.data?.items || [];
  const sg = useApi("/market/outlook?destination=Singapore");
  const [f, setF] = useState({ grade: "A", tons: 20, priceUsd: 5, floorUsd: 4.5, deliverBy: "2026-05-10", escalation: true, pct: 8 });
  const price = useApi(`/market/price?grade=${f.grade}`);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const fc = price.data?.season_avg;
  const pct = fc ? ((f.priceUsd * USD_INR - fc) / fc) * 100 : 0;
  const verdict = pct >= 3 ? ["Above forecast", "p-good"] : pct >= -7 ? ["Fair", "p-warn"] : ["Below forecast", "p-bad"];
  const rows = reqs.data || [];

  const publish = async (e) => {
    e.preventDefault();
    try {
      await api("/requirements", { method: "POST", body: { grade: f.grade, tons: +f.tons, priceUsd: +f.priceUsd, floorUsd: +f.floorUsd, deliverBy: f.deliverBy, escalation: { enabled: f.escalation, pct: +f.pct } } });
      toast("Requirement published — visible to farmers now");
      reqs.reload();
    } catch { toast("Could not publish. Check the form."); }
  };
  const withdraw = async (id) => { await api(`/requirements/${id}`, { method: "DELETE" }); reqs.reload(); };

  return (
    <div id="buyer">
      <h2>Buyer dashboard · {user.company || user.name}</h2>
      <p className="sub">Post what you need. Farmers and FPOs see it instantly and respond.</p>
      <div className="grid kpis">
        <div className="card kpi"><div className="l">Open requirements</div><div className="v">{rows.length}</div></div>
        <div className="card kpi"><div className="l">Tons requested</div><div className="v">{rows.reduce((a, r) => a + r.tons, 0)} t</div></div>
        <div className="card kpi"><div className="l">Farmers interested</div><div className="v">{rows.reduce((a, r) => a + r.interested, 0)}</div></div>
        <div className="card kpi"><div className="l">Forecast price, grade {f.grade}</div><div className="v">{fc ? `$${(fc / USD_INR).toFixed(2)}/kg` : "…"}</div><div className="d">{fc && `≈ ${inr(fc)}/kg farm-gate`}</div></div>
      </div>
      <div className="grid two">
        <div className="card">
          <h3>Post a new requirement</h3>
          <form onSubmit={publish}>
            <div className="row">
              <div><label>Grade</label><select value={f.grade} onChange={set("grade")}>{Object.entries(GRADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><label>Quantity (tons)</label><input type="number" min="1" value={f.tons} onChange={set("tons")} required /></div>
            </div>
            <div className="row">
              <div><label>Offered price (USD/kg)</label><input type="number" step="0.1" min="0.5" value={f.priceUsd} onChange={set("priceUsd")} required /></div>
              <div><label>Price floor (USD/kg)</label><input type="number" step="0.1" value={f.floorUsd} onChange={set("floorUsd")} /></div>
            </div>
            <div className="row">
              <div><label>Delivery by</label><input type="date" value={f.deliverBy} onChange={set("deliverBy")} required /></div>
              <div><label>Max escalation (%)</label><input type="number" min="0" max="30" value={f.pct} onChange={set("pct")} /></div>
            </div>
            <label><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={f.escalation} onChange={set("escalation")} /> Raise offer if supply is tight</label>
            <div className="insight">{fc ? <>Forecast fair price for grade {f.grade}: <b>${(fc / USD_INR).toFixed(2)}/kg</b>. Your offer is <span className={`pill ${verdict[1]}`}>{verdict[0]}</span> ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%). {verdict[1] === "p-bad" && "Farmers will likely favour other buyers — consider raising it or adding escalation."}</> : "Loading forecast…"}</div>
            <p><button className="btn" type="submit">Publish requirement</button></p>
          </form>
        </div>
        <div className="card">
          <h3>Singapore market snapshot</h3>
          {sg.data ? (<>
            <LineChart labels={[...sg.data.history.years, `${sg.data.year} (fc)`]} label="Singapore demand vs supply"
              series={[{ name: "Demand (t)", color: "var(--brand)", data: [...sg.data.history.demand, sg.data.demand], dots: true }, { name: "FPO supply (t)", color: "var(--brand2)", data: [...sg.data.history_supply, sg.data.supply], dots: true }]} />
            <div className="insight">{sg.data.year} model forecast: demand <b>{Math.round(sg.data.demand)} t</b> ({Math.round(sg.data.demand_lo)}–{Math.round(sg.data.demand_hi)}) vs FPO supply <b>{Math.round(sg.data.supply)} t</b> → {sg.data.gap > 0 ? <>shortage of <b>{Math.round(sg.data.gap)} t</b>, mostly Grade {sg.data.most_needed_grade}. Competition for export-grade fruit is high, so book early.</> : "supply is sufficient."}</div>
          </>) : <Loading />}
          <ErrorBox error={sg.error} />
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Your requirements</h3>
        <div className="tableWrap"><table>
          <thead><tr><th>Grade</th><th>Tons</th><th>Offer</th><th>Escalation</th><th>Deliver by</th><th>Filled</th><th>Interested</th><th>Price check</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id}>
                <td>{r.grade}</td><td>{r.tons}</td><td>${r.priceUsd.toFixed(2)}</td>
                <td>{r.escalation?.enabled ? `up to +${r.escalation.pct}%` : "—"}</td><td>{r.deliverBy.slice(0, 10)}</td>
                <td style={{ minWidth: 110 }}><div className="bar"><i style={{ width: `${(r.filled / r.tons) * 100}%` }} /></div><span className="note">{r.filled}/{r.tons} t</span></td>
                <td>{r.interested} farmers</td>
                <td><span className={`pill ${r.verdict.status === "above" ? "p-good" : r.verdict.status === "fair" ? "p-warn" : "p-bad"}`}>{r.verdict.status === "above" ? "Above forecast" : r.verdict.status === "fair" ? "Fair" : "Below forecast"}</span></td>
                <td><button className="btn alt small" onClick={() => withdraw(r._id)}>Withdraw</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="9" className="note">No requirements yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
      <div className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <div><h3 style={{ margin: 0 }}>Digital agreements ({agreements.length})</h3>
            <p className="sub" style={{ margin: "4px 0 0" }}>Each farmer commitment becomes a formal agreement: you complete the terms, both parties sign with OTP verification, and the signed PDF's SHA-256 is registered on Polygon.</p></div>
          <Link className="btn" to="/contracts">Open Agreement Registry</Link>
        </div>
        <div className="tableWrap"><table>
          <thead><tr><th>Agreement</th><th>Farmer / FPO</th><th>Quantity</th><th>Value</th><th>Status</th><th /></tr></thead>
          <tbody>
            {agreements.map((a) => {
              const mine = a.signers.find((s) => s.role === "buyer");
              const action = a.status === "draft" ? "Complete terms" : a.status === "pending_signature" && mine?.status !== "signed" ? "Review & sign" : "Open";
              const to = a.status === "draft" ? `/contracts/${a.agreementId}/edit` : action === "Review & sign" ? `/contracts/${a.agreementId}/sign` : `/contracts/${a.agreementId}`;
              return (
                <tr key={a.agreementId}>
                  <td><b>{a.agreementId}</b><div className="note">v{a.version}</div></td>
                  <td>{a.parties.seller.farmerName}<div className="note">{a.parties.seller.fpo}</div></td>
                  <td>{a.terms.quantityTons} t · Grade {a.terms.grade}</td>
                  <td>USD {Number(a.terms.totalValueUsd).toLocaleString()}</td>
                  <td><span className={`pill ${a.chain?.status === "registered" ? "p-good" : a.status === "pending_signature" ? "p-warn" : a.status === "disputed" ? "p-bad" : ""}`}>{a.status.replace("_", " ")}</span></td>
                  <td><Link className="btn alt small" to={to}>{action}</Link></td>
                </tr>
              );
            })}
            {agreements.length === 0 && <tr><td colSpan="6" className="note">No agreements yet. When a farmer commits to a requirement, a draft agreement appears here.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
