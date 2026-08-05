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

export const money = (v: string | number | null | undefined): string =>
  v == null ? '—' : `$${Number(v).toFixed(2)}`
