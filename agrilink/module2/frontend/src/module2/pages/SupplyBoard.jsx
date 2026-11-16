import { Link, useNavigate } from 'react-router-dom'
import { useLoad, useM2 } from '../context.jsx'
import { Async, Badge, PageHeader, Panel, Stat, StatusBadge, SupplyBar, SupplyLegend, Table } from '../components/ui.jsx'
import { fmtDate, fmtKg, fmtPct } from '../format.js'

/** Module 2 home: supply assurance for every activated agreement, and what needs attention now. */
export default function SupplyBoard() {
  const { api, auth, to } = useM2()
  const nav = useNavigate()
  const agreements = useLoad(() => api.get('/agreements'), [auth.role, auth.actorId])
  const canOps = ['admin', 'fpo', 'doctor'].includes(auth.role)
  const attention = useLoad(async () => {
    if (!canOps) return null
    const [checks, visits, interventions, risks] = await Promise.all([
      api.get('/quality-checks', { status: 'MISSED' }), api.get('/doctor-visits', { status: 'SCHEDULED' }),
      api.get('/interventions'), auth.role === 'doctor' ? Promise.resolve([]) : api.get('/risks', { status: 'OPEN' }),
    ])
    return { missed: checks, visits, interventions: interventions.filter((i) => ['OPEN', 'IN_PROGRESS'].includes(i.status)), risks }
  }, [auth.role, auth.actorId])

  return (
    <div className="m2-page">
      <PageHeader title="Supply assurance" crumb="Module 2 · Farm management & supply assurance">
        Every agreement handed over from Module 1, from the first photo check to handover at the Indian port and payment.
        Expected supply falls when quality fails, risks hit or farmers withdraw.
      </PageHeader>
      <Async state={agreements}>{(rows) => {
        const totals = rows.reduce((t, a) => ({ order: t.order + a.supply.order_kg, exp: t.exp + a.supply.expected_kg,
          del: t.del + a.supply.delivered_kg, pass: t.pass + a.supply.quality.PASS, farmers: t.farmers + a.supply.farmers }),
        { order: 0, exp: 0, del: 0, pass: 0, farmers: 0 })
        return (
          <div className="m2-stack">
            <div className="m2-grid m2-grid-4">
              <Stat label="Agreements in Module 2" value={rows.length} note={`${rows.filter((a) => ['ACTIVE', 'HARVESTING'].includes(a.status)).length} in monitoring`} />
              <Stat label="Expected vs ordered" value={fmtPct(totals.order ? (100 * totals.exp) / totals.order : 0)}
                note={`${fmtKg(totals.exp)} of ${fmtKg(totals.order)}`} tone={totals.exp < 0.95 * totals.order ? 'bad' : undefined} />
              <Stat label="Delivered to collection" value={fmtKg(totals.del)} note="Graded at or above contract grade" />
              <Stat label="Farmers passing quality" value={`${totals.pass} / ${totals.farmers}`} note="Latest review per commitment" />
            </div>
            <Panel title="Agreements" sub="Click a row for commitments, harvest, escrow and the trace record." actions={<SupplyLegend />} flush>
              <Table rows={rows} onRowClick={(a) => nav(to(`agreements/${a.id}`))} empty="No agreements yet. Module 1 hands them over when they are activated."
                columns={[
                  { key: 'id', label: 'Agreement', render: (a) => <><strong>{a.id}</strong><div className="m2-small m2-muted">{a.buyer_name}</div></> },
                  { key: 'status', label: 'Stage', render: (a) => <StatusBadge status={a.status} /> },
                  { key: 'grade', label: 'Grade', render: (a) => `${a.required_grade} or better` },
                  { key: 'window', label: 'Harvest window', render: (a) => <span className="m2-nowrap">{fmtDate(a.harvest_window.start)} – {fmtDate(a.harvest_window.end)}</span> },
                  { key: 'supply', label: 'Supply', width: 200, render: (a) => <>
                    <SupplyBar order={a.supply.order_kg} expected={a.supply.expected_kg} delivered={a.supply.delivered_kg} />
                    <div className="m2-small m2-muted" style={{ marginTop: 4 }}>{fmtKg(a.supply.expected_kg)} expected of {fmtKg(a.supply.order_kg)}</div></> },
                  { key: 'q', label: 'Quality', render: (a) => <div className="m2-row">
                    <Badge tone="ok">{a.supply.quality.PASS} pass</Badge>
                    {a.supply.quality.FAIL > 0 && <Badge tone="bad">{a.supply.quality.FAIL} fail</Badge>}
                    {a.supply.quality.PENDING_DOCTOR + a.supply.quality.RETAKE_PHOTO + a.supply.quality.NONE > 0 &&
                      <Badge tone="warn">{a.supply.quality.PENDING_DOCTOR + a.supply.quality.RETAKE_PHOTO + a.supply.quality.NONE} pending</Badge>}</div> },
                  { key: 'escrow', label: 'Escrow', render: (a) => <StatusBadge status={a.escrow_status} /> },
                ]} />
            </Panel>
          </div>
        )
      }}</Async>
      {canOps && <div style={{ marginTop: 16 }}><Async state={attention}>{(a) => a && (
        <div className="m2-grid m2-grid-2">
          <Panel title="Needs attention: quality" sub="Missed photo checks escalated to the farmer doctor, and open interventions." flush>
            <Table rows={[...a.missed.map((c) => ({ id: c.id, kind: 'Missed photo check', who: c.farmer_name, farmer: c.farmer_id, status: 'MISSED' })),
              ...a.interventions.map((i) => ({ id: i.id, kind: 'Intervention', who: i.farmer_name, farmer: i.farmer_id, status: i.status }))]}
              empty="Nothing waiting."
              columns={[{ key: 'kind', label: 'Item' }, { key: 'who', label: 'Farmer', render: (r) => <Link to={to(`farmers/${r.farmer}`)}>{r.who}</Link> },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'go', label: '', render: (r) => <Link to={to(r.kind === 'Intervention' ? 'reviews' : 'visits')}>Open</Link> }]} />
          </Panel>
          <Panel title="Needs attention: visits and risks" sub="Priority farmer doctor visits and risk alerts not yet assessed." flush>
            <Table rows={[...a.visits.filter((v) => v.priority).map((v) => ({ id: v.id, kind: 'Priority visit', what: `${v.farmer_name} · ${v.doctor_name}`, link: 'visits' })),
              ...a.risks.map((r) => ({ id: r.id, kind: r.type_label, what: `${r.severity} · ${r.areas.join(', ')}`, link: 'risks' }))]}
              empty="Nothing waiting."
              columns={[{ key: 'kind', label: 'Item' }, { key: 'what', label: 'Detail' }, { key: 'go', label: '', render: (r) => <Link to={to(r.link)}>Open</Link> }]} />
          </Panel>
        </div>
      )}</Async></div>}
    </div>
  )
}
