import { describe, it, expect } from 'vitest'
import {
  normalizeDictOptions,
  pickArray,
  createMappingContext,
  readCookieToken,
  loadSiteDicts,
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

/** Bắt lỗi của `loadSiteDicts` — luôn là `SiteApiError` (không phải lỗi JS thô). */
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

  it('đọc mảng chuỗi thuần của getDrType', () => {
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

describe('createMappingContext', () => {
  const dicts = {
    trustCodes: normalizeDictOptions([{ id: 2, TRUST_COD: 'MAEU' }]),
    drTypes: normalizeDictOptions(['FOB', 'CIF']),
    ports: normalizeDictOptions([{ E_PORT_NAM: '上海', PORT_COD: 'CNSHA' }]),
    // `getCntrCode/` trả **chuỗi thuần** (FACT 6.2) — không có id số.
    cntrTypes: normalizeDictOptions(['40', 'HQ']),
    cntrSizes: normalizeDictOptions(['20', '45']),
  }

  it('tìm 承运人 theo supplyId', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findTrustCode(2)).toBe('MAEU')
  })

  it('tìm 交货条款 theo mã', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findDrType('FOB')).toBe('FOB')
  })

  it('tìm cảng theo mã', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findPort('CNSHA')).toBe('上海')
  })

  it('tìm 箱型 và 尺寸 theo **chuỗi** trong dict', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findCntrType('HQ')).toBe('HQ')
    expect(ctx.findCntrSize('45')).toBe('45')
  })

  it('KHÔNG tra được 箱型/尺寸 từ mã số của API (C-5)', () => {
    // API cho `cType: 2`, `vC: 0` — mã số, còn dict của site chỉ có chuỗi.
    const ctx = createMappingContext(dicts)
    expect(ctx.findCntrType(2)).toBeUndefined()
    expect(ctx.findCntrSize(0)).toBeUndefined()
  })

  it('trả undefined khi không tìm thấy', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findPort('ZZZZZ')).toBeUndefined()
  })
})

