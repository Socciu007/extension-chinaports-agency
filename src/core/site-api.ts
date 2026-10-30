import { fetchJsonWithTimeout, HttpTimeoutError, type JsonResponse } from './http'
import type { MappingContext } from './field-meta'

export const DEFAULT_SITE_API_BASE = '/api/booking/exportManifestDataMaintain'

export interface DictOption {
  /** mã dùng để đối chiếu (UN/LOCODE, mã cảng, mã 箱型…) */
  code: string
  /** nhãn hiển thị trong dropdown của site */
  name: string
  /** id trong DB của site (dùng cho 承运人 / 箱型 / 尺寸) */
  id?: string
  /** bản gốc, để đối chiếu theo key khác nếu cần */
  raw: Record<string, unknown>
}

/** Key chứa mã — `TRUST_COD`/`PORT_COD` là key thật của site (FACT 4). */
const CODE_KEYS = [
  'code',
  'unCode',
  'portCode',
  'value',
  'key',
  'dictCode',
  'itemCode',
  'TRUST_COD',
  'PORT_COD',
]
/** Key chứa tên hiển thị — `E_PORT_NAM` là tên cảng tiếng Trung của site. */
const NAME_KEYS = [
  'name',
  'label',
  'text',
  'dictName',
  'itemName',
  'cnName',
  'portName',
  'E_PORT_NAM',
]

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

/** Tìm mảng đầu tiên trong payload (hỗ trợ `{data:[…]}`, `{list:[…]}`, …). */
function asArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (typeof payload !== 'object' || payload === null) return []

  const source = payload as Record<string, unknown>
  for (const key of ['data', 'list', 'rows', 'records', 'result', 'items']) {
    const value = source[key]
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') {
      const nested = asArray(value)
      if (nested.length > 0) return nested
    }
  }
  return []
}

/**
 * Bóc vỏ envelope `{code, data, msg}` của site.
 * Đã kiểm chứng ngày 2026-10-27 trên site thật:
 *   GET /api/booking/exportManifestDataMaintain/getTrustCode/
 *   → {"code":4000,"data":null,"msg":"身份认证信息未提供。"}   (HTTP 200!)
 */
function unwrapEnvelope(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload
  const source = payload as Record<string, unknown>
  if ('data' in source && source.data !== null && source.data !== undefined) return source.data
  return payload
}

/** Lấy mảng theo key cụ thể; nếu không có thì lùi về `asArray`. */
export function pickArray(payload: unknown, keys: string[]): unknown[] {
  for (const candidate of [unwrapEnvelope(payload), payload]) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const source = candidate as Record<string, unknown>
    for (const key of keys) {
      if (Array.isArray(source[key])) return source[key] as unknown[]
    }
    for (const key of keys) {
      const value = source[key]
      if (value && typeof value === 'object') {
        const nested = asArray(value)
        if (nested.length > 0) return nested
      }
    }
  }
  return asArray(payload)
}

/**
 * Key ưu tiên cho một endpoint cụ thể.
 *
 * Vì dict của site dùng key riêng (`PORT_COD`/`E_PORT_NAM`), nếu để các key
 * generic (`code`/`name`/`cnName`…) được tra TRƯỚC thì một bản ghi port sau
 * này có thêm field `name` sẽ khiến `findPort` trả tên tiếng Anh, còn site
 * chỉ gợi ý tên cảng tiếng Trung (`上海/CNSHA`) ⇒ không khớp suggestion.
 */
export interface DictKeyPreference {
  /** key chứa mã — tra TRƯỚC `CODE_KEYS` */
  codeKeys?: string[]
  /** key chứa tên — tra TRƯỚC `NAME_KEYS` */
  nameKeys?: string[]
}

