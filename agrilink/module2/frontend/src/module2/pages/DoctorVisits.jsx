import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAction, useLoad, useM2 } from '../context.jsx'
import { Async, Badge, Banner, Button, Field, Modal, PageHeader, Panel, Sim, Table, Tabs } from '../components/ui.jsx'
import { fmtDateTime, relHours } from '../format.js'

const TRIGGER = { schedule: 'Routine visit', manual: 'Requested', missed_uploads: 'Two missed photo uploads', ai_flag: 'AI flag below contract grade' }

/** Section 2: farmer doctor visits (human in the loop). */
export default function DoctorVisits() {
  const { api, auth, meta, to } = useM2()
  const [tab, setTab] = useState('SCHEDULED')
  const [open, setOpen] = useState(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const state = useLoad(() => api.get('/doctor-visits', { status: tab }), [tab, auth.role, auth.actorId])
  const why = (r) => r.note || TRIGGER[r.trigger] || r.trigger
  const canRecord = (v) => v.status === 'SCHEDULED' && (auth.role === 'admin' || (auth.role === 'doctor' && auth.actorId === v.doctor_id))
  return (
    <div className="m2-page">
      <PageHeader title="Farmer doctor visits" crumb="Farmer doctor verification"
        actions={['fpo', 'doctor', 'admin'].includes(auth.role) && <Button onClick={() => setScheduleOpen(true)}>Schedule a visit</Button>}>
        The farmer doctor is an FPO group lead who visits weekly or monthly, inspects the fruit on site and records a grade.
        The doctor's grade is final; AI alone never is. Priority visits come from two missed uploads or an AI flag below contract grade.
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'SCHEDULED', label: 'To visit' }, { id: 'COMPLETED', label: 'Completed' }]} />
      <Panel flush>
        <Async state={state}>{(rows) => (
          <Table rows={rows} empty={tab === 'SCHEDULED' ? 'No visits waiting.' : 'No completed visits.'} columns={[
            { key: 'f', label: 'Farmer', render: (v) => <><Link to={to(`farmers/${v.farmer_id}`)}>{v.farmer_name}</Link><div className="m2-small m2-muted">{v.village} · {v.fpo_id}</div></> },
            { key: 'd', label: 'Farmer doctor', render: (v) => v.doctor_name },
            { key: 'due', label: tab === 'SCHEDULED' ? 'Due' : 'Visited', render: (v) => tab === 'SCHEDULED'
              ? <>{fmtDateTime(v.due_at)}<div className="m2-small" style={{ color: meta && v.due_at < meta.now ? 'var(--m2-bad)' : 'var(--m2-muted)' }}>{meta && v.due_at < meta.now ? `Overdue · due ${relHours(v.due_at, meta.now)}` : relHours(v.due_at, meta?.now)}</div></> : fmtDateTime(v.completed_at) },
            { key: 'why', label: 'Why', render: (v) => <>{v.priority && <Badge tone="bad">Priority</Badge>} <span className="m2-small">{v.reasons.map(why).join('; ')}</span></> },
            { key: 'res', label: tab === 'SCHEDULED' ? '' : 'Finding', render: (v) => tab === 'SCHEDULED'
              ? (canRecord(v) && <Button size="sm" variant="primary" onClick={() => setOpen(v)}>Record inspection</Button>)
              : <><Badge tone={v.finding.grade === 'REJECT' ? 'bad' : 'ok'}>Grade {v.finding.grade}</Badge>
                <div className="m2-small m2-muted">{v.finding.observations}</div></> },
          ]} />
        )}</Async>
      </Panel>
      {open && <InspectionModal visit={open} onClose={() => setOpen(null)} />}
      {scheduleOpen && <ScheduleModal onClose={() => setScheduleOpen(false)} />}
    </div>
  )
}

