import { describe, it, expect, afterEach } from 'vitest'
import {
  normalizeDictOptions,
  pickArray,
  fetchPackageCode,
  fetchPortCode,
  readCookieToken,
  DEFAULT_SITE_API_BASE,
  SiteApiError,
  describeSiteError,
  type SiteApiErrorKind,
} from '../src/core/site-api'

/** Phần `init` mà module đưa cho fetch — dùng để ghim shape của request. */
interface CapturedInit {
  method?: string
  headers?: HeadersInit
  credentials?: string
}

/** Bắt lỗi của một request tới site — luôn là `SiteApiError` (không phải lỗi JS thô). */
async function rejectionOf(promise: Promise<unknown>): Promise<SiteApiError> {
  try {
    await promise
  } catch (e) {
    if (e instanceof SiteApiError) return e
    throw e
  }
  throw new Error('Expected the promise to reject, but it resolved')
}

describe('normalizeDictOptions', () => {
  it('đọc mảng {code, name}', () => {
    const options = normalizeDictOptions([{ code: 'MAEU', name: '马士基' }])
    expect(options[0]).toMatchObject({ code: 'MAEU', name: '马士基' })
  })

  it('đọc mảng {value, label}', () => {
    const options = normalizeDictOptions([{ value: 'FOB', label: 'FOB' }])
    expect(options[0]).toMatchObject({ code: 'FOB', name: 'FOB' })
  })

  it('bọc payload {data: [...]}', () => {
    const options = normalizeDictOptions({ data: [{ code: 'CNSHA', name: '上海' }] })
    expect(options[0]).toMatchObject({ code: 'CNSHA', name: '上海' })
  })

  it('đọc mảng chuỗi thuần', () => {
    const options = normalizeDictOptions(['FOB', 'CIF'])
    expect(options[0]).toMatchObject({ code: 'FOB', name: 'FOB' })
  })

  it('đọc mã của getTrustCode theo TRUST_COD', () => {
    const options = normalizeDictOptions([{ id: 2, TRUST_COD: 'MAEU' }])
    expect(options[0]).toMatchObject({ code: 'MAEU', id: '2' })
  })

  it('đọc cảng theo E_PORT_NAM + PORT_COD', () => {
    const options = normalizeDictOptions([{ E_PORT_NAM: '上海', PORT_COD: 'CNSHA' }])
    expect(options[0]).toMatchObject({ code: 'CNSHA', name: '上海' })
  })

  it('bỏ qua phần tử không có mã', () => {
    expect(normalizeDictOptions([{ note: 'x' }])).toHaveLength(0)
  })
})

describe('pickArray', () => {
  it('lấy mảng lồng theo key', () => {
    const payload = { cntr_type: [{ code: '2', name: '20GP' }], cntr_size: [] }
    expect(pickArray(payload, ['cntr_type', 'cntrType'])).toHaveLength(1)
  })

  it('lấy mảng data khi không có key yêu cầu', () => {
    expect(pickArray({ data: [1, 2] }, ['cntr_type'])).toHaveLength(2)
  })
})

describe('readCookieToken', () => {
  it('đọc cookie token', () => {
    expect(readCookieToken('a=1; token=abc.def; b=2')).toBe('abc.def')
  })

  it('trả undefined khi không có', () => {
    expect(readCookieToken('a=1')).toBeUndefined()
  })
})

describe('request tới site — header và cookie', () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response

  it('gửi credentials + header Authorization của cookie token', async () => {
    const inits: CapturedInit[] = []
    const fakeFetch = (async (_url: string, init?: CapturedInit) => {
      inits.push(init ?? {})
      return okResponse({ code: 2000, data: [] })
    }) as unknown as typeof fetch

    await fetchPortCode('SHANGHAI', {
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })

    expect(inits).toHaveLength(1)
    // Cookie của site phải được gửi kèm (API cùng origin của site).
    expect(inits.every((i) => i.credentials === 'include')).toBe(true)
    expect(inits.every((i) => i.method === 'GET')).toBe(true)
    expect(inits.every((i) => new Headers(i.headers).get('authorization') === 'JWT abc')).toBe(true)
  })

  it('không gửi header Authorization khi không có token', async () => {
    const inits: CapturedInit[] = []
    const fakeFetch = (async (_url: string, init?: CapturedInit) => {
      inits.push(init ?? {})
      return okResponse({ code: 2000, data: [] })
    }) as unknown as typeof fetch

    await fetchPortCode('SHANGHAI', {
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: '',
    })

    expect(inits).toHaveLength(1)
    expect(inits.every((i) => new Headers(i.headers).get('authorization') === null)).toBe(true)
  })
})