export function normalizeDictOptions(
  payload: unknown,
  prefer?: DictKeyPreference,
): DictOption[] {
  const codeKeys = [...(prefer?.codeKeys ?? []), ...CODE_KEYS]
  const nameKeys = [...(prefer?.nameKeys ?? []), ...NAME_KEYS]
  const result: DictOption[] = []

  for (const entry of asArray(unwrapEnvelope(payload))) {
    // `getDrType/` trả về mảng chuỗi thuần: mã cũng chính là nhãn hiển thị.
    if (typeof entry === 'string') {
      const code = entry.trim()
      if (code === '') continue
      result.push({ code, name: code, raw: { value: code } })
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>

    const code = pickString(raw, codeKeys) ?? pickString(raw, ['id'])
    if (code === undefined) continue

    const name = pickString(raw, nameKeys) ?? code
    const id = pickString(raw, ['id'])

    result.push({ code, name, id, raw })
  }

  return result
}

export interface SiteDicts {
  trustCodes: DictOption[]
  drTypes: DictOption[]
  ports: DictOption[]
  cntrTypes: DictOption[]
  cntrSizes: DictOption[]
}

/** Đọc cookie `token` của site (JWT gửi qua header `Authorization: JWT <token>`). */
export function readCookieToken(cookieString: string): string | undefined {
  for (const part of cookieString.split(';')) {
    const [name, ...rest] = part.split('=')
    if (name?.trim() === 'token') {
      const value = rest.join('=').trim()
      return value === '' ? undefined : value
    }
  }
  return undefined
}

export interface SiteFetchOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  cookieString?: string
  /** Thời gian chờ tối đa (ms) cho mỗi request — hết giờ thì báo lỗi `timeout`. */
  timeoutMs?: number
  /**
   * Nhãn của endpoint trong message lỗi.
   *
   * Mặc định là `path` — nhưng endpoint tạo bill có `path` RỖNG, nên message
   * sẽ có hai dấu cách; endpoint đó truyền nhãn riêng.
   *
   * `loadSiteDicts` KHÔNG dùng nhãn này — nó tự gán nhãn riêng cho từng dict.
   */
  label?: string
  /**
   * Header thêm cho request — nhận được cả 3 dạng của `HeadersInit`
   * (object thuần, `Headers` instance, mảng cặp `[[name, value]]`).
   *
   * Thứ tự ưu tiên khi trùng tên: cookie `token` của site > `Content-Type`
   * do tầng POST tự đặt > header của caller. `Accept` luôn do tầng này đặt.
   */
  headers?: HeadersInit
}

/**
 * Phân loại lỗi của API site — cùng hình dạng với `ApiErrorKind` của
 * `src/core/api.ts`:
 *
 * - `session`      — site trả `code: 4000`: session thiếu/hết hạn
 * - `site`         — site trả mã khác 2000 (lỗi phía site)
 * - `network`      — request không hoàn tất (offline, DNS, CORS)
 * - `http`         — site đã trả lời nhưng status không phải 2xx
 * - `bad_response` — body không phải JSON, hoặc không phải envelope của site
 * - `bad_request`  — extension KHÔNG gửi được request hợp lệ (body không
 *   serialize được, thiếu mã bill) ⇒ site chưa hề bị gọi
 * - `timeout`      — site không trả lời trong thời gian chờ
 */
export type SiteApiErrorKind =
  | 'session'
  | 'site'
  | 'network'
  | 'http'
  | 'bad_response'
  | 'bad_request'
  | 'timeout'

/** Lỗi từ API của site — luôn mang `kind` để tầng UI map sang thông báo. */
export class SiteApiError extends Error {
  readonly kind: SiteApiErrorKind
  /**
   * Mã số của lỗi: mã envelope của site (`site`/`session`) hoặc HTTP status
   * (`http`); `undefined` khi không có mã nào (`network`/`bad_response`).
   */
  readonly code: number | undefined

  constructor(kind: SiteApiErrorKind, message: string, code?: number) {
    super(message)
    this.name = 'SiteApiError'
    this.kind = kind
    this.code = code
  }
}

