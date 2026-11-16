import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLoad, useM2 } from '../context.jsx'
import { Async, Badge, PageHeader, Panel, Sim, StatusBadge, Table } from '../components/ui.jsx'
import { fmtDateTime, relHours } from '../format.js'

const FILTERS = [
  { id: '', label: 'All' }, { id: 'DUE', label: 'Due' }, { id: 'REMINDED', label: 'Reminded' },
  { id: 'RETAKE_REQUESTED', label: 'Retake' }, { id: 'MISSED', label: 'Missed' }, { id: 'ANALYSED', label: 'Analysed' },
]

/** Section 1 of the workflow: scheduled photo checks, reminders and AI results. */
export default function QualityChecks() {
  const { api, auth, meta, to } = useM2()
  const [status, setStatus] = useState('')
  const [fpo, setFpo] = useState('')
  const state = useLoad(() => api.get('/quality-checks', { status, fpo_id: fpo }), [status, fpo, auth.role, auth.actorId])
  return (
    <div className="m2-page">
      <PageHeader title="Photo quality checks" crumb="Quality monitoring">
        Every active commitment gets a photo check every week. Farmers upload in the AgriLink app; a missed deadline sends an
        SMS/WhatsApp reminder, and a second miss flags the farmer doctor. AgriLink runs the AI on every upload.
      </PageHeader>
      <Panel flush title="Checks" actions={<div className="m2-row">
        <select className="m2-select m2-select-inline" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
        {auth.role === 'admin' && <select className="m2-select m2-select-inline" value={fpo} onChange={(e) => setFpo(e.target.value)} aria-label="FPO">
          <option value="">All FPOs</option>{meta?.actors.fpo.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}
      </div>}>
        <Async state={state}>{(rows) => (
          <Table rows={rows} empty="No checks match this filter." columns={[
            { key: 'f', label: 'Farmer', render: (c) => <><Link to={to(`farmers/${c.farmer_id}`)}>{c.farmer_name}</Link><div className="m2-small m2-muted">{c.agreement_id}</div></> },
            { key: 'trigger', label: 'Why', render: (c) => <span className="m2-small">{c.trigger.replace(/_/g, ' ')}</span> },
            { key: 'due', label: 'Due', render: (c) => fmtDateTime(c.due_at) },
            { key: 'deadline', label: 'Deadline', render: (c) => ['DUE', 'REMINDED', 'RETAKE_REQUESTED'].includes(c.status)
              ? <>{fmtDateTime(c.deadline)}<div className="m2-small m2-muted">{relHours(c.deadline, meta?.now)}</div></> : '—' },
            { key: 'status', label: 'Status', render: (c) => <><StatusBadge status={c.status} />{c.misses > 0 && <div className="m2-small m2-muted">{c.misses} missed deadline{c.misses > 1 ? 's' : ''}</div>}</> },
            { key: 'photos', label: 'Photos', render: (c) => c.photos.length ? <div className="m2-photos">{c.photos.slice(0, 3).map((p) => <img key={p} src={api.photoUrl(p)} alt="Fruit" />)}</div> : '—' },
            { key: 'cv', label: 'AI result', render: (c) => c.cv ? <div className="m2-small">
              {c.cv.grade_hint && <><b>AI grade {c.cv.grade_hint}</b> · </>}Defects {c.cv.defect_pct}% · colour {c.cv.colour_score} · {c.cv.size_measured === false ? 'size at weighing' : `~${c.cv.est_weight_g} g`} · conf. {c.cv.confidence}
              {c.cv.gallery?.gallery_size > 0 && <div className="m2-muted">Closest doctor-graded photos: {c.cv.gallery.neighbours.slice(0, 3).map((n) => n.grade).join(', ')}{c.cv.gallery.learned && ` · learned grader ${c.cv.gallery.learned.grade} (${Math.round(c.cv.gallery.learned.probability * 100)}%)`}</div>}
              {c.cv.notes?.length > 1 && <div className="m2-muted">{c.cv.notes.slice(1, 3).join(' ')}</div>}
              {c.cv.flags.length > 0 && <div><Badge tone="bad">{c.cv.flags.map((f) => meta?.flags[f] || f).join(', ')}</Badge></div>}
              <div><Sim /></div></div> : '—' },
            { key: 'ontime', label: 'On time', render: (c) => c.on_time === true ? <Badge tone="ok">Yes</Badge> : c.on_time === false ? <Badge tone="bad">No</Badge> : '—' },
          ]} />
        )}</Async>
      </Panel>
    </div>
  )
}
