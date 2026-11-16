import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api.js";
import Icon from "../../components/Icon.jsx";
import { ErrorBox, Loading, useToast } from "../../components/ui.jsx";
import { useApi } from "../../hooks/useApi.js";
import { useI18n } from "../../i18n/index.jsx";
import { DashboardBody, RecBody, RecSide, SEV, STATUS_CLS, day } from "./Advice.jsx";
import "./advisory.css";
import "../certificates/certificates.css";
import "../stages/stages.css";

/**
 * Agronomist (farmer doctor) workspace. Only the farmer doctor of a farmer's FPO can approve, edit, reject, verify,
 * schedule and record inspections; FPO and AgriLink operations desks see the same screens read-only.
 */
const LANGS = [["en", "English"], ["hi", "हिंदी"], ["mr", "मराठी"], ["gu", "ગુજરાતી"], ["ta", "தமிழ்"], ["te", "తెలుగు"], ["kn", "ಕನ್ನಡ"]];

function Queue({ title, icon, rows, empty, render }) {
  return (
    <div className="card">
      <h3><Icon name={icon} />{title} <span className="pill adv-neutral">{rows.length}</span></h3>
      {!rows.length ? <p className="note">{empty}</p> : <div className="adv-qlist">{rows.map(render)}</div>}
    </div>
  );
}