/**
 * Chuỗi hiển thị cho người dùng, theo từng `kind` — tiếng Anh.
 * Tầng UI phải map theo `kind`, KHÔNG hiển thị thẳng `error.message`
 * vì message là chi tiết kỹ thuật, không phải thông báo cho người dùng.
 *
 * Nhánh `session` có thêm gợi ý về cookie `HttpOnly`: extension xác thực bằng
 * cookie `token` của site đọc qua `document.cookie` ⇒ nếu site đánh dấu cookie
 * đó là `HttpOnly` thì extension KHÔNG BAO GIỜ đọc được, và operator sẽ bị
 * bắt vòng lặp "đăng nhập lại" dù đã đăng nhập. Gợi ý được viết theo kiểu
 * "có thể" vì không truyền được trạng thái đọc token xuống đây.
 */
export function describeSiteError(error: unknown): string {
  if (error instanceof SiteApiError) {
    switch (error.kind) {
      case 'session':
        return 'Your session on the site has expired — log in to the site and try again. If you are still signed in, the site\'s token cookie may be HttpOnly, which the extension cannot read.'
      case 'site':
        return 'The site rejected the request. Please try again in a moment.'
      case 'network':
        return 'Could not reach the site. Check your network connection.'
      case 'http':
        return 'The site returned an error. Please try again in a moment.'
      case 'bad_response':
        return 'The site returned an unexpected response.'
      case 'bad_request':
        return 'The request was not sent to the site because the manifest data was incomplete or invalid.'
      case 'timeout':
        return 'The site did not respond in time. Please try again.'
    }
  }
  return 'Something went wrong while talking to the site.'
}

/**
 * Mã thành công của API site là **2000** (FACT 6.4 — bundle site:
 * `2e3==e.code ? … : …`). Mã `200` KHÔNG phải mã của site.
 */
const SITE_OK_CODE = 2000
/** Mã của site khi session thiếu/hết hạn. */
const SITE_SESSION_CODE = 4000

/**
 * Site báo lỗi NGAY TRONG HTTP 200.
 * Đã kiểm chứng 2026-10-27 trên site thật:
 *   GET /api/booking/exportManifestDataMaintain/getTrustCode/
 *   → HTTP 200 {"code":4000,"data":null,"msg":"身份认证信息未提供。"}
 *
 * Vì vậy phải kiểm tra theo **mã thành công của site** (`2000`), không kiểm
 * tra `data === null`: một envelope thành công với `data: null` chỉ nghĩa là
 * dict rỗng, còn một lỗi phía site (`code: 5000`) có thể đi kèm `data` khác
 * null — bỏ qua nó thì extension im lặng báo "không tìm thấy…" cho mọi field.
 */
function assertSiteEnvelope(label: string, payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) {
    throw new SiteApiError(
      'bad_response',
      `The site API response for ${label} is not the site's {code, data, msg} envelope.`,
    )
  }
  const source = payload as { code?: unknown }
  if (typeof source.code !== 'number') {
    throw new SiteApiError(
      'bad_response',
      `The site API response for ${label} has no numeric code — not the site's {code, data, msg} envelope.`,
    )
  }
  if (source.code === SITE_OK_CODE) return
  if (source.code === SITE_SESSION_CODE) {
    throw new SiteApiError(
      'session',
      `The site rejected the request to ${label} because the session is missing or expired. Log in to the site and try again.`,
      source.code,
    )
  }
  throw new SiteApiError('site', `The site rejected the request to ${label} (code ${source.code}).`, source.code)
}

/**
 * Gửi một request tới API của site và trả về envelope đã kiểm tra.
 *
 * Toàn bộ phần chung của GET và POST nằm ở đây: dựng URL (+ query), đọc
 * cookie `token`, header, timeout cứng, phân loại lỗi, kiểm tra envelope
 * `{code, data, msg}`. Tách riêng để POST không phải copy-paste khối phân loại
 * lỗi — hai đường phải báo lỗi giống hệt nhau, nếu không thì caller gặp
 * lỗi "session" ở GET nhưng lại gặp lỗi chung chung ở POST.
 */
