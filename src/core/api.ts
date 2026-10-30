import { fetchJsonWithTimeout, HttpTimeoutError, type JsonResponse } from './http'
import type { ManifestCargo, ManifestContainer, ManifestContact, ManifestData } from './types'

export const DEFAULT_API_BASE = 'https://www.dadaex.cn/api/vn/insight/manifest'

/**
 * - `not_found`    — the bill number has no manifest
 * - `network`      — the request never completed (offline, DNS, CORS)
 * - `http`         — the service answered, but with a non-2xx status
 * - `bad_response` — the service answered 2xx but the body is not a valid envelope
 * - `timeout`      — the service did not answer within the time limit
 */
export type ApiErrorKind = 'not_found' | 'network' | 'http' | 'bad_response' | 'timeout'

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
      case 'timeout':
        return 'The manifest service did not respond in time. Please try again.'
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

/**
 * Số bill THEO ĐÚNG CÁCH OPERATOR GÕ — đúng thứ ghi vào 提单号 trên site.
 *
 * KHÁC `normalizeBlNo`: KHÔNG bỏ hậu tố piece (`P1`, `P12`). Số bill trên
 * site CÓ THỂ kèm hậu tố piece (operator gõ `CHN4139065P1`), còn API của
 * dadaex chỉ nhận mã gốc ⇒ hai số khác nhau, đừng gộp.
 *
 * `normalizeBlNo` là key TRA CỨU; hàm này là key ĐÃ GHI LÊN SITE — chốt
 * trùng bill và bằng chứng "bill đã có trên site" phải dùng hàm này.
 *
 * Số bill trong ngành này luôn VIẾT HOA (mã API của dadaex cũng vậy) ⇒
 * chuẩn hoá input của operator cho khớp: số ghi lên site, key chốt trùng
 * bill và mã của API phải so sánh được với nhau.
 *
 * KHÔNG phải vì site tự upper-case mọi field — site chỉ upper-case giá trị
 * của DÒNG HÀNG; field header giữ nguyên chữ (xem `upper()` ở `payload.ts`).
 */
export function billNoAsWritten(raw: string): string {
  return raw.trim().toUpperCase()
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
  timeoutMs?: number
}

export async function fetchManifest(
  blNo: string,
  options: FetchManifestOptions = {},
): Promise<ManifestData> {
  const base = options.baseUrl ?? DEFAULT_API_BASE
  const doFetch = options.fetchImpl ?? fetch
  const url = `${base}?blNo=${encodeURIComponent(normalizeBlNo(blNo))}`

  let res: JsonResponse
  try {
    res = await fetchJsonWithTimeout(url, {}, { fetchImpl: doFetch, timeoutMs: options.timeoutMs })
  } catch (e) {
    if (e instanceof HttpTimeoutError) {
      throw new ManifestApiError('timeout', e.message)
    }
    throw new ManifestApiError('network', `Could not reach the manifest API: ${(e as Error).message}`)
  }
  if (!res.ok) {
    throw new ManifestApiError('http', `The manifest API returned HTTP ${res.status}`)
  }
  if (res.invalidJson) {
    throw new ManifestApiError('bad_response', 'The manifest API response is not valid JSON')
  }
  return parseEnvelope(res.data)
}
