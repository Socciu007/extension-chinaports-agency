import type { MappingContext } from './mapping'

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

export function normalizeDictOptions(payload: unknown): DictOption[] {
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

    const code = pickString(raw, CODE_KEYS) ?? pickString(raw, ['id'])
    if (code === undefined) continue

    const name = pickString(raw, NAME_KEYS) ?? code
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
}

/** Lỗi từ API của site — thường là session thiếu/hết hạn. */
export class SiteApiError extends Error {
  readonly code: number | undefined

  constructor(message: string, code?: number) {
    super(message)
    this.name = 'SiteApiError'
    this.code = code
  }
}

/**
 * Site báo lỗi NGAY TRONG HTTP 200.
 * Đã kiểm chứng 2026-10-27 trên site thật:
 *   GET /api/booking/exportManifestDataMaintain/getTrustCode/
 *   → HTTP 200 {"code":4000,"data":null,"msg":"身份认证信息未提供。"}
 * Nếu không kiểm tra, extension sẽ tưởng dict rỗng và báo "không tìm thấy cảng"
 * cho mọi field — mất dấu vết nguyên nhân thật (session hết hạn).
 */
function assertSiteEnvelope(path: string, payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) return
  const source = payload as { code?: unknown; data?: unknown }
  if (typeof source.code !== 'number') return
  if (source.data !== null && source.data !== undefined) return
  throw new SiteApiError(
    source.code === 4000
      ? `The site rejected ${path} because the session is missing or expired. Log in to the site and try again.`
      : `The site rejected ${path} (code ${source.code}).`,
    source.code,
  )
}

async function fetchSiteJson(
  path: string,
  options: SiteFetchOptions = {},
  params?: Record<string, string>,
): Promise<unknown> {
  const base = options.baseUrl ?? DEFAULT_SITE_API_BASE
  const doFetch = options.fetchImpl ?? fetch
  const token = readCookieToken(options.cookieString ?? document.cookie)

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `JWT ${token}`

  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  const res = await doFetch(`${base}/${path}${query}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    throw new SiteApiError(`The site API ${path} returned HTTP ${res.status}`)
  }
  const payload = (await res.json()) as unknown
  assertSiteEnvelope(path, payload)
  return payload
}

export async function loadSiteDicts(options: SiteFetchOptions = {}): Promise<SiteDicts> {
  // 4 endpoint, đúng như site gọi (FACT 4). `getPackageCode/` **không** gọi:
  // sau C-2 thì PACKAGE_STR/PACKAGE_COD đều để trống ⇒ dict 包装 không có ai dùng.
  const [trustRaw, drRaw, cntrRaw, portRaw] = await Promise.all([
    fetchSiteJson('getTrustCode/', options, { kw: '' }),
    fetchSiteJson('getDrType/', options, { kw: '' }),
    fetchSiteJson('getCntrCode/', options),
    // `getPort/` chỉ là fallback: nó lọc theo tên cảng tiếng Trung nên có thể
    // lỗi mà không được làm hỏng phần còn lại của dict (tên cảng chính đến
    // từ API dadaex).
    fetchSiteJson('getPort/', options, { kw: '', filter: 'E_PORT_NAM' }).catch(() => null),
  ])

  return {
    trustCodes: normalizeDictOptions(trustRaw),
    drTypes: normalizeDictOptions(drRaw),
    ports: normalizeDictOptions(portRaw),
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
      // Widget của site chỉ gợi ý tên cảng tiếng Trung → trả về tên.
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
