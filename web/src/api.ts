async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown
    try {
      detail = (await res.json()).detail
    } catch {
      detail = res.statusText
    }
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)) as Error & {
      status: number
      detail: unknown
    }
    err.status = res.status
    err.detail = detail
    throw err
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const qs = params
    ? '?' +
      Object.entries(params)
        .filter(([, v]) => v !== '' && v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : ''
  return fetch(`/api${path}${qs}`).then((r) => handle<T>(r))
}

export function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then((r) => handle<T>(r))
}

export function upload<T>(path: string, form: FormData): Promise<T> {
  return fetch(`/api${path}`, { method: 'POST', body: form }).then((r) => handle<T>(r))
}

// XHR variant: fetch can't observe upload progress, and a request with no
// timeout freezes the UI forever when the network dies mid-flight (the
// 2026-08-20 mDNS outage did exactly that).
export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress: (phase: 'uploading' | 'processing', pct: number) => void,
  timeoutMs = 120000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api${path}`)
    xhr.timeout = timeoutMs
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress('uploading', e.loaded / e.total)
    }
    xhr.upload.onload = () => onProgress('processing', 1)
    const fail = (msg: string, status = 0, detail?: unknown) =>
      reject(Object.assign(new Error(msg), { status, detail }))
    xhr.onload = () => {
      const body = xhr.response
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T)
      else {
        const detail = body?.detail ?? xhr.statusText
        fail(typeof detail === 'string' ? detail : JSON.stringify(detail), xhr.status, detail)
      }
    }
    xhr.ontimeout = () => fail(`upload timed out after ${timeoutMs / 1000}s — server unreachable or still processing; check the import history before retrying`)
    xhr.onerror = () => fail('network error during upload — check connectivity and the import history before retrying')
    xhr.send(form)
  })
}

export const money = (v: string | number | null | undefined): string =>
  v == null ? '—' : `$${Number(v).toFixed(2)}`
