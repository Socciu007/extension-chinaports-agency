import { fetchJsonWithTimeout, HttpTimeoutError, type JsonResponse } from './http'
import type { MappingContext } from './field-meta'

export const DEFAULT_SITE_API_BASE = '/api/booking/exportManifestDataMaintain'

export interface DictOption {
  code: string // used to compare (UN/LOCODE, port code, container type code…)
  name: string // display name in the site's dropdown
  id?: string // id in the site's database (used for carrier / container type / size)
  raw: Record<string, unknown> // original data, to compare with other keys if needed
}

// Key containing the code — `TRUST_COD`/`PORT_COD` are the actual keys of the site (FACT 4).
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
// Key containing the display name — `E_PORT_NAM` is the Chinese port name of the site.
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

// Find the first array in the payload (supports `{data:[…]}`, `{list:[…]}`, …).
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

// Unwrap the site envelope `{code, data, msg}`.
function unwrapEnvelope(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload
  const source = payload as Record<string, unknown>
  if ('data' in source && source.data !== null && source.data !== undefined) return source.data
  return payload
}

// Get the array by specific key; if not found, fall back to `asArray`.
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

// Preferred keys for a specific endpoint.
// Because the site's dict uses specific keys (`PORT_COD`/`E_PORT_NAM`), if we let the generic keys (`code`/`name`/`cnName`…) be searched first, a port record with an additional `name` field will cause `findPort` to return the English name, but the site only suggests the Chinese port name (`上海/CNSHA`) ⇒ the suggestion does not match.
export interface DictKeyPreference {
  codeKeys?: string[]
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
  ports: DictOption[]
  cntrTypes: DictOption[]
  cntrSizes: DictOption[]
}

// Read the `token` cookie of the site (JWT sent via header `Authorization: JWT <token>`).
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
  timeoutMs?: number
  label?: string
  headers?: HeadersInit
}

export type SiteApiErrorKind =
  | 'session'
  | 'site'
  | 'network'
  | 'http'
  | 'bad_response'
  | 'bad_request'
  | 'timeout'

export class SiteApiError extends Error {
  readonly kind: SiteApiErrorKind
  readonly code: number | undefined

  constructor(kind: SiteApiErrorKind, message: string, code?: number) {
    super(message)
    this.name = 'SiteApiError'
    this.kind = kind
    this.code = code
  }
}

// A string to display to the user, according to the `kind` — English.
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

const SITE_OK_CODE = 2000
const SITE_SESSION_CODE = 4000

// Assert that the payload is a site envelope `{code, data, msg}`.
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

// Send a request to the site API and return the validated envelope.
async function sendSiteJson(
  path: string,
  init: RequestInit,
  options: SiteFetchOptions,
  params?: Record<string, string>,
): Promise<unknown> {
  const base = options.baseUrl ?? DEFAULT_SITE_API_BASE
  const doFetch = options.fetchImpl ?? fetch
  // The label in the error message — the empty `path` (create bill endpoint) creates a message with two spaces, so the endpoint passes a label separately.
  const label = options.label ?? path
  // The service worker of MV3 does not have `document` ⇒ there is no `document.cookie`.
  const token = readCookieToken(
    options.cookieString ?? (typeof document !== 'undefined' ? document.cookie : ''),
  )

  // `Headers` can receive all three forms of `HeadersInit` (plain object, `Headers` instance, array of pairs) and merge headers with the same name (case-insensitive) 
  // ⇒ no header of the caller is lost, no two headers with the same name are sent.
  const headers = new Headers(options.headers)
  for (const [name, value] of new Headers(init.headers)) {
    headers.set(name, value)
  }
  headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `JWT ${token}`)

  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  const url = `${base}/${path}${query}`

  let res: JsonResponse
  try {
    res = await fetchJsonWithTimeout(
      url,
      {
        ...init,
        headers,
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

// POST JSON to the site API.
export async function postSiteJson(
  path: string,
  body: unknown,
  options: SiteFetchOptions = {},
): Promise<unknown> {
  let serialized: unknown
  try {
    serialized = JSON.stringify(body)
  } catch (e) {
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
  // The site's `getDrType/` dict is NOT fetched: 交货条款 comes straight from
  // the API (`transportTerms`) and nothing else looks the value up.
  const [trustRaw, cntrRaw, portRaw] = await Promise.all([
    fetchSiteJson('getTrustCode/', { ...options, label: 'the trust code list' }, { kw: '' }),
    fetchSiteJson('getCntrCode/', { ...options, label: 'the container type list' }),
    fetchSiteJson(
      'getPort/',
      { ...options, label: 'the port list' },
      { kw: '', filter: 'E_PORT_NAM' },
    ).catch(() => null),
  ])

  return {
    trustCodes: normalizeDictOptions(trustRaw),
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
