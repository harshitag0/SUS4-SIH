import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getToken } from "../../api.js";
import Icon from "../../components/Icon.jsx";
import { ErrorBox, Loading, useToast } from "../../components/ui.jsx";
import { useApi } from "../../hooks/useApi.js";
import { useI18n } from "../../i18n/index.jsx";
import { sendOrQueue, useConnectivity } from "../../offline.js";
import "./advisory.css";
import "../certificates/certificates.css";
import "../stages/stages.css";

/** Farmer advisory dashboard + recommendation detail + messages. Works offline from the last saved copy. */
export const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const SEV = { high: "p-bad", medium: "p-warn", low: "adv-neutral" };
export const STATUS_CLS = { pending_approval: "p-warn", open: "p-bad", acknowledged: "p-warn", completed: "p-good", verified: "p-good", resolved: "adv-neutral", rejected: "adv-neutral" };
const SPEECH = { en: "en-IN", hi: "hi-IN", mr: "mr-IN", gu: "gu-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN" };

export function speak(text, lang) {
  try { const u = new SpeechSynthesisUtterance(text); u.lang = SPEECH[lang] || "en-IN"; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no speech */ }
}

export function OfflineBanner() {
  const { t } = useI18n();
  const { online, queued } = useConnectivity();
  if (online && !queued) return null;
  return <div className={`adv-offline ${online ? "sync" : ""}`}><Icon name={online ? "zap" : "info"} size={16} />{online ? t("adv_syncing", { n: queued }) : t("adv_offline")}{!online && queued > 0 && ` · ${t("adv_queued_n", { n: queued })}`}</div>;
}

function Ring({ score }) {
  if (score == null) return <div className="adv-ring none"><b>—</b></div>;
  const r = 30, c = 2 * Math.PI * r, tone = score >= 80 ? "ok" : score >= 50 ? "warn" : "bad";
  return (
    <svg className={`adv-ring ${tone}`} width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`${score}%`}>
      <circle cx="38" cy="38" r={r} className="trk" /><circle cx="38" cy="38" r={r} className="val" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 38 38)" />
      <text x="38" y="43" textAnchor="middle">{score}%</text>
    </svg>
  );
}

export function SpecTable({ rows, t }) {
  if (!rows?.length) return null;
  return rows.map((s) => (
    <div className="card" style={{ padding: 0 }} key={s.agreementId}>
      <h3 style={{ padding: "16px 20px 0" }}><Icon name="target" />{t("adv_spec_title", { buyer: s.buyer, grade: s.grade })}</h3>
      <p className="note" style={{ padding: "0 20px", margin: "4px 0 0" }}>{s.measuredAt ? t("adv_spec_measured", { date: day(s.measuredAt) }) : t("adv_spec_none")}</p>
      <div className="tableWrap"><table>
        <thead><tr><th>{t("adv_param")}</th><th>{t("adv_required")}</th><th>{t("adv_current")}</th><th>{t("adv_status")}</th></tr></thead>
        <tbody>{s.rows.map((r) => (
          <tr key={r.key}><td>{t("adv_row_" + r.key)}<div className="note">{t("adv_src_" + r.key)}</div></td><td>{r.required === "none" ? t("adv_none_word") : r.required}</td><td>{r.current === "none" ? t("adv_none_word") : r.current ?? "—"}</td>
            <td>{r.ok === true ? <span className="pill p-good">{t("adv_meets")}</span> : r.ok === false ? <span className="pill p-bad">{t("adv_gap")}</span> : <span className="pill adv-neutral">{t("adv_not_measured")}</span>}</td></tr>))}</tbody>
      </table></div>
    </div>
  ));
}

