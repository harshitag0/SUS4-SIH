import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/index.jsx";
import { LangChips } from "../components/ui.jsx";
import { Brand } from "../components/Layout.jsx";
import Icon from "../components/Icon.jsx";
import WhatsAppButton from "../components/WhatsAppButton.jsx";
import { TEXT } from "./landing/text.js";
import "./landing/landing.css";
import LiveBoard from "./landing/LiveBoard.jsx";

/** Shared welcome-photo panel used by the login screens. */
export function WelcomePhoto() {
  const { t } = useI18n();
  return (
    <section className="welcome-photo">
      <Brand />
      <div>
        <h1 className="headline">{t("lp_head1")}<br /><em>{t("lp_head2")}</em></h1>
        <p>{t("lp_sub")}</p>
        <div className="stat-row">
          <div className="glass"><b>9</b><span>{t("lp_stat1")}</span></div>
          <div className="glass"><b>3</b><span>{t("lp_stat2")}</span></div>
          <div className="glass"><b>3</b><span>{t("lp_stat3")}</span></div>
        </div>
      </div>
    </section>
  );
}

const SECTIONS = ["features", "realtime", "how", "roles", "contact"];
const LOGINS = [["farmer", "sprout", "/login/farmer"], ["ops", "farmer", "/login/operations"], ["buyer", "building", "/login/buyer"]];

/** Fades sections in as they scroll into view; respects reduced motion (CSS). */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".lp .reveal");
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return undefined; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  });
}

/** Highlights the nav link of the section on screen. */
function useActiveSection() {
  const [active, setActive] = useState("");
  useEffect(() => {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "-45% 0px -50% 0px" });
    SECTIONS.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  return active;
}

