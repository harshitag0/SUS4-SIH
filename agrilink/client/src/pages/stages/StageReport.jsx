import { Fragment, useEffect, useState } from "react";
import { getToken } from "../../api.js";
import Icon from "../../components/Icon.jsx";

/** Shared pieces for stage assessments: status pill, provisional/final report, image evidence. */
export const STATUS = {
  pending_review: ["p-warn", "calendar", "st_pending"],
  approved: ["p-good", "checkCircle", "st_approved"],
  rejected: ["p-bad", "xCircle", "st_rejected"],
  requires_correction: ["p-warn", "pen", "st_correction"],
  not_started: ["", "info", "st_not_started"],
};
export function StagePill({ status, t }) {
  const [cls, icon, key] = STATUS[status] || STATUS.not_started;
  return <span className={`pill ${cls || "stg-neutral"}`}><Icon name={icon} size={13} />{t(key)}</span>;
}

const COMPLIANCE = {
  likely_compliant: ["p-good", "Likely compliant"], minor_issues: ["p-warn", "Minor issues"],
  issues_found: ["p-bad", "Issues found"], insufficient_evidence: ["p-warn", "Insufficient evidence"],
};
const FINAL = { approved: ["p-good", "Compliant (approved)"], rejected: ["p-bad", "Non-compliant (rejected)"], requires_correction: ["p-warn", "Correction required"] };
const RESULT = { pass: ["p-good", "Pass"], warn: ["p-warn", "Attention"], fail: ["p-bad", "Fail"], not_assessed: ["stg-neutral", "Not assessed"] };
const SOURCE = { farmer: "Farmer record", ai: "AI image analysis", photo: "Photo measurement" };
const fmt = (v) => (v === true ? "Yes" : v === false ? "No" : v == null ? "—" : String(v));

/** Fetches a protected photo with the bearer token. */
function AuthImg({ src, alt }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u, alive = true;
    fetch(src, { headers: { authorization: `Bearer ${getToken()}` } }).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (b && alive) { u = URL.createObjectURL(b); setUrl(u); }
    }).catch(() => {});
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [src]);
  return url ? <img src={url} alt={alt} /> : <div className="stg-img-ph"><Icon name="file" size={18} /></div>;
}

export function ScoreRing({ score }) {
  if (score == null) return <div className="stg-score none"><b>—</b><span>No score</span></div>;
  const tone = score >= 80 ? "ok" : score >= 60 ? "warn" : "bad";
  const r = 30, c = 2 * Math.PI * r;
  return (
    <svg className={`stg-ring ${tone}`} width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`Quality score ${score} of 100`}>
      <circle cx="38" cy="38" r={r} className="trk" /><circle cx="38" cy="38" r={r} className="val" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 38 38)" />
      <text x="38" y="43" textAnchor="middle">{score}</text>
    </svg>
  );
}

export default function StageReport({ a, fields = [] }) {
  const r = a.report || {};
  const [cCls, cLabel] = FINAL[a.status] || COMPLIANCE[r.provisionalCompliance] || ["", "—"];
  const label = (k) => fields.find((f) => f.key === k)?.label || k;
  return (
    <div className="stg-report">
      <div className="card stg-summary">
        <ScoreRing score={r.qualityScore} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="note">Quality score · {r.coverage?.evaluated ?? 0} of {r.coverage?.total ?? 0} checks assessed</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "4px 0" }}>
            <span className={`pill ${cCls}`}>{cLabel}</span>
            {a.status === "pending_review" && <span className="note">Provisional — waiting for the consultant's decision</span>}
          </div>
          <div className="note">{(r.ai?.models || []).join(" · ") || "AI not used"}{r.ai && !r.ai.available ? " · AI unavailable at submission" : ""}</div>
        </div>
      </div>

      {a.review?.decision && (
        <div className={`card stg-decision ${a.review.decision}`}>
          <b>Consultant decision: {FINAL[a.review.decision]?.[1]}</b>
          <div className="note">{a.review.by} · {new Date(a.review.at).toLocaleString("en-GB")}</div>
          {a.review.remarks && <p style={{ margin: "6px 0 0" }}>{a.review.remarks}</p>}
        </div>
      )}

      {r.issues?.length > 0 && (
        <div className="card">
          <h3><Icon name="alert" />Detected issues</h3>
          <ul className="stg-issues">{r.issues.map((i, k) => (
            <li key={k}><span className={`pill ${i.severity === "high" ? "p-bad" : i.severity === "medium" ? "p-warn" : "stg-neutral"}`}>{i.severity}</span>{i.label}<span className="note"> · {SOURCE[i.source] || i.source}</span></li>))}</ul>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <h3 style={{ padding: "16px 20px 0" }}><Icon name="checkCircle" />Stage checks</h3>
        <div className="tableWrap"><table>
          <thead><tr><th>Check</th><th>Source</th><th>Recorded</th><th>Expected</th><th>Result</th></tr></thead>
          <tbody>{(r.checks || []).map((c) => {
            const [cls, txt] = RESULT[c.status] || RESULT.not_assessed;
            return (<tr key={c.key}><td>{c.label}{c.note && <div className="note">{c.note}</div>}</td><td className="note">{SOURCE[c.source]}</td>
              <td>{fmt(c.value)}</td><td className="note">{c.expected}</td><td><span className={`pill ${cls}`}>{txt}</span></td></tr>);
          })}</tbody>
        </table></div>
      </div>

      <div className="card">
        <h3><Icon name="info" />Assessment remarks</h3>
        <ul className="stg-remarks">{(r.remarks || []).map((m, k) => <li key={k}>{m}</li>)}</ul>
      </div>

      <div className="card">
        <h3><Icon name="file" />Image evidence</h3>
        <div className="stg-gallery">{(r.imageEvidence || []).map((p) => (
          <figure key={p.n}>
            <AuthImg src={`/api/stage-assessments/${a.assessmentId}/photos/${p.n}`} alt={`Photo ${p.n}`} />
            <figcaption>
              <b>Photo {p.n}</b> {p.usable === false ? <span className="pill p-warn">not usable</span> : p.usable ? <span className="pill p-good">clear</span> : null}
              {p.issues?.length > 0 && <div className="note">{p.issues.join(", ").replace(/_/g, " ")}</div>}
              {p.fruit?.is_fruit && <div className="note">blemish {p.fruit.defect_pct}% · colour {p.fruit.colour_score}</div>}
              <div className="note mono" title={p.sha256}>SHA-256 {p.sha256?.slice(0, 10)}…</div>
            </figcaption>
          </figure>))}</div>
      </div>

      {a.entries && Object.keys(a.entries).length > 0 && (
        <div className="card">
          <h3><Icon name="pen" />Farmer's record</h3>
          <dl className="cert-facts">{Object.entries(a.entries).map(([k, v]) => <Fragment key={k}><dt>{label(k)}</dt><dd>{fmt(v)}</dd></Fragment>)}</dl>
        </div>
      )}
    </div>
  );
}
