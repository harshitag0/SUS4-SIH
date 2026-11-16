import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { Brand } from "../../components/Layout.jsx";
import { CertStatus, day, gradeMix, kg, shortHash } from "../certificates/ui.jsx";
import "../certificates/certificates.css";

/** Public lot journey behind the lot QR code (no login). Data: farm operations' public trace endpoint. */
const STAGE = {
  AGREEMENT_ACTIVATED: "Agreement active", PHOTOS_ANALYSED: "Photos checked by AI", DOCTOR_INSPECTION: "Farmer doctor inspection",
  QUALITY_PASS: "Quality passed", QUALITY_FAIL: "Quality below grade", INTERVENTION_VERIFIED: "Fix verified by doctor",
  LOT_COLLECTED: "Collected at FPO", HANDOVER_AT_PORT: "Handed over at port", RECEIVED_IN_SINGAPORE: "Received in Singapore",
};

export default function PublicTrace() {
  const { lotId } = useParams();
  const [d, setD] = useState(null);
  const [certs, setCerts] = useState([]);
  const [err, setErr] = useState(false);
  useEffect(() => {
    document.title = `Lot ${lotId} — AgriLink trace`;
    fetch(`/api/m2/trace/lots/${encodeURIComponent(lotId)}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setD).catch(() => setErr(true));
    fetch(`/api/public/certificates?lot=${encodeURIComponent(lotId)}`).then((r) => (r.ok ? r.json() : [])).then(setCerts).catch(() => {});
  }, [lotId]);
  const active = certs.find((c) => c.status === "valid") || certs[0];

  return (
    <div className="pubpage">
      <header className="pub-top"><div className="pub-wrap"><Brand to="/" /><span className="note">Lot traceability</span></div></header>
      <main className="pub-wrap">
        {err && <div className="cert-verdict bad big"><Icon name="xCircle" size={26} /><div><b>Lot {lotId} was not found.</b></div></div>}
        {!d && !err && <p className="note">Loading…</p>}
        {d && (
          <>
            <h1 style={{ marginBottom: 4 }}>Lot <span className="mono">{d.lot.id}</span></h1>
            <p className="sub">{d.agreement.variety} {/mango/i.test(d.agreement.crop) ? "mango" : String(d.agreement.crop).toLowerCase()} · {kg(d.lot.total_kg)} · {gradeMix(d.lot.grade_mix)} · {d.fpo} → {d.agreement.buyer}</p>
            {active ? (
              <div className={`cert-verdict ${active.status === "valid" ? "good" : "warn"}`}>
                <Icon name="shield" size={24} />
                <div><b>Quality certificate <span className="mono">{active.certificateId}</span></b> <CertStatus status={active.status} />
                  <div><Link to={`/verify/${active.certificateId}`}>Open certificate →</Link></div></div>
              </div>
            ) : <div className="cert-verdict warn"><Icon name="info" size={22} /><div><b>No quality certificate issued for this lot yet.</b></div></div>}
            <div className="cert-layout">
              <div className="card">
                <h3><Icon name="truck" />Journey</h3>
                <ol className="cert-audit">{d.events.map((e) => (
                  <li key={e.hash || e.seq}><b>{STAGE[e.stage] || e.stage.replace(/_/g, " ").toLowerCase()}</b><div className="note">{day(e.at)} · {e.summary}</div></li>))}</ol>
              </div>
              <div>
                <div className="card">
                  <h3><Icon name="farmer" />Growers in this lot</h3>
                  <ul className="cert-basis">{d.lot.contributions.map((c) => <li key={c.farmer_id}><b>{c.farmer_name}</b> · {kg(c.kg)} · Grade {c.grade}</li>)}</ul>
                </div>
                <div className="card">
                  <h3><Icon name="shield" />Tamper check</h3>
                  <p style={{ margin: 0 }}>{d.chain.ok ? <span className="pill p-good">Trace log intact</span> : <span className="pill p-bad">Trace log broken</span>} <span className="note">{d.chain.checked} events checked</span></p>
                  {d.chain.head && <div className="note mono" style={{ marginTop: 6 }}>Head {shortHash(d.chain.head)}</div>}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
