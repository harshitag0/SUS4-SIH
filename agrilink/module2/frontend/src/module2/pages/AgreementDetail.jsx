import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAction, useLoad, useM2 } from '../context.jsx'
import { Async, Badge, Banner, Button, Field, KV, Modal, PageHeader, Panel, Sim, Stat, StatusBadge, SupplyBar, SupplyLegend, Table, Tabs } from '../components/ui.jsx'
import { fmtDate, fmtDateTime, fmtKg, fmtMoney, humanise, relHours } from '../format.js'

const STAGES = ['ACTIVE', 'HARVESTING', 'READY_FOR_DISPATCH', 'FUNDED', 'DISPATCHED', 'RECEIVED', 'COMPLETE']
const STAGE_LABEL = { ACTIVE: 'Monitoring', HARVESTING: 'Harvest & collection', READY_FOR_DISPATCH: 'Ready', FUNDED: 'Tranche 2 funded',
  DISPATCHED: 'Handed over at port', RECEIVED: 'Received in SG', COMPLETE: 'Closed' }

export default function AgreementDetail() {
  const { id } = useParams()
  const { api, meta } = useM2()
  const [tab, setTab] = useState('commitments')
  const state = useLoad(() => api.get(`/agreements/${id}`), [id])
  return (
    <div className="m2-page">
      <Async state={state}>{(a) => (
        <>
          <PageHeader crumb={<><Link to="..">Supply assurance</Link> / {a.id}</>} title={`${a.id} · ${a.buyer_name}`}>
            {fmtKg(a.quantity_kg)} {a.variety}, grade {a.required_grade} or better · harvest {fmtDate(a.harvest_window.start)} – {fmtDate(a.harvest_window.end)} ·
            dispatch by {fmtDate(a.dispatch_deadline)}
          </PageHeader>
          <Stages status={a.status} />
          <div className="m2-grid m2-grid-4" style={{ margin: '16px 0' }}>
            <Stat label="Expected supply" value={fmtKg(a.supply.expected_kg)} note={`${a.supply.fill_expected_pct}% of the order`}
              tone={a.supply.expected_kg < 0.95 * a.supply.order_kg ? 'bad' : undefined} />
            <Stat label="Delivered (contract grade)" value={fmtKg(a.supply.delivered_kg)} note={`${a.supply.fill_delivered_pct}% of the order`} />
            <Stat label="Farmers" value={a.supply.farmers} note={`${a.supply.quality.PASS} passing · ${a.supply.withdrawn} withdrawn`} />
            <Stat label="Escrow paid to FPO" value={fmtMoney(a.escrow.paid_to_fpo, a.currency)} note={`${fmtMoney(a.escrow.held, a.currency)} held · ${humanise(a.escrow.status)}`} />
          </div>
          {a.supply.expected_kg < 0.95 * a.supply.order_kg && ['ACTIVE', 'HARVESTING'].includes(a.status) &&
            <div style={{ marginBottom: 16 }}><Banner tone="warn">Expected supply is below 95% of the order. Operations can open supply recovery from the Risks or Supply recovery page.</Banner></div>}
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'commitments', label: 'Commitments', count: a.commitments.length },
            { id: 'harvest', label: 'Harvest & lots', count: a.lots.length },
            { id: 'escrow', label: 'Escrow & receipt' },
            { id: 'timeline', label: 'Trace record' },
          ]} />
          {tab === 'commitments' && <Commitments a={a} />}
          {tab === 'harvest' && <Harvest a={a} />}
          {tab === 'escrow' && <Escrow a={a} meta={meta} />}
          {tab === 'timeline' && <Timeline id={a.id} />}
        </>
      )}</Async>
    </div>
  )
}

