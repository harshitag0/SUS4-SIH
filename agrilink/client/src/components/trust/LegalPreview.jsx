import { day, dt, usd } from "./ui.jsx";

/** HTML rendition of the formal procurement agreement (same structure as the generated PDF). */
export default function LegalPreview({ a, terms, changed = [] }) {
  const t = terms || a.terms, b = a.parties.buyer, s = a.parties.seller;
  const cls = (k) => (changed.includes(k) ? "changed" : undefined);
  const signer = (role) => a.signers.find((x) => x.role === role);
  const SigBox = ({ role, label }) => {
    const sg = signer(role), sig = sg?.signature;
    return (
      <div className="sigbox">
        <div className="lab">{label}</div>
        {sig?.signedAt ? (
          <>
            {sig.type === "drawn" && sig.image ? <img src={sig.image} alt="signature" /> : <div className="script">{sig.typedName}</div>}
            <div>{sg.name} · {sg.organisation}</div>
            <div className="note">Signed {dt(sig.signedAt)} · {sig.certificateId}</div>
          </>
        ) : (
          <><div style={{ borderBottom: "1px solid #cbd5e1", height: 46 }} /><div className="note" style={{ marginTop: 6 }}>{sg?.name} — awaiting signature</div></>
        )}
      </div>
    );
  };
  return (
    <article className="legal">
      <div className="doc-top" />
      <header>
        <div><h1>PROCUREMENT AGREEMENT</h1><div className="note">Fresh Alphonso Mangoes · India → Singapore</div></div>
        <div className="meta"><b style={{ color: "#0b1f3a" }}>{a.agreementId}</b><br />Version {a.version}{a.amendmentOf ? ` (amends v${a.amendmentOf})` : ""}<br />Date {day(a.createdAt)}</div>
      </header>
      <div className="parties">
        <div className="party"><b>BUYER</b>{b.company}<br />Contact: {b.contactName}<br />{b.country} · {b.maskedMobile}</div>
        <div className="party"><b>SELLER (FARMER / FPO)</b>{s.farmerName}<br />FPO: {s.fpo}<br />{s.village}, {s.district}, Maharashtra · {s.maskedMobile}</div>
      </div>
      <h2>1. Product and quantity</h2>
      <table><tbody>
        <tr><td>Product</td><td>{t.product}</td></tr>
        <tr><td>Variety / grade</td><td>{t.variety} · Grade {t.grade}</td></tr>
        <tr className={cls("quantityTons")}><td>Quantity</td><td><b>{t.quantityTons} metric tons</b></td></tr>
        <tr className={cls("priceUsdPerKg")}><td>Price</td><td><b>{usd(t.priceUsdPerKg)} per kg</b> · {t.incoterm}</td></tr>
        <tr><td>Total contract value</td><td><b>{usd(t.totalValueUsd)}</b></td></tr>
      </tbody></table>
      <h2>2. Quality specifications</h2><p className={cls("qualitySpec")}>{t.qualitySpec}</p>
      <h2>3. Packaging requirements</h2><p className={cls("packaging")}>{t.packaging}</p>
      <h2>4. Pickup and delivery</h2>
      <p className={cls("pickupLocation")}><b>Pickup:</b> {t.pickupLocation}</p>
      <p className={cls("deliveryLocation")}><b>Delivery:</b> {t.deliveryLocation}</p>
      <p className={cls("deliveryDate")}><b>Delivery date:</b> {day(t.deliveryDate)}</p>
      <h2>5. Inspection and acceptance</h2><p className={cls("inspection")}>{t.inspection}</p>
      <h2>6. Payment milestones</h2>
      <ol type="a" className={cls("paymentMilestones")}>{(t.paymentMilestones || []).map((m, i) => <li key={i}>{m.label} — <b>{m.pct}%</b> ({usd((t.totalValueUsd * m.pct) / 100)})</li>)}</ol>
      {t.escalation?.enabled && <p>Price escalation: up to {t.escalation.pct}% if export supply is tight, by written notice before dispatch.</p>}
      <h2>7. Rejection</h2><p className={cls("rejectionTerms")}>{t.rejectionTerms}</p>
      <h2>8. Dispute resolution</h2><p className={cls("disputeTerms")}>{t.disputeTerms}</p>
      <h2>9. Integrity and records</h2>
      <p>The SHA-256 hash of the final signed version is registered on Polygon PoS by AgriLink. The document and personal data remain off-chain. Any amendment creates a new version that both parties must sign again; earlier versions and their hashes are preserved.</p>
      <div className="sigs2">
        <SigBox role="buyer" label="SIGNED FOR THE BUYER" />
        <SigBox role="farmer" label="SIGNED FOR THE SELLER (FARMER / FPO)" />
      </div>
    </article>
  );
}