async function sendSiteJson(
  path: string,
  init: RequestInit,
  options: SiteFetchOptions,
  params?: Record<string, string>,
): Promise<unknown> {
  const base = options.baseUrl ?? DEFAULT_SITE_API_BASE
  const doFetch = options.fetchImpl ?? fetch
  // Nhãn trong message lỗi — `path` rỗng (endpoint tạo bill) tạo ra message
  // có hai dấu cách, nên endpoint đó truyền nhãn riêng.
  const label = options.label ?? path
  // Service worker của MV3 không có `document` ⇒ không có `document.cookie`.
  const token = readCookieToken(
    options.cookieString ?? (typeof document !== 'undefined' ? document.cookie : ''),
  )

  // `Headers` nhận được cả 3 dạng của `HeadersInit` (object thuần, `Headers`
  // instance, mảng cặp) và gộp các header trùng tên (không phân biệt hoa/thường)
  // ⇒ không header nào của caller bị rơi, không gửi 2 header cùng tên.
  const headers = new Headers(options.headers)
  for (const [name, value] of new Headers(init.headers)) {
    headers.set(name, value)
  }
  headers.set('Accept', 'application/json')
  // Token trong cookie của site là nguồn xác thực ⇒ ghi đè `Authorization` mà
  // caller đưa vào. Không có token trong cookie thì giữ nguyên của caller.
  if (token) headers.set('Authorization', `JWT ${token}`)

  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  const url = `${base}/${path}${query}`

  let res: JsonResponse
  try {
    res = await fetchJsonWithTimeout(
      url,
      {
        ...init,
        // Đưa thẳng `Headers` instance cho `fetch` — chính `Headers` đã lo
        // chuẩn hoá tên header và gộp header trùng tên (không phân biệt
        // hoa/thường) ⇒ không thể gửi 2 header cùng tên.
        headers,
        // API cùng origin của site ⇒ cookie phải đi kèm mọi request.
        credentials: 'include',
      },
      { fetchImpl: doFetch, timeoutMs: options.timeoutMs },
    )
  } catch (e) {
    if (e instanceof HttpTimeoutError) {
      throw new SiteApiError('timeout', e.message)
    }
    throw new SiteApiError('network', `Could not reach the site API (${label}): ${(e as Error).message}`)
  }

  if (!res.ok) {
    throw new SiteApiError(
      'http',
      `The site API request to ${label} returned HTTP ${res.status}`,
      res.status,
    )
  }

  if (res.invalidJson) {
    throw new SiteApiError(
      'bad_response',
      `The site API response for ${label} is not valid JSON`,
    )
  }

  const payload = res.data
  assertSiteEnvelope(label, payload)
  return payload
}

async function fetchSiteJson(
  path: string,
  options: SiteFetchOptions = {},
  params?: Record<string, string>,
): Promise<unknown> {
  return sendSiteJson(path, { method: 'GET' }, options, params)
}

/**
 * POST JSON tới API của site.
 *
 * Body phải có key **chữ thường** — site gọi helper `keyToLowercase` trước
 * khi POST. Tầng gọi (`site-write.ts`) chịu trách nhiệm lowercase trước khi
 * gọi hàm này.
 *
 * Trả về **envelope đã kiểm tra** `{code, data, msg}` — KHÔNG tự bóc `data`:
 * mỗi endpoint trả về một shape khác nhau (bill, dòng hàng, kết quả lưu),
 * caller tự quyết định lấy gì.
 */
