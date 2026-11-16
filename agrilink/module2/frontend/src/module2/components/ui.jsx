import { useEffect } from 'react'
import { humanise } from '../format.js'

export function PageHeader({ title, crumb, children, actions }) {
  return (
    <div className="m2-pagehead">
      <div>
        {crumb && <div className="m2-crumb">{crumb}</div>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="m2-actions">{actions}</div>}
    </div>
  )
}

export function Panel({ title, sub, actions, children, flush }) {
  return (
    <section className="m2-panel">
      {(title || actions) && (
        <div className="m2-panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          <div className="m2-spacer" />
          {actions}
        </div>
      )}
      <div className={`m2-panel-body ${flush ? 'm2-flush' : ''}`}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, note, tone }) {
  return (
    <div className="m2-panel m2-stat">
      <div className="m2-stat-label">{label}</div>
      <div className="m2-stat-value" style={tone ? { color: `var(--m2-${tone})` } : undefined}>{value}</div>
      {note && <div className="m2-stat-note">{note}</div>}
    </div>
  )
}

export function Button({ variant = 'secondary', size, busy, children, ...rest }) {
  const cls = ['m2-btn', variant !== 'secondary' && `m2-btn-${variant}`, size === 'sm' && 'm2-btn-sm'].filter(Boolean).join(' ')
  return <button type="button" className={cls} disabled={busy || rest.disabled} {...rest}>{busy ? 'Working…' : children}</button>
}

export function Badge({ tone = 'neutral', children, title }) {
  return <span className={`m2-badge m2-tone-${tone}`} title={title}>{children}</span>
}

const STATUS_TONE = {
  PASS: 'ok', COMPLETED: 'ok', DELIVERED: 'ok', COMPLETE: 'ok', RELEASED: 'ok', VERIFIED: 'ok', FILLED: 'ok',
  ANALYSED: 'ok', ACCEPTED_SIGNED: 'ok', SENT_SIMULATED: 'neutral', CLOSED: 'neutral', CANCELLED: 'neutral',
  FAIL: 'bad', MISSED: 'bad', REFUNDED: 'bad', NOT_EFFECTIVE: 'bad', WITHDRAWN: 'bad', DISPUTED: 'bad',
  UNFILLED: 'bad', SHORT: 'bad', DECLINED: 'neutral',
  PENDING_DOCTOR: 'warn', REMINDED: 'warn', RETAKE_REQUESTED: 'warn', RETAKE_PHOTO: 'warn', OPEN: 'warn',
  IN_PROGRESS: 'info', SCHEDULED: 'info', DUE: 'info', ACTIVE: 'info', HARVESTING: 'info', ASSESSED: 'warn',
  READY_FOR_DISPATCH: 'info', FUNDED: 'info', DISPATCHED: 'info', RECEIVED: 'warn', SIGNED: 'info',
  PARTIAL: 'warn', OFFERED: 'warn', COLLECTED: 'info', HANDED_OVER: 'info',
}
const STATUS_LABEL = {
  PENDING_DOCTOR: 'Awaiting doctor', RETAKE_PHOTO: 'Retake photo', RETAKE_REQUESTED: 'Retake requested',
  READY_FOR_DISPATCH: 'Ready for dispatch', SENT_SIMULATED: 'Sent', ACCEPTED_SIGNED: 'Accepted · signed',
  NOT_EFFECTIVE: 'Not effective', HANDED_OVER: 'Handed over',
}
export function StatusBadge({ status }) {
  if (!status) return <Badge>No review yet</Badge>
  return <Badge tone={STATUS_TONE[status] || 'neutral'}>{STATUS_LABEL[status] || humanise(status)}</Badge>
}

export function Sim({ children = 'SIMULATED' }) {
  return <span className="m2-sim" title="Produced by a simulated adapter, not real-world data">{children}</span>
}

export function Table({ columns, rows, empty = 'Nothing to show.', onRowClick, rowKey = (r) => r.id }) {
  if (!rows || rows.length === 0) return <Empty title={empty} />
  return (
    <div className="m2-tablewrap">
      <table className="m2-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'm2-r' : ''} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r) ?? i} className={onRowClick ? 'm2-clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key} className={c.align === 'right' ? 'm2-r' : ''}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Empty({ title, children }) {
  return <div className="m2-empty"><strong>{title}</strong>{children}</div>
}

export function Loading({ label = 'Loading…' }) {
  return <div className="m2-loading">{label}</div>
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="m2-banner m2-banner-bad" role="alert">
      <span>{error.message || String(error)}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  )
}

export function Banner({ tone = 'info', children }) {
  return <div className={`m2-banner m2-banner-${tone}`}><div>{children}</div></div>
}

/** Standard wrapper for a loaded block: loading, error, then content. */
export function Async({ state, children, label }) {
  if (state.loading && !state.data) return <Loading label={label} />
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.reload} />
  return children(state.data)
}

export function Field({ label, hint, error, children }) {
  return (
    <div className="m2-field">
      {label && <label>{label}</label>}
      {children}
      {error ? <span className="m2-ferr">{error}</span> : hint ? <span className="m2-hint">{hint}</span> : null}
    </div>
  )
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="m2-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="m2-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="m2-modal-head"><h2>{title}</h2><div className="m2-spacer" /><Button variant="ghost" onClick={onClose} aria-label="Close">✕</Button></div>
        <div className="m2-modal-body">{children}</div>
        {footer && <div className="m2-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="m2-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className="m2-tab" onClick={() => onChange(t.id)}>
          {t.label}{t.count !== undefined && <span className="m2-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function SupplyBar({ order, expected, delivered }) {
  const max = Math.max(order, expected, delivered, 1) * 1.05
  const pct = (v) => `${Math.min(100, (v / max) * 100)}%`
  return (
    <div className="m2-supply" title={`Order ${order} kg · expected ${expected} kg · delivered ${delivered} kg`}>
      <span className="m2-s-exp" style={{ width: pct(expected) }} />
      <span className="m2-s-del" style={{ width: pct(delivered) }} />
      <span className="m2-s-mark" style={{ left: pct(order) }} />
    </div>
  )
}

export function SupplyLegend() {
  return (
    <div className="m2-legend">
      <span><i style={{ background: 'var(--m2-accent)' }} />Delivered</span>
      <span><i style={{ background: 'var(--m2-accent-line)' }} />Expected</span>
      <span><i style={{ background: 'var(--m2-ink)', opacity: 0.5, width: 2 }} />Order size</span>
    </div>
  )
}

export function KV({ items }) {
  return (
    <dl className="m2-kv">
      {items.filter(Boolean).map(([k, v]) => [<dt key={`${k}-k`}>{k}</dt>, <dd key={`${k}-v`}>{v ?? '—'}</dd>])}
    </dl>
  )
}
