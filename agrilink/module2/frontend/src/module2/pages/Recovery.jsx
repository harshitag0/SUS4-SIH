import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAction, useLoad, useM2 } from '../context.jsx'
import { Async, Badge, Banner, Button, Field, Modal, PageHeader, Panel, StatusBadge, Table } from '../components/ui.jsx'
import { fmtDateTime, fmtKg } from '../format.js'

/** Supply recovery: offer the shortfall to FPOs outside the affected area, ranked with
 *  Module 1's rule, accepted only with farmers' paper signatures collected in person. */
export default function Recovery() {
  const { api, auth } = useM2()
  const state = useLoad(() => api.get('/recovery-requests'), [auth.role, auth.actorId])
  const status = useLoad(() => api.get('/ratings/status'), [])
  return (
    <div className="m2-page">
      <PageHeader title="Supply recovery" crumb="Risk monitoring & supply recovery">
        When expected supply drops below the order, the shortfall is offered to FPOs outside the affected area. Candidates are ordered
        the same way as Module 1: first come, first served during the 6-month pilot, then by rating with 20% kept for new FPOs.
      </PageHeader>
      <Async state={status}>{(s) => <div style={{ marginBottom: 16 }}><Banner tone="info">
        Ranking mode now: <strong>{s.live ? 'by rating' : 'first come, first served (pilot)'}</strong>. Ratings drive ranking from {s.switch_on}.</Banner></div>}</Async>
      <Async state={state}>{(rows) => rows.length === 0
        ? <Panel><span className="m2-muted">No recovery requests. Operations opens one from the scenario lab or after a withdrawal.</span></Panel>
        : <div className="m2-stack">{rows.map((r) => <Request key={r.id} r={r} />)}</div>}</Async>
    </div>
  )
}

function Request({ r }) {
  const { api, auth, to } = useM2()
  const { run, busy } = useAction()
  const [offerFor, setOfferFor] = useState(null)
  const [respond, setRespond] = useState(null)
  const isOps = auth.role === 'admin'
  const open = ['OPEN', 'PARTIAL'].includes(r.status)
  const pending = r.offers.filter((o) => o.status === 'OFFERED').reduce((s, o) => s + o.kg, 0)
  const remaining = Math.max(0, r.shortfall_kg - r.filled_kg - pending)
  return (
    <Panel title={<>Recovery for <Link to={to(`agreements/${r.agreement_id}`)}>{r.agreement_id}</Link></>}
      sub={`Opened ${fmtDateTime(r.created_at)} · reason: ${r.reason.replace(/_/g, ' ')}${r.affected_areas.length ? ` · affected: ${r.affected_areas.join(', ')}` : ''}`}
      actions={<div className="m2-row"><Badge tone="neutral">Short {fmtKg(r.shortfall_kg)}</Badge><Badge tone="ok">Filled {fmtKg(r.filled_kg)}</Badge><StatusBadge status={r.status} />
        {isOps && open && <Button variant="ghost" busy={busy} onClick={() => run(() => api.post(`/recovery-requests/${r.id}/close`), 'Recovery closed')}>Close</Button>}</div>}>
      <div className="m2-grid m2-grid-2">
        <div>
          <h3 style={{ marginBottom: 8 }}>Candidate FPOs ({r.ranking_mode === 'rating' ? 'by rating' : 'first come, first served'})</h3>
          <Table rows={r.candidates} rowKey={(c) => c.fpo_id} empty="No FPO outside the affected area has spare capacity." columns={[
            { key: 'rank', label: '#', render: (c) => c.rank },
            { key: 'n', label: 'FPO', render: (c) => <>{c.name}<div className="m2-small m2-muted">{c.taluka}{c.is_new && ' · new'}</div></> },
            { key: 'cap', label: 'Spare', align: 'right', render: (c) => fmtKg(c.spare_capacity_kg) },
            { key: 'why', label: 'Why this order', render: (c) => <span className="m2-small">{c.reason} · rating {c.rating}</span> },
            { key: 'b', label: '', render: (c) => isOps && open && remaining > 0 && !r.offers.some((o) => o.fpo_id === c.fpo_id && o.status === 'OFFERED') &&
              <Button size="sm" onClick={() => setOfferFor(c)}>Offer</Button> },
          ]} />
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Offers</h3>
          <Table rows={r.offers.map((o, i) => ({ ...o, id: i }))} empty="No offers yet." columns={[
            { key: 'n', label: 'FPO', render: (o) => o.fpo_name },
            { key: 'kg', label: 'Offered', align: 'right', render: (o) => fmtKg(o.kg) },
            { key: 'st', label: 'Status', render: (o) => <><StatusBadge status={o.status} />{o.note && <div className="m2-small m2-muted">{o.note}</div>}</> },
            { key: 'b', label: '', render: (o) => o.status === 'OFFERED' && (auth.role === 'admin' || (auth.role === 'fpo' && auth.actorId === o.fpo_id)) &&
              <Button size="sm" variant="primary" onClick={() => setRespond(o)}>Respond</Button> },
          ]} />
        </div>
      </div>
      {offerFor && <OfferModal r={r} c={offerFor} remaining={remaining} onClose={() => setOfferFor(null)} />}
      {respond && <RespondModal r={r} o={respond} onClose={() => setRespond(null)} />}
    </Panel>
  )
}

