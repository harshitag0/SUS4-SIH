import { Link, useParams } from 'react-router-dom'
import { useLoad, useM2 } from '../context.jsx'
import { Async, Badge, KV, PageHeader, Panel, StatusBadge, Table } from '../components/ui.jsx'
import { fmtDateTime, fmtKg } from '../format.js'

export default function FarmerProfile() {
  const { id } = useParams()
  const { api, to } = useM2()
  const state = useLoad(() => api.get(`/farmers/${id}`), [id])
  return (
    <div className="m2-page">
      <Async state={state}>{(f) => (
        <>
          <PageHeader crumb="Farmer" title={f.name}>{f.village}, {f.taluka} taluka · {f.fpo.name}</PageHeader>
          <div className="m2-grid m2-grid-2" style={{ marginBottom: 16 }}>
            <Panel title="Profile"><KV items={[['Orchard', `${f.orchard_ha} ha · ${f.trees} trees`], ['Messages by', f.channel], ['Language', f.language],
              ['Farmer doctor visits', `every ${f.fpo.visit_interval_days} days`], ['Consent recorded', f.consent_recorded ? 'Yes' : 'No'],
              f.synthetic && ['Data', <Badge tone="info">Pre-registered</Badge>]]} /></Panel>
            <Panel title="Rating history" flush>
              <Table rows={f.ratings} rowKey={(r) => r.period} empty="Not rated yet." columns={[
                { key: 'p', label: 'Month', render: (r) => r.period }, { key: 'm', label: 'Month score', align: 'right', render: (r) => r.month_score ?? '—' },
                { key: 'r', label: 'Rating', align: 'right', render: (r) => <strong>{r.rating}</strong> }]} />
            </Panel>
          </div>
          <div className="m2-stack">
            <Panel title="Commitments" flush>
              <Table rows={f.commitments} columns={[
                { key: 'a', label: 'Agreement', render: (c) => <Link to={to(`agreements/${c.agreement_id}`)}>{c.agreement_id}</Link> },
                { key: 'k', label: 'Committed / expected / delivered', render: (c) => `${fmtKg(c.committed_kg)} / ${fmtKg(c.projected_kg)} / ${fmtKg(c.delivered_kg)}` },
                { key: 'q', label: 'Quality', render: (c) => <StatusBadge status={c.quality_status} /> }, { key: 's', label: 'Status', render: (c) => <StatusBadge status={c.status} /> }]} />
            </Panel>
            <div className="m2-grid m2-grid-2">
              <Panel title="Recent reviews" flush>
                <Table rows={f.reviews} columns={[{ key: 'at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
                  { key: 's', label: 'Decision', render: (r) => <StatusBadge status={r.status} /> },
                  { key: 'g', label: 'Grades', render: (r) => <span className="m2-small">{r.final_grade ? `Final ${r.final_grade}` : ''}{r.provisional_grade ? ` · AI ${r.provisional_grade}` : ''}</span> }]} />
              </Panel>
              <Panel title="Farmer doctor visits" flush>
                <Table rows={f.visits} columns={[{ key: 'due', label: 'Due', render: (v) => fmtDateTime(v.due_at) },
                  { key: 's', label: 'Status', render: (v) => <StatusBadge status={v.status} /> },
                  { key: 'g', label: 'Finding', render: (v) => v.finding ? `Grade ${v.finding.grade}` : '—' }]} />
              </Panel>
            </div>
          </div>
        </>
      )}</Async>
    </div>
  )
}
