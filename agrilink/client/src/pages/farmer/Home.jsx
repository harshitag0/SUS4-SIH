import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { api } from "../../api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useI18n } from "../../i18n/index.jsx";
import { useApi } from "../../hooks/useApi.js";
import { ErrorBox, Loading, inr, lakh } from "../../components/ui.jsx";

const COLOUR = { green: 0.4, yellow: 0.65, golden: 0.85 };
const BLEMISH = { none: 0, few: 5, many: 15 };

function WeatherGlass({ alerts, simulate, setSimulate }) {
  const { t } = useI18n();
  const items = alerts?.alerts || [];
  const w = alerts?.weather;
  const src = w && { "open-meteo": "wx_live", demo: "wx_demo", simulated: "wx_simulated" }[w.source];
  return (
    <div className="glass weather">
      <Icon name={items.length ? "rain" : "sun"} size={34} />
      <div className="temp">{w ? Math.round(w.temp_c) : "–"}°C</div>
      <div className="wx-meta">
        <div><span>{t("wx_rain")}</span><b>{w ? w.rain_mm_48h : "–"} mm</b></div>
        <div><span>{t("wx_wind")}</span><b>{w ? Math.round(w.wind_kmh) : "–"} km/h</b></div>
        <div><span>{src ? t(src) : ""}</span><button className="linkbtn" style={{ color: "#fff", padding: 0, fontSize: 13 }} onClick={() => setSimulate(!simulate)}>{simulate ? t("sim_clear") : t("sim_storm")}</button></div>
      </div>
      <div className={`wx-alert ${items.length ? "bad" : ""}`}>
        <Icon name={items.length ? "alert" : "checkCircle"} size={18} />{items.length ? t("al_" + items[0].code) : t("no_alerts")}
      </div>
    </div>
  );
}

