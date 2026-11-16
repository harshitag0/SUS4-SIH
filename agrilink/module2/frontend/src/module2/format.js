// Display helpers. Times are stored in UTC and shown in India Standard Time,
// where the farmers, FPOs and farmer doctors work.
const IST = 'Asia/Kolkata'

export function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}
export function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })
}
export function fmtKg(n) {
  if (n === null || n === undefined) return '—'
  return `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
}
export function fmtMoney(n, currency = 'SGD') {
  if (n === null || n === undefined) return '—'
  return `${currency} ${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}
export function fmtPct(n) {
  if (n === null || n === undefined) return '—'
  return `${Math.round(n * 10) / 10}%`
}
export function relHours(fromIso, nowIso) {
  if (!fromIso || !nowIso) return ''
  const h = (new Date(fromIso) - new Date(nowIso)) / 36e5
  const abs = Math.abs(h)
  const txt = abs < 1 ? `${Math.round(abs * 60)} min` : abs < 48 ? `${Math.round(abs)} h` : `${Math.round(abs / 24)} days`
  return h >= 0 ? `in ${txt}` : `${txt} ago`
}
export function humanise(s) {
  if (!s) return '—'
  return s.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