function RecRow({ it, t, base = "/farmer/advice" }) {
  return (
    <Link to={`${base}/${it.itemId}`} className={`card adv-row ${it.severity}`}>
      <span className={`pill ${SEV[it.severity]}`}>{t("adv_sev_" + it.severity)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>{it.problem}</b>
        <div className="note">{it.awaitingApproval ? t("adv_awaiting_short") : it.action}</div>
      </div>
      <span className={`pill ${STATUS_CLS[it.status]}`}>{t("adv_st_" + it.status)}</span>
      <span className="adv-due"><Icon name="calendar" size={14} />{day(it.dueDate)}</span>
    </Link>
  );
}

const nextInspection = (d) => {
  const dates = [d.status?.nextPhotoCheck, d.status?.visits?.[0]?.at, ...d.items.filter((i) => ["open", "acknowledged", "completed"].includes(i.status)).map((i) => i.followUpDate)].filter(Boolean).map((x) => new Date(x));
  return dates.length ? new Date(Math.min(...dates)) : null;
};

/** Dashboard body, shared by the farmer page and the agronomist's farmer view. */
export function DashboardBody({ data, t, itemBase }) {
  const [tab, setTab] = useState("active");
  const groups = {
    active: data.items.filter((i) => ["pending_approval", "open", "acknowledged"].includes(i.status)),
    completed: data.items.filter((i) => ["completed", "verified"].includes(i.status)),
    history: data.items.filter((i) => ["resolved", "rejected"].includes(i.status)),
  };
  const latest = data.snapshots?.[data.snapshots.length - 1], prev = data.snapshots?.[data.snapshots.length - 2];
  const next = nextInspection(data);
  const stageWord = (s) => t("st_" + (s === "pending_review" ? "pending" : s === "requires_correction" ? "correction" : s));
  return (
    <>
      <div className="adv-top">
        <div className="card adv-score">
          <Ring score={data.compliance?.score ?? null} />
          <div><div className="note">{t("adv_compliance")}</div><b>{data.compliance ? t("adv_compliance_note", { n: data.compliance.measured }) : t("adv_spec_none")}</b></div>
        </div>
        <div className="card kpi"><div className="l">{t("adv_active")}</div><div className="v">{data.summary.active}</div><div className="d">{t("adv_high")}: {data.summary.high}</div></div>
        <div className="card kpi"><div className="l">{t("adv_pending_actions")}</div><div className="v">{data.summary.pendingActions}</div><div className="d">{t("adv_awaiting_n", { n: data.summary.awaitingApproval })}</div></div>
        <div className="card kpi"><div className="l">{t("adv_completed")}</div><div className="v">{data.summary.completed}</div><div className="d">{t("adv_resolved")}: {data.summary.resolved}</div></div>
      </div>

      <div className="grid two">
        <div className="card">
          <h3><Icon name="sprout" />{t("adv_crop_status")}</h3>
          {(data.status?.crops || []).length ? data.status.crops.map((c) => (
            <div key={c.cropId} className="adv-line"><b>{c.variety} · {c.plot}</b><span className="note">{c.stage ? `${c.stage.name} · ${stageWord(c.stage.status)}` : t("adv_no_stage")}</span></div>
          )) : <p className="note">{t("adv_no_crop")}</p>}
        </div>
        <div className="card">
          <h3><Icon name="checkCircle" />{t("adv_latest_quality")}</h3>
          {latest ? <>
            <div className="adv-line"><span className="note">{t(latest.kind === "doctor_visit" ? "adv_k_visit" : "adv_k_photo")} · {day(latest.at)}</span></div>
            <div className="adv-metrics">
              {latest.defect != null && <span>{t("m_defect")}: <b>{latest.defect}%</b>{prev?.defect != null && prev.defect !== latest.defect && <i className={latest.defect < prev.defect ? "up" : "down"}> ({prev.defect}% → {latest.defect}%)</i>}</span>}
              {latest.colour != null && <span>{t("m_colour")}: <b>{latest.colour}</b></span>}
              {latest.doctorGrade && <span>{t("cert_doctor")}: <b>{latest.doctorGrade}</b></span>}
              <span>{t("m_flags")}: <b>{latest.flags?.length ? latest.flags.join(", ").replace(/_/g, " ") : t("adv_none_word")}</b></span>
            </div>
          </> : <p className="note">{t("adv_spec_none")}</p>}
        </div>
        <div className="card">
          <h3><Icon name="truck" />{t("adv_harvest")}</h3>
          {(data.status?.harvest || []).length ? data.status.harvest.map((h) => (
            <div key={h.agreementId} className="adv-line"><span className={`pill ${h.state === "ready" || h.state === "harvest_now" ? "p-good" : h.state === "at_risk" ? "p-bad" : "adv-neutral"}`}>{t("hs_" + h.state)}</span>
              <span className="note">{h.agreementId}{h.windowStart ? ` · ${t("adv_window")} ${day(h.windowStart)}` : ""}</span></div>
          )) : <p className="note">{t("hs_unknown")}</p>}
        </div>
        <div className="card">
          <h3><Icon name="calendar" />{t("adv_visits")}</h3>
          {(data.status?.visits || []).length ? data.status.visits.slice(0, 3).map((v) => <div key={v.id} className="adv-line"><b>{day(v.at)}</b><span className="note">{v.doctor}</span></div>) : <p className="note">{t("adv_no_visits")}</p>}
          <div className="adv-line" style={{ marginTop: 8 }}><span className="note">{t("adv_next_inspection")}</span><b>{next ? day(next) : "—"}</b></div>
        </div>
      </div>

      <SpecTable rows={data.specRows} t={t} />

      <div className="dc-tabs" style={{ marginTop: 6 }}>
        {[["active", "adv_active"], ["completed", "adv_completed"], ["history", "adv_history"]].map(([k, l]) => (
          <button key={k} className={`dc-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{t(l)} ({groups[k].length})</button>))}
      </div>
      {!groups[tab].length && <div className="card adv-empty"><Icon name="checkCircle" size={26} /><p>{tab === "active" ? t("adv_none") : "—"}</p></div>}
      <div className="adv-list">{groups[tab].map((it) => <RecRow key={it.itemId} it={it} t={t} base={itemBase} />)}</div>
    </>
  );
}

export default function Advice() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useApi(`/advisory/me?lang=${lang}`, { live: ["advisory", "stages"] });
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); try { await fetch(`/api/advisory/me?refresh=1&lang=${lang}`, { headers: { authorization: `Bearer ${getToken()}` } }); await reload(); } finally { setBusy(false); } };
  return (
    <div>
      <OfflineBanner />
      <div className="page-head">
        <div><h1>{t("adv_title")}</h1><p className="sub">{t("adv_sub")}</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn alt small" to="/farmer/messages"><Icon name="bell" size={15} />{t("adv_messages")}</Link>
          <button className="btn alt small" disabled={busy} onClick={refresh}><Icon name="zap" size={15} />{busy ? "…" : t("adv_refresh")}</button>
        </div>
      </div>
      {loading && !data && <Loading />}
      {error && !data && <ErrorBox error={error} />}
      {data && <><DashboardBody data={data} t={t} itemBase="/farmer/advice" /><p className="note">{t("adv_disclaimer")}</p></>}
    </div>
  );
}

const fileToJpeg = (file) => createImageBitmap(file).then((bmp) => {
  const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.85);
});

export function AuthImg({ src, alt }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u, alive = true;
    fetch(src, { headers: { authorization: `Bearer ${getToken()}` } }).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && alive) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => {});
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [src]);
  return url ? <img src={url} alt={alt} /> : <div className="stg-img-ph"><Icon name="file" size={18} /></div>;
}

export function Timeline({ events, t }) {
  return <ol className="cert-audit">{[...(events || [])].reverse().map((e, i) => {
    const k = "ev_" + e.action, label = t(k) === k ? e.action.replace(/_/g, " ") : t(k);
    return <li key={i}><b>{label}</b><div className="note">{new Date(e.at).toLocaleString("en-GB")} · {e.by}{e.note ? ` — ${e.note}` : ""}</div></li>;
  })}</ol>;
}

/** Shared recommendation content (problem, reason, steps, guidance) */
export function RecBody({ it, t }) {
  return (
    <>
      {it.awaitingApproval && <div className="alertbox"><span className="ic"><Icon name="info" /></span><div>{t("adv_awaiting")}</div></div>}
      {it.reason && <div className="card"><h3><Icon name="info" />{t("adv_why")}</h3><p style={{ margin: 0 }}>{it.reason}</p>
        <div className="adv-evidence" style={{ marginTop: 10 }}>{(it.evidence || []).map((e, i) => <span key={i} className="chip">{e.label}: <b>{String(e.value)}</b>{e.at ? ` · ${day(e.at)}` : ""}</span>)}</div></div>}
      {it.action && <div className="card">
        <div className="adv-action"><Icon name="checkCircle" size={18} /><b>{it.action}</b></div>
        <ol className="adv-steps" style={{ marginTop: 12 }}>{it.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <p className="adv-expected" style={{ marginTop: 12 }}><Icon name="trending" size={15} />{it.expected}</p>
      </div>}
      {(it.guidance?.length > 0 || it.notes?.length > 0) && <div className="card"><h3><Icon name="farmer" />{t("adv_guidance")}</h3>
        <div className="adv-notes">{[...(it.guidance || []).map((g) => ({ text: g.text, from: g.by })), ...(it.notes || [])].map((n, i) => <blockquote key={i}>“{n.text}” <span className="note">— {n.from}</span></blockquote>)}</div></div>}
      {(it.assistance || []).map((a, i) => <div key={i} className="card adv-help"><b>{t("adv_help")}</b><p style={{ margin: "4px 0" }}>{a.note}</p>{a.response ? <blockquote>“{a.response}” <span className="note">— {a.by}</span></blockquote> : <span className="note">{t("adv_help_sent")}</span>}</div>)}
      {it.verification?.result && <div className={`card stg-decision ${it.verification.result === "verified" ? "approved" : "requires_correction"}`}>
        <b>{t(it.verification.result === "verified" ? "adv_verified" : "adv_not_effective")}</b><div className="note">{it.verification.by} · {day(it.verification.at)}</div>{it.verification.note && <p style={{ margin: "6px 0 0" }}>{it.verification.note}</p>}</div>}
    </>
  );
}

export function RecSide({ it, history, t, itemBase, evidenceBase }) {
  return (
    <>
      <div className="card">
        <h3><Icon name="calendar" />{t("adv_timeline")}</h3>
        <div className="adv-dates" style={{ gridTemplateColumns: "1fr" }}>
          <div><span className="note">{t("adv_complete_by")}</span><b>{day(it.dueDate)}</b><span className="note">{t("adv_days", { n: it.timelineDays })}</span></div>
          <div><span className="note">{t("adv_followup")}</span><b>{day(it.followUpDate)}</b><span className="note">{t(it.followUpBy === "scheduled farmer-doctor visit" ? "adv_fu_visit" : "adv_fu_check")}</span></div>
        </div>
        <Timeline events={it.events} t={t} />
      </div>
      {(it.comparisons?.length > 0 || history?.length > 0) && <div className="card"><h3><Icon name="trending" />{t("adv_history")}</h3>
        {it.comparisons?.map((c, i) => <div key={i} className="adv-line"><span>{t("m_" + c.metric)}: {c.before} → {c.after}</span><span className={`pill ${c.verdict === "improved" ? "p-good" : c.verdict === "worse" ? "p-bad" : "adv-neutral"}`}>{t("adv_" + c.verdict)}</span></div>)}
        {history?.map((h) => <div key={h.itemId} className="adv-line"><Link to={`${itemBase}/${h.itemId}`}>{day(h.firstSeenAt)}</Link><span className={`pill ${STATUS_CLS[h.status]}`}>{t("adv_st_" + h.status)}</span></div>)}
      </div>}
      {it.farmerEvidence?.length > 0 && <div className="card"><h3><Icon name="file" />{t("adv_your_photos")}</h3>
        <div className="stg-gallery">{it.farmerEvidence.map((e) => <figure key={e.n}><AuthImg src={`${evidenceBase}/${it.itemId}/evidence/${e.n}`} alt="" /><figcaption className="note">{day(e.at)}{e.note ? ` · ${e.note}` : ""}</figcaption></figure>)}</div></div>}
      <details className="card note"><summary>{t("adv_based_on")}</summary><ul>{(it.sources || []).map((s) => <li key={s}>{s}</li>)}</ul></details>
    </>
  );
}

export function RecommendationDetail() {
  const { itemId } = useParams();
  const { t, lang } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi(`/advisory/me/items/${itemId}?lang=${lang}`, { live: ["advisory"] });
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState([]);
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} />;
  const it = data.item;
  const act = async (action) => {
    setBusy(true);
    try {
      const r = await sendOrQueue(`/advisory/me/items/${itemId}/actions?lang=${lang}`, { action, note: note || undefined, photos: photos.length ? photos.map((p) => ({ dataBase64: p })) : undefined });
      toast(r.queued ? t("adv_queued") : t("saved"));
      setMode(null); setNote(""); setPhotos([]);
      if (!r.queued) reload();
    } catch (e) { toast(e.message, { long: true }); } finally { setBusy(false); }
  };
  const helpOpen = (it.assistance || []).find((a) => a.status === "open");
  return (
    <div>
      <OfflineBanner />
      <div className="crumbs"><Link to="/farmer/advice">{t("adv_title")}</Link> / {it.problem}</div>
      <div className="page-head">
        <div>
          <h1 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{it.problem} <span className={`pill ${STATUS_CLS[it.status]}`}>{t("adv_st_" + it.status)}</span></h1>
          <p className="sub"><span className={`pill ${SEV[it.severity]}`}>{t("adv_sev_" + it.severity)}</span> {it.stage ? `${it.stage.name} · ` : ""}{t("adv_by", { date: day(it.dueDate) })}</p>
        </div>
        <button className="btn alt small" onClick={() => speak([it.problem, it.reason, it.action, ...(it.steps || []), ...(it.guidance || []).map((g) => g.text)].filter(Boolean).join(". "), lang)}><Icon name="volume" size={15} />{t("listen")}</button>
      </div>
      <div className="stg-layout">
        <div>
          <RecBody it={it} t={t} />
          {!it.awaitingApproval && ["open", "acknowledged", "completed"].includes(it.status) && (
            <div className="card adv-actions">
              <h3><Icon name="pen" />{t("adv_your_action")}</h3>
              <div className="adv-btns">
                {it.status === "open" && <button className="btn" disabled={busy} onClick={() => act("acknowledge")}><Icon name="check" size={15} />{t("adv_acknowledge")}</button>}
                {["open", "acknowledged"].includes(it.status) && <button className="btn" disabled={busy} onClick={() => setMode("complete")}><Icon name="checkCircle" size={15} />{t("adv_mark_done")}</button>}
                {it.status === "completed" && <button className="btn alt" disabled={busy} onClick={() => act("reopen")}>{t("adv_undo")}</button>}
                <button className="btn alt" disabled={busy || !!helpOpen} onClick={() => setMode("help")}><Icon name="phone" size={15} />{helpOpen ? t("adv_help_sent") : t("adv_help")}</button>
              </div>
              {mode && (
                <div className="adv-form">
                  <label className="stg-field"><span>{mode === "help" ? t("adv_help_q") : t("adv_note")}</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                  {mode === "complete" && <label className="cert-drop"><input type="file" accept="image/*" capture="environment" multiple onChange={async (e) => setPhotos(await Promise.all([...e.target.files].slice(0, 3).map(fileToJpeg)))} />
                    <Icon name="file" size={18} /><span>{photos.length ? t("stg_photos_chosen", { n: photos.length }) : t("adv_add_photo")}</span></label>}
                  {photos.length > 0 && <div className="stg-thumbs">{photos.map((p, i) => <img key={i} src={p} alt="" />)}</div>}
                  <div className="adv-btns"><button className="btn" disabled={busy || (mode === "help" && note.trim().length < 3)} onClick={() => act(mode === "help" ? "request_help" : "complete")}>{t("adv_send")}</button>
                    <button className="btn alt" onClick={() => setMode(null)}>{t("adv_cancel")}</button></div>
                </div>
              )}
            </div>
          )}
        </div>
        <aside>
          <RecSide it={it} history={data.history} t={t} itemBase="/farmer/advice" evidenceBase="/api/advisory/items" />
          <button className="btn alt small" onClick={() => nav("/farmer/advice")}><Icon name="arrowLeft" size={14} />{t("back")}</button>
        </aside>
      </div>
    </div>
  );
}

/** Messages sent to the farmer (WhatsApp / SMS) with honest delivery status. */
export function FarmerMessages() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { data, error, loading, reload } = useApi("/messages/me", { live: ["advisory"] });
  const [busy, setBusy] = useState(false);
  const L = { en: ["Send me today's update", "Sent {n} messages", "No pending tasks to send"], hi: ["आज का अपडेट भेजें", "{n} संदेश भेजे", "भेजने को कोई काम नहीं"], mr: ["आजचा अपडेट पाठवा", "{n} संदेश पाठवले", "पाठवण्यासाठी काम नाही"] }[lang] || ["Send me today's update", "Sent {n} messages", "No pending tasks to send"];
  const sendNow = async () => {
    setBusy(true);
    try { const r = await api("/messages/me/update", { method: "POST" }); toast(r.sent ? L[1].replace("{n}", r.sent) : L[2]); reload(); }
    catch (e) { toast(e.message, { long: true }); } finally { setBusy(false); }
  };
  return (
    <div>
      <OfflineBanner />
      <div className="crumbs"><Link to="/farmer/advice">{t("adv_title")}</Link> / {t("adv_messages")}</div>
      <div className="page-head"><div><h1>{t("adv_messages")}</h1><p className="sub">{t("adv_messages_sub")}</p></div>
        <button className="btn" disabled={busy} onClick={sendNow}><Icon name="send" size={16} />{busy ? "…" : L[0]}</button></div>
      {loading && !data && <Loading />}
      {error && !data && <ErrorBox error={error} />}
      {data && !data.length && <div className="card adv-empty"><Icon name="bell" size={26} /><p>—</p></div>}
      <div className="adv-list">{(data || []).map((m) => (
        <div key={m._id} className="card adv-msg">
          <div className="adv-line"><span className="pill adv-neutral">{m.channel === "whatsapp" ? "WhatsApp" : m.channel === "sms" ? "SMS" : t("adv_voice")}</span>
            <span className={`pill ${m.status === "delivered" || m.status === "read" ? "p-good" : m.status === "failed" ? "p-bad" : m.status === "simulated" ? "p-warn" : "adv-neutral"}`}>{t("msg_" + m.status)}</span>
            <span className="note">{new Date(m.createdAt).toLocaleString("en-GB")}</span></div>
          <p style={{ margin: "8px 0 0" }}>{m.body}</p>
          {m.status === "simulated" && <p className="note" style={{ margin: "4px 0 0" }}>{t("msg_sim_note")}</p>}
        </div>))}</div>
    </div>
  );
}
