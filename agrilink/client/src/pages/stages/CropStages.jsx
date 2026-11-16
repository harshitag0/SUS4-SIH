import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api.js";
import Icon from "../../components/Icon.jsx";
import { ErrorBox, Loading, useToast } from "../../components/ui.jsx";
import { useApi } from "../../hooks/useApi.js";
import { useI18n } from "../../i18n/index.jsx";
import StageReport, { StagePill } from "./StageReport.jsx";
import "./stages.css";
import "../certificates/certificates.css";

/** Farmer: crop records → lifecycle stages → submit photos + record → report → consultant decision → certificate. */
export function CropList() {
  const { t } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const crops = useApi("/crops", { live: ["stages"] });
  const agreements = useApi("/contracts");
  const [form, setForm] = useState({ season: new Date().getFullYear() + 1, agreementId: "", plot: "" });
  const [busy, setBusy] = useState(false);
  const create = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const c = await api("/crops", { method: "POST", body: { ...form, agreementId: form.agreementId || undefined } }); nav(`/farmer/stages/${c.cropId}`); }
    catch (err) { toast(err.message, { long: true }); } finally { setBusy(false); }
  };
  const registered = (agreements.data?.items || []).filter((a) => a.chain?.status === "registered");
  return (
    <div>
      <div className="page-head"><div><h1>{t("stg_title")}</h1><p className="sub">{t("stg_sub")}</p></div></div>
      {crops.loading && !crops.data && <Loading />}
      {crops.error && <ErrorBox error={crops.error} />}
      <div className="grid two">
        {(crops.data || []).map((c) => (
          <Link key={c.cropId} to={`/farmer/stages/${c.cropId}`} className="card stg-crop">
            <div className="stg-crop-top"><span className="mono">{c.cropId}</span><span className="pill p-good">{t("stg_season")} {c.season}</span></div>
            <h3 style={{ margin: "6px 0 2px" }}>{c.variety} · {c.plot}</h3>
            <div className="note">{c.fpo?.name}{c.agreementId ? ` · ${c.agreementId}` : ""}</div>
            <span className="stg-open">{t("stg_open")} <Icon name="arrowRight" size={14} /></span>
          </Link>
        ))}
        <form className="card stg-new" onSubmit={create}>
          <h3><Icon name="sprout" />{t("stg_new")}</h3>
          <label>{t("stg_season")}<input type="number" min="2020" max="2100" value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} /></label>
          <label>{t("stg_plot")}<input value={form.plot} maxLength={60} placeholder={t("stg_plot_ph")} onChange={(e) => setForm({ ...form, plot: e.target.value })} /></label>
          <label>{t("stg_agreement")}
            <select value={form.agreementId} onChange={(e) => setForm({ ...form, agreementId: e.target.value })}>
              <option value="">{t("stg_no_agreement")}</option>
              {registered.map((a) => <option key={a.agreementId} value={a.agreementId}>{a.agreementId} · {a.parties?.buyer?.company}</option>)}
            </select>
          </label>
          <button className="btn" disabled={busy}>{t("stg_create")}</button>
        </form>
      </div>
    </div>
  );
}

/** Resize to at most 1600 px and re-encode as JPEG (smaller uploads on mobile data). */
async function toJpeg(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.88);
}

function Field({ f, value, onChange }) {
  if (f.type === "boolean") return (
    <div className="stg-field"><span>{f.label}{f.required && " *"}</span>
      <div className="stg-yn">{[[true, "Yes"], [false, "No"]].map(([v, l]) => (
        <button type="button" key={l} className={`chip ${value === v ? "on" : ""}`} onClick={() => onChange(v)}>{l}</button>))}</div></div>);
  if (f.type === "select") return (
    <label className="stg-field"><span>{f.label}{f.required && " *"}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}><option value="">—</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select></label>);
  return (
    <label className="stg-field"><span>{f.label}{f.required && " *"}</span>
      <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} min={f.min} max={f.max} value={value ?? ""} onChange={(e) => onChange(e.target.value)} /></label>);
}

