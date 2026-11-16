import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../../components/Icon.jsx";

/** Live platform board: every number comes from /api/public/live (running system), refreshed every 30 s. */
const inr = (n) => (n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const ago = (d) => {
  if (!d) return null;
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function cards(d) {
  const w = d.weather.ok ? d.weather.districts : [];
  const alerts = w.filter((x) => x.alert);
  const maxRain = w.length ? Math.max(...w.map((x) => x.rain_mm_48h)) : null;
  return [
    { icon: "offers", ok: d.demand.ok, live: true, value: d.demand.ok ? `${d.demand.openTons} t` : "—", label: "open buyer demand",
      sub: d.demand.ok ? `${d.demand.buyers} buyers · ${d.demand.newThisWeek} new this week · Grade A avg ${inr(d.demand.byGrade?.A?.avgOfferInr)}/kg` : "", src: "Live · buyer requirements", to: "/login/farmer" },
    { icon: "price", ok: d.price.ok, live: false, value: d.price.ok ? `${inr(d.price.fairOffer)}/kg` : "—", label: "fair offer, Grade A (season)",
      sub: d.price.ok ? `Best week ${d.price.bestWeek}: ${inr(d.price.bestPrice)}/kg · local mandi ~${inr(d.price.mandiPrice)}/kg` : "", src: d.price.source === "model_sample" ? `Forecast model · sample data · ±${d.price.mape}%` : "Forecast model", to: "/login/farmer" },
    { icon: alerts.length ? "alert" : "sun", ok: d.weather.ok, live: d.weather.source === "open-meteo", value: alerts.length ? `${alerts.length} alert${alerts.length > 1 ? "s" : ""}` : "All clear", label: "Konkan weather, next 48 h",
      sub: w.map((x) => `${x.district} ${Math.round(x.temp_c)}°`).join(" · ") + (maxRain != null ? ` · rain up to ${maxRain} mm` : ""), src: d.weather.source === "open-meteo" ? "Live · Open-Meteo" : "Weather service offline", to: "/login/farmer" },
    { icon: "sprout", ok: d.stages.ok, live: true, value: d.stages.ok ? String(d.stages.pending) : "—", label: "crop photos awaiting doctor review",
      sub: d.stages.ok ? `${d.stages.approved} stages approved${d.stages.updatedAt ? ` · last ${ago(d.stages.updatedAt)}` : ""}` : "", src: "Live · stage assessments", to: "/login/farmer" },
    { icon: "shield", ok: d.chain.ok, live: d.chain.ok, value: d.chain.ok ? String(d.chain.registered) : "—", label: "agreements anchored on-chain",
      sub: d.chain.ok ? `${d.chain.total} agreements total · block #${d.chain.block}` : "Chain node offline — agreements still signed and stored", src: d.chain.ok ? d.chain.network : "Blockchain offline", to: "/verify" },
    { icon: "wallet", ok: d.escrow.ok, live: false, value: d.escrow.ok ? `$${d.escrow.released.toLocaleString("en-US")}` : "—", label: "released to FPOs via escrow",
      sub: d.escrow.ok ? `$${d.escrow.held.toLocaleString("en-US")} held until delivery is verified · ${d.escrow.accounts} accounts` : "", src: "Escrow ledger · test funds (no bank link yet)", to: "/login/buyer" },
    { icon: "bell", ok: d.messages.ok, live: d.messages.delivered > 0, value: d.messages.ok ? String(d.messages.last24h) : "—", label: "WhatsApp / SMS advisories, 24 h",
      sub: d.messages.ok ? (d.messages.delivered ? `${d.messages.delivered} delivered · ${d.messages.failed} failed` : `${d.messages.simulated} in test mode · provider keys not set`) : "", src: d.messages.delivered ? "Live · WhatsApp Cloud / SMS" : "Message log · test mode", to: "/login/farmer" },
    { icon: "checkCircle", ok: d.certs.ok, live: true, value: d.certs.ok ? String(d.certs.issued) : "—", label: "quality certificates issued",
      sub: d.certs.ok && d.certs.latestId ? `Latest ${d.certs.latestId} · ${ago(d.certs.latestAt)}` : "", src: "Live · QR verifiable", to: d.certs.latestId ? `/verify/${d.certs.latestId}` : "/verify" },
  ];
}

export default function LiveBoard({ L }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/public/live").then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { if (alive) { setD(j); setErr(false); } }).catch(() => alive && setErr(true));
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const titles = L.realtime.features.map((f) => f.name);
  const list = d ? cards(d) : [];
  const up = list.filter((c) => c.ok).length;
  return (
    <div className="lb">
      <div className="lb-bar">
        <span className={`lb-dot ${d && !err ? "on" : ""}`} />
        <b>{d && !err ? `${up}/8 services online` : err ? "Platform offline" : "Connecting…"}</b>
        {d && <span className="lb-time">Updated {new Date(d.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · refreshes every 30 s</span>}
      </div>
      <div className="lb-grid">
        {(d ? list : Array.from({ length: 8 }, () => null)).map((c, i) => (
          c ? (
            <Link key={i} to={c.to} className={`lb-card ${c.ok ? "" : "down"}`}>
              <div className="lb-top"><span className="lb-ic"><Icon name={c.icon} size={18} /></span><span className="lb-name">{titles[i]}</span></div>
              <div className="lb-val">{c.value}</div>
              <div className="lb-label">{c.label}</div>
              <p className="lb-sub">{c.sub}</p>
              <div className="lb-src"><i className={c.ok ? (c.live ? "live" : "test") : "off"} />{c.src}</div>
            </Link>
          ) : <div key={i} className="lb-card skel" />
        ))}
      </div>
    </div>
  );
}
