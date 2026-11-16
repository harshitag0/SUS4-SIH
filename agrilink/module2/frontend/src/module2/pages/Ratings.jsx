import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAction, useLoad, useM2 } from '../context.jsx'
import { Async, Badge, Banner, Button, PageHeader, Panel, Table, Tabs } from '../components/ui.jsx'
import { fmtDateTime } from '../format.js'

const FARMER_COLS = { fulfilment: 'Fulfilment', quality: 'Quality', on_time_delivery: 'On time', responsiveness: 'Photos on time', commitment: 'Commitment', buyer_review: 'Buyer review' }
const BUYER_COLS = { on_time_payment: 'Pays on time', order_commitment: 'Keeps orders', fair_grading: 'Fair disputes', responsiveness: 'Responds in window', farmer_review: 'Farmer review' }

/** Monthly ratings, computed from Module 2's own records. Module 1 reads them for ranking. */
export default function Ratings() {
  const { api, auth, meta, to } = useM2()
  const { run, busy } = useAction()
  const [tab, setTab] = useState(auth.role === 'buyer' ? 'buyer' : 'farmer')
  const status = useLoad(() => api.get('/ratings/status'), [])
  const rows = useLoad(() => api.get(`/ratings/${tab}`), [tab, auth.role, auth.actorId])
  const period = meta?.now?.slice(0, 7)
  const cols = tab === 'farmer' ? FARMER_COLS : BUYER_COLS
  return (
    <div className="m2-page">
      <PageHeader title="Monthly ratings" crumb="Delivery, payment & ratings" actions={auth.role === 'admin' && period &&
        <Button variant="primary" busy={busy} onClick={() => run(() => api.post('/ratings/run', { period }), `Ratings updated for ${period}`)}>Update ratings for {period}</Button>}>
        Every input is counted from records: photo checks, doctor-confirmed grades, deliveries, withdrawals, escrow timing,
        disputes and two-way reviews. Weather and pest shortfalls are exempt. Ratings smooth month to month.
      </PageHeader>
      <Async state={status}>{(s) => <div style={{ marginBottom: 16 }}><Banner tone={s.live ? 'ok' : 'info'}>
        {s.live ? <>Ratings now <strong>drive ranking</strong> in Module 1 and supply recovery (since {s.switch_on}).</>
          : <>Pilot phase: ratings are <strong>recorded only</strong>. Ranking stays first come, first served until {s.switch_on}, 6 months after the pilot start ({s.pilot_start}).</>}
        {' '}Weights are illustrative.</Banner></div>}</Async>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'farmer', label: 'Farmers' }, { id: 'buyer', label: 'Buyers' }]} />
      <Panel flush>
        <Async state={rows}>{(data) => (
          <Table rows={data} rowKey={(r) => r.subject_id} empty="No ratings yet. Run the monthly update." columns={[
            { key: 'n', label: tab === 'farmer' ? 'Farmer' : 'Buyer', render: (r) => tab === 'farmer'
              ? <><Link to={to(`farmers/${r.subject_id}`)}>{r.name}</Link><div className="m2-small m2-muted">{r.fpo_id}</div></> : r.name },
            { key: 'rating', label: 'Rating', align: 'right', render: (r) => <strong>{r.rating}</strong> },
            { key: 'month', label: `Month ${data[0]?.period || ''}`, align: 'right', render: (r) => r.month_score ?? '—' },
            ...Object.entries(cols).map(([k, label]) => ({ key: k, label, align: 'right',
              render: (r) => r.components[k] === null || r.components[k] === undefined ? <span className="m2-faint">—</span> : `${Math.round(r.components[k] * 100)}%` })),
            { key: 'new', label: '', render: (r) => r.is_new && <Badge tone="warn" title="Fewer than 2 rated months: gets the 20% new-farmer reserve">New</Badge> },
            { key: 'at', label: 'Updated', render: (r) => <span className="m2-small">{r.period} · {fmtDateTime(r.computed_at)}</span> },
          ]} />
        )}</Async>
      </Panel>
    </div>
  )
}
