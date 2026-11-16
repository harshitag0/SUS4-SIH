import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { ErrorBox, Loading } from "../components/ui.jsx";
import { useApi } from "../hooks/useApi.js";
import { useI18n } from "../i18n/index.jsx";

/**
 * AI Decision Center — the single pipeline for every deal across the platform.
 * The API checks all sources (ML engines, weather, capacity, blockchain, farm operations) concurrently,
 * then walks the stages in order and returns one decision per stage plus the next best action.
 */
const STATUS = {
  done: ["Done", "ok", "checkCircle"], ok: ["Pass", "ok", "checkCircle"], active: ["In progress", "act", "zap"],
  warn: ["Attention", "warn", "alert"], bad: ["Blocked", "bad", "xCircle"], pending: ["Waiting", "wait", "calendar"], skipped: ["Skipped", "wait", "info"],
};
const tone = (h) => (h >= 80 ? "ok" : h >= 60 ? "warn" : "bad");

function Ring({ value }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg className={`dc-ring ${tone(value)}`} width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Health ${value}`}>
      <circle cx="32" cy="32" r={r} className="trk" />
      <circle cx="32" cy="32" r={r} className="val" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 32 32)" />
      <text x="32" y="37" textAnchor="middle">{value}</text>
    </svg>
  );
}

function Stage({ s, i, current }) {
  const [label, cls, icon] = STATUS[s.status] || STATUS.pending;
  return (
    <li className={`dc-stage ${cls} ${current ? "cur" : ""}`}>
      <span className="dc-dot"><Icon name={icon} size={15} /></span>
      <div className="dc-body">
        <div className="dc-row">
          <b>{i + 1}. {s.title}</b>
          <span className={`dc-pill ${cls}`}>{label}</span>
          <span className="dc-mod">{s.module}</span>
        </div>
        <div className="dc-sum">{s.summary}</div>
        {s.decision && <div className="dc-dec"><Icon name="zap" size={14} />{s.decision}</div>}
        {s.action && <Link className="btn small alt dc-act" to={s.action.to}>{s.action.label}<Icon name="arrowRight" size={14} /></Link>}
      </div>
    </li>
  );
}

function Deal({ d }) {
  const { t } = useI18n();
  const cur = d.stages.findIndex((s) => s.key === d.currentStage);
  return (
    <div className="dc-deal">
      <div className="card dc-head">
        <Ring value={d.health} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="note">{t("dc_health")} · {d.agreementId} v{d.version}</div>
          <h3 style={{ margin: "2px 0" }}>{d.product} · {d.tons} t · USD {Math.round(d.valueUsd).toLocaleString()}</h3>
          <div className="note">{d.farmer}{d.fpo ? ` (${d.fpo})` : ""} → {d.buyer} · delivery {String(d.deliveryDate).slice(0, 10)}</div>
        </div>
        {d.nextAction && (
          <div className="dc-next">
            <div className="note">{t("dc_next")}</div>
            <b>{d.nextAction.title}</b>
            <div>{d.nextAction.decision}</div>
            {d.nextAction.action && <Link className="btn small" to={d.nextAction.action.to}>{d.nextAction.action.label}<Icon name="arrowRight" size={14} /></Link>}
          </div>
        )}
      </div>
      <div className="dc-grid">
        <ol className="card dc-pipe">{d.stages.map((s, i) => <Stage key={s.key} s={s} i={i} current={i === cur} />)}</ol>
        <div className="card dc-src">
          <div className="section-head"><b>{t("dc_sources")}</b><span className="note">{t("dc_ms", { n: d.computedInMs })}</span></div>
          {d.sources.map((x) => {
            const max = Math.max(...d.sources.map((y) => y.ms), 1);
            return (
              <div key={x.name} className="dc-srow" title={x.error || ""}>
                <span className={`dc-sdot ${x.ok ? "ok" : "bad"}`} />
                <span className="dc-sname">{x.name}</span>
                <span className="dc-bar"><span style={{ width: `${(x.ms / max) * 100}%` }} /></span>
                <span className="note">{x.ms} ms</span>
              </div>
            );
          })}
          <p className="note" style={{ marginTop: 10 }}>All sources start together; the slowest one sets the total time, not the sum.</p>
        </div>
      </div>
    </div>
  );
}

export default function Decisions() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApi("/journey", { live: ["contracts", "bonds", "farmops"], refreshMs: 60000 });
  const [params, setParams] = useSearchParams();
  const items = data?.items || [];
  const sel = items.find((d) => d.agreementId === params.get("deal")) || items[0];
  useEffect(() => { document.title = "AgriLink — Deal Journey"; }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("dc_title")}</h1>
          <p className="sub">{t("dc_sub")}</p>
        </div>
        <button className="btn alt small" onClick={reload}><Icon name="zap" size={14} />{t("dc_rerun")}</button>
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && !items.length && <div className="card"><p>{t("dc_none")}</p></div>}
      {items.length > 1 && (
        <div className="dc-tabs">
          {items.map((d) => (
            <button key={d.agreementId} className={`dc-tab ${d === sel ? "on" : ""}`} onClick={() => setParams({ deal: d.agreementId })}>
              <span className={`dc-sdot ${tone(d.health)}`} />{d.agreementId}<span className="note">{d.buyer.split(" ")[0]} · {d.tons} t · {d.health}</span>
            </button>
          ))}
        </div>
      )}
      {sel && <Deal d={sel} />}
    </div>
  );
}
