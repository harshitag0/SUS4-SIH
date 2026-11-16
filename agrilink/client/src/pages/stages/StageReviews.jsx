import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api.js";
import Icon from "../../components/Icon.jsx";
import { ErrorBox, Loading, useToast } from "../../components/ui.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useApi } from "../../hooks/useApi.js";
import { useI18n } from "../../i18n/index.jsx";
import StageReport, { ScoreRing, StagePill } from "./StageReport.jsx";
import "./stages.css";
import "../certificates/certificates.css";

/** Consultant (farmer doctor) queue; FPO and AgriLink operations see it read-only. */
const TABS = [["pending_review", "Pending review"], ["requires_correction", "Requires correction"], ["approved", "Approved"], ["rejected", "Rejected"], ["", "All"]];

export function StageReviewQueue() {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "pending_review";
  const { data, error, loading } = useApi(`/stage-assessments${status ? `?status=${status}` : ""}`, { live: ["stages"] });
  const role = user.m2Role || "admin";
  return (
    <div>
      <div className="page-head">
        <div><h1>Stage reviews</h1><p className="sub">{role === "doctor" ? "Stage assessments from growers in your FPO. Review the evidence, confirm what photos cannot show, then decide." : "Stage assessments and consultant decisions (read-only for this desk; farmer doctors decide)."}</p></div>
        {role === "admin" && <Link className="btn alt small" to="/ops/stage-settings"><Icon name="dashboard" size={15} />Stage settings</Link>}
      </div>
      <div className="dc-tabs">{TABS.map(([k, l]) => <button key={l} className={`dc-tab ${status === k ? "on" : ""}`} onClick={() => setParams(k ? { status: k } : { status: "" })}>{l}</button>)}</div>
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && !data.length && <div className="card cert-empty"><Icon name="checkCircle" size={26} /><p>Nothing here.</p></div>}
      {data?.length > 0 && (
        <div className="card" style={{ padding: 0 }}><div className="tableWrap"><table>
          <thead><tr><th>Assessment</th><th>Stage</th><th>Crop · batch</th><th>Score</th><th>Submitted</th><th>Status</th></tr></thead>
          <tbody>{data.map((a) => (
            <tr key={a.assessmentId} className="cert-row" onClick={() => nav(`/ops/stage-reviews/${a.assessmentId}`)}>
              <td><span className="mono">{a.assessmentId}</span><div className="note">v{a.version}</div></td>
              <td>{a.stage.name}</td>
              <td><span className="mono">{a.cropId}</span><div className="note">{a.batchId || "no batch yet"}</div></td>
              <td>{a.report?.qualityScore ?? "—"}</td>
              <td>{new Date(a.createdAt).toLocaleDateString("en-GB")}</td>
              <td><StagePill status={a.status} t={t} /></td>
            </tr>))}</tbody>
        </table></div></div>
      )}
    </div>
  );
}