function AlertActions({ alerts }) {
  const { t } = useI18n();
  const items = alerts?.alerts || [];
  if (!items.length) return null;
  return (
    <div className="alertbox">
      <span className="ic"><Icon name="alert" size={20} /></span>
      <div style={{ flex: 1 }}>
        {items.map((a) => (
          <div key={a.code} style={{ marginBottom: 6 }}>
            <b>{t("al_" + a.code)}</b>{a.params.tons_at_risk > 0 && <> · {t("at_risk", { n: a.params.tons_at_risk })}</>}
            <ul className="clauses">{a.actions.map((x) => <li key={x}>{t("ac_" + x)}</li>)}</ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function QualityCheck() {
  const { t } = useI18n();
  const [w, setW] = useState(310);
  const [c, setC] = useState("golden");
  const [b, setB] = useState("none");
  const [res, setRes] = useState(null);
  const check = async () => setRes(await api("/quality/assess", { method: "POST", body: { weight_g: +w, colour_idx: COLOUR[c], blemish_pct: BLEMISH[b], target_grade: "A" } }));
  return (
    <div className="card">
      <h3><Icon name="search" />{t("qc_title")}</h3>
      <div className="row">
        <div><label>{t("qc_weight")}</label><input type="number" value={w} onChange={(e) => setW(e.target.value)} /></div>
        <div><label>{t("qc_colour")}</label><select value={c} onChange={(e) => setC(e.target.value)}>{Object.keys(COLOUR).map((k) => <option key={k} value={k}>{t("col_" + k)}</option>)}</select></div>
      </div>
      <label>{t("qc_blemish")}</label>
      <select value={b} onChange={(e) => setB(e.target.value)}>{Object.keys(BLEMISH).map((k) => <option key={k} value={k}>{t("bl_" + k)}</option>)}</select>
      <button className="btn" style={{ marginTop: 12, width: "100%" }} onClick={check}>{t("qc_check")}</button>
      {res && (
        <div className="insight">
          <b>{res.grade === "reject" ? t("qc_reject") : t("qc_result", { g: res.grade })}</b>
          {res.tips.length > 0 && <ul className="clauses">{res.tips.map((k) => <li key={k}>{t(k)}</li>)}</ul>}
          {res.needs_consultant_review && <p className="note">{t("qc_review")}</p>}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { t, wk, speak } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const [simulate, setSimulate] = useState(false);
  const sum = useApi("/farmers/me/summary", { refreshMs: 60000, live: ["bonds"] });
  const offers = useApi("/requirements?grade=A", { refreshMs: 60000, live: ["requirements"] });
  const alerts = useApi(simulate ? "/alerts/me?rain_mm_48h=80&wind_kmh=45" : "/alerts/me");
  const f = user.farm, s = sum.data;
  const best = (offers.data || []).filter((r) => r.left > 0).sort((a, b) => b.offerInr - a.offerInr)[0];

  if (sum.loading) return <Loading />;
  if (!s) return <ErrorBox error={sum.error} />;
  const win = `${wk(s.window.start)} – ${wk(s.window.end)}`;
  const spoken = `${t("hello", { name: user.name })}. ${t("expected_yield")}: ${s.expectedTons} ${t("tons")}. ${t("gradeA_est")}: ${s.gradeATons} ${t("tons")}. ${t("harvest_window")}: ${win}. ${t("free_cap")}: ${s.freeTons} ${t("tons")}.`;

  const QUICK = [["/farmer/offers", "offers", "n_offers"], ["/farmer/demand", "demand", "n_demand"], ["/farmer/price", "price", "n_price"], ["/farmer/profit", "profit", "n_profit"], ["/farmer/agreements", "agreements", "n_bonds"]];
  return (
    <>
      <section className="hero-card">
        <div className="hero-top">
          <div>
            <h2>{t("hello", { name: user.name })}</h2>
            <div className="loc"><Icon name="target" size={15} />{f.village}, {t("d_" + f.district)}{f.fpo ? ` · ${f.fpo}` : ""}</div>
          </div>
          <button className="btn small glassbtn" onClick={() => speak(spoken)}><Icon name="volume" size={16} />{t("listen")}</button>
        </div>
        <WeatherGlass alerts={alerts.data} simulate={simulate} setSimulate={setSimulate} />
      </section>

      <div className="quick">
        {QUICK.map(([to, icon, label]) => <Link key={to} to={to}><span className="ic"><Icon name={icon} /></span>{t(label)}</Link>)}
      </div>

      <AlertActions alerts={alerts.data} />

      <div className="grid kpis">
        <div className="card kpi"><span className="ic"><Icon name="box" /></span><div className="l">{t("expected_yield")}</div><div className="v">{s.expectedTons} <small>{t("tons")}</small></div></div>
        <div className="card kpi"><span className="ic"><Icon name="checkCircle" /></span><div className="l">{t("gradeA_est")}</div><div className="v">{s.gradeATons} <small>{t("tons")}</small></div></div>
        <div className="card kpi"><span className="ic"><Icon name="calendar" /></span><div className="l">{t("harvest_window")}</div><div className="v sm">{win}</div></div>
        <div className="card kpi"><span className="ic"><Icon name="wallet" /></span><div className="l">{t("earning_est")}</div><div className="v">{lakh(s.earningInr, t)}</div><div className="d">{inr(s.windowAvgPrice)} {t("per_kg")}</div></div>
      </div>

      <div className="grid two">
        <div>
          <div className="card">
            <h3><Icon name="target" />{t("best_for_you")}</h3>
            {best ? (
              <div className="bestoffer">
                <div><b>{best.buyerName}</b><br /><span className="note">{t("left", { n: best.left })} · {t("deliver_by")} {best.deliverBy.slice(0, 10)}</span></div>
                <div className="bigprice">{inr(best.offerInr)}<small>{t("per_kg")}</small></div>
              </div>
            ) : <p className="note">{t("no_offer")}</p>}
            <button className="btn" onClick={() => nav("/farmer/offers")}>{t("see_offers")}<Icon name="arrowRight" size={16} /></button>
          </div>
          <div className="card">
            <h3><Icon name="box" />{t("free_cap")}: <span className="up">{s.freeTons} {t("tons")}</span></h3>
            <div className="bar big"><i style={{ width: `${s.gradeATons ? Math.min(100, (s.committedTons / s.gradeATons) * 100) : 0}%` }} /></div>
            <p className="note">{t("committed")}: {s.committedTons} {t("tons")} / {s.gradeATons} {t("tons")}</p>
            <div className="insight">{t("tip_text", { p: s.priceDropPct })}</div>
          </div>
        </div>
        <div>
          <div className="card img-card">
            <div className="img"><span className="tag pill p-good">{t("v_alphonso")}</span></div>
            <div className="body">
              <h3>{t("my_farm_title")}</h3>
              <div className="facts">
                <div><span>{t("district")}</span><b>{f.village}, {t("d_" + f.district)}</b></div>
                <div><span>{t("acres")}</span><b>{f.acres} {t("acres_u")}</b></div>
                <div><span>{t("trees")}</span><b>{t("tree_info", { n: f.trees, a: f.age })}</b></div>
                <div><span>{t("irrigation")}</span><b>{t("irr_" + f.irrigation)}</b></div>
              </div>
            </div>
          </div>
          <QualityCheck />
        </div>
      </div>
    </>
  );
}
