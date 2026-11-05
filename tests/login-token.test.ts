import { describe, it, expect, vi } from 'vitest'
import {
  CAPTCHA_PATH,
  CAPTCHA_SERVICE_URL,
  fetchTokenByLogin,
  LOGIN_PATH,
  LoginTokenError,
} from '../src/core/login-token'
import type { LoginCredentials } from '../src/core/login-credentials'

const ORIGIN = 'https://site.test'
const CAPTCHA_URL = `${ORIGIN}${CAPTCHA_PATH}`
const LOGIN_URL = `${ORIGIN}${LOGIN_PATH}`

const CREDENTIALS: LoginCredentials = {
  siteUsername: 'site-user',
  sitePassword: 'site-pass',
  ocrUser: 'ocr-user',
  ocrPassword: 'ocr-pass',
  ocrSoftwareId: 'soft-id',
}

/** The captcha image of the site — a data URL with the base64 part after the comma. */
const IMAGE_BASE = 'data:image/png;base64,AAABBB'
/** The base64 PART of the image — what the captcha service expects. */
const IMAGE_B64 = 'AAABBB'

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

/** Answers of the fake fetch — the default answer of every step. */
interface FakeAnswers {
  captcha?: () => Response
  ocr?: () => Response
  login?: () => Response
}

/** One request that the fake fetch has received. */
interface RecordedCall {
  url: string
  init: RequestInit | undefined
}

/**
 * A fake `fetch` that answers BY URL: the captcha of the site, the captcha
 * service, then the login of the site.
 */
function fakeFetch(answers: FakeAnswers = {}): {
  fetchImpl: typeof fetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url)
    calls.push({ url: target, init })
    if (target === CAPTCHA_URL) {
      return (
        answers.captcha?.() ??
        jsonResponse({ code: 2000, data: { image_base: IMAGE_BASE, key: 'captcha-key' } })
      )
    }
    if (target === CAPTCHA_SERVICE_URL) {
      return answers.ocr?.() ?? jsonResponse({ pic_str: '8F2K' })
    }
    if (target === LOGIN_URL) {
      return (
        answers.login?.() ?? jsonResponse({ code: 2000, data: { token: 'the-token' } })
      )
    }
    throw new Error(`Unexpected URL: ${target}`)
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

/** The error of a rejected promise — always a `LoginTokenError`. */
async function errorOf(promise: Promise<unknown>): Promise<LoginTokenError> {
  try {
    await promise
  } catch (e) {
    if (e instanceof LoginTokenError) return e
    throw e
  }
  throw new Error('Expected the promise to reject, but it resolved')
}

/** The JSON body of the login request. */
function loginBodyOf(calls: RecordedCall[]): Record<string, unknown> {
  const call = calls.find((entry) => entry.url === LOGIN_URL)
  return JSON.parse(String(call?.init?.body)) as Record<string, unknown>
}

describe('fetchTokenByLogin — cả luồng', () => {
  it('captcha ⇒ captcha service ⇒ login ⇒ trả về token', async () => {
    const { fetchImpl, calls } = fakeFetch()

    const token = await fetchTokenByLogin({
      credentials: CREDENTIALS,
      fetchImpl,
      siteOrigin: ORIGIN,
    })

    expect(token).toBe('the-token')
    expect(calls.map((call) => call.url)).toEqual([
      CAPTCHA_URL,
      CAPTCHA_SERVICE_URL,
      LOGIN_URL,
    ])
  })

  it('captcha service nhận FormData: user/pass/softid/codetype + base64 PART', async () => {
    const { fetchImpl, calls } = fakeFetch()

    await fetchTokenByLogin({ credentials: CREDENTIALS, fetchImpl, siteOrigin: ORIGIN })

    const call = calls.find((entry) => entry.url === CAPTCHA_SERVICE_URL)
    const body = call?.init?.body
    expect(body).toBeInstanceOf(FormData)
    const form = body as FormData
    expect(form.get('user')).toBe('ocr-user')
    expect(form.get('pass')).toBe('ocr-pass')
    expect(form.get('softid')).toBe('soft-id')
    expect(form.get('codetype')).toBe('6001')
    // CHỈ phần base64 — không có tiền tố data URL.
    expect(form.get('file_base64')).toBe(IMAGE_B64)
    // KHÔNG được tự đặt Content-Type — browser phải tự đặt boundary.
    expect(new Headers(call?.init?.headers).get('content-type')).toBeNull()
  })

  it('login gửi username/password/captcha/captchaKey/captchaImgBase', async () => {
    const { fetchImpl, calls } = fakeFetch()

    await fetchTokenByLogin({ credentials: CREDENTIALS, fetchImpl, siteOrigin: ORIGIN })

    const body = loginBodyOf(calls)
    expect(body.username).toBe('site-user')
    expect(body.password).toBe('site-pass')
    expect(body.captcha).toBe('8F2K')
    expect(body.captchaKey).toBe('captcha-key')
    expect(body.captchaImgBase).toBe(IMAGE_BASE)
  })

  it('chữ của captcha cũng đọc được từ `data` của captcha service', async () => {
    const { fetchImpl, calls } = fakeFetch({
      ocr: () => jsonResponse({ data: { pic_str: '9Z' } }),
    })

    const token = await fetchTokenByLogin({
      credentials: CREDENTIALS,
      fetchImpl,
      siteOrigin: ORIGIN,
    })

    expect(token).toBe('the-token')
    expect(loginBodyOf(calls).captcha).toBe('9Z')
  })
})

