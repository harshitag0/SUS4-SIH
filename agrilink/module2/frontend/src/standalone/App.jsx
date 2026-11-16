import { useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { M2Provider, Module2Routes, m2NavFor, useM2 } from '../module2/index.js'
import { useAction } from '../module2/context.jsx'
import { fmtDateTime } from '../module2/format.js'
import './shell.css'

// Standalone shell used only while Module 2 runs on its own. Inside AgriLink,
// Module 1 provides navigation, sign-in (auth) and the page frame instead.
const API_BASE = import.meta.env.VITE_M2_API_BASE || 'http://localhost:8000/api/m2'
const ROLE_LABEL = { admin: 'AgriLink operations', fpo: 'FPO officer', doctor: 'Farmer doctor', farmer: 'Farmer', buyer: 'Buyer (SG supermarket)' }
const DEFAULT_ACTOR = { admin: 'OPS-1', fpo: 'FPO-RTN', doctor: 'DOC-RTN', farmer: 'FRM-RTN-06', buyer: 'BUY-A' }

function loadAuth() {
  // Demo links can preselect a user: /m2?as=fpo:FPO-RTN
  const as = new URLSearchParams(window.location.search).get('as')
  if (as && as.includes(':')) {
    const [role, actorId] = as.split(':')
    if (ROLE_LABEL[role]) return { role, actorId }
  }
  try {
    const v = JSON.parse(window.localStorage.getItem('m2-demo-auth'))
    if (v?.role && v?.actorId) return v
  } catch { /* storage unavailable */ }
  return { role: 'admin', actorId: 'OPS-1' }
}

export default function App() {
  const [auth, setAuthState] = useState(loadAuth)
  const setAuth = (a) => {
    setAuthState(a)
    try { window.localStorage.setItem('m2-demo-auth', JSON.stringify(a)) } catch { /* ignore */ }
  }
  return (
    <BrowserRouter>
      <M2Provider apiBase={API_BASE} auth={auth} basePath="/m2">
        <Routes>
          <Route path="/m2/*" element={<Shell setAuth={setAuth} />} />
          <Route path="*" element={<Navigate to="/m2" replace />} />
        </Routes>
      </M2Provider>
    </BrowserRouter>
  )
}

function Shell({ setAuth }) {
  const { auth, meta, metaError, to } = useM2()
  const nav = useNavigate()
  const groups = m2NavFor(auth.role)
  return (
    <div className="sh-layout m2-root">
      <aside className="sh-side">
        <div className="sh-brand"><span className="sh-mark" aria-hidden>◆</span><div><strong>AgriLink</strong><div className="sh-sub">Module 2 · Farm management & supply assurance</div></div></div>
        <nav>{groups.map((g) => (
          <div key={g.group} className="sh-group"><div className="sh-group-label">{g.group}</div>
            {g.items.map((i) => <NavLink key={i.path} to={to(i.path)} end={i.path === ''} className={({ isActive }) => `sh-link ${isActive ? 'sh-active' : ''}`}>{i.label}</NavLink>)}</div>))}
        </nav>
        <div className="sh-foot">Standalone shell. Inside AgriLink, Module 1 supplies sign-in and navigation.</div>
      </aside>
      <div className="sh-main">
        <header className="sh-top">
          <div className="sh-actas">
            <label className="sh-label">Acting as</label>
            <select className="m2-select" value={auth.role} onChange={(e) => { const r = e.target.value; setAuth({ role: r, actorId: DEFAULT_ACTOR[r] }); nav(to('')) }} aria-label="Role">
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {meta && auth.role !== 'admin' && (
              <select className="m2-select" value={auth.actorId} onChange={(e) => { setAuth({ role: auth.role, actorId: e.target.value }); nav(to('')) }} aria-label="Who">
                {(meta.actors[auth.role] || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>)}
          </div>
          <div className="m2-spacer" />
          {meta && <DemoClock />}
        </header>
        {metaError && <div className="m2-page"><div className="m2-banner m2-banner-bad">Cannot reach the Module 2 backend at {API_BASE}. Start it with <code>uvicorn app.main:app --port 8000</code>.</div></div>}
        <Module2Routes />
      </div>
    </div>
  )
}

function DemoClock() {
  const { api, auth, meta } = useM2()
  const { run, busy } = useAction()
  const advance = (hours, label) => run(async () => {
    return api.post('/system/clock/advance', { hours })
  }, `Clock moved ${label}; scheduled jobs ran`)
  return (
    <div className="sh-clock">
      <div title={meta.clock_simulated ? 'Simulated time used by every rule (deadlines, windows, the 6-month switch)' : 'Real time'}>
        <div className="sh-label">{meta.clock_simulated ? 'Simulated time (IST)' : 'Time (IST)'}</div>
        <strong>{fmtDateTime(meta.now)}</strong>
      </div>
      {meta.demo_controls && auth.role === 'admin' && <div className="m2-row">
        <button className="m2-btn m2-btn-sm" disabled={busy} onClick={() => advance(6, '+6 h')}>+6 h</button>
        <button className="m2-btn m2-btn-sm" disabled={busy} onClick={() => advance(24, '+1 day')}>+1 day</button>
        <button className="m2-btn m2-btn-sm" disabled={busy} onClick={() => advance(24 * 7, '+1 week')}>+1 week</button>
        <button className="m2-btn m2-btn-sm m2-btn-danger" disabled={busy} onClick={() => {
          if (window.confirm('Reset all Module 2 demo data to the seeded state?')) run(() => api.post('/system/reset-demo'), 'Demo data reset')
        }}>Reset demo</button></div>}
    </div>
  )
}
