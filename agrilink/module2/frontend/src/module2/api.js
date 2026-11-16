// REST client for Module 2. The host application supplies the base URL and the
// auth headers, so the same client works standalone and inside Module 1.

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export function createApi({ baseUrl, getHeaders }) {
  async function request(method, path, { body, query, form } = {}) {
    const url = new URL(baseUrl.replace(/\/$/, '') + path, window.location.origin)
    if (query) Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
    })
    const headers = { ...(getHeaders ? getHeaders() : {}) }
    let payload
    if (form) payload = form
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    let res
    try {
      res = await fetch(url, { method, headers, body: payload })
    } catch {
      throw new ApiError('Cannot reach the Module 2 server. Is the backend running?', 0)
    }
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    if (!res.ok) {
      const msg = data?.error?.message || data?.detail || `Request failed (${res.status})`
      throw new ApiError(msg, res.status, data?.error?.details)
    }
    return data
  }
  return {
    baseUrl,
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body: body ?? {} }),
    upload: (path, form) => request('POST', path, { form }),
    photoUrl: (name) => `${baseUrl.replace(/\/$/, '')}/photos/${encodeURIComponent(name)}`,
  }
}
