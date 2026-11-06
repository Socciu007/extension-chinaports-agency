import {
  fetchJsonWithTimeout,
  HttpTimeoutError,
  HTTP_TIMEOUT_MS,
  type JsonResponse,
} from './http'
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
  credentials: LoginCredentials
  fetchImpl?: typeof fetch
  timeoutMs?: number
  siteOrigin?: string
  captchaServiceUrl?: string
}

const MISSING_CREDENTIALS_MESSAGE = 'Username and password are required.'
const CAPTCHA_HTTP_MESSAGE = 'The site refused to give a captcha image.'
const CAPTCHA_MISSING_MESSAGE = 'The site did not return the captcha image.'
const CAPTCHA_NETWORK_MESSAGE = 'Could not reach the site to get the captcha.'
const CAPTCHA_TIMEOUT_MESSAGE =
  'The site did not answer in time when it was asked for the captcha.'
const OCR_MISSING_MESSAGE = 'The captcha service did not return the captcha text.'
const OCR_HTTP_MESSAGE = 'The captcha service did not return the captcha text'
const OCR_NETWORK_MESSAGE = 'Could not reach the captcha service.'
const OCR_TIMEOUT_MESSAGE = 'The captcha service did not answer in time.'
const LOGIN_HTTP_MESSAGE = 'The site refused the login'
const LOGIN_NETWORK_MESSAGE = 'Could not reach the site to log in.'
const LOGIN_TIMEOUT_MESSAGE =
  'The site did not answer in time when it was asked to log in.'
const TOKEN_MISSING_MESSAGE = 'The site did not return a token after the login.'

/** The message of an HTTP error — the status is part of the diagnosis. */
function httpMessage(message: string, status: number): string {
  return `${message} (HTTP ${status}). Please try again.`
}

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

/** A string field of the credentials — trimmed; anything that is not a string is empty. */
function trimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The credentials with every field trimmed.
 *
 * The check for "is it filled in?" and the login itself use the same values,
 * so a stray space can never make the check pass and the login fail.
 */
function normalizeCredentials(credentials: LoginCredentials | undefined): LoginCredentials {
  return {
    username: trimmedText(credentials?.username),
    password: trimmedText(credentials?.password),
    captcha: trimmedText(credentials?.captcha),
    captchaKey: credentials?.captchaKey ?? 0,
    captchaImgBase: trimmedText(credentials?.captchaImgBase),
  }
}

/**
 * A request that returns JSON — a network error becomes a `LoginTokenError`.
 *
 * The message is the one of the caller: the site and the captcha service are
 * two different things and the operator must know which one is unreachable.
 * A timeout is a different thing again ⇒ it gets its own message.
 */
async function requestJson(
  url: string,
  init: RequestInit,
  options: { fetchImpl: typeof fetch; timeoutMs: number },
  networkMessage: string,
  timeoutMessage: string,
): Promise<JsonResponse> {
  try {
    return await fetchJsonWithTimeout(url, init, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    })
  } catch (e) {
    // Keep the cause: the operator must know WHY the request failed. A fetch
    // error carries no request body ⇒ the password cannot leak through it.
    console.warn('[manifest-autofill] a login request failed', e)
    if (e instanceof HttpTimeoutError) {
      throw new LoginTokenError('network', timeoutMessage)
    }
    throw new LoginTokenError('network', networkMessage)
  }
}

/** The code of the envelope — a number, or a string that holds a number. */
function siteCode(payload: unknown): number | undefined {
  const raw = asRecord(payload)?.code
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
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
  const code = siteCode(payload)
  if (code === undefined) return
  if (code === SITE_OK_CODE) return
  throw new LoginTokenError(kind, message)
}

