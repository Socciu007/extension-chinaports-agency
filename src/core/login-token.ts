/**
 * The login flow of the site: captcha → captcha service → login → token.
 *
 * The flow runs in the POPUP (an extension page), never in a content script:
 * Chrome blocks the cross-origin requests of a content script even when the
 * extension holds the host permission, and the captcha service sends no CORS
 * headers. Extension pages may call the hosts of `host_permissions` without
 * CORS headers.
 */
import { fetchJsonWithTimeout, HTTP_TIMEOUT_MS, type JsonResponse } from './http'
import type { LoginCredentials } from './login-credentials'
import { SITE_ORIGIN } from './site-url'

/** The captcha-solving service (超級鹰 / chaojiying). */
export const CAPTCHA_SERVICE_URL = 'https://upload.chaojiying.net/Upload/Processing.php'

/** The endpoint of the site that gives the captcha image and its key. */
export const CAPTCHA_PATH = '/api/captcha/'

/** The endpoint of the site that logs in. */
export const LOGIN_PATH = '/api/login/'

/** The code of the site that means "OK" (the envelope of the site is `{code, data, msg}`). */
const SITE_OK_CODE = 2000

/** The type of the captcha of the service: 6001 = digits and letters. */
const CAPTCHA_TYPE = '6001'

/** The keys that may hold the token in the answer of the login. */
const TOKEN_KEYS = [
  'token',
  'jwt',
  'access_token',
  'accessToken',
  'access_token_jwt',
  'Authorization',
  'authorization',
]

/** Why the login did not give a token — the UI shows a different text per kind. */
export type LoginTokenErrorKind = 'credentials' | 'captcha' | 'ocr' | 'login' | 'token' | 'network'

/** The error of the login flow. */
export class LoginTokenError extends Error {
  readonly kind: LoginTokenErrorKind

  constructor(kind: LoginTokenErrorKind, message: string) {
    super(message)
    this.name = 'LoginTokenError'
    this.kind = kind
  }
}

export interface LoginTokenOptions {
  /** The details of the user — every field must be filled in. */
  credentials: LoginCredentials
  /** The `fetch` to use — the real one by default. */
  fetchImpl?: typeof fetch
  /** The timeout of every request — 15 s by default. */
  timeoutMs?: number
  /** The origin of the site — `SITE_ORIGIN` by default. */
  siteOrigin?: string
  /** The URL of the captcha service — `CAPTCHA_SERVICE_URL` by default. */
  captchaServiceUrl?: string
}

const MISSING_CREDENTIALS_MESSAGE =
  'Set the login details in the extension options first: the site account, the site password and the captcha service details.'
const CAPTCHA_REFUSED_MESSAGE = 'The site refused to give a captcha image.'
const CAPTCHA_MISSING_MESSAGE = 'The site did not return the captcha image.'
const CAPTCHA_NETWORK_MESSAGE = 'Could not reach the site to get the captcha.'
const OCR_MISSING_MESSAGE = 'The captcha service did not return the captcha text.'
const OCR_NETWORK_MESSAGE = 'Could not reach the captcha service.'
const LOGIN_REFUSED_MESSAGE =
  'The site refused the login — check the account details and try again.'
const LOGIN_NETWORK_MESSAGE = 'Could not reach the site to log in.'
const TOKEN_MISSING_MESSAGE = 'The site did not return a token after the login.'

