import { fetchJsonWithTimeout, HttpTimeoutError, type JsonResponse } from './http'

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
// Because the site's dict uses specific keys (`PORT_COD`/`E_PORT_NAM`), the generic keys (`code`/`name`/`cnName`…) must NOT be searched first — a port record with an additional `name` field would then win over the key the site really uses.
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

/**
 * Build the query string of a site request.
 *
 * `encodeURIComponent` is used instead of `URLSearchParams` because the site's
 * own frontend sends a space as `%20` — `URLSearchParams` would send `+`,
 * which the site's filter parameter does not read the same way.
 */
function buildQuery(params: Record<string, string>): string {
  const pairs = Object.entries(params).map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
  )
  return pairs.length === 0 ? '' : `?${pairs.join('&')}`
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

  const query = params ? buildQuery(params) : ''
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

export async function fetchSiteJson(
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

/**
 * The 包装代码 (PACKAGE_COD) of the site for a package NAME.
 *
 * The API gives the package NAME only (`goods.unit` → 包装类型/PACKAGE_STR);
 * the site needs the CODE (包装代码/PACKAGE_COD) ⇒ the code has to be looked
 * up in the site's own package dictionary.
 *
 * The URL is the one the site itself calls:
 * `getPackageCode/?kw=<name>&filter=%20E_PACKAGE_NAM` — the `filter` value
 * starts with a SPACE, that is what the site sends.
 */
export async function fetchPackageCode(
  name: string,
  options: SiteFetchOptions = {},
): Promise<string | undefined> {
  const kw = name.trim() === 'PACKAGES' ? 'PACKAGE' : name.trim()
  if (kw === '') return undefined

  const raw = await fetchSiteJson(
    'getPackageCode/',
    { ...options, label: 'the package code list' },
    { kw, filter: 'E_PACKAGE_NAM' },
  )

  const dict = normalizeDictOptions(raw, {
    codeKeys: ['PACKAGE_COD'],
    nameKeys: ['E_PACKAGE_NAM', 'PACKAGE_NAM'],
  })

  // Match the NAME first — the dictionary may return several rows because
  // `kw` is a "contains" search.
  const exact = dict.find((option) => option.name.trim().toUpperCase() === kw.toUpperCase())
  if (exact) return exact.code
  // Only one row ⇒ take it (the site already filtered by `kw`).
  if (dict.length === 1) return dict[0]?.code
  return undefined
}

// Columns of the site's port dictionary that may hold the port NAME.
const PORT_NAME_KEYS = [
  'E_PORT_NAM',
  'PORT_NAM',
  'E_PORT_NAM_EN',
  'PORT_NAM_EN',
  'E_PORT_EN',
  'PORT_EN',
  'NAME_EN',
  'nameEn',
]

/**
 * Does the port row hold the requested NAME?
 *
 * The port dictionary of the site holds the CHINESE name in `E_PORT_NAM`
 * (FACT 3) ⇒ the English name may live in another column ⇒ match on the
 * VALUE of every name-ish column, not on one fixed column.
 */
function portRowMatchesName(raw: Record<string, unknown>, wanted: string): boolean {
  const target = wanted.trim().toUpperCase()
  const matches = (value: unknown): boolean =>
    typeof value === 'string' && value.trim().toUpperCase() === target

  for (const key of PORT_NAME_KEYS) {
    if (matches(raw[key])) return true
  }
  // Safety net: any other column whose NAME mentions a name.
  for (const [key, value] of Object.entries(raw)) {
    if (!key.toUpperCase().includes('NAM')) continue
    if (matches(value)) return true
  }
  return false
}

/**
 * The port CODE (PORT_COD) of the site for a port NAME.
 *
 * The API gives the English port NAME (`PortData.nameEn`) and a port code of
 * its own; the site needs the code of ITS port dictionary ⇒ the code has to
 * be looked up once the name is known.
 *
 * The URL is the one the site itself calls:
 * `getPort/?kw=<name>&filter=E_PORT_NAM`.
 */
export async function fetchPortCode(
  name: string,
  options: SiteFetchOptions = {},
): Promise<string | undefined> {
  const kw = name.trim()
  if (kw === '') return undefined

  const raw = await fetchSiteJson(
    'getPort/',
    { ...options, label: 'the port list' },
    { kw, filter: 'E_PORT_NAM' },
  )

  const dict = normalizeDictOptions(raw, {
    codeKeys: ['PORT_COD'],
    nameKeys: PORT_NAME_KEYS,
  })

  // Match the NAME first — the dictionary may return several rows because
  // `kw` is a "contains" search.
  const exact = dict.find((option) => portRowMatchesName(option.raw, kw))
  if (exact) return exact.code
  // Only one row ⇒ take it (the site already filtered by `kw`).
  if (dict.length === 1) return dict[0]?.code
  return undefined
}