export function StageReviewDetail() {
  const { id } = useParams();
  const { t } = useI18n();
  const toast = useToast();
  const { data: a, error, loading, reload } = useApi(`/stage-assessments/${id}`, { live: ["stages"] });
  const [decision, setDecision] = useState("approved");
  const [remarks, setRemarks] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (loading && !a) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api(`/stage-assessments/${a.assessmentId}/decision`, { method: "POST", body: { decision, remarks, confirmNotAssessable: confirm } });
      toast(r.certificateId ? `Approved — certificate ${r.certificateId} issued` : r.status === "approved" ? "Approved — certificate pending (see below)" : "Decision recorded");
      reload();
    } catch (e) { toast(e.message, { long: true }); } finally { setBusy(false); }
  };
  const retry = async () => { setBusy(true); try { await api(`/stage-assessments/${a.assessmentId}/retry-certificate`, { method: "POST" }); reload(); } catch (e) { toast(e.message, { long: true }); } finally { setBusy(false); } };

  return (
    <div>
      <div className="crumbs"><Link to="/ops/stage-reviews">Stage reviews</Link> / <span className="mono">{a.assessmentId}</span></div>
      <div className="page-head">
        <div>
          <h1 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{a.stage.name} <StagePill status={a.status} t={t} /></h1>
          <p className="sub">{a.farmer?.name} · {a.farmer?.farm?.village} · crop <span className="mono">{a.cropId}</span>{a.batchId ? <> · batch <span className="mono">{a.batchId}</span></> : ""} · version {a.version}</p>
        </div>
        {a.certificateId && <Link className="btn small" to={`/ops/certificates/${a.certificateId}`}><Icon name="shield" size={15} />{a.certificateId}</Link>}
      </div>

      <div className="stg-layout">
        <StageReport a={a} fields={a.fields} />
        <aside>
          {a.canDecide && (
            <div className="card stg-decide">
              <h3><Icon name="pen" />Your decision</h3>
              <div className="stg-choices">{[["approved", "Approve"], ["requires_correction", "Requires correction"], ["rejected", "Reject"]].map(([k, l]) => (
                <label key={k} className={`stg-choice ${decision === k ? "on " + k : ""}`}><input type="radio" name="d" checked={decision === k} onChange={() => setDecision(k)} />{l}</label>))}</div>
              <label className="stg-field"><span>Remarks {decision !== "approved" && "*"}</span>
                <textarea rows={4} aria-label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={decision === "approved" ? "Optional: what you verified" : "Tell the farmer what to fix or why"} /></label>
              {decision === "approved" && (
                <label className="stg-confirm"><input type="checkbox" aria-label="I verified what photos cannot show" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  <span>I verified on site or from records what photos cannot show: {(a.report?.notAssessable || []).join("; ")}.</span></label>
              )}
              <button className="btn" disabled={busy || (decision === "approved" ? !confirm : remarks.trim().length < 5)} onClick={submit}>
                {decision === "approved" ? "Approve and issue certificate" : decision === "rejected" ? "Reject" : "Request correction"}</button>
              <p className="note">The AI and rule results above are provisional. Your decision is the assessment result; approval triggers the stage certificate.</p>
            </div>
          )}
          {!a.canDecide && a.status === "pending_review" && <div className="card"><p className="note" style={{ margin: 0 }}>Only the farmer doctor of this grower's FPO can decide. Switch the desk to that farmer doctor to review.</p></div>}
          {a.status === "approved" && !a.certificateId && (
            <div className="card"><p className="down" style={{ marginTop: 0 }}>Approved, but the certificate was not issued: {a.certificateError}</p>
              <button className="btn small" disabled={busy} onClick={retry}>Retry certificate</button></div>
          )}
          <div className="card">
            <h3><Icon name="calendar" />Versions</h3>
            <ol className="cert-audit">{a.history.map((h) => (
              <li key={h.assessmentId}><Link to={`/ops/stage-reviews/${h.assessmentId}`} className="mono">{h.assessmentId}</Link> v{h.version} <StagePill status={h.status} t={t} />
                {h.review?.remarks && <div className="note">{h.review.remarks}</div>}</li>))}</ol>
          </div>
          <div className="card">
            <h3><Icon name="shield" />Audit trail {a.auditIntact ? <span className="pill p-good">intact</span> : <span className="pill p-bad">broken</span>}</h3>
            <ol className="cert-audit">{[...a.audit].reverse().map((e) => <li key={e.hash}><b>{e.action.replace(/_/g, " ")}</b><div className="note">{new Date(e.at).toLocaleString("en-GB")} · {e.actorName}</div></li>)}</ol>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** AgriLink operations: configure lifecycle stages (name, order, guidance, on/off). */
export function StageSettings() {
  const toast = useToast();
  const { data, error, loading } = useApi("/stages/config");
  const [rows, setRows] = useState(null);
  const list = rows || data || [];
  const set = (i, patch) => setRows(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i, d) => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setRows(n.map((r, k) => ({ ...r, order: k + 1 }))); };
  const save = async () => {
    try { setRows(await api("/stages/config", { method: "PUT", body: { stages: list.map(({ key, name, enabled, order, guidance }) => ({ key, name, enabled, order, guidance })) } })); toast("Stage settings saved"); }
    catch (e) { toast(e.message, { long: true }); }
  };
  return (
    <div>
      <div className="crumbs"><Link to="/ops/stage-reviews">Stage reviews</Link> / Stage settings</div>
      <div className="page-head"><div><h1>Stage settings</h1><p className="sub">Lifecycle stages farmers record. Checks and thresholds are defined per stage in the server configuration and should be validated by an agronomist.</p></div>
        <button className="btn small" onClick={save} disabled={!rows}>Save changes</button></div>
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} />}
      <div className="stg-settings">{list.map((s, i) => (
        <div key={s.key} className={`card ${s.enabled ? "" : "off"}`}>
          <div className="stg-set-row">
            <span className="n">{i + 1}</span>
            <input value={s.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Stage name" />
            <label className="stg-toggle"><input type="checkbox" checked={s.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} />Enabled</label>
            <button className="btn alt small" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button className="btn alt small" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          </div>
          <textarea rows={2} value={s.guidance} onChange={(e) => set(i, { guidance: e.target.value })} aria-label="Guidance" />
          <div className="note">{s.fields.length} fields · {s.checks.length} checks · {s.aiMode === "fruit" ? "fruit image analysis + photo check" : "photo check only (no crop image model)"} · min {s.minPhotos} photo(s){s.requiresBatch ? " · needs batch" : ""}</div>
        </div>))}</div>
    </div>
  );
}

export { ScoreRing };