function LoginMenu({ L }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, []);
  return (
    <div className={`lp-login ${open ? "open" : ""}`} ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="lp-btn ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {L.nav.login}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <div className="lp-menu" role="menu">
        {LOGINS.map(([k, , to]) => (
          <button key={k} role="menuitem" onClick={() => nav(to)}>
            <span><b>{L.login[k][0]}</b><small>{L.login[k][1]}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Nav({ L, active }) {
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`lp-nav ${scrolled ? "scrolled" : ""} ${menu ? "menu-open" : ""}`}>
      <div className="lp-wrap lp-nav-in">
        <Brand to="/" />
        <nav className="lp-links" onClick={() => setMenu(false)}>
          {SECTIONS.map((id) => <a key={id} href={`#${id}`} className={active === id ? "on" : ""}>{L.nav[id]}</a>)}
          <div className="lp-lang-sm" onClick={(e) => e.stopPropagation()}><LangChips /></div>
        </nav>
        <div className="lp-nav-actions">
          <div className="lp-lang-lg"><LangChips /></div>
          <LoginMenu L={L} />
          <button className="lp-btn primary hide-sm" onClick={() => nav("/login/farmer")}>{L.nav.start}</button>
          <button className="lp-burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name={menu ? "x" : "offers"} size={20} /></button>
        </div>
      </div>
    </header>
  );
}

function HeroArt() {
  return <div className="lp-hero-art reveal"><img src="/img/lp/hero.svg" alt="" width="560" height="500" /></div>;
}

function Contact({ L }) {
  const C = L.contact;
  const [f, setF] = useState({ name: "", contact: "", role: C.roles[0], message: "" });
  const [state, setState] = useState("idle");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async (e) => {
    e.preventDefault();
    setState("busy");
    try { await api("/contact", { method: "POST", body: f }); setState("sent"); setF({ ...f, message: "" }); }
    catch { setState("err"); }
  };
  return (
    <section id="contact" className="lp-sec">
      <div className="lp-wrap lp-contact">
        <div className="reveal">
          <span className="lp-tag">{C.tag}</span>
          <h2>{C.title}</h2>
          <p className="lp-sub">{C.sub}</p>
          <ul className="lp-info">
            {C.info.map(([, a, b]) => <li key={a}><small>{a}</small><b>{b}</b></li>)}
          </ul>
        </div>
        <form className="lp-form reveal" onSubmit={send}>
          <div className="two-col">
            <label>{C.name}<input required minLength={2} maxLength={80} value={f.name} onChange={set("name")} autoComplete="name" /></label>
            <label>{C.phone}<input required minLength={5} maxLength={120} value={f.contact} onChange={set("contact")} /></label>
          </div>
          <label>{C.role}
            <select value={f.role} onChange={set("role")}>{C.roles.map((r) => <option key={r}>{r}</option>)}</select>
          </label>
          <label>{C.msg}<textarea required minLength={5} maxLength={2000} rows={5} value={f.message} onChange={set("message")} /></label>
          <button className="lp-btn primary big" disabled={state === "busy"}>{C.send}<Icon name="arrowRight" size={16} /></button>
          {state === "sent" && <p className="lp-ok" role="status">{C.sent}</p>}
          {state === "err" && <p className="lp-err" role="alert">{C.err}</p>}
        </form>
      </div>
    </section>
  );
}

export default function Landing() {
  const { lang } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const L = TEXT[lang] || TEXT.en;
  const active = useActiveSection();
  useReveal();
  if (user) return <Navigate to={{ farmer: "/farmer/home", buyer: "/buyer", operations: "/ops/decisions" }[user.role] || "/"} replace />;

  return (
    <div className="lp">
      <Nav L={L} active={active} />

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="reveal">
            <span className="lp-eyebrow">{L.hero.eyebrow}</span>
            <h1>{L.hero.h1} <em>{L.hero.h1b}</em></h1>
            <p className="lp-lead">{L.hero.sub}</p>
            <div className="lp-cta-row">
              <button className="lp-btn primary big" onClick={() => nav("/login/farmer")}>{L.hero.cta1}<Icon name="arrowRight" size={16} /></button>
              <button className="lp-btn light big" onClick={() => nav("/login/buyer")}>{L.hero.cta2}</button>
              <WhatsAppButton className="big" />
            </div>
          </div>
          <HeroArt />
        </div>
      </section>

      <section id="features" className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head reveal"><span className="lp-tag">{L.features.tag}</span><h2>{L.features.title}</h2></div>
          <div className="lp-features">
            {L.features.items.map(([, a, b], i) => (
              <article key={a} className="lp-feature reveal" style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
                <div className="lp-fbody"><h3>{a}</h3><p>{b}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="lp-sec tint">
        <div className="lp-wrap">
          <div className="lp-head reveal"><span className="lp-tag">{L.how.tag}</span><h2>{L.how.title}</h2></div>
          <ol className="lp-steps">
            {L.how.steps.map(([, a, b], i) => (
              <li key={a} className="reveal" style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="n">{String(i + 1).padStart(2, "0")}</span><h3>{a}</h3><p>{b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="realtime" className="lp-sec">
        <div className="lp-wrap lp-realtime">
          <div className="lp-realtime-head reveal">
            <span className="lp-tag">{L.realtime.tag}</span>
            <h2>{L.realtime.title}</h2>
            <p className="lp-sub">{L.realtime.sub}</p>
          </div>
          <LiveBoard L={L} />
        </div>
      </section>

      <section id="roles" className="lp-sec tint">
        <div className="lp-wrap">
          <div className="lp-head reveal"><span className="lp-tag">{L.roles.tag}</span><h2>{L.roles.title}</h2></div>
          <div className="lp-roles">
            {L.roles.items.map(([, a, pts], i) => (
              <article key={a} className={`lp-role reveal r${i}`} style={{ transitionDelay: `${i * 90}ms` }}>
                <h3>{a}</h3>
                <ul>{pts.map((p) => <li key={p}>{p}</li>)}</ul>
                <Link className="lp-link" to={LOGINS[i][2]}>{L.roles.go} →</Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-cta reveal">
            <div><h2>{L.cta.title}</h2><p>{L.cta.sub}</p></div>
            <button className="lp-btn white big" onClick={() => nav("/login/farmer")}>{L.cta.btn}<Icon name="arrowRight" size={16} /></button>
          </div>
        </div>
      </section>

      <Contact L={L} />

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <Brand to="/" />
          <nav>{SECTIONS.map((id) => <a key={id} href={`#${id}`}>{L.nav[id]}</a>)}</nav>
          <p>© 2026 AgriLink · {L.footer}</p>
        </div>
      </footer>
    </div>
  );
}