/**
 * The token of the login WINS over the cookie of the site.
 *
 * The login mode gets the token from `/api/login/` ⇒ the site may have no
 * cookie at all (or an old one) ⇒ the token passed in must be the one used.
 */
describe('token truyền vào thắng cookie của site', () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response

  afterEach(() => {
    // jsdom keeps the cookie between tests ⇒ it has to be cleared.
    document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  it('có `token` trong options ⇒ KHÔNG dùng cookie của document', async () => {
    document.cookie = 'token=cookie-token'
    const inits: CapturedInit[] = []
    const fakeFetch = (async (_url: string, init?: CapturedInit) => {
      inits.push(init ?? {})
      return okResponse({ code: 2000, data: [] })
    }) as unknown as typeof fetch

    await fetchPortCode('SHANGHAI', {
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      token: 'login-token',
    })

    expect(inits).toHaveLength(1)
    expect(new Headers(inits[0]?.headers).get('authorization')).toBe('JWT login-token')
  })

  it('KHÔNG có `token` ⇒ vẫn dùng cookie của document', async () => {
    document.cookie = 'token=cookie-token'
    const inits: CapturedInit[] = []
    const fakeFetch = (async (_url: string, init?: CapturedInit) => {
      inits.push(init ?? {})
      return okResponse({ code: 2000, data: [] })
    }) as unknown as typeof fetch

    await fetchPortCode('SHANGHAI', {
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
    })

    expect(inits).toHaveLength(1)
    expect(new Headers(inits[0]?.headers).get('authorization')).toBe('JWT cookie-token')
  })
})

describe('fetchPackageCode', () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response

  /** Fetch giả của site — ghi lại URL rồi trả về `body`. */
  function fakeSite(body: unknown): { fetchImpl: typeof fetch; urls: string[] } {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(String(url))
      return okResponse(body)
    }) as unknown as typeof fetch
    return { fetchImpl, urls }
  }

  const optionsOf = (fetchImpl: typeof fetch) => ({
    baseUrl: '/api/test',
    fetchImpl,
    cookieString: 'token=abc',
  })

  it('trùng tên ⇒ trả mã, và URL đúng như site gửi', async () => {
    const { fetchImpl, urls } = fakeSite({
      code: 2000,
      data: [{ PACKAGE_COD: 'PKGS', E_PACKAGE_NAM: 'PACKAGES' }],
    })

    const code = await fetchPackageCode('PACKAGES', optionsOf(fetchImpl))

    expect(code).toBe('PKGS')
    expect(urls[0]).toContain('kw=PACKAGES')
    // Filter của site CÓ DẤU CÁCH Ở ĐẦU ⇒ `%20`.
    expect(urls[0]).toContain('filter=%20E_PACKAGE_NAM')
  })

  it('chỉ có MỘT dòng ⇒ lấy mã của dòng đó (không cần trùng tên)', async () => {
    const { fetchImpl } = fakeSite({
      code: 2000,
      data: [{ PACKAGE_COD: 'PKGS', E_PACKAGE_NAM: 'PACKAGES (木箱)' }],
    })

    const code = await fetchPackageCode('PACKAGES', optionsOf(fetchImpl))

    expect(code).toBe('PKGS')
  })

  it('NHIỀU dòng mà không dòng nào trùng tên ⇒ undefined', async () => {
    const { fetchImpl } = fakeSite({
      code: 2000,
      data: [
        { PACKAGE_COD: 'PKG1', E_PACKAGE_NAM: 'WOODEN CASES' },
        { PACKAGE_COD: 'PKG2', E_PACKAGE_NAM: 'STEEL DRUMS' },
      ],
    })

    const code = await fetchPackageCode('PACKAGES', optionsOf(fetchImpl))

    expect(code).toBeUndefined()
  })

  it('tên rỗng ⇒ KHÔNG gọi site', async () => {
    const { fetchImpl, urls } = fakeSite({ code: 2000, data: [] })

    const code = await fetchPackageCode('   ', optionsOf(fetchImpl))

    expect(code).toBeUndefined()
    expect(urls).toHaveLength(0)
  })

  it('site trả lỗi 4000 ⇒ promise reject', async () => {
    const fakeFetch = (async () =>
      okResponse({ code: 4000, data: null, msg: 'session' })) as unknown as typeof fetch

    const err = await rejectionOf(fetchPackageCode('PACKAGES', optionsOf(fakeFetch)))
    expect(err.kind).toBe('session')
    expect(err.code).toBe(4000)
  })
})

