import { fetchJsonWithTimeout, HttpTimeoutError, type JsonResponse } from './http'
import { billNoAsWritten, normalizeBlNo } from './bill-no'
import type { MappingContext } from './field-meta'
import { buildManifestBody } from './payload'
import type {
  ManifestApiData,
  ManifestCargo,
  ManifestContainer,
  ManifestContact,
  ManifestData,
} from './types'

export { normalizeBlNo, billNoAsWritten }

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

// A string to display to the user, according to the `kind` — English.
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

// Chuẩn hoá 3 mảng của API về mảng rỗng khi thiếu.
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * Bóc envelope của API ⇒ dữ liệu RAW (đã chuẩn hoá 3 mảng).
 *
 * Tách riêng khỏi `parseEnvelope` vì `fetchManifest` cần CẢ dữ liệu raw (để
 * lấy `blNo` của API) LẪN body của site.
 */
function parseEnvelopeData(json: unknown): ManifestApiData {
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
  const data = env.data as ManifestApiData
  return {
    ...data,
    cabContacts: asArray<ManifestContact>(data.cabContacts),
    cdgoods: asArray<ManifestCargo>(data.cdgoods),
    cdCon: asArray<ManifestContainer>(data.cdCon),
  }
}

/** Tuỳ chọn của `parseEnvelope` — dict của site + số bill của operator. */
export interface ParseEnvelopeOptions {
  /** Dict của site — BẮT BUỘC (tên cảng, mã 承运人…). */
  ctx: MappingContext
  /** Số bill do operator gõ (giữ hậu tố piece) — ghi vào `bill_nbr`. */
  operatorBlNo?: string
}

/**
 * Bóc envelope của API ⇒ BODY của site (45 key).
 *
 * `ctx` (dict của site) phải được load TRƯỚC khi gọi hàm này: body cần tên
 * cảng và mã 承运人 từ dict.
 */
export function parseEnvelope(json: unknown, options: ParseEnvelopeOptions): ManifestData {
  const raw = parseEnvelopeData(json)
  return buildManifestBody(raw, options.ctx, options.operatorBlNo)
}

export interface FetchManifestOptions extends ParseEnvelopeOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Kết quả của `fetchManifest` — body của site + số bill của API. */
export interface FetchManifestResult {
  /** Body của site (45 key) — sẽ gửi lên site. */
  body: ManifestData
  /** Số bill API trả về (để báo khi khác số bill ghi lên site). */
  apiBillNo: string
}

export async function fetchManifest(
  blNo: string,
  options: FetchManifestOptions,
): Promise<FetchManifestResult> {
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
  const raw = parseEnvelopeData(res.data)
  return {
    body: buildManifestBody(raw, options.ctx, options.operatorBlNo),
    apiBillNo: billNoAsWritten(raw.blNo ?? ''),
  }
}