function OfferModal({ r, c, remaining, onClose }) {
  const { api } = useM2()
  const { run, busy } = useAction()
  const [kg, setKg] = useState(Math.min(remaining, c.spare_capacity_kg))
  return (
    <Modal title={`Offer to ${c.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" busy={busy} onClick={async () => { if (await run(() => api.post(`/recovery-requests/${r.id}/offers`, { fpo_id: c.fpo_id, kg: Number(kg) }), 'Offer sent by SMS')) onClose() }}>Send offer</Button></>}>
      <Field label="Quantity (kg)" hint={`Up to ${fmtKg(Math.min(remaining, c.spare_capacity_kg))}: remaining shortfall and the FPO's spare capacity.`}>
        <input className="m2-input" type="number" min="1" value={kg} onChange={(e) => setKg(e.target.value)} /></Field>
    </Modal>
  )
}

function RespondModal({ r, o, onClose }) {
  const { api } = useM2()
  const { run, busy } = useAction()
  const farmers = useLoad(() => api.get('/farmers', { fpo_id: o.fpo_id }), [o.fpo_id])
  const [alloc, setAlloc] = useState({})
  const [signed, setSigned] = useState(false)
  const [note, setNote] = useState('')
  const allocations = Object.entries(alloc).filter(([, kg]) => Number(kg) > 0).map(([farmer_id, kg]) => ({ farmer_id, kg: Number(kg) }))
  const total = allocations.reduce((s, a) => s + a.kg, 0)
  const send = (accepted) => run(() => api.post(`/recovery-requests/${r.id}/offers/${o.fpo_id}/response`,
    { accepted, signed_in_person: accepted && signed, allocations: accepted ? allocations : [], note }), accepted ? 'Accepted; agreement updated' : 'Offer declined')
  return (
    <Modal title={`Respond to offer: ${fmtKg(o.kg)}`} onClose={onClose} footer={<>
      <Button variant="danger" busy={busy} onClick={async () => { if (await send(false)) onClose() }}>Decline</Button>
      <Button variant="primary" busy={busy} disabled={!signed || total !== o.kg} onClick={async () => { if (await send(true)) onClose() }}>Accept with signatures</Button></>}>
      <div className="m2-form">
        <Banner tone="info">As in Module 1: brief the farmers in person, collect paper signatures, then record each farmer's quantity here.</Banner>
        <Async state={farmers}>{(rows) => (
          <table className="m2-table"><thead><tr><th>Member</th><th>Village</th><th>Kg</th></tr></thead>
            <tbody>{rows.map((f) => <tr key={f.id}><td>{f.name}</td><td>{f.village}</td>
              <td><input className="m2-input" type="number" min="0" style={{ width: 110 }} value={alloc[f.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [f.id]: e.target.value })} /></td></tr>)}</tbody></table>)}</Async>
        <div className={total === o.kg ? 'm2-small' : 'm2-small m2-muted'}>Allocated {fmtKg(total)} of {fmtKg(o.kg)}</div>
        <label className="m2-check"><input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} />Farmers were briefed in person and signed on paper</label>
        <Field label="Note"><input className="m2-input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