describe('fetchPortCode', () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response

  /** Fetch giả của site — ghi lại URL rồi trả về `body`. */
  function fakeSite(body: unknown): { fetchImpl: typeof fetch; urls: string[] } {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(String(url))
      return okResponse(body)
    }) as unknown as typeof fetch
    return { fetchImpl, urls }
  }

  const optionsOf = (fetchImpl: typeof fetch) => ({
    baseUrl: '/api/test',
    fetchImpl,
    cookieString: 'token=abc',
  })

  it('trùng tên ⇒ trả mã, và URL đúng như site gửi', async () => {
    // Dict có NHIỀU dòng ⇒ mã chỉ đúng khi khớp TÊN (đường dẫn "chỉ có
    // MỘT dòng" thì không cần khớp tên — test riêng ở dưới).
    const { fetchImpl, urls } = fakeSite({
      code: 2000,
      data: [
        { PORT_COD: 'CNSHA', E_PORT_NAM: '上海', E_PORT_NAM_EN: 'SHANGHAI' },
        { PORT_COD: 'IDBLW', E_PORT_NAM: '勿拉湾', E_PORT_NAM_EN: 'BELAWAN' },
      ],
    })

    const code = await fetchPortCode('SHANGHAI', optionsOf(fetchImpl))

    expect(code).toBe('CNSHA')
    expect(urls[0]).toContain('kw=SHANGHAI')
    expect(urls[0]).toContain('filter=E_PORT_NAM')
  })

  it('tên cảng tiếng Anh nằm ở cột KHÁC `E_PORT_NAM` ⇒ vẫn khớp', async () => {
    // Dict của site lưu tên Trung ở `E_PORT_NAM` ⇒ tên Anh có thể nằm ở
    // cột khác ⇒ khớp theo GIÁ TRỊ, không theo một cột cố định.
    // Nhiều dòng ⇒ chỉ đúng khi khớp TÊN, không phải do có một dòng.
    const { fetchImpl } = fakeSite({
      code: 2000,
      data: [
        { PORT_COD: 'CNSHA', E_PORT_NAM: '上海', PORT_NAM_EN: 'SHANGHAI' },
        { PORT_COD: 'IDBLW', E_PORT_NAM: '勿拉湾', PORT_NAM_EN: 'BELAWAN' },
      ],
    })

    const code = await fetchPortCode('SHANGHAI', optionsOf(fetchImpl))

    expect(code).toBe('CNSHA')
  })

  it('chỉ có MỘT dòng ⇒ lấy mã của dòng đó (không cần trùng tên)', async () => {
    const { fetchImpl } = fakeSite({
      code: 2000,
      data: [{ PORT_COD: 'CNSHA', E_PORT_NAM: '上海' }],
    })

    const code = await fetchPortCode('SHANGHAI', optionsOf(fetchImpl))

    expect(code).toBe('CNSHA')
  })

  it('NHIỀU dòng mà không dòng nào trùng tên ⇒ undefined', async () => {
    const { fetchImpl } = fakeSite({
      code: 2000,
      data: [
        { PORT_COD: 'CNSHA', E_PORT_NAM: '上海' },
        { PORT_COD: 'IDBLW', E_PORT_NAM: '勿拉湾' },
      ],
    })

    const code = await fetchPortCode('SURABAYA', optionsOf(fetchImpl))

    expect(code).toBeUndefined()
  })

  it('tên rỗng ⇒ KHÔNG gọi site', async () => {
    const { fetchImpl, urls } = fakeSite({ code: 2000, data: [] })

    const code = await fetchPortCode('   ', optionsOf(fetchImpl))

    expect(code).toBeUndefined()
    expect(urls).toHaveLength(0)
  })

  it('site trả lỗi 4000 ⇒ promise reject', async () => {
    const fakeFetch = (async () =>
      okResponse({ code: 4000, data: null, msg: 'session' })) as unknown as typeof fetch

    const err = await rejectionOf(fetchPortCode('SHANGHAI', optionsOf(fakeFetch)))
    expect(err.kind).toBe('session')
    expect(err.code).toBe(4000)
  })
})