export async function postSiteJson(
  path: string,
  body: unknown,
  options: SiteFetchOptions = {},
): Promise<unknown> {
  let serialized: unknown
  try {
    serialized = JSON.stringify(body)
  } catch (e) {
    // Body cyclic (hoặc có BigInt) ⇒ serialize lỗi. Không để `TypeError` thô
    // thoát ra ngoài — mọi lỗi của tầng này phải là `SiteApiError`.
    throw new SiteApiError(
      'bad_request',
      `The request body for ${options.label ?? path} could not be serialized as JSON: ${(e as Error).message}`,
    )
  }
  if (typeof serialized !== 'string') {
    throw new SiteApiError(
      'bad_request',
      `The request body for ${options.label ?? path} could not be serialized as JSON.`,
    )
  }

  return sendSiteJson(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serialized,
    },
    options,
  )
}

export async function loadSiteDicts(options: SiteFetchOptions = {}): Promise<SiteDicts> {
  // 4 endpoint, đúng như site gọi (FACT 4). `getPackageCode/` **không** gọi:
  // sau C-2 thì PACKAGE_STR/PACKAGE_COD đều để trống ⇒ dict 包装 không có ai dùng.
  const [trustRaw, drRaw, cntrRaw, portRaw] = await Promise.all([
    fetchSiteJson('getTrustCode/', { ...options, label: 'the trust code list' }, { kw: '' }),
    fetchSiteJson('getDrType/', { ...options, label: 'the cargo type list' }, { kw: '' }),
    fetchSiteJson('getCntrCode/', { ...options, label: 'the container type list' }),
    // `getPort/` chỉ là fallback: nó lọc theo tên cảng tiếng Trung nên có thể
    // lỗi mà không được làm hỏng phần còn lại của dict (tên cảng chính đến
    // từ API dadaex).
    fetchSiteJson(
      'getPort/',
      { ...options, label: 'the port list' },
      { kw: '', filter: 'E_PORT_NAM' },
    ).catch(() => null),
  ])

  return {
    trustCodes: normalizeDictOptions(trustRaw),
    drTypes: normalizeDictOptions(drRaw),
    // Dict cảng: key thật của site là `PORT_COD`/`E_PORT_NAM` — ưu tiên chúng
    // để tên cảng tiếng Trung luôn thắng key generic (`name`/`code`).
    ports: normalizeDictOptions(portRaw, {
      codeKeys: ['PORT_COD'],
      nameKeys: ['E_PORT_NAM'],
    }),
    cntrTypes: normalizeDictOptions(pickArray(cntrRaw, ['cntr_type', 'cntrType', 'type'])),
    cntrSizes: normalizeDictOptions(pickArray(cntrRaw, ['cntr_size', 'cntrSize', 'size'])),
  }
}

export function createMappingContext(dicts: SiteDicts): MappingContext {
  return {
    findTrustCode(supplyId) {
      if (supplyId === undefined) return undefined
      const hit = dicts.trustCodes.find((o) => o.id === String(supplyId) || o.code === String(supplyId))
      return hit?.code
    },

    findDrType(code) {
      if (!code) return undefined
      const hit = dicts.drTypes.find((o) => o.code === code || o.id === code)
      return hit?.name
    },

    findPort(code) {
      if (!code) return undefined
      const hit = dicts.ports.find(
        (o) =>
          o.code === code ||
          o.id === code ||
          pickString(o.raw, ['unCode', 'portCode', 'code']) === code,
      )
      if (!hit) return undefined
      // Dict `getPort()` của site lưu tên cảng tiếng Trung ⇒ trả về tên.
      return hit.name
    },

    findCntrType(raw) {
      if (raw === undefined || raw === null) return undefined
      const key = String(raw)
      const hit = dicts.cntrTypes.find((o) => o.id === key || o.code === key)
      return hit?.name
    },

    findCntrSize(raw) {
      if (raw === undefined || raw === null) return undefined
      const key = String(raw)
      const hit = dicts.cntrSizes.find((o) => o.id === key || o.code === key)
      return hit?.name
    },
  }
}
