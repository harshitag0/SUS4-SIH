import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createApi } from './api.js'

const M2Ctx = createContext(null)
const ToastCtx = createContext(null)

/**
 * Module 2 provider. The host passes:
 *   apiBase  - e.g. "http://localhost:8000/api/m2"
 *   auth     - { role, actorId } of the signed-in user (Module 1 supplies this on integration)
 *   basePath - where Module 2's routes are mounted, e.g. "/m2"
 *   getHeaders - optional extra headers from the host (e.g. its own Authorization when a gateway sets identity)
 */
export function M2Provider({ apiBase, auth, basePath = '/m2', getHeaders: hostHeaders, children }) {
  // Kept current during render on purpose: child effects run before parent effects,
  // so the headers must already reflect a role switch when children start loading.
  const authRef = useRef(auth)
  authRef.current = auth
  const hostRef = useRef(hostHeaders)
  hostRef.current = hostHeaders
  const api = useMemo(() => createApi({
    baseUrl: apiBase,
    getHeaders: () => {
      const a = authRef.current || {}
      const h = { ...(hostRef.current ? hostRef.current() : {}) }
      if (a.role) h['X-M2-Role'] = a.role
      if (a.actorId) h['X-M2-Actor'] = a.actorId
      return h
    },
  }), [apiBase])
  const [meta, setMeta] = useState(null)
  const [metaError, setMetaError] = useState(null)
  const [version, setVersion] = useState(0)          // bump to make every page reload its data
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let alive = true
    api.get('/meta').then((m) => { if (alive) { setMeta(m); setMetaError(null) } })
      .catch((e) => { if (alive) setMetaError(e) })
    return () => { alive = false }
  }, [api, version])

  const to = useCallback((p = '') => `${basePath.replace(/\/$/, '')}/${p.replace(/^\//, '')}`.replace(/\/$/, '') || '/', [basePath])
  const value = useMemo(() => ({ api, auth, meta, metaError, version, refresh, to }), [api, auth, meta, metaError, version, refresh, to])
  return (
    <M2Ctx.Provider value={value}>
      <ToastProvider>{children}</ToastProvider>
    </M2Ctx.Provider>
  )
}

export function useM2() {
  const v = useContext(M2Ctx)
  if (!v) throw new Error('useM2 must be used inside <M2Provider>')
  return v
}

function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((text, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setItems((xs) => [...xs, { id, text, tone }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="m2-toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`m2-toast ${t.tone === 'bad' ? 'm2-toast-bad' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

/** Load data; reloads when deps change or when the module data version is bumped. */
export function useLoad(fn, deps = []) {
  const { version } = useM2()
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve().then(fn)
      .then((data) => { if (alive) setState({ data, error: null, loading: false }) })
      .catch((error) => { if (alive) setState({ data: null, error, loading: false }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, tick])
  return { ...state, reload: () => setTick((t) => t + 1) }
}

/** Run a mutating call: shows a toast, refreshes module data on success.
 *  Resolves to the response, or null if the call failed (the error is shown as a toast). */
export function useAction() {
  const toast = useToast()
  const { refresh } = useM2()
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (fn, okText) => {
    setBusy(true)
    try {
      const res = await fn()
      if (okText) toast(okText)
      refresh()
      return res ?? true
    } catch (e) {
      toast(e.message || 'Something went wrong', 'bad')
      return null
    } finally {
      setBusy(false)
    }
  }, [toast, refresh])
  return { run, busy }
}