describe('fetchTokenByLogin — đọc token', () => {
  it('token nằm ở `data` của envelope', async () => {
    const { fetchImpl } = fakeFetch({
      login: () => jsonResponse({ code: 2000, data: { token: 'in-data' } }),
    })

    const token = await fetchTokenByLogin({
      credentials: CREDENTIALS,
      fetchImpl,
      siteOrigin: ORIGIN,
    })

    expect(token).toBe('in-data')
  })

  it('token nằm ở `data.data` của envelope', async () => {
    const { fetchImpl } = fakeFetch({
      login: () => jsonResponse({ code: 2000, data: { data: { jwt: 'in-nested' } } }),
    })

    const token = await fetchTokenByLogin({
      credentials: CREDENTIALS,
      fetchImpl,
      siteOrigin: ORIGIN,
    })

    expect(token).toBe('in-nested')
  })

  it('token có tiền tố `JWT ` ⇒ trả về KHÔNG có tiền tố', async () => {
    const { fetchImpl } = fakeFetch({
      login: () => jsonResponse({ code: 2000, data: { token: 'JWT abc.def' } }),
    })

    const token = await fetchTokenByLogin({
      credentials: CREDENTIALS,
      fetchImpl,
      siteOrigin: ORIGIN,
    })

    expect(token).toBe('abc.def')
  })

  it('token có tiền tố `Bearer ` ⇒ trả về KHÔNG có tiền tố', async () => {
    const { fetchImpl } = fakeFetch({
      login: () => jsonResponse({ code: 2000, data: { access_token: 'bearer abc.def' } }),
    })

    const token = await fetchTokenByLogin({
      credentials: CREDENTIALS,
      fetchImpl,
      siteOrigin: ORIGIN,
    })

    expect(token).toBe('abc.def')
  })
})

describe('fetchTokenByLogin — lỗi', () => {
  it('thiếu thông tin đăng nhập ⇒ kind credentials, KHÔNG gọi mạng', async () => {
    const { fetchImpl, calls } = fakeFetch()

    const err = await errorOf(
      fetchTokenByLogin({
        credentials: { ...CREDENTIALS, sitePassword: '   ' },
        fetchImpl,
        siteOrigin: ORIGIN,
      }),
    )

    expect(err.kind).toBe('credentials')
    expect(err.message).toContain('extension options')
    expect(calls).toHaveLength(0)
  })

  it('site từ chối cho captcha ⇒ kind captcha', async () => {
    const { fetchImpl } = fakeFetch({
      captcha: () => jsonResponse({ code: 5000, data: null, msg: 'boom' }),
    })

    const err = await errorOf(
      fetchTokenByLogin({ credentials: CREDENTIALS, fetchImpl, siteOrigin: ORIGIN }),
    )

    expect(err.kind).toBe('captcha')
  })

  it('site KHÔNG trả ảnh captcha ⇒ kind captcha', async () => {
    const { fetchImpl } = fakeFetch({
      captcha: () => jsonResponse({ code: 2000, data: { key: 'captcha-key' } }),
    })

    const err = await errorOf(
      fetchTokenByLogin({ credentials: CREDENTIALS, fetchImpl, siteOrigin: ORIGIN }),
    )

    expect(err.kind).toBe('captcha')
  })

  it('captcha service KHÔNG trả chữ ⇒ kind ocr', async () => {
    const { fetchImpl } = fakeFetch({ ocr: () => jsonResponse({ pic_str: '' }) })

    const err = await errorOf(
      fetchTokenByLogin({ credentials: CREDENTIALS, fetchImpl, siteOrigin: ORIGIN }),
    )

    expect(err.kind).toBe('ocr')
  })

  it('site từ chối đăng nhập ⇒ kind login', async () => {
    const { fetchImpl } = fakeFetch({
      login: () => jsonResponse({ code: 4000, data: null, msg: 'bad captcha' }),
    })

    const err = await errorOf(
      fetchTokenByLogin({ credentials: CREDENTIALS, fetchImpl, siteOrigin: ORIGIN }),
    )

    expect(err.kind).toBe('login')
  })

  it('site KHÔNG trả token ⇒ kind token', async () => {
    const { fetchImpl } = fakeFetch({
      login: () => jsonResponse({ code: 2000, data: { ok: true } }),
    })

    const err = await errorOf(
      fetchTokenByLogin({ credentials: CREDENTIALS, fetchImpl, siteOrigin: ORIGIN }),
    )

    expect(err.kind).toBe('token')
  })

  it('mạng hỏng lúc lấy captcha ⇒ kind network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Failed to fetch')
    }) as unknown as typeof fetch

    const err = await errorOf(
      fetchTokenByLogin({ credentials: CREDENTIALS, fetchImpl, siteOrigin: ORIGIN }),
    )

    expect(err.kind).toBe('network')
  })

  it('mạng hỏng lúc gọi captcha service ⇒ kind network', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url) === CAPTCHA_SERVICE_URL) throw new Error('Failed to fetch')
      return jsonResponse({ code: 2000, data: { image_base: IMAGE_BASE, key: 'k' } })
    }) as unknown as typeof fetch

    const err = await errorOf(
      fetchTokenByLogin({ credentials: CREDENTIALS, fetchImpl, siteOrigin: ORIGIN }),
    )

    expect(err.kind).toBe('network')
  })

  it('mạng hỏng lúc đăng nhập ⇒ kind network', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url) === LOGIN_URL) throw new Error('Failed to fetch')
      if (String(url) === CAPTCHA_SERVICE_URL) return jsonResponse({ pic_str: '8F2K' })
      return jsonResponse({ code: 2000, data: { image_base: IMAGE_BASE, key: 'k' } })
    }) as unknown as typeof fetch

    const err = await errorOf(
      fetchTokenByLogin({ credentials: CREDENTIALS, fetchImpl, siteOrigin: ORIGIN }),
    )

    expect(err.kind).toBe('network')
  })
})
