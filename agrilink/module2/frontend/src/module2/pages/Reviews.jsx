import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAction, useLoad, useM2 } from '../context.jsx'
import { Async, Badge, Button, Field, Modal, PageHeader, Panel, Stat, StatusBadge, Table, Tabs } from '../components/ui.jsx'
import { fmtDateTime } from '../format.js'

/** Section 3: quality review decisions, interventions, verification and re-check. */
export default function Reviews() {
  const { api, auth, to } = useM2()
  const [tab, setTab] = useState('interventions')
  const interventions = useLoad(() => api.get('/interventions'), [auth.role, auth.actorId])
  const reviews = useLoad(() => api.get('/quality-reviews'), [auth.role, auth.actorId])
  const [act, setAct] = useState(null)
  const [verify, setVerify] = useState(null)
  return (
    <div className="m2-page">
      <PageHeader title="Quality reviews & interventions" crumb="Quality decision & intervention">
        Each new AI result or doctor finding triggers a review against the contract grade. A fail opens an intervention with
        guidance; the FPO or doctor logs actions, the doctor verifies, and a re-check is scheduled.
      </PageHeader>
      <Async state={reviews}>{(rows) => {
        const decided = rows.filter((r) => ['PASS', 'FAIL'].includes(r.status))
        const withAi = decided.filter((r) => r.provisional_grade)
        const agree = withAi.filter((r) => !r.disagree).length
        return (
          <div className="m2-grid m2-grid-4" style={{ marginBottom: 16 }}>
            <Stat label="Reviews" value={rows.length} note={`${decided.length} final (doctor-confirmed)`} />
            <Stat label="Pass rate" value={decided.length ? `${Math.round((100 * decided.filter((r) => r.status === 'PASS').length) / decided.length)}%` : '—'} />
            <Stat label="AI agrees with doctor" value={withAi.length ? `${Math.round((100 * agree) / withAi.length)}%` : '—'} note="Tracks whether the AI can be trusted more over time" />
            <Stat label="Waiting for a doctor" value={rows.filter((r) => r.status === 'PENDING_DOCTOR').length} note="AI result only" />
          </div>)
      }}</Async>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'interventions', label: 'Interventions' }, { id: 'reviews', label: 'Review log' }]} />
      {tab === 'interventions' && (
        <Panel flush>
          <Async state={interventions}>{(rows) => (
            <Table rows={rows} empty="No interventions. They open automatically when a doctor-confirmed grade is below contract grade." columns={[
              { key: 'f', label: 'Farmer', render: (i) => <><Link to={to(`farmers/${i.farmer_id}`)}>{i.farmer_name}</Link><div className="m2-small m2-muted">{i.agreement_id} · opened {fmtDateTime(i.created_at)}</div></> },
              { key: 'recs', label: 'Guidance', render: (i) => <ul style={{ margin: 0, paddingLeft: 16 }}>{i.recommendations.map((r, n) => (
                <li key={n} className="m2-small">{r.text} <span className="m2-faint">({r.source === 'rule' ? 'standard guidance' : 'farmer doctor'})</span></li>))}</ul> },
              { key: 'actions', label: 'Actions taken', render: (i) => i.actions.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{i.actions.map((a, n) => <li key={n} className="m2-small">{a.note} <span className="m2-faint">· {fmtDateTime(a.at)}</span></li>)}</ul> : <span className="m2-muted m2-small">None yet</span> },
              { key: 'st', label: 'Status', render: (i) => <><StatusBadge status={i.status} />{i.verification && <div className="m2-small m2-muted">{i.verification.note}</div>}</> },
              { key: 'btn', label: '', render: (i) => ['OPEN', 'IN_PROGRESS'].includes(i.status) && <div className="m2-stack" style={{ gap: 6 }}>
                {['fpo', 'doctor', 'admin'].includes(auth.role) && <Button size="sm" onClick={() => setAct(i)}>Log action</Button>}
                {['doctor', 'admin'].includes(auth.role) && <Button size="sm" variant="primary" disabled={!i.actions.length} title={!i.actions.length ? 'Log an action first' : ''} onClick={() => setVerify(i)}>Verify</Button>}</div> },
            ]} />
          )}</Async>
        </Panel>)}
      {tab === 'reviews' && (
        <Panel flush>
          <Async state={reviews}>{(rows) => (
            <Table rows={rows} columns={[
              { key: 'at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
              { key: 'f', label: 'Farmer', render: (r) => <><Link to={to(`farmers/${r.farmer_id}`)}>{r.farmer_name}</Link><div className="m2-small m2-muted">{r.agreement_id}</div></> },
              { key: 'st', label: 'Decision', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'g', label: 'Grade', render: (r) => <div className="m2-row">{r.final_grade && <Badge>Final {r.final_grade}</Badge>}{r.provisional_grade && <Badge tone="neutral">AI {r.provisional_grade}</Badge>}{r.disagree && <Badge tone="warn">Doctor overrode AI</Badge>}</div> },
              { key: 'why', label: 'Reasoning', render: (r) => <span className="m2-small">{r.reasons.join(' · ')}</span> },
            ]} />
          )}</Async>
        </Panel>)}
      {act && <TextModal title={`Log action: ${act.farmer_name}`} label="What was done?" cta="Save action" onClose={() => setAct(null)}
        submit={(note) => api.post(`/interventions/${act.id}/actions`, { note })} ok="Action logged" />}
      {verify && <VerifyModal i={verify} onClose={() => setVerify(null)} />}
    </div>
  )
}

function TextModal({ title, label, cta, onClose, submit, ok }) {
  const { run, busy } = useAction()
  const [note, setNote] = useState('')
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" busy={busy} disabled={note.trim().length < 3} onClick={async () => { if (await run(() => submit(note), ok)) onClose() }}>{cta}</Button></>}>
      <Field label={label}><textarea className="m2-textarea" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
    </Modal>
  )
}

function VerifyModal({ i, onClose }) {
  const { api } = useM2()
  const { run, busy } = useAction()
  const [effective, setEffective] = useState(true)
  const [note, setNote] = useState('')
  return (
    <Modal title={`Verify improvement: ${i.farmer_name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" busy={busy} onClick={async () => {
        if (await run(() => api.post(`/interventions/${i.id}/verify`, { effective, note }), 'Verified; re-check scheduled')) onClose()
      }}>Save and schedule re-check</Button></>}>
      <div className="m2-form">
        <Field label="Did the actions work?">
          <label className="m2-check"><input type="radio" checked={effective} onChange={() => setEffective(true)} />Yes, improvement seen</label>
          <label className="m2-check"><input type="radio" checked={!effective} onChange={() => setEffective(false)} />No, not effective</label></Field>
        <Field label="Notes"><textarea className="m2-textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <span className="m2-small m2-muted">Either way the farmer gets a new photo check now, and the next review decides PASS or FAIL.</span>
      </div>
    </Modal>
  )
}