describe('DEFAULT_SITE_API_BASE', () => {
  it('trỏ đúng base của site', () => {
    expect(DEFAULT_SITE_API_BASE).toBe('/api/booking/exportManifestDataMaintain')
  })
})

// --- Bổ sung 2026-10-27 sau khi kiểm tra header/endpoint thật của site ---

describe('envelope {code, data, msg} của site', () => {
  it('normalizeDictOptions bóc vỏ data', () => {
    const options = normalizeDictOptions({
      code: 200,
      data: [{ code: 'MAEU', name: '马士基' }],
    })
    expect(options[0]).toMatchObject({ code: 'MAEU', name: '马士基' })
  })

  it('pickArray tìm thấy mảng lồng trong data', () => {
    const payload = {
      code: 200,
      data: { cntr_type: [{ code: '2', name: '20GP' }], cntr_size: [] },
    }
    expect(pickArray(payload, ['cntr_type', 'cntrType'])).toHaveLength(1)
    expect(pickArray(payload, ['cntr_size', 'cntrSize'])).toHaveLength(0)
  })
})

describe('tra cảng khi session hết hạn', () => {
  it('báo lỗi rõ ràng thay vì trả mã rỗng', async () => {
    const fakeFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 4000, data: null, msg: '身份认证信息未提供。' }),
    })) as unknown as typeof fetch

    await expect(
      fetchPortCode('SHANGHAI', {
        baseUrl: '/api/test',
        fetchImpl: fakeFetch,
        cookieString: 'token=abc',
      }),
    ).rejects.toThrow(/session/i)
  })
})

// --- Rà soát code-quality: envelope phải khoá theo MÃ THÀNH CÔNG của site ---

describe('envelope khoá theo mã thành công 2000', () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response

  it('lỗi của site (code khác 2000) phải ném, kể cả khi data khác null', async () => {
    const fakeFetch = (async () =>
      okResponse({ code: 5000, data: [], msg: '系统错误' })) as unknown as typeof fetch

    const err = await rejectionOf(
      fetchPortCode('SHANGHAI', {
        baseUrl: '/api/test',
        fetchImpl: fakeFetch,
        cookieString: 'token=abc',
      }),
    )
    expect(err.kind).toBe('site')
    expect(err.code).toBe(5000)
  })

  it('envelope thành công với data null KHÔNG ném — dict rỗng là hợp lệ', async () => {
    const fakeFetch = (async () => okResponse({ code: 2000, data: null })) as unknown as typeof fetch

    const code = await fetchPortCode('SHANGHAI', {
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })
    expect(code).toBeUndefined()
  })

  it('lỗi mạng → kind network', async () => {
    const fakeFetch = (async () => {
      throw new Error('Failed to fetch')
    }) as unknown as typeof fetch

    const err = await rejectionOf(
      fetchPortCode('SHANGHAI', {
        baseUrl: '/api/test',
        fetchImpl: fakeFetch,
        cookieString: 'token=abc',
      }),
    )
    expect(err.kind).toBe('network')
  })

  it('body không phải JSON → kind bad_response', async () => {
    const fakeFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0')
      },
    })) as unknown as typeof fetch

    const err = await rejectionOf(
      fetchPortCode('SHANGHAI', {
        baseUrl: '/api/test',
        fetchImpl: fakeFetch,
        cookieString: 'token=abc',
      }),
    )
    expect(err.kind).toBe('bad_response')
  })

  it('HTTP 500 → kind http', async () => {
    const fakeFetch = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({ code: 2000, data: [] }),
    })) as unknown as typeof fetch

    const err = await rejectionOf(
      fetchPortCode('SHANGHAI', {
        baseUrl: '/api/test',
        fetchImpl: fakeFetch,
        cookieString: 'token=abc',
      }),
    )
    expect(err.kind).toBe('http')
    expect(err.code).toBe(500)
  })

  it('code 4000 → kind session, message vẫn nói "session"', async () => {
    const fakeFetch = (async () =>
      okResponse({ code: 4000, data: null, msg: '身份认证信息未提供。' })) as unknown as typeof fetch

    const err = await rejectionOf(
      fetchPortCode('SHANGHAI', {
        baseUrl: '/api/test',
        fetchImpl: fakeFetch,
        cookieString: 'token=abc',
      }),
    )
    expect(err.kind).toBe('session')
    expect(err.code).toBe(4000)
    expect(err.message).toMatch(/session/i)
  })

  it('hết giờ → kind timeout, không phải lỗi mạng', async () => {
    // Fetch treo mãi, chỉ chờ tín hiệu abort của timeout.
    const fakeFetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch

    const err = await rejectionOf(
      fetchPortCode('SHANGHAI', {
        baseUrl: '/api/test',
        fetchImpl: fakeFetch,
        cookieString: 'token=abc',
        timeoutMs: 20,
      }),
    )
    expect(err.kind).toBe('timeout')
  })
})