export function AgronomistHome() {
  const { t } = useI18n();
  const q = useApi("/advisory/agronomist", { live: ["advisory"] });
  const farmers = useApi("/advisory/farmers", { live: ["advisory"] });
  const item = (i) => (
    <Link key={i.itemId} className="adv-qrow" to={`/ops/agronomist/farmers/${i.farmerId}/items/${i.itemId}`}>
      <span className={`pill ${SEV[i.severity]}`}>{t("adv_sev_" + i.severity)}</span>
      <span style={{ flex: 1 }}><b>{i.problem}</b><span className="note"> · {i.farmer}</span></span>
      <span className="note">{day(i.dueDate)}</span>
    </Link>
  );
  return (
    <div>
      <div className="page-head">
        <div><h1>Agronomist workspace</h1><p className="sub">{q.data?.desk?.canAct ? `${q.data.desk.name} — approve treatment advice, verify farmers' corrective work, schedule and record inspections.` : "Read-only for this desk. Switch the desk to the FPO's farmer doctor to act."}</p></div>
        <Link className="btn alt small" to="/ops/messages"><Icon name="bell" size={15} />Message log</Link>
      </div>
      {(q.loading && !q.data) && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <div className="grid two">
          <Queue title="Awaiting your approval" icon="shield" rows={q.data.approvals} empty="No treatment recommendations waiting." render={item} />
          <Queue title="Completed — verify" icon="checkCircle" rows={q.data.verifications} empty="Nothing to verify." render={item} />
          <Queue title="Farmers asking for help" icon="phone" rows={q.data.help} empty="No open help requests." render={item} />
          <Queue title="Upcoming inspections" icon="calendar" rows={q.data.visits} empty="No visits scheduled." render={(v) => (
            <Link key={v.id} className="adv-qrow" to={`/ops/agronomist/farmers/${v.farmerId}`}><b>{day(v.at)}</b><span style={{ flex: 1 }}>{v.farmer}</span><span className="note">{v.id}</span></Link>)} />
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        <h3 style={{ padding: "16px 20px 0" }}><Icon name="farmer" />Assigned farmers</h3>
        {farmers.data && <div className="tableWrap"><table>
          <thead><tr><th>Farmer</th><th>Language</th><th>Active</th><th>Approve</th><th>Verify</th><th>Help</th><th>Next visit</th></tr></thead>
          <tbody>{farmers.data.map((f) => (
            <tr key={f.id} className="cert-row"><td><Link to={`/ops/agronomist/farmers/${f.id}`}><b>{f.name}</b></Link><div className="note">{f.village}, {f.district}</div></td>
              <td>{LANGS.find((l) => l[0] === f.lang)?.[1] || f.lang}</td><td>{f.active}{f.high ? <span className="pill p-bad" style={{ marginLeft: 6 }}>{f.high} urgent</span> : null}</td>
              <td>{f.awaitingApproval || "—"}</td><td>{f.toVerify || "—"}</td><td>{f.help || "—"}</td><td>{f.nextVisit ? day(f.nextVisit) : "—"}</td></tr>))}</tbody>
        </table></div>}
      </div>
    </div>
  );
}

function InspectionTools({ farmerId, visits, canAct, reload }) {
  const toast = useToast();
  const [rec, setRec] = useState(null);
  const [f, setF] = useState({ grade: "A", observed_defect_pct: "", pest_signs: [], cleared_flags: [], observations: "", recommendations: "", fruit_inspected: "" });
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const schedule = async () => {
    setBusy(true);
    try { await api(`/advisory/farmers/${farmerId}/inspections`, { method: "POST", body: { dueAt: dueAt ? new Date(dueAt).toISOString() : undefined, note: "Follow-up inspection for advisory" } }); toast("Inspection scheduled — farmer will be reminded"); reload(); }
    catch (e) { toast(e.message, { long: true }); } finally { setBusy(false); }
  };
  const record = async () => {
    setBusy(true);
    try {
      const body = { grade: f.grade, observations: f.observations || undefined, pest_signs: f.pest_signs, cleared_flags: f.cleared_flags,
        observed_defect_pct: f.observed_defect_pct === "" ? undefined : Number(f.observed_defect_pct), fruit_inspected: f.fruit_inspected === "" ? undefined : Number(f.fruit_inspected),
        recommendations: f.recommendations.split("\n").map((x) => x.trim()).filter(Boolean) };
      await api(`/advisory/farmers/${farmerId}/inspections/${rec}`, { method: "POST", body });
      toast("Inspection recorded — recommendations updated against the previous result"); setRec(null); reload();
    } catch (e) { toast(e.message, { long: true }); } finally { setBusy(false); }
  };
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  return (
    <div className="card">
      <h3><Icon name="calendar" />Inspections</h3>
      {(visits || []).map((v) => <div key={v.id} className="adv-line"><b>{day(v.at)}</b><span className="note">{v.id} · {v.doctor}</span>
        {canAct && <button className="btn small" onClick={() => setRec(v.id)}>Record result</button>}</div>)}
      {!(visits || []).length && <p className="note">No inspection scheduled.</p>}
      {canAct && <div className="adv-btns" style={{ marginTop: 10, alignItems: "end" }}>
        <label className="stg-field"><span>Date (optional)</span><input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label>
        <button className="btn alt small" disabled={busy} onClick={schedule}>Schedule follow-up inspection</button></div>}
      {rec && (
        <div className="adv-form">
          <b>Record inspection {rec}</b>
          <div className="stg-fields">
            <label className="stg-field"><span>Grade *</span><select value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}><option>A</option><option>B</option><option>REJECT</option></select></label>
            <label className="stg-field"><span>Observed blemish %</span><input type="number" min="0" max="100" value={f.observed_defect_pct} onChange={(e) => setF({ ...f, observed_defect_pct: e.target.value })} /></label>
            <label className="stg-field"><span>Fruit inspected</span><input type="number" min="0" value={f.fruit_inspected} onChange={(e) => setF({ ...f, fruit_inspected: e.target.value })} /></label>
          </div>
          <div className="stg-field"><span>Pest / disease signs seen</span><div className="stg-yn">{["fruit_fly_signs", "anthracnose", "sap_burn"].map((p) => <button type="button" key={p} className={`chip ${f.pest_signs.includes(p) ? "on" : ""}`} onClick={() => toggle("pest_signs", p)}>{p.replace(/_/g, " ")}</button>)}</div></div>
          <div className="stg-field"><span>Earlier flags now cleared</span><div className="stg-yn">{["fruit_fly_signs", "anthracnose", "sap_burn"].map((p) => <button type="button" key={p} className={`chip ${f.cleared_flags.includes(p) ? "on" : ""}`} onClick={() => toggle("cleared_flags", p)}>{p.replace(/_/g, " ")}</button>)}</div></div>
          <label className="stg-field"><span>Observations</span><textarea rows={2} value={f.observations} onChange={(e) => setF({ ...f, observations: e.target.value })} /></label>
          <label className="stg-field"><span>Recommendations (one per line, shown to the farmer as your guidance)</span><textarea rows={2} value={f.recommendations} onChange={(e) => setF({ ...f, recommendations: e.target.value })} /></label>
          <div className="adv-btns"><button className="btn" disabled={busy} onClick={record}>Save inspection result</button><button className="btn alt" onClick={() => setRec(null)}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}

export function AgronomistFarmer() {
  const { id } = useParams();
  const { t } = useI18n();
  const [lang, setLang] = useState("en");
  const { data, error, loading, reload } = useApi(`/advisory/farmers/${id}?lang=${lang}`, { live: ["advisory"] });
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); try { await api(`/advisory/farmers/${id}?refresh=1&lang=${lang}`); await reload(); } finally { setBusy(false); } };
  return (
    <div>
      <div className="crumbs"><Link to="/ops/agronomist">Agronomist workspace</Link> / {data?.farmer?.name}</div>
      <div className="page-head">
        <div><h1>{data?.farmer?.name || "…"}</h1><p className="sub">{data?.farmer?.village}, {data?.farmer?.district} · farmer's language: {LANGS.find((l) => l[0] === data?.farmer?.lang)?.[1]} · WhatsApp {data?.farmer?.notify?.whatsapp === false ? "off" : "on"} · SMS {data?.farmer?.notify?.sms === false ? "off" : "on"}</p></div>
        <div className="adv-btns">
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="View in language">{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn alt small" disabled={busy} onClick={refresh}>{busy ? "…" : "Re-run analysis"}</button>
        </div>
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && <>
        <InspectionTools farmerId={id} visits={data.status?.visits} canAct={data.canAct} reload={reload} />
        <DashboardBody data={data} t={t} itemBase={`/ops/agronomist/farmers/${id}/items`} />
      </>}
    </div>
  );
}

export function AgronomistItem() {
  const { id, itemId } = useParams();
  const { t } = useI18n();
  const toast = useToast();
  const [lang, setLang] = useState("en");
  const { data, error, loading, reload } = useApi(`/advisory/farmers/${id}?lang=${lang}`, { live: ["advisory"] });
  const [note, setNote] = useState("");
  const [guidance, setGuidance] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const it = data.items.find((i) => i.itemId === itemId);
  if (!it) return <ErrorBox error={{ message: "Recommendation not found" }} />;
  const history = data.items.filter((i) => i.key === it.key && i.itemId !== it.itemId);
  const post = async (path, body, msg) => {
    setBusy(true);
    try { await api(path, { method: "POST", body }); toast(msg); setNote(""); setGuidance(""); reload(); }
    catch (e) { toast(e.message, { long: true }); } finally { setBusy(false); }
  };
  const helpOpen = (it.assistance || []).find((a) => a.status === "open");
  return (
    <div>
      <div className="crumbs"><Link to="/ops/agronomist">Agronomist workspace</Link> / <Link to={`/ops/agronomist/farmers/${id}`}>{data.farmer.name}</Link> / {it.problem}</div>
      <div className="page-head">
        <div><h1 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{it.problem} <span className={`pill ${STATUS_CLS[it.status]}`}>{t("adv_st_" + it.status)}</span></h1>
          <p className="sub"><span className={`pill ${SEV[it.severity]}`}>{t("adv_sev_" + it.severity)}</span> {it.category}{it.requiresApproval ? " · treatment advice — needs your approval" : ""}</p></div>
        <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Preview in language">{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      <div className="stg-layout">
        <div><RecBody it={it} t={t} /></div>
        <aside>
          {data.canAct ? (
            <div className="card stg-decide">
              <h3><Icon name="pen" />Your decision</h3>
              {it.status === "pending_approval" && <>
                <label className="stg-field"><span>Expert guidance added to the farmer's steps (optional)</span><textarea rows={3} value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="e.g. product and dose advised by the KVK for this orchard" /></label>
                <label className="stg-field"><span>Change completion date (optional)</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
                <button className="btn" disabled={busy} onClick={() => post(`/advisory/items/${itemId}/review`, { decision: "approve", guidance: guidance || undefined, dueDate: dueDate || undefined }, "Approved — sent to the farmer in their language")}>Approve and send to farmer</button>
              </>}
              {["pending_approval", "open", "acknowledged"].includes(it.status) && <>
                <label className="stg-field"><span>Reason (to reject)</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <button className="btn alt cert-danger" disabled={busy || note.trim().length < 5} onClick={() => post(`/advisory/items/${itemId}/review`, { decision: "reject", note }, "Recommendation rejected")}>Reject recommendation</button>
              </>}
              {["open", "acknowledged", "completed"].includes(it.status) && it.status !== "pending_approval" && <>
                <label className="stg-field"><span>Add expert guidance</span><textarea rows={2} value={guidance} onChange={(e) => setGuidance(e.target.value)} /></label>
                <button className="btn alt" disabled={busy || guidance.trim().length < 5} onClick={() => post(`/advisory/items/${itemId}/review`, { decision: "guidance", guidance }, "Guidance added")}>Add guidance</button>
              </>}
              {it.status === "completed" && <>
                <label className="stg-field"><span>Verification note</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <div className="adv-btns">
                  <button className="btn" disabled={busy} onClick={() => post(`/advisory/items/${itemId}/verify`, { result: "verified", note: note || undefined }, "Verified")}>Verify — done correctly</button>
                  <button className="btn alt" disabled={busy || note.trim().length < 5} onClick={() => post(`/advisory/items/${itemId}/verify`, { result: "not_effective", note }, "Sent back to the farmer")}>More work needed</button>
                </div>
              </>}
              {helpOpen && <>
                <label className="stg-field"><span>Answer the farmer's question: “{helpOpen.note}”</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <button className="btn alt" disabled={busy || note.trim().length < 3} onClick={() => post(`/advisory/items/${itemId}/help`, { response: note }, "Answer sent")}>Send answer</button>
              </>}
              <p className="note">Recommendations about pests and disease reach the farmer only after your approval. The farmer receives them in their own language.</p>
            </div>
          ) : <div className="card"><p className="note" style={{ margin: 0 }}>Read-only: only the farmer doctor of this farmer's FPO can approve, verify or record inspections.</p></div>}
          <RecSide it={it} history={history} t={t} itemBase={`/ops/agronomist/farmers/${id}/items`} evidenceBase="/api/advisory/items" />
        </aside>
      </div>
    </div>
  );
}

/** Operations: notification log with real delivery status, channel configuration and counts. */
export function MessageLog() {
  const [filter, setFilter] = useState("");
  const { data, error, loading } = useApi(`/messages${filter ? `?status=${filter}` : ""}`, { refreshMs: 15000 });
  const st = data?.status;
  const ch = (c) => (c?.live ? <span className="pill p-good">live</span> : c?.configured ? <span className="pill p-warn">configured, mode {st.mode}</span> : <span className="pill p-warn">simulated (not configured)</span>);
  return (
    <div>
      <div className="crumbs"><Link to="/ops/agronomist">Agronomist workspace</Link> / Message log</div>
      <div className="page-head"><div><h1>Message log</h1><p className="sub">Every WhatsApp, SMS and voice message with its real status. "Simulated" means development mode: nothing reached the farmer.</p></div></div>
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} />}
      {st && <div className="grid kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div className="card kpi"><div className="l">WhatsApp Cloud API</div><div className="v sm">{ch(st.whatsapp)}</div></div>
        <div className="card kpi"><div className="l">SMS gateway ({st.sms.provider})</div><div className="v sm">{ch(st.sms)}</div>{st.sms.dltRequired && <div className="d">DLT templates required</div>}</div>
        <div className="card kpi"><div className="l">Voice notes</div><div className="v sm">{st.voice.configured ? <span className="pill p-good">available</span> : <span className="pill adv-neutral">not configured</span>}</div></div>
        <div className="card kpi"><div className="l">Messages</div><div className="v sm">{data.stats.map((s) => `${s.channel} ${s.status}: ${s.n}`).join(" · ") || "—"}</div></div>
      </div>}
      <div className="dc-tabs">{["", "sent", "delivered", "failed", "simulated", "skipped"].map((s) => <button key={s} className={`dc-tab ${filter === s ? "on" : ""}`} onClick={() => setFilter(s)}>{s || "all"}</button>)}</div>
      {data && <div className="card" style={{ padding: 0 }}><div className="tableWrap"><table>
        <thead><tr><th>When</th><th>Farmer</th><th>Channel</th><th>Message</th><th>Status</th><th>Attempts</th></tr></thead>
        <tbody>{data.rows.map((m) => (
          <tr key={m._id}><td className="note">{new Date(m.createdAt).toLocaleString("en-GB")}</td><td>{m.user?.name}<div className="note">{m.to} · {m.lang}</div></td>
            <td>{m.channel}<div className="note">{m.template}</div></td><td style={{ maxWidth: 380 }}>{m.body}</td>
            <td><span className={`pill ${["delivered", "read"].includes(m.status) ? "p-good" : m.status === "failed" ? "p-bad" : m.status === "sent" ? "adv-neutral" : "p-warn"}`}>{m.status}</span>{m.lastError && <div className="note">{m.lastError}</div>}</td>
            <td>{m.attempts}{m.nextRetryAt && <div className="note">retry {new Date(m.nextRetryAt).toLocaleTimeString("en-GB")}</div>}</td></tr>))}</tbody>
      </table></div></div>}
    </div>
  );
}