function Stages({ status }) {
  const idx = status === 'DISPUTED' ? 5 : status === 'REFUNDED' ? 6 : STAGES.indexOf(status)
  return (
    <ol className="m2-steps" aria-label="Agreement stage">
      {STAGES.map((s, i) => (
        <li key={s} className={i < idx ? 'm2-done' : i === idx ? 'm2-current' : ''}>
          {i === idx && status === 'DISPUTED' ? 'Disputed' : i === idx && status === 'REFUNDED' ? 'Closed (refunded)' : STAGE_LABEL[s]}
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------ commitments */
function Commitments({ a }) {
  const { api, auth, to } = useM2()
  const { run, busy } = useAction()
  const [withdraw, setWithdraw] = useState(null)
  const [reason, setReason] = useState('')
  const canWithdraw = (c) => c.status === 'ACTIVE' && c.delivered_kg === 0 && (auth.role === 'admin' || (auth.role === 'fpo' && auth.actorId === c.fpo_id))
  return (
    <Panel title="Signed farmer commitments" sub="Signed on paper with the FPO (Module 1). Quality status is the latest review: AI result plus farmer doctor." actions={<SupplyLegend />} flush>
      <Table rows={a.commitments} columns={[
        { key: 'farmer', label: 'Farmer', render: (c) => <><Link to={to(`farmers/${c.farmer_id}`)}>{c.farmer_name}</Link>
          <div className="m2-small m2-muted">{c.fpo_name} · {c.taluka}{c.source === 'recovery' && ' · added by recovery'}</div></> },
        { key: 'kg', label: 'Committed / expected / delivered', width: 230, render: (c) => <>
          <SupplyBar order={c.committed_kg} expected={c.status === 'WITHDRAWN' ? 0 : c.projected_kg} delivered={c.delivered_kg} />
          <div className="m2-small m2-muted" style={{ marginTop: 4 }}>{c.committed_kg} / {c.status === 'WITHDRAWN' ? 0 : c.projected_kg} / {c.delivered_kg} kg
            {c.exempt_shortfall_kg > 0 && <> · {c.exempt_shortfall_kg} kg weather/pest exempt</>}</div></> },
        { key: 'q', label: 'Quality', render: (c) => <div className="m2-row"><StatusBadge status={c.quality_status} />
          {c.final_grade && <Badge>Grade {c.final_grade === 'REJECT' ? 'Reject' : c.final_grade}</Badge>}{!c.final_grade && c.provisional_grade && <Badge tone="neutral">AI: {c.provisional_grade}</Badge>}</div> },
        { key: 'status', label: 'Status', render: (c) => <><StatusBadge status={c.status} />{c.withdrawal && <div className="m2-small m2-muted">{c.withdrawal.reason}</div>}</> },
        { key: 'act', label: '', render: (c) => canWithdraw(c) && <Button size="sm" variant="ghost" onClick={() => { setWithdraw(c); setReason('') }}>Withdrawal…</Button> },
      ]} />
      {withdraw && (
        <Modal title={`Withdrawal: ${withdraw.farmer_name}`} onClose={() => setWithdraw(null)} footer={<>
          <Button onClick={() => setWithdraw(null)}>Cancel</Button>
          <Button variant="danger" busy={busy} disabled={reason.trim().length < 3} onClick={async () => {
            if (await run(() => api.post(`/commitments/${withdraw.id}/withdraw`, { reason }), 'Withdrawal recorded')) setWithdraw(null)
          }}>Record withdrawal</Button></>}>
          <div className="m2-form">
            <Banner tone="warn">Farmers may still sell locally. A signed farmer who backs out lowers the expected supply and counts against their commitment rating (not weather-exempt).</Banner>
            <Field label="Reason given by the farmer"><textarea className="m2-textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sold the crop to a local trader" /></Field>
          </div>
        </Modal>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------ harvest & lots */
function Harvest({ a }) {
  const { api, auth, to } = useM2()
  const { run, busy } = useAction()
  const plan = useLoad(() => api.get(`/agreements/${a.id}/harvest-plan`), [a.id, a.status])
  const [lotOpen, setLotOpen] = useState(false)
  const [port, setPort] = useState('Mumbai air cargo terminal (CSMIA)')
  const isFpo = auth.role === 'admin' || (auth.role === 'fpo' && a.fpo_ids.includes(auth.actorId))
  return (
    <div className="m2-stack">
      {isFpo && (
        <Panel title="Next step for the FPO" sub="Coordinate harvest & collection, then hand over at the Indian port.">
          <div className="m2-row">
            {['ACTIVE', 'HARVESTING'].includes(a.status) &&
              <Button variant={a.status === 'ACTIVE' ? 'primary' : 'secondary'} busy={busy}
                onClick={() => run(() => api.post(`/agreements/${a.id}/harvest-notice`), 'Harvest notice sent to eligible farmers')}>
                {a.status === 'ACTIVE' ? 'Open harvest & notify eligible farmers' : 'Resend harvest notice'}</Button>}
            {a.status === 'HARVESTING' && <Button variant="primary" onClick={() => setLotOpen(true)}>Record collected lot</Button>}
            {a.status === 'HARVESTING' && a.lots.length > 0 &&
              <Button busy={busy} onClick={() => run(() => api.post(`/agreements/${a.id}/ready-for-dispatch`), 'Buyer asked to fund tranche 2')}>Mark ready for dispatch</Button>}
            {a.status === 'READY_FOR_DISPATCH' && <Banner tone="info">Waiting for the buyer to fund tranche 2 into escrow. Handover is blocked until then.</Banner>}
            {a.status === 'FUNDED' && <>
              <input className="m2-input" style={{ maxWidth: 320 }} value={port} onChange={(e) => setPort(e.target.value)} aria-label="Port of handover" />
              <Button variant="primary" busy={busy} onClick={() => run(() => api.post(`/agreements/${a.id}/handover`, { port }), 'Handed over at port')}>Hand over at port</Button></>}
            {['DISPATCHED', 'RECEIVED', 'DISPUTED', 'COMPLETE', 'REFUNDED'].includes(a.status) &&
              <span className="m2-muted">Handed over at {a.handover_port} on {fmtDateTime(a.dispatched_at)}. Quality responsibility ended there.</span>}
          </div>
        </Panel>
      )}
      <Panel title="Harvest plan" sub="Only farmers whose latest review is PASS can deliver. Pick dates are staggered across the window." flush>
        <Async state={plan}>{(p) => (
          <Table rows={p.rows} rowKey={(r) => r.commitment_id} columns={[
            { key: 'f', label: 'Farmer', render: (r) => <Link to={to(`farmers/${r.farmer_id}`)}>{r.farmer_name}</Link> },
            { key: 'taluka', label: 'Taluka' },
            { key: 'pick', label: 'Suggested pick', render: (r) => fmtDate(r.suggested_pick_date) },
            { key: 'rem', label: 'Remaining', align: 'right', render: (r) => fmtKg(r.remaining_kg) },
            { key: 'q', label: 'Quality', render: (r) => <div className="m2-row"><StatusBadge status={r.quality_status} />{r.final_grade && <Badge>Grade {r.final_grade}</Badge>}</div> },
            { key: 'e', label: 'Collection', render: (r) => r.eligible ? <Badge tone="ok">Eligible</Badge> : <span className="m2-small m2-muted">{r.blocker}</span> },
          ]} />
        )}</Async>
      </Panel>
      <Panel title="Lots" sub="Each lot gets a QR code that opens its trace record (buyer scan)." flush>
        <Table rows={a.lots} empty="No lots recorded yet." columns={[
          { key: 'id', label: 'Lot', render: (l) => <Link to={to(`trace/${l.id}`)}><span className="m2-mono">{l.id}</span></Link> },
          { key: 'fpo', label: 'FPO', render: (l) => l.fpo_id },
          { key: 'kg', label: 'Accepted', align: 'right', render: (l) => fmtKg(l.total_kg) },
          { key: 'mix', label: 'Grade mix', render: (l) => Object.entries(l.grade_mix).map(([g, kg]) => `${g}: ${kg} kg`).join(' · ') },
          { key: 'div', label: 'Returned (below grade)', render: (l) => l.diverted.length ? fmtKg(l.diverted.reduce((s, d) => s + d.kg, 0)) : '—' },
          { key: 'st', label: 'Status', render: (l) => <StatusBadge status={l.status} /> },
          { key: 'at', label: 'Collected', render: (l) => fmtDateTime(l.collected_at) },
          { key: 'qr', label: 'QR', render: (l) => <span style={{ display: 'inline-block', width: 56 }} dangerouslySetInnerHTML={{ __html: l.qr_svg.replace('<svg ', '<svg width="56" height="56" ') }} /> },
        ]} />
      </Panel>
      {lotOpen && <LotModal a={a} plan={plan.data} onClose={() => setLotOpen(false)} />}
    </div>
  )
}

function LotModal({ a, plan, onClose }) {
  const { api, auth } = useM2()
  const { run, busy } = useAction()
  const fpos = auth.role === 'fpo' ? [auth.actorId] : a.fpo_ids
  const [fpo, setFpo] = useState(fpos[0])
  const rows = useMemo(() => (plan?.rows || []).filter((r) => r.fpo_id === fpo && r.eligible && r.remaining_kg > 0), [plan, fpo])
  const [vals, setVals] = useState({})
  const set = (id, k, v) => setVals((s) => ({ ...s, [id]: { ...s[id], [k]: v } }))
  const contributions = rows.filter((r) => Number(vals[r.farmer_id]?.kg) > 0)
    .map((r) => ({ farmer_id: r.farmer_id, kg: Number(vals[r.farmer_id].kg), grade: vals[r.farmer_id]?.grade || a.required_grade }))
  return (
    <Modal title="Record collected lot" onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" busy={busy} disabled={!contributions.length} onClick={async () => {
        if (await run(() => api.post(`/agreements/${a.id}/lots`, { fpo_id: fpo, contributions }), 'Lot recorded')) onClose()
      }}>Record lot</Button></>}>
      <div className="m2-form">
        {fpos.length > 1 && <Field label="Collection point (FPO)"><select className="m2-select" value={fpo} onChange={(e) => setFpo(e.target.value)}>{fpos.map((f) => <option key={f}>{f}</option>)}</select></Field>}
        <p className="m2-small m2-muted" style={{ margin: 0 }}>Weigh each farmer's fruit and grade it at collection. Fruit below grade {a.required_grade} is returned for the local market and does not count as delivered.</p>
        {rows.length === 0 ? <Banner tone="warn">No eligible farmers with remaining quantity at this FPO.</Banner> : (
          <table className="m2-table"><thead><tr><th>Farmer</th><th className="m2-r">Remaining</th><th>Weighed kg</th><th>Collection grade</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.farmer_id}><td>{r.farmer_name}</td><td className="m2-r">{fmtKg(r.remaining_kg)}</td>
                <td><input className="m2-input" type="number" min="0" step="1" style={{ width: 110 }} value={vals[r.farmer_id]?.kg ?? ''} onChange={(e) => set(r.farmer_id, 'kg', e.target.value)} /></td>
                <td><select className="m2-select" style={{ width: 110 }} value={vals[r.farmer_id]?.grade ?? a.required_grade} onChange={(e) => set(r.farmer_id, 'grade', e.target.value)}>
                  <option value="A">A</option><option value="B">B</option><option value="REJECT">Reject</option></select></td></tr>
            ))}</tbody></table>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ escrow */
function Escrow({ a, meta }) {
  const { api, auth } = useM2()
  const { run, busy } = useAction()
  const e = a.escrow
  const isBuyer = auth.role === 'admin' || (auth.role === 'buyer' && auth.actorId === a.buyer_id)
  const isOps = auth.role === 'admin'
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [surveyOpen, setSurveyOpen] = useState(false)
  const now = meta?.now
  const stl = a.settlement
  return (
    <div className="m2-stack">
      {stl && (
        <Panel title="Settlement for the shipped quantity" sub="The buyer pays for what is shipped at contract grade, pro rata to the order and capped at the contract value.">
          <KV items={[['Shipped', `${fmtKg(stl.shipped_kg)} of ${fmtKg(stl.order_kg)} (${Math.round(stl.share * 1000) / 10}%)`],
            ['Payable value', fmtMoney(stl.payable_value, a.currency)], ['Advance paid at signing', fmtMoney(stl.advance_paid, a.currency)],
            ['Tranche 2 due', fmtMoney(stl.tranche2_due, a.currency)],
            stl.advance_excess > 0 && ['Advance excess', <span style={{ color: 'var(--m2-bad)' }}>{fmtMoney(stl.advance_excess, a.currency)} owed back by the FPO (settled outside escrow)</span>]]} />
        </Panel>)}
      <div className="m2-grid m2-grid-3">
        <Stat label="Paid to FPO" value={fmtMoney(e.paid_to_fpo, a.currency)} note="The FPO pays its farmers by quantity and grade" />
        <Stat label="Held in escrow" value={fmtMoney(e.held, a.currency)} />
        <Stat label="Refunded to buyer" value={fmtMoney(e.refunded_to_buyer, a.currency)} />
      </div>
      <Panel title="Buyer and operations actions" sub={<>Pilot flow: 50% at signing (Module 1), 50% funded at dispatch and released when the buyer confirms origin quality or the window passes.</>}>
        <div className="m2-stack">
          {e.status === 'RECEIVED' && <Banner tone="warn">Dispute window closes {fmtDateTime(e.window_ends_at)} ({relHours(e.window_ends_at, now)}). After that, tranche 2 is released automatically.</Banner>}
          {a.status === 'DISPUTED' && <Banner tone="bad">Disputed: {a.dispute.reason}. A third-party surveyor decides whether the cause is origin quality or transit.</Banner>}
          <div className="m2-row">
            {isBuyer && a.status === 'READY_FOR_DISPATCH' && <Button variant="primary" busy={busy} onClick={() => run(() => api.post(`/agreements/${a.id}/escrow/fund`), 'Tranche 2 funded into escrow')}>Fund tranche 2 ({fmtMoney(stl?.tranche2_due ?? 0, a.currency)})</Button>}
            {isBuyer && a.status === 'DISPATCHED' && <Button variant="primary" busy={busy} onClick={() => run(() => api.post(`/agreements/${a.id}/receipt`), 'Receipt recorded; dispute window open')}>Record receipt in Singapore</Button>}
            {isBuyer && a.status === 'RECEIVED' && <>
              <Button variant="primary" busy={busy} onClick={() => run(() => api.post(`/agreements/${a.id}/confirm`), 'Tranche 2 released to the FPO')}>Confirm origin quality</Button>
              <Button variant="danger" onClick={() => setDisputeOpen(true)}>Dispute origin quality</Button></>}
            {isOps && a.status === 'DISPUTED' && <Button variant="primary" onClick={() => setSurveyOpen(true)}>Record surveyor decision</Button>}
            {!['READY_FOR_DISPATCH', 'DISPATCHED', 'RECEIVED', 'DISPUTED'].includes(a.status) && <span className="m2-muted">No payment action at this stage ({humanise(a.status)}).</span>}
          </div>
        </div>
      </Panel>
      <Panel title="Escrow ledger" flush>
        <Table rows={e.ledger.map((l, i) => ({ ...l, id: i }))} columns={[
          { key: 'at', label: 'When', render: (l) => fmtDateTime(l.at) }, { key: 'step', label: 'Step' },
          { key: 'amount', label: 'Amount', align: 'right', render: (l) => l.amount ? fmtMoney(l.amount, a.currency) : '—' },
          { key: 'ref', label: 'Reference', render: (l) => l.ref ? <span className="m2-mono">{l.ref}</span> : '—' }]} />
      </Panel>
      {['COMPLETE', 'REFUNDED'].includes(a.status) && <Feedback a={a} />}
      {disputeOpen && <DisputeModal a={a} onClose={() => setDisputeOpen(false)} />}
      {surveyOpen && <SurveyorModal a={a} onClose={() => setSurveyOpen(false)} />}
    </div>
  )
}

function DisputeModal({ a, onClose }) {
  const { api } = useM2()
  const { run, busy } = useAction()
  const [reason, setReason] = useState('')
  const [lots, setLots] = useState([])
  return (
    <Modal title="Dispute origin quality" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button>
      <Button variant="danger" busy={busy} disabled={reason.trim().length < 5} onClick={async () => {
        if (await run(() => api.post(`/agreements/${a.id}/dispute`, { reason, lot_ids: lots }), 'Dispute raised; surveyor will decide')) onClose()
      }}>Raise dispute</Button></>}>
      <div className="m2-form">
        <Banner tone="info">Only origin quality can be disputed: the grade recorded at the Indian port. Damage in transit is the buyer's risk in this phase.</Banner>
        <Field label="What is wrong with origin quality?"><textarea className="m2-textarea" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Lots affected (leave empty for all)">
          <div className="m2-stack" style={{ gap: 4 }}>{a.lots.map((l) => (
            <label key={l.id} className="m2-check"><input type="checkbox" checked={lots.includes(l.id)} onChange={(e) => setLots(e.target.checked ? [...lots, l.id] : lots.filter((x) => x !== l.id))} />
              <span className="m2-mono">{l.id}</span> · {fmtKg(l.total_kg)}</label>))}</div>
        </Field>
      </div>
    </Modal>
  )
}

function SurveyorModal({ a, onClose }) {
  const { api } = useM2()
  const { run, busy } = useAction()
  const [cause, setCause] = useState('transit')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  return (
    <Modal title="Third-party surveyor decision" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" busy={busy} disabled={name.trim().length < 2} onClick={async () => {
        if (await run(() => api.post(`/agreements/${a.id}/surveyor-decision`, { cause, surveyor: name, note }), 'Decision recorded')) onClose()
      }}>Record decision</Button></>}>
      <div className="m2-form">
        <Field label="Cause found by the surveyor"><select className="m2-select" value={cause} onChange={(e) => setCause(e.target.value)}>
          <option value="transit">Transit damage: buyer's risk, release tranche 2 to the FPO</option>
          <option value="origin_quality">Origin quality fault: refund tranche 2 to the buyer</option></select></Field>
        <Field label="Surveyor (organisation)" hint="The surveyor is not chosen yet; enter who inspected."><input className="m2-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Notes"><textarea className="m2-textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function Feedback({ a }) {
  const { api, auth } = useM2()
  const { run, busy } = useAction()
  const [stars, setStars] = useState(5)
  const [comment, setComment] = useState('')
  const [farmer, setFarmer] = useState('')
  const buyerDone = a.feedback.find((f) => f.direction === 'buyer_to_supply')
  const myFarmers = a.commitments.filter((c) => auth.role === 'admin' || c.fpo_id === auth.actorId)
    .filter((c) => !a.feedback.some((f) => f.direction === 'farmer_to_buyer' && f.from_id === c.farmer_id))
  return (
    <Panel title="Two-way reviews" sub="They feed the monthly ratings: buyer review → farmer rating; farmer review → buyer rating.">
      <div className="m2-stack">
        <Table rows={a.feedback} empty="No reviews yet." columns={[
          { key: 'd', label: 'Direction', render: (f) => f.direction === 'buyer_to_supply' ? 'Buyer → supply' : `Farmer ${f.from_id} → buyer` },
          { key: 's', label: 'Stars', render: (f) => '★'.repeat(f.stars) + '☆'.repeat(5 - f.stars) },
          { key: 'c', label: 'Comment', render: (f) => f.comment || '—' }, { key: 'at', label: 'When', render: (f) => fmtDateTime(f.created_at) }]} />
        {(auth.role === 'buyer' || auth.role === 'admin') && !buyerDone && (
          <div className="m2-row"><StarSelect value={stars} onChange={setStars} />
            <input className="m2-input" style={{ maxWidth: 360 }} placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <Button variant="primary" busy={busy} onClick={() => run(() => api.post(`/agreements/${a.id}/feedback`, { direction: 'buyer_to_supply', stars, comment }), 'Review saved')}>Rate this supply</Button></div>)}
        {(auth.role === 'fpo' || auth.role === 'admin') && myFarmers.length > 0 && (
          <div className="m2-row">
            <select className="m2-select" style={{ maxWidth: 240 }} value={farmer} onChange={(e) => setFarmer(e.target.value)} aria-label="Farmer">
              <option value="">Farmer whose reply you received…</option>{myFarmers.map((c) => <option key={c.farmer_id} value={c.farmer_id}>{c.farmer_name}</option>)}</select>
            <StarSelect value={stars} onChange={setStars} />
            <Button busy={busy} disabled={!farmer} onClick={() => run(() => api.post(`/agreements/${a.id}/feedback`, { direction: 'farmer_to_buyer', farmer_id: farmer, stars, channel: 'sms' }), 'Farmer review recorded').then(() => setFarmer(''))}>Record farmer's SMS reply</Button>
          </div>)}
      </div>
    </Panel>
  )
}

function StarSelect({ value, onChange }) {
  return <select className="m2-select" style={{ width: 120 }} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Stars">
    {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)} ({n})</option>)}</select>
}

/* ------------------------------------------------------------ timeline */
function Timeline({ id }) {
  const { api } = useM2()
  const ev = useLoad(() => api.get(`/agreements/${id}/timeline`), [id])
  const chain = useLoad(() => api.get('/trace/verify'), [id])
  return (
    <Panel title="Trace record" flush actions={<Async state={chain}>{(c) => c.ok
      ? <Badge tone="ok" title={`Head ${c.head}`}>Hash chain verified · {c.checked} events</Badge>
      : <Badge tone="bad">Chain broken at {c.broken_at}</Badge>}</Async>}
      sub="Append-only, SHA-256 hash-chained events. The chain head is what would be anchored on Ethereum.">
      <Async state={ev}>{(rows) => (
        <ul className="m2-timeline">{rows.map((e) => (
          <li key={e.id}><div><div className="m2-stage">{e.stage.replace(/_/g, ' ')}</div><div className="m2-small m2-muted">{fmtDateTime(e.at)}</div></div>
            <div>{e.summary}<div className="m2-small m2-faint m2-mono" title={e.hash}>#{e.seq} · {e.hash.slice(0, 16)}…</div></div></li>))}</ul>
      )}</Async>
    </Panel>
  )
}