describe('describeSiteError', () => {
  it('trả câu tiếng Anh riêng biệt cho từng kind', () => {
    const kinds: SiteApiErrorKind[] = [
      'session',
      'site',
      'network',
      'http',
      'bad_response',
      'bad_request',
      'timeout',
    ]
    const sentences = kinds.map((kind) => describeSiteError(new SiteApiError(kind, 'raw detail')))

    for (const sentence of sentences) {
      expect(sentence).toMatch(/\S/)
      // Không lộ message kỹ thuật, không dùng nhãn tiếng Trung của site.
      expect(sentence).not.toContain('raw detail')
      expect(sentence).not.toMatch(/[一-鿿]/)
    }
    expect(new Set(sentences).size).toBe(sentences.length)
  })

  it('trả câu chung cho lỗi không phải SiteApiError', () => {
    const sentence = describeSiteError(new Error('boom'))
    expect(sentence).toMatch(/\S/)
    expect(sentence).not.toContain('boom')
  })

  it('bad_request ⇒ thông báo cho biết request chưa hề được gửi', () => {
    const message = describeSiteError(new SiteApiError('bad_request', 'x'))
    expect(message).toContain('was not sent to the site')
  })
})

describe('dict cảng — ưu tiên key thật của site', () => {
  it('E_PORT_NAM thắng key generic name', () => {
    const options = normalizeDictOptions(
      [{ E_PORT_NAM: '上海', name: 'Shanghai', PORT_COD: 'CNSHA' }],
      { codeKeys: ['PORT_COD'], nameKeys: ['E_PORT_NAM'] },
    )
    expect(options[0]).toMatchObject({ code: 'CNSHA', name: '上海' })
  })

  it('PORT_COD thắng key generic code', () => {
    const options = normalizeDictOptions(
      [{ E_PORT_NAM: '上海', PORT_COD: 'CNSHA', code: 'XX' }],
      { codeKeys: ['PORT_COD'], nameKeys: ['E_PORT_NAM'] },
    )
    expect(options[0]).toMatchObject({ code: 'CNSHA', name: '上海' })
  })

  it('tra cảng dùng key thật của site (`PORT_COD` thắng `code` generic)', async () => {
    const okResponse = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body }) as unknown as Response
    const fakeFetch = (async (url: string) => {
      if (url.includes('getPort')) {
        return okResponse({
          code: 2000,
          data: [{ E_PORT_NAM: '上海', name: 'Shanghai', PORT_COD: 'CNSHA', code: 'XX' }],
        })
      }
      return okResponse({ code: 2000, data: [] })
    }) as unknown as typeof fetch

    const code = await fetchPortCode('Shanghai', {
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })
    expect(code).toBe('CNSHA')
  })
})