function InspectionModal({ visit, onClose }) {
  const { api, meta } = useM2()
  const { run, busy } = useAction()
  const latest = useLoad(() => api.get('/quality-checks', { farmer_id: visit.farmer_id, status: 'ANALYSED' }), [visit.farmer_id])
  const [f, setF] = useState({ grade: 'A', observed_defect_pct: '', fruit_inspected: 40, pest_signs: [], cleared_flags: [], observations: '', recs: '' })
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const toggle = (k, flag) => set(k, f[k].includes(flag) ? f[k].filter((x) => x !== flag) : [...f[k], flag])
  const [result, setResult] = useState(null)
  const submit = async () => {
    const body = { grade: f.grade, pest_signs: f.pest_signs, cleared_flags: f.cleared_flags, observations: f.observations,
      recommendations: f.recs.split('\n').map((x) => x.trim()).filter(Boolean),
      fruit_inspected: f.fruit_inspected ? Number(f.fruit_inspected) : null,
      observed_defect_pct: f.observed_defect_pct === '' ? null : Number(f.observed_defect_pct) }
    const r = await run(() => api.post(`/doctor-visits/${visit.id}/complete`, body), 'Inspection recorded; quality review updated')
    if (r) setResult(r)
  }
  const cv = latest.data?.[0]?.cv
  return (
    <Modal title={`Inspection: ${visit.farmer_name}`} onClose={onClose} footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <>
      <Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={submit}>Save inspection</Button></>}>
      {result ? (
        <div className="m2-stack">{result.reviews.map((r) => (
          <Banner key={r.id} tone={r.status === 'PASS' ? 'ok' : 'bad'}>{r.agreement_id}: <strong>{r.status}</strong> · {r.reasons.join(' · ')}</Banner>))}
          {result.reviews.some((r) => r.status === 'FAIL') && <span className="m2-small m2-muted">An intervention has been opened with guidance; see Reviews & interventions.</span>}
        </div>
      ) : (
        <div className="m2-form">
          {cv ? <Banner tone="info"><span>Latest AI result: defects {cv.defect_pct}%, colour {cv.colour_score}, ~{cv.est_weight_g} g, confidence {cv.confidence}
            {cv.flags.length > 0 && <>, flags: <strong>{cv.flags.map((x) => meta?.flags[x] || x).join(', ')}</strong></>}. <Sim /></span></Banner>
            : <Banner tone="warn">No recent AI result for this farmer. Your grade alone will decide.</Banner>}
          <div className="m2-form m2-form-2">
            <Field label="Your grade"><select className="m2-select" value={f.grade} onChange={(e) => set('grade', e.target.value)}>
              <option value="A">A</option><option value="B">B</option><option value="REJECT">Reject</option></select></Field>
            <Field label="Fruit inspected"><input className="m2-input" type="number" min="1" value={f.fruit_inspected} onChange={(e) => set('fruit_inspected', e.target.value)} /></Field>
            <Field label="Observed defects (%)"><input className="m2-input" type="number" min="0" max="100" value={f.observed_defect_pct} onChange={(e) => set('observed_defect_pct', e.target.value)} /></Field>
          </div>
          <Field label="Pest or disease signs seen">{Object.entries(meta?.flags || {}).map(([k, label]) => (
            <label key={k} className="m2-check"><input type="checkbox" checked={f.pest_signs.includes(k)} onChange={() => toggle('pest_signs', k)} />{label}</label>))}</Field>
          {cv?.flags.length > 0 && <Field label="AI flags you judge to be false">{cv.flags.map((k) => (
            <label key={k} className="m2-check"><input type="checkbox" checked={f.cleared_flags.includes(k)} onChange={() => toggle('cleared_flags', k)} />Clear "{meta?.flags[k] || k}"</label>))}</Field>}
          <Field label="Observations"><textarea className="m2-textarea" value={f.observations} onChange={(e) => set('observations', e.target.value)} /></Field>
          <Field label="Your recommendations to the farmer (one per line)" hint="Added to the intervention if the fruit fails."><textarea className="m2-textarea" value={f.recs} onChange={(e) => set('recs', e.target.value)} /></Field>
        </div>
      )}
    </Modal>
  )
}

function ScheduleModal({ onClose }) {
  const { api, auth } = useM2()
  const { run, busy } = useAction()
  const farmers = useLoad(() => api.get('/farmers'), [])
  const [farmer, setFarmer] = useState('')
  const [note, setNote] = useState('')
  return (
    <Modal title="Schedule a farm visit" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" busy={busy} disabled={!farmer} onClick={async () => {
        if (await run(() => api.post('/doctor-visits', { farmer_id: farmer, note }), 'Visit scheduled')) onClose()
      }}>Schedule</Button></>}>
      <Async state={farmers}>{(rows) => (
        <div className="m2-form">
          <Field label="Farmer" hint={auth.role === 'admin' ? 'Visits go to the FPO\'s farmer doctor.' : 'Members of your FPO.'}>
            <select className="m2-select" value={farmer} onChange={(e) => setFarmer(e.target.value)}>
              <option value="">Choose…</option>{rows.map((f) => <option key={f.id} value={f.id}>{f.name} · {f.village} ({f.fpo_id})</option>)}</select></Field>
          <Field label="Reason"><input className="m2-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Farmer reported dark spots" /></Field>
        </div>)}</Async>
    </Modal>
  )
}
