import type { ManifestData } from './types'

export const DEFAULT_API_BASE = 'https://www.dadaex.cn/api/vn/insight/manifest'

export type ApiErrorKind = 'not_found' | 'network' | 'bad_response'

export class ManifestApiError extends Error {
  readonly kind: ApiErrorKind

  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.name = 'ManifestApiError'
    this.kind = kind
  }
}

/**
 * blNo trên site có thể kèm hậu tố piece dạng `P1`, `P12`.
 * API của dadaex chỉ nhận mã gốc — đã kiểm chứng:
 * `CHN4139065P1` → data_not_found, `CHN4139065` → status 1.
 */
export function normalizeBlNo(raw: string): string {
  return raw.trim().toUpperCase().replace(/P\d+$/, '')
}

export function parseEnvelope(json: unknown): ManifestData {
  if (typeof json !== 'object' || json === null) {
    throw new ManifestApiError('bad_response', 'Phản hồi API không phải object')
  }
  const env = json as { status?: number; message?: string; data?: unknown }
  if (env.status !== 1) {
    throw new ManifestApiError('not_found', env.message || 'API không trả dữ liệu')
  }
  if (typeof env.data !== 'object' || env.data === null) {
    throw new ManifestApiError('not_found', 'API trả status=1 nhưng data=null')
  }
  return env.data as ManifestData
}

export interface FetchManifestOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export async function fetchManifest(
  blNo: string,
  options: FetchManifestOptions = {},
): Promise<ManifestData> {
  const base = options.baseUrl ?? DEFAULT_API_BASE
  const doFetch = options.fetchImpl ?? fetch
  const url = `${base}?blNo=${encodeURIComponent(blNo)}`

  let res: Response
  try {
    res = await doFetch(url)
  } catch (e) {
    throw new ManifestApiError('network', `Không gọi được API: ${(e as Error).message}`)
  }
  if (!res.ok) {
    throw new ManifestApiError('network', `API trả HTTP ${res.status}`)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ManifestApiError('bad_response', 'Phản hồi API không phải JSON')
  }
  return parseEnvelope(json)
}
