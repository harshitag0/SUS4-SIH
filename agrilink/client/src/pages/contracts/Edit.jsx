import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api.js";
import { useApi } from "../../hooks/useApi.js";
import Icon from "../../components/Icon.jsx";
import { ErrorBox, Loading, useToast } from "../../components/ui.jsx";
import LegalPreview from "../../components/trust/LegalPreview.jsx";
import { StatusBadge, usd } from "../../components/trust/ui.jsx";

const TEXT = [["qualitySpec", "Quality specifications"], ["packaging", "Packaging requirements"], ["inspection", "Inspection and acceptance conditions"],
  ["rejectionTerms", "Rejection terms"], ["disputeTerms", "Dispute-resolution terms"]];

/** Structured agreement creation / editing with a live formal preview. */
export default function Edit() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const r = useApi(`/contracts/${id}`);
  const [t, setT] = useState(null);
  const a = r.data;
  useEffect(() => { if (a && !t) setT({ ...a.terms, deliveryDate: String(a.terms.deliveryDate).slice(0, 10) }); }, [a, t]);
  if (r.loading && !a) return <Loading />;
  if (!a || !t) return <ErrorBox error={r.error} />;
  if (a.status !== "draft") return <div className="card"><p>This agreement is <StatusBadge status={a.status} /> and can no longer be edited. Signed agreements change only through an amendment.</p><Link to={`/contracts/${id}`}>Back to agreement</Link></div>;

  const set = (k) => (e) => setT({ ...t, [k]: e.target.value });
  const total = Number(t.quantityTons || 0) * 1000 * Number(t.priceUsdPerKg || 0);
  const preview = { ...t, totalValueUsd: total };
  const changed = Object.keys(t).filter((k) => JSON.stringify(t[k]) !== JSON.stringify(k === "deliveryDate" ? String(a.terms[k]).slice(0, 10) : a.terms[k]));
  const pctSum = t.paymentMilestones.reduce((s, m) => s + Number(m.pct || 0), 0);
  const setMs = (i, k, v) => setT({ ...t, paymentMilestones: t.paymentMilestones.map((m, j) => (j === i ? { ...m, [k]: k === "pct" ? Number(v) : v } : m)) });

  const save = async (send) => {
    if (pctSum !== 100) return toast("Payment milestones must add up to 100%");
    try {
      const { product, variety, grade, totalValueUsd, currency, escalation, ...editable } = t;
      await api(`/contracts/${id}/terms`, { method: "PUT", body: { ...editable, quantityTons: Number(t.quantityTons), priceUsdPerKg: Number(t.priceUsdPerKg) } });
      if (send) await api(`/contracts/${id}/send`, { method: "POST" });
      toast(send ? "Sent to both parties for signature" : "Draft saved");
      nav(`/contracts/${id}`);
    } catch (e) { toast(e.message || "Could not save"); }
  };

  return (
    <>
      <Link to={`/contracts/${id}`} className="linkbtn" style={{ textDecoration: "none" }}><Icon name="arrowLeft" size={16} />Back to agreement</Link>
      <div className="page-head" style={{ marginTop: 6 }}>
        <div><h2>{a.agreementId} · edit terms</h2><p className="sub">Version {a.version} · draft. Changes are highlighted in the preview. After sending, the text is locked and both parties sign.</p></div>
        <div className="page-actions"><button className="btn alt" onClick={() => save(false)}>Save draft</button><button className="btn cyan" onClick={() => save(true)}><Icon name="arrowRight" size={16} />Save &amp; send for signature</button></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)", alignItems: "start" }}>
        <div>
          <div className="card">
            <h3><Icon name="file" />Agreement</h3>
            <dl className="kv" style={{ gridTemplateColumns: "150px 1fr" }}>
              <dt>Agreement ID</dt><dd className="mono">{a.agreementId}</dd>
              <dt>Buyer</dt><dd>{a.parties.buyer.company} · {a.parties.buyer.country}</dd>
              <dt>Farmer / FPO</dt><dd>{a.parties.seller.farmerName} · {a.parties.seller.fpo}</dd>
              <dt>Product</dt><dd>{t.product}</dd>
              <dt>Variety / grade</dt><dd>{t.variety} · Grade {t.grade}</dd>
            </dl>
          </div>
          <div className="card">
            <h3><Icon name="wallet" />Quantity, price and delivery</h3>
            <div className="row">
              <div><label>Quantity (metric tons)</label><input type="number" step="0.1" min="0.1" value={t.quantityTons} onChange={set("quantityTons")} /></div>
              <div><label>Agreed price (USD/kg)</label><input type="number" step="0.05" min="0.1" value={t.priceUsdPerKg} onChange={set("priceUsdPerKg")} /></div>
            </div>
            <p className="insight">Total contract value: <b>{usd(total)}</b> · {t.incoterm}</p>
            <div className="row">
              <div><label>Pickup location</label><input value={t.pickupLocation} onChange={set("pickupLocation")} /></div>
              <div><label>Delivery location</label><input value={t.deliveryLocation} onChange={set("deliveryLocation")} /></div>
            </div>
            <div className="row"><div><label>Delivery date</label><input type="date" value={t.deliveryDate} onChange={set("deliveryDate")} /></div><div><label>Incoterm</label><input value={t.incoterm} onChange={set("incoterm")} /></div></div>
          </div>
          <div className="card">
            <h3><Icon name="calendar" />Payment milestones <span className={`badge ${pctSum === 100 ? "b-registered" : "b-disputed"}`} style={{ marginLeft: "auto" }}>{pctSum}%</span></h3>
            {t.paymentMilestones.map((m, i) => (
              <div className="row" key={i} style={{ gridTemplateColumns: "1fr 90px" }}>
                <div><label>Milestone {i + 1}</label><input value={m.label} onChange={(e) => setMs(i, "label", e.target.value)} /></div>
                <div><label>%</label><input type="number" min="0" max="100" value={m.pct} onChange={(e) => setMs(i, "pct", e.target.value)} /></div>
              </div>
            ))}
          </div>
          <div className="card">
            <h3><Icon name="shield" />Quality, inspection and legal terms</h3>
            {TEXT.map(([k, l]) => <div key={k}><label>{l}</label><textarea rows={4} value={t[k]} onChange={set(k)} style={{ width: "100%", font: "inherit", fontSize: 14, padding: 10, border: "1px solid var(--line)", borderRadius: 10 }} /></div>)}
          </div>
        </div>
        <div style={{ position: "sticky", top: 76 }}>
          <div className="note" style={{ marginBottom: 8 }}>Live preview · {changed.length ? `${changed.length} unsaved change(s) highlighted` : "no unsaved changes"}</div>
          <LegalPreview a={a} terms={preview} changed={changed} />
        </div>
      </div>
    </>
  );
}