function SubmitStage({ crop, stage, onDone }) {
  const { t } = useI18n();
  const toast = useToast();
  const batches = useApi(`/crops/${crop.cropId}/batches`);
  const [entries, setEntries] = useState({});
  const [files, setFiles] = useState([]);
  const [batchId, setBatchId] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = async (list) => {
    const chosen = [...list].slice(0, 5);
    setFiles(await Promise.all(chosen.map(async (f) => ({ name: f.name, dataBase64: await toJpeg(f) }))));
  };
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const a = await api(`/crops/${crop.cropId}/stages/${stage.key}/assessments`, { method: "POST", body: { entries, photos: files, batchId: batchId || undefined } });
      toast(t("stg_submitted")); onDone(a);
    } catch (err) { toast(err.message, { long: true }); } finally { setBusy(false); }
  };
  return (
    <form className="card stg-form" onSubmit={send}>
      <h3><Icon name="pen" />{stage.name}</h3>
      <p className="insight" style={{ marginTop: 0 }}>{stage.guidance}</p>
      <div className="stg-fields">{stage.fields.map((f) => <Field key={f.key} f={f} value={entries[f.key]} onChange={(v) => setEntries({ ...entries, [f.key]: v })} />)}</div>
      {(stage.requiresBatch || (batches.data || []).length > 0) && (
        <label className="stg-field"><span>{t("stg_batch")}{stage.requiresBatch && " *"}</span>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">{stage.requiresBatch ? "—" : t("stg_no_batch")}</option>
            {(batches.data || []).map((b) => <option key={b.batchId} value={b.batchId}>{b.batchId} · {b.kg} kg · Grade {b.grade}</option>)}
          </select>
          {stage.requiresBatch && !(batches.data || []).length && <small className="down">{t("stg_need_batch")}</small>}
        </label>
      )}
      <label className="cert-drop" style={{ marginTop: 6 }}>
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => pick(e.target.files)} />
        <Icon name="file" size={18} /><span>{files.length ? t("stg_photos_chosen", { n: files.length }) : t("stg_photos", { n: stage.minPhotos })}</span>
      </label>
      {files.length > 0 && <div className="stg-thumbs">{files.map((f) => <img key={f.name} src={f.dataBase64} alt={f.name} />)}</div>}
      <p className="note">{t("stg_cannot")}: {stage.notAssessable.join("; ")}.</p>
      <button className="btn" disabled={busy || files.length < stage.minPhotos}>{busy ? t("stg_checking") : t("stg_submit")}</button>
    </form>
  );
}

export default function CropStages() {
  const { cropId } = useParams();
  const { t } = useI18n();
  const crop = useApi(`/crops/${cropId}`, { live: ["stages"] });
  const [sel, setSel] = useState(null);
  const [submitted, setSubmitted] = useState(null);
  const c = crop.data;
  const stage = c ? c.stages.find((s) => s.key === sel) || c.stages.find((s) => !s.latest || s.latest.status !== "approved") || c.stages[0] : null;
  const latest = stage?.latest;
  const report = useApi(latest ? `/stage-assessments/${latest.assessmentId}` : `/crops/${cropId}`, { enabled: !!latest, live: ["stages"] });
  if (crop.loading && !c) return <Loading />;
  if (crop.error) return <ErrorBox error={crop.error} />;
  const canSubmit = !latest || ["requires_correction", "rejected"].includes(latest.status);
  const done = c.stages.filter((s) => s.latest?.status === "approved").length;

  return (
    <div>
      <div className="crumbs"><Link to="/farmer/stages">{t("stg_title")}</Link> / <span className="mono">{c.cropId}</span></div>
      <div className="page-head">
        <div><h1>{c.variety} · {c.plot}</h1><p className="sub">{t("stg_season")} {c.season} · {c.fpo?.name}{c.agreementId ? ` · ${c.agreementId}` : ""} · {t("stg_progress", { n: done, total: c.stages.length })}</p></div>
      </div>

      <ol className="stg-track">{c.stages.map((s, i) => (
        <li key={s.key} className={`${s.key === stage.key ? "on" : ""} ${s.latest?.status || "not_started"}`}>
          <button onClick={() => { setSel(s.key); setSubmitted(null); }}>
            <span className="n">{s.latest?.status === "approved" ? <Icon name="check" size={14} /> : i + 1}</span>
            <span className="nm">{s.name}</span>
            <StagePill status={s.latest?.status || "not_started"} t={t} />
          </button>
        </li>))}</ol>

      <div className="stg-layout">
        <div>
          {latest && !submitted && report.data && <StageReport a={report.data} fields={stage.fields} />}
          {submitted && <StageReport a={submitted} fields={stage.fields} />}
          {canSubmit && !submitted && <SubmitStage crop={c} stage={stage} onDone={(a) => { setSubmitted(a); crop.reload(); }} />}
        </div>
        <aside>
          <div className="card">
            <h3><Icon name="info" />{stage.name}</h3>
            <p className="note" style={{ marginTop: 0 }}>{stage.guidance}</p>
            {latest && <><div className="note">{t("stg_version")} {latest.version} · {new Date(latest.submittedAt).toLocaleDateString("en-GB")}</div>
              {latest.batchId && <div className="note">{t("stg_batch")}: <span className="mono">{latest.batchId}</span></div>}</>}
            {latest?.certificateId && <Link className="btn small" style={{ marginTop: 10 }} to={`/farmer/certificates/${latest.certificateId}`}><Icon name="shield" size={14} />{t("stg_view_cert")}</Link>}
            {latest?.status === "requires_correction" && <p className="insight">{t("stg_fix")}</p>}
          </div>
          <div className="card">
            <h3><Icon name="checkCircle" />{t("stg_how")}</h3>
            <ol className="stg-steps"><li>{t("stg_how1")}</li><li>{t("stg_how2")}</li><li>{t("stg_how3")}</li><li>{t("stg_how4")}</li></ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