describe('loadSiteDicts', () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response

  it('gọi đúng 4 endpoint, getPort kèm kw + filter', async () => {
    const calls: string[] = []
    const inits: CapturedInit[] = []
    const fakeFetch = (async (url: string, init?: CapturedInit) => {
      calls.push(url)
      inits.push(init ?? {})
      const body = url.includes('getTrustCode')
        ? { code: 2000, data: [{ id: 2, TRUST_COD: 'MAEU' }] }
        : url.includes('getDrType')
          ? { code: 2000, data: ['FOB', 'CIF'] }
          : url.includes('getPort')
            ? { code: 2000, data: [{ E_PORT_NAM: '上海', PORT_COD: 'CNSHA' }] }
            : {
                // `getCntrCode/` trả **chuỗi thuần**, tên key **ngược** (FACT 6.2).
                code: 2000,
                data: {
                  cntr_type: ['40', 'HQ'],
                  cntr_size: ['20', '45'],
                },
              }
      return okResponse(body)
    }) as unknown as typeof fetch

    const dicts = await loadSiteDicts({
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })

    expect(calls).toHaveLength(4)
    // URL phải chính xác — `new URLSearchParams({kw: ''})` → `"kw="`.
    expect(calls).toContain('/api/test/getTrustCode/?kw=')
    expect(calls).toContain('/api/test/getDrType/?kw=')
    expect(calls).toContain('/api/test/getCntrCode/')
    expect(
      calls.some((u) => u.startsWith('/api/test/getPort/') && u.includes('filter=E_PORT_NAM')),
    ).toBe(true)
    // Không gọi dict 包装 — không ai dùng (C-2).
    expect(calls.some((u) => u.includes('getPackageCode'))).toBe(false)
    expect(dicts.trustCodes[0]?.code).toBe('MAEU')
    expect(dicts.drTypes[0]?.name).toBe('FOB')
    expect(dicts.ports[0]?.name).toBe('上海')
    expect(dicts.cntrTypes[0]?.name).toBe('40')
    expect(dicts.cntrSizes[0]?.name).toBe('20')
  })

  it('gửi credentials + header Authorization của cookie token', async () => {
    const inits: CapturedInit[] = []
    const fakeFetch = (async (_url: string, init?: CapturedInit) => {
      inits.push(init ?? {})
      return okResponse({ code: 2000, data: [] })
    }) as unknown as typeof fetch

    await loadSiteDicts({
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })

    expect(inits).toHaveLength(4)
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

    await loadSiteDicts({
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: '',
    })

    expect(inits).toHaveLength(4)
    expect(inits.every((i) => new Headers(i.headers).get('authorization') === null)).toBe(true)
  })

  it('vẫn nạp được dict khác khi getPort lỗi', async () => {
    const fakeFetch = (async (url: string) => {
      if (url.includes('getPort')) throw new Error('network down')
      if (url.includes('getTrustCode')) {
        return okResponse({ code: 2000, data: [{ id: 2, TRUST_COD: 'MAEU' }] })
      }
      return okResponse({ code: 2000, data: [] })
    }) as unknown as typeof fetch

    const dicts = await loadSiteDicts({
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })

    expect(dicts.ports).toHaveLength(0)
    expect(dicts.trustCodes[0]?.code).toBe('MAEU')
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

describe('loadSiteDicts khi session hết hạn', () => {
  it('báo lỗi rõ ràng thay vì trả dict rỗng', async () => {
    const fakeFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 4000, data: null, msg: '身份认证信息未提供。' }),
    })) as unknown as typeof fetch

    await expect(
      loadSiteDicts({ baseUrl: '/api/test', fetchImpl: fakeFetch, cookieString: 'token=abc' }),
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
      loadSiteDicts({ baseUrl: '/api/test', fetchImpl: fakeFetch, cookieString: 'token=abc' }),
    )
    expect(err.kind).toBe('site')
    expect(err.code).toBe(5000)
  })

  it('envelope thành công với data null KHÔNG ném — dict rỗng là hợp lệ', async () => {
    const fakeFetch = (async () => okResponse({ code: 2000, data: null })) as unknown as typeof fetch

    const dicts = await loadSiteDicts({
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })
    expect(dicts.trustCodes).toHaveLength(0)
    expect(dicts.drTypes).toHaveLength(0)
    expect(dicts.ports).toHaveLength(0)
    expect(dicts.cntrTypes).toHaveLength(0)
    expect(dicts.cntrSizes).toHaveLength(0)
  })

  it('lỗi mạng → kind network', async () => {
    const fakeFetch = (async () => {
      throw new Error('Failed to fetch')
    }) as unknown as typeof fetch

    const err = await rejectionOf(
      loadSiteDicts({ baseUrl: '/api/test', fetchImpl: fakeFetch, cookieString: 'token=abc' }),
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
      loadSiteDicts({ baseUrl: '/api/test', fetchImpl: fakeFetch, cookieString: 'token=abc' }),
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
      loadSiteDicts({ baseUrl: '/api/test', fetchImpl: fakeFetch, cookieString: 'token=abc' }),
    )
    expect(err.kind).toBe('http')
    expect(err.code).toBe(500)
  })

  it('code 4000 → kind session, message vẫn nói "session"', async () => {
    const fakeFetch = (async () =>
      okResponse({ code: 4000, data: null, msg: '身份认证信息未提供。' })) as unknown as typeof fetch

    const err = await rejectionOf(
      loadSiteDicts({ baseUrl: '/api/test', fetchImpl: fakeFetch, cookieString: 'token=abc' }),
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
      loadSiteDicts({
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

  it('loadSiteDicts dùng key thật của site cho dict cảng', async () => {
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

    const dicts = await loadSiteDicts({
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })
    expect(dicts.ports[0]?.code).toBe('CNSHA')
    expect(dicts.ports[0]?.name).toBe('上海')
  })
})
