import { useParams } from 'react-router-dom'
import { useLoad, useM2 } from '../context.jsx'
import { Async, Badge, KV, PageHeader, Panel, StatusBadge } from '../components/ui.jsx'
import { fmtDateTime, fmtKg } from '../format.js'

/** Public page behind a lot's QR code: what a buyer sees on scanning. */
export default function LotTrace() {
  const { lotId } = useParams()
  const { api } = useM2()
  const state = useLoad(() => api.get(`/trace/lots/${lotId}`), [lotId])
  return (
    <div className="m2-page" style={{ maxWidth: 900 }}>
      <Async state={state}>{(t) => (
        <>
          <PageHeader crumb="Lot trace record" title={`Lot ${t.lot.id}`}>
            {t.agreement.variety} for {t.agreement.buyer} · collected by {t.fpo}
          </PageHeader>
          <div className="m2-grid m2-grid-2" style={{ marginBottom: 16 }}>
            <Panel title="Lot">
              <KV items={[['Quantity', fmtKg(t.lot.total_kg)], ['Grade mix', Object.entries(t.lot.grade_mix).map(([g, k]) => `${g}: ${k} kg`).join(' · ')],
                ['Contract grade', `${t.agreement.required_grade} or better`], ['Status', <StatusBadge status={t.lot.status} />],
                ['Collected', fmtDateTime(t.lot.collected_at)], ['Handed over', t.lot.handed_over_at ? `${fmtDateTime(t.lot.handed_over_at)} · ${t.lot.handover_port}` : '—'],
                ['Farmers', t.lot.contributions.map((c) => `${c.farmer_name} (${c.kg} kg, ${c.grade})`).join('; ')]]} />
            </Panel>
            <Panel title="Record integrity">
              <div className="m2-stack" style={{ gap: 8 }}>
                {t.chain.ok ? <Badge tone="ok">Hash chain verified · {t.chain.checked} events</Badge> : <Badge tone="bad">Chain broken at {t.chain.broken_at}</Badge>}
                <span className="m2-small m2-muted">Each event stores a SHA-256 hash of the previous one, so a changed record is detected. The chain head would be anchored on Ethereum (planned).</span>
                {t.chain.head && <span className="m2-mono m2-small" style={{ wordBreak: 'break-all' }}>{t.chain.head}</span>}
                <span style={{ width: 120 }} dangerouslySetInnerHTML={{ __html: t.lot.qr_svg.replace('<svg ', '<svg width="120" height="120" ') }} />
              </div>
            </Panel>
          </div>
          <Panel title="Journey" flush sub="Quality checks of the contributing farmers, collection, handover and receipt.">
            <ul className="m2-timeline">{t.events.map((e) => (
              <li key={e.id}><div><div className="m2-stage">{e.stage.replace(/_/g, ' ')}</div><div className="m2-small m2-muted">{fmtDateTime(e.at)}</div></div>
                <div>{e.summary}</div></li>))}</ul>
          </Panel>
        </>
      )}</Async>
    </div>
  )
}
