import type { ManifestCargo, ManifestContainer, ManifestContact, ManifestData } from './types'

export const DEFAULT_API_BASE = 'https://www.dadaex.cn/api/vn/insight/manifest'

/**
 * - `not_found`    — the bill number has no manifest
 * - `network`      — the request never completed (offline, DNS, CORS)
 * - `http`         — the service answered, but with a non-2xx status
 * - `bad_response` — the service answered 2xx but the body is not a valid envelope
 */
export type ApiErrorKind = 'not_found' | 'network' | 'http' | 'bad_response'

export class ManifestApiError extends Error {
  readonly kind: ApiErrorKind

  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.name = 'ManifestApiError'
    this.kind = kind
  }
}

/**
 * Chuỗi hiển thị cho người dùng, theo từng `kind` — tiếng Anh.
 * Tầng UI phải map theo `kind`, KHÔNG hiển thị thẳng `error.message`
 * vì message là chi tiết kỹ thuật, không phải thông báo cho người dùng.
 */
export function describeApiError(error: unknown): string {
  if (error instanceof ManifestApiError) {
    switch (error.kind) {
      case 'not_found':
        return 'No manifest was found for this bill of lading number.'
      case 'network':
        return 'Could not reach the manifest service. Check your network connection.'
      case 'http':
        return 'The manifest service returned an error. Please try again in a moment.'
      case 'bad_response':
        return 'The manifest service returned an unexpected response.'
    }
  }
  return 'Something went wrong while fetching the manifest data.'
}

/**
 * blNo trên site có thể kèm hậu tố piece dạng `P1`, `P12`.
 * API của dadaex chỉ nhận mã gốc — đã kiểm chứng:
 * `CHN4139065P1` → status 0 (data_not_found),
 * `CHN4139065`  → status 1 nhưng `data=null` (tồn tại bill nhưng không có manifest).
 *
 * Chỉ bỏ hậu tố khi nó đứng sau một chữ số, nên mã gốc thật sự kết thúc
 * bằng `P<digits>` (ví dụ `ABCP12`) không bị đụng tới.
 */
export function normalizeBlNo(raw: string): string {
  return raw.trim().toUpperCase().replace(/(?<=\d)P\d+$/, '')
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function parseEnvelope(json: unknown): ManifestData {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ManifestApiError('bad_response', 'The API response is not a JSON object')
  }
  const env = json as { status?: unknown; message?: unknown; messgae?: unknown; data?: unknown }
  if (typeof env.status !== 'number') {
    throw new ManifestApiError('bad_response', 'The API response has no numeric status field')
  }
  if (env.status !== 1) {
    const message =
      typeof env.message === 'string'
        ? env.message
        : typeof env.messgae === 'string'
          ? env.messgae
          : 'The API returned no data'
    throw new ManifestApiError('not_found', message)
  }
  if (typeof env.data !== 'object' || env.data === null) {
    throw new ManifestApiError('not_found', 'The API returned status=1 but no manifest data')
  }
  if (Array.isArray(env.data)) {
    throw new ManifestApiError('bad_response', 'The API returned an array instead of a manifest object')
  }
  const data = env.data as ManifestData
  return {
    ...data,
    cabContacts: asArray<ManifestContact>(data.cabContacts),
    cdgoods: asArray<ManifestCargo>(data.cdgoods),
    cdCon: asArray<ManifestContainer>(data.cdCon),
  }
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
  const url = `${base}?blNo=${encodeURIComponent(normalizeBlNo(blNo))}`

  let res: Response
  try {
    res = await doFetch(url)
  } catch (e) {
    throw new ManifestApiError('network', `Could not reach the manifest API: ${(e as Error).message}`)
  }
  if (!res.ok) {
    throw new ManifestApiError('http', `The manifest API returned HTTP ${res.status}`)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ManifestApiError('bad_response', 'The manifest API response is not valid JSON')
  }
  return parseEnvelope(json)
}
