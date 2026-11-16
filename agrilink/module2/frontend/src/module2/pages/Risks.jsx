import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAction, useLoad, useM2 } from '../context.jsx'
import { Async, Badge, Banner, Button, Field, Modal, PageHeader, Panel, Sim, StatusBadge, SupplyBar, Table } from '../components/ui.jsx'
import { fmtDate, fmtDateTime, fmtKg } from '../format.js'

/** Section 4: monitor risks -> scenario lab -> recommendations -> supply risk -> recovery. */
export default function Risks() {
  const { api, auth } = useM2()
  const { run, busy } = useAction()
  const state = useLoad(() => api.get('/risks'), [auth.role])
  const [create, setCreate] = useState(false)
  const isOps = auth.role === 'admin'
  return (
    <div className="m2-page">
      <PageHeader title="Risk monitoring & scenario lab" crumb="Risk monitoring & supply recovery" actions={isOps && <>
        <Button busy={busy} onClick={() => run(() => api.post('/risks/ingest-feed'), 'Feed checked')}>Check risk feed</Button>
        <Button variant="primary" onClick={() => setCreate(true)}>Record a risk</Button></>}>
        Weather and pest risks are checked against every active commitment in the affected talukas. The scenario lab shows how much
        contracted supply is at risk; farmers get advice by SMS/WhatsApp; if supply falls below 95% of an order, recovery starts.
      </PageHeader>
      <Async state={state}>{(rows) => rows.length === 0 ? <Panel><span className="m2-muted">No risk alerts.</span></Panel> : (
        <div className="m2-stack">{rows.map((r) => <Alert key={r.id} r={r} isOps={isOps} />)}</div>
      )}</Async>
      {create && <CreateRisk onClose={() => setCreate(false)} />}
    </div>
  )
}

function Alert({ r, isOps }) {
  const { api, to } = useM2()
  const { run, busy } = useAction()
  const s = r.scenario
  return (
    <Panel title={<>{r.type_label} · {r.areas.join(', ')} <Badge tone={r.severity === 'high' ? 'bad' : 'warn'}>{r.severity}</Badge></>}
      sub={<>{fmtDateTime(r.starts_at)} – {fmtDateTime(r.ends_at)} · {r.summary} · source: {r.source.replace(/^SIMULATED[_ ]?/, '').replace(/_/g, ' ').toLowerCase()}</>}
      actions={<div className="m2-row"><StatusBadge status={r.status} />
        {isOps && r.status === 'OPEN' && <Button variant="primary" busy={busy} onClick={() => run(() => api.post(`/risks/${r.id}/scenario`), 'Scenario assessed')}>Run scenario lab</Button>}
        {isOps && r.status === 'ASSESSED' && !r.recommendations_sent_at && <Button busy={busy} onClick={() => run(() => api.post(`/risks/${r.id}/recommendations`), 'Advice sent to farmers, FPOs and doctors')}>Send recommendations</Button>}
        {isOps && r.status !== 'CLOSED' && <Button variant="ghost" busy={busy} onClick={() => run(() => api.post(`/risks/${r.id}/close`), 'Alert closed')}>Close</Button>}</div>}>
      {!s ? <span className="m2-muted">Not assessed yet. The scenario lab applies an illustrative loss factor to commitments in {r.areas.join(', ')}.</span> : (
        <div className="m2-stack">
          <div className="m2-row m2-small m2-muted">Loss factor {Math.round(s.loss_factor * 100)}% (illustrative) · {s.exposed.length} commitments exposed
            {r.recommendations_sent_at && <> · advice sent {fmtDateTime(r.recommendations_sent_at)} to {r.recommendations_to.farmers} farmers</>}</div>
          {s.agreements.length === 0 ? <Banner tone="ok">No monitored agreement has commitments in this area.</Banner> :
            <Table rows={s.agreements} rowKey={(a) => a.agreement_id} columns={[
              { key: 'a', label: 'Agreement', render: (a) => <Link to={to(`agreements/${a.agreement_id}`)}>{a.agreement_id}</Link> },
              { key: 'bar', label: 'Expected after risk', width: 220, render: (a) => <><SupplyBar order={a.order_kg} expected={a.expected_after_kg} delivered={0} />
                <div className="m2-small m2-muted" style={{ marginTop: 4 }}>{fmtKg(a.expected_before_kg)} → {fmtKg(a.expected_after_kg)} of {fmtKg(a.order_kg)}</div></> },
              { key: 'fill', label: 'Fill', align: 'right', render: (a) => `${a.fill_pct}%` },
              { key: 'risk', label: 'Supply risk?', render: (a) => a.supply_risk ? <Badge tone="bad">Yes · short {fmtKg(a.shortfall_kg)}</Badge> : <Badge tone="ok">No</Badge> },
              { key: 'go', label: '', render: (a) => isOps && a.supply_risk && <StartRecovery agreementId={a.agreement_id} alertId={r.id} /> },
            ]} />}
          <details><summary className="m2-small" style={{ cursor: 'pointer' }}>Exposed commitments and advice</summary>
            <div className="m2-grid m2-grid-2" style={{ marginTop: 8 }}>
              <Table rows={s.exposed} rowKey={(e) => e.commitment_id} columns={[
                { key: 'f', label: 'Farmer', render: (e) => <Link to={to(`farmers/${e.farmer_id}`)}>{e.farmer_name}</Link> },
                { key: 'a', label: 'Agreement', render: (e) => e.agreement_id },
                { key: 'k', label: 'Expected', align: 'right', render: (e) => `${e.projected_before_kg} → ${e.projected_after_kg} kg` }]} />
              <ul style={{ margin: 0 }}>{s.advice.map((x) => <li key={x} className="m2-small">{x}</li>)}</ul>
            </div></details>
        </div>)}
    </Panel>
  )
}

