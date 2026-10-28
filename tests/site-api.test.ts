import { describe, it, expect } from 'vitest'
import {
  normalizeDictOptions,
  pickArray,
  createMappingContext,
  readCookieToken,
  loadSiteDicts,
  DEFAULT_SITE_API_BASE,
} from '../src/core/site-api'

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
    const fakeFetch = (async (url: string) => {
      calls.push(url)
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
    // `getTrustCode/` được gọi kèm query `?kw=` ⇒ phải so bằng `startsWith`.
    expect(calls.some((u) => u.startsWith('/api/test/getTrustCode/'))).toBe(true)
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

  it('vẫn nạp được dict khác khi getPort lỗi', async () => {
    const fakeFetch = (async (url: string) => {
      if (url.includes('getPort')) throw new Error('network down')
      if (url.includes('getTrustCode')) {
        return okResponse({ code: 200, data: [{ id: 2, TRUST_COD: 'MAEU' }] })
      }
      return okResponse({ code: 200, data: [] })
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