/** A plain object — anything else is not a place where a value can live. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** The first string value of `keys` — `undefined` when there is none. */
function pickString(
  source: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/**
 * Strip the `JWT ` / `Bearer ` prefix.
 *
 * The site sends the value of the header (`Authorization: JWT <token>`) ⇒ the
 * extension must keep only the token itself, or the header would read
 * `JWT JWT <token>`.
 */
function stripAuthPrefix(value: string): string | undefined {
  const stripped = value.replace(/^(JWT|Bearer)\s+/i, '').trim()
  return stripped === '' ? undefined : stripped
}

/** The base64 PART of the captcha image — everything after the first `,`. */
function base64PartOf(imageBase: string): string {
  const comma = imageBase.indexOf(',')
  return comma >= 0 ? imageBase.slice(comma + 1) : imageBase
}

/** Join the origin and the path — the origin may or may not end with `/`. */
function siteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}${path}`
}

/** A string field of the credentials — anything that is not a string is empty. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The credentials with every field trimmed.
 *
 * The check for "is it filled in?" and the login itself use the same values,
 * so a stray space can never make the check pass and the login fail.
 */
function normalizeCredentials(credentials: LoginCredentials): LoginCredentials {
  return {
    siteUsername: textOf(credentials?.siteUsername),
    sitePassword: textOf(credentials?.sitePassword),
    ocrUser: textOf(credentials?.ocrUser),
    ocrPassword: textOf(credentials?.ocrPassword),
    ocrSoftwareId: textOf(credentials?.ocrSoftwareId),
  }
}

/** Is every field of the credentials filled in? */
function hasEveryCredential(credentials: LoginCredentials): boolean {
  return (
    credentials.siteUsername !== '' &&
    credentials.sitePassword !== '' &&
    credentials.ocrUser !== '' &&
    credentials.ocrPassword !== '' &&
    credentials.ocrSoftwareId !== ''
  )
}

/**
 * A request that returns JSON — a network error becomes a `LoginTokenError`.
 *
 * The message is the one of the caller: the site and the captcha service are
 * two different things and the operator must know which one is unreachable.
 */
async function requestJson(
  url: string,
  init: RequestInit,
  options: { fetchImpl: typeof fetch; timeoutMs: number },
  networkMessage: string,
): Promise<JsonResponse> {
  try {
    return await fetchJsonWithTimeout(url, init, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    })
  } catch {
    throw new LoginTokenError('network', networkMessage)
  }
}

/**
 * Check the `code` of the envelope of the site.
 *
 * The code is only checked when it IS a number: the exact shape of the
 * answers of `/api/captcha/` and `/api/login/` could not be verified on the
 * live site, so a missing code must not be taken for a refusal.
 */
function assertSiteOk(
  payload: unknown,
  kind: LoginTokenErrorKind,
  message: string,
): void {
  const code = asRecord(payload)?.code
  if (typeof code !== 'number') return
  if (code === SITE_OK_CODE) return
  throw new LoginTokenError(kind, message)
}

/**
 * The token of the answer of the login.
 *
 * The site may put the token in the envelope, in `data` or in `data.data` ⇒
 * all three places are searched.
 */
function findToken(payload: unknown): string | undefined {
  const envelope = asRecord(payload)
  if (!envelope) return undefined
  const data = asRecord(envelope.data)
  const nested = data ? asRecord(data.data) : undefined
  for (const source of [envelope, data, nested]) {
    const raw = pickString(source, TOKEN_KEYS)
    if (raw === undefined) continue
    const token = stripAuthPrefix(raw)
    if (token !== undefined) return token
  }
  return undefined
}

/**
 * Log in to the site and return its token.
 *
 * The steps are: the captcha of the site → the captcha service (which reads
 * the image) → the login of the site → the token.
 */
export async function fetchTokenByLogin(options: LoginTokenOptions): Promise<string> {
  const credentials = normalizeCredentials(options.credentials)
  if (!hasEveryCredential(credentials)) {
    throw new LoginTokenError('credentials', MISSING_CREDENTIALS_MESSAGE)
  }

  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS
  const origin = options.siteOrigin ?? SITE_ORIGIN
  const captchaServiceUrl = options.captchaServiceUrl ?? CAPTCHA_SERVICE_URL

  // Step 1 — the captcha image and its key.
  const captchaResponse = await requestJson(
    siteUrl(origin, CAPTCHA_PATH),
    { method: 'GET' },
    { fetchImpl: doFetch, timeoutMs },
    CAPTCHA_NETWORK_MESSAGE,
  )
  if (!captchaResponse.ok) {
    // The site answered with an HTTP error ⇒ it did not give a captcha.
    throw new LoginTokenError('captcha', CAPTCHA_REFUSED_MESSAGE)
  }
  assertSiteOk(captchaResponse.data, 'captcha', CAPTCHA_REFUSED_MESSAGE)

  const captchaEnvelope = asRecord(captchaResponse.data)
  const captchaData = asRecord(captchaEnvelope?.data)
  const imageBase =
    pickString(captchaData, ['image_base']) ?? pickString(captchaEnvelope, ['image_base'])
  if (imageBase === undefined) {
    throw new LoginTokenError('captcha', CAPTCHA_MISSING_MESSAGE)
  }
  // The key may be missing ⇒ the login is refused by the site, not by us.
  const captchaKey =
    pickString(captchaData, ['key']) ?? pickString(captchaEnvelope, ['key']) ?? ''

  // Step 2 — the captcha service reads the image.
  const form = new FormData()
  form.append('user', credentials.ocrUser)
  form.append('pass', credentials.ocrPassword)
  form.append('softid', credentials.ocrSoftwareId)
  form.append('codetype', CAPTCHA_TYPE)
  form.append('file_base64', base64PartOf(imageBase))

  const ocrResponse = await requestJson(
    captchaServiceUrl,
    // NO `Content-Type` header: the browser has to set the multipart
    // boundary itself, otherwise the service cannot read the body.
    { method: 'POST', body: form },
    { fetchImpl: doFetch, timeoutMs },
    OCR_NETWORK_MESSAGE,
  )
  if (!ocrResponse.ok) {
    throw new LoginTokenError('ocr', OCR_MISSING_MESSAGE)
  }
  // The answer of the service is NOT the envelope of the site: it holds
  // `pic_str` (sometimes inside `data`).
  const ocrEnvelope = asRecord(ocrResponse.data)
  const ocrData = asRecord(ocrEnvelope?.data)
  const picStr = pickString(ocrEnvelope, ['pic_str']) ?? pickString(ocrData, ['pic_str'])
  if (picStr === undefined) {
    throw new LoginTokenError('ocr', OCR_MISSING_MESSAGE)
  }

  // Step 3 — the login.
  const loginResponse = await requestJson(
    siteUrl(origin, LOGIN_PATH),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: credentials.siteUsername,
        password: credentials.sitePassword,
        captcha: picStr,
        captchaKey,
        captchaImgBase: imageBase,
      }),
    },
    { fetchImpl: doFetch, timeoutMs },
    LOGIN_NETWORK_MESSAGE,
  )
  if (!loginResponse.ok) {
    throw new LoginTokenError('login', LOGIN_REFUSED_MESSAGE)
  }
  assertSiteOk(loginResponse.data, 'login', LOGIN_REFUSED_MESSAGE)

  // Step 4 — the token.
  const token = findToken(loginResponse.data)
  if (token === undefined) {
    throw new LoginTokenError('token', TOKEN_MISSING_MESSAGE)
  }
  return token
}