function StartRecovery({ agreementId, alertId }) {
  const { api, to } = useM2()
  const { run, busy } = useAction()
  const existing = useLoad(() => api.get('/recovery-requests', { agreement_id: agreementId }), [agreementId])
  const open = existing.data?.find((x) => ['OPEN', 'PARTIAL'].includes(x.status))
  if (open) return <Link to={to('recovery')}>Recovery open →</Link>
  return <Button size="sm" variant="primary" busy={busy} onClick={() => run(() => api.post('/recovery-requests', { agreement_id: agreementId, alert_id: alertId, reason: 'weather_or_pest' }), 'Supply recovery opened')}>Start supply recovery</Button>
}

function CreateRisk({ onClose }) {
  const { api, meta } = useM2()
  const { run, busy } = useAction()
  const today = meta?.now?.slice(0, 10)
  const [f, setF] = useState({ type: 'unseasonal_rain', severity: 'medium', areas: [], starts: today, ends: today, summary: '' })
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  return (
    <Modal title="Record a risk" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" busy={busy} disabled={!f.areas.length} onClick={async () => {
        const body = { type: f.type, severity: f.severity, areas: f.areas, summary: f.summary,
          starts_at: `${f.starts}T00:00:00Z`, ends_at: `${f.ends}T23:59:00Z` }
        if (await run(() => api.post('/risks', body), 'Risk recorded')) onClose()
      }}>Record risk</Button></>}>
      <div className="m2-form">
        <div className="m2-form m2-form-2">
          <Field label="Type"><select className="m2-select" value={f.type} onChange={(e) => set('type', e.target.value)}>
            {Object.entries(meta?.risk_types || {}).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <Field label="Severity"><select className="m2-select" value={f.severity} onChange={(e) => set('severity', e.target.value)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field>
          <Field label="From"><input className="m2-input" type="date" value={f.starts} onChange={(e) => set('starts', e.target.value)} /></Field>
          <Field label="To"><input className="m2-input" type="date" value={f.ends} onChange={(e) => set('ends', e.target.value)} /></Field>
        </div>
        <Field label="Affected talukas"><div className="m2-row">{(meta?.talukas || []).map((t) => (
          <label key={t} className="m2-check"><input type="checkbox" checked={f.areas.includes(t)} onChange={(e) => set('areas', e.target.checked ? [...f.areas, t] : f.areas.filter((x) => x !== t))} />{t}</label>))}</div></Field>
        <Field label="Summary"><input className="m2-input" value={f.summary} onChange={(e) => set('summary', e.target.value)} placeholder="Source and what is expected" /></Field>
        <span className="m2-small m2-muted">Started {fmtDate(meta?.now)}. Loss factors used by the scenario lab are illustrative.</span>
      </div>
    </Modal>
  )
}