/**
 * The token of the answer of the login.
 *
 * The site may put the token in the envelope, in `data` or in `data.data` ⇒
 * all three places are searched. A `JWT ` / `Bearer ` prefix is stripped.
 *
 * LAST RESORT: the answer may BE the token — `{"code":2000,"data":"<jwt>"}`
 * ⇒ a non-empty string in `data` is taken as the token.
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
  // LAST RESORT — the answer may BE the token: `{"code":2000,"data":"<jwt>"}`.
  if (typeof envelope.data === 'string') {
    const token = stripAuthPrefix(envelope.data.trim())
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
export async function fetchTokenByLogin(
  options: LoginTokenOptions | undefined,
): Promise<string> {
  const credentials = normalizeCredentials(options?.credentials)
  if (!credentials.username || !credentials.password) throw new LoginTokenError('credentials', MISSING_CREDENTIALS_MESSAGE)

  const doFetch = options?.fetchImpl ?? fetch
  const timeoutMs = options?.timeoutMs ?? HTTP_TIMEOUT_MS
  const origin = options?.siteOrigin ?? SITE_ORIGIN
  const captchaServiceUrl = options?.captchaServiceUrl ?? CAPTCHA_SERVICE_URL

  // Step 1 — the captcha image and its key.
  const captchaResponse = await requestJson(
    siteUrl(origin, CAPTCHA_PATH),
    { method: 'GET', credentials: 'include' },
    { fetchImpl: doFetch, timeoutMs },
    CAPTCHA_NETWORK_MESSAGE,
    CAPTCHA_TIMEOUT_MESSAGE,
  )
  if (!captchaResponse.ok) {
    // The site answered with an HTTP error ⇒ it did not give a captcha.
    throw new LoginTokenError(
      'captcha',
      httpMessage(CAPTCHA_HTTP_MESSAGE, captchaResponse.status),
    )
  }

  const captchaEnvelope = asRecord(captchaResponse.data)
  const captchaData = asRecord(captchaEnvelope?.data)
  const bareImage =
    typeof captchaEnvelope?.data === 'string' ? captchaEnvelope.data.trim() : ''
  const imageBase =
    pickString(captchaData, ['image_base']) ??
    pickString(captchaEnvelope, ['image_base']) ??
    (bareImage === '' ? undefined : bareImage)
  const captchaKey = captchaData?.key ?? ''
  if (!captchaKey || !imageBase) throw new LoginTokenError('captcha', CAPTCHA_MISSING_MESSAGE)
  console.log('Complete captcha data')
  
  // Step 2 — the captcha service reads the image.
  const form = new FormData()
  form.append('user', 'nfwyst')
  form.append('pass', 'daisikia');
  form.append('softid', '898124');
  form.append('codetype', '6001');
  form.append('file_base64', base64PartOf(imageBase))

  const ocrResponse = await requestJson(
    captchaServiceUrl,
    { method: 'POST', body: form },
    { fetchImpl: doFetch, timeoutMs },
    OCR_NETWORK_MESSAGE,
    OCR_TIMEOUT_MESSAGE,
  )
  if (!ocrResponse.ok) throw new LoginTokenError('ocr', httpMessage(OCR_HTTP_MESSAGE, ocrResponse.status))
  const ocrData = asRecord(ocrResponse.data)
  const picStr = pickString(ocrData, ['pic_str'])
  if (!picStr) throw new LoginTokenError('ocr', OCR_MISSING_MESSAGE)
  console.log('Complete ocr to decode captcha')

  // Step 3 — the login.
  const loginResponse = await requestJson(
    siteUrl(origin, LOGIN_PATH),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        username: credentials.username,
        password: credentials.password,
        captcha: picStr,
        captchaKey,
        captchaImgBase: imageBase,
      }),
    },
    { fetchImpl: doFetch, timeoutMs },
    LOGIN_NETWORK_MESSAGE,
    LOGIN_TIMEOUT_MESSAGE,
  )
  if (!loginResponse.ok || (!loginResponse.data || !(loginResponse.data as Record<string, unknown>).data)) throw new LoginTokenError('login', httpMessage(LOGIN_HTTP_MESSAGE, loginResponse.status))
  console.log('Complete login')

  // Step 4 — the token.
  const loginData = loginResponse.data as Record<string, unknown>
  const token = (loginData.data as Record<string, unknown>)?.access
  if (!token || typeof token !== 'string') throw new LoginTokenError('token', TOKEN_MISSING_MESSAGE)
  return token
}
