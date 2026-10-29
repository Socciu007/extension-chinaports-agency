import { describe, it, expect } from 'vitest'
import { postSiteJson, SiteApiError } from '../src/core/site-api'
import {
  BILL_PATH,
  CARGO_PATH,
  createManifestBill,
  addCargoRow,
  saveManifestContainers,
  extractBillNo,
} from '../src/core/site-write'
import type { HeaderPayload } from '../src/core/payload'

/** Phần `init` mà module đưa cho fetch — dùng để ghim shape của request. */
interface CapturedInit {
  method?: string
  headers?: HeadersInit
  credentials?: string
  body?: unknown
}

/** Một lần gọi fetch đã bắt. */
interface CapturedCall {
  url: string
  init: CapturedInit
}

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

/** Fetch giả: ghi lại url + init rồi trả về `response`. */
function captureFetch(response: () => Response): {
  fetchImpl: typeof fetch
  calls: CapturedCall[]
} {
  const calls: CapturedCall[] = []
  const fetchImpl = (async (url: string, init?: CapturedInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return response()
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

/** Bắt lỗi của `postSiteJson` — luôn là `SiteApiError`. */
async function rejectionOf(promise: Promise<unknown>): Promise<SiteApiError> {
  try {
    await promise
  } catch (e) {
    if (e instanceof SiteApiError) return e
    throw e
  }
  throw new Error('Expected the promise to reject, but it resolved')
}

/** Bắt lỗi ném đồng bộ (các hàm thuần như `extractBillNo`). */
function thrownOf(fn: () => unknown): SiteApiError {
  try {
    fn()
  } catch (e) {
    if (e instanceof SiteApiError) return e
    throw e
  }
  throw new Error('Expected the function to throw, but it did not')
}

/**
 * Đọc header gửi đi theo shape THẬT của `init.headers`.
 *
 * KHÔNG dựng lại `Headers`: `Headers` gộp header trùng tên (không phân biệt
 * hoa/thường) ⇒ một record hỏng chứa cả `authorization` và `Authorization` vẫn
 * ra đúng 1 entry ⇒ test không bao giờ fail. Đọc shape thật mới bắt được.
 */
function sentHeaders(init: HeadersInit | undefined): [string, string][] {
  if (init instanceof Headers) return Array.from(init.entries())
  if (Array.isArray(init)) return init.map(([name, value]) => [String(name), String(value)])
  return Object.entries((init ?? {}) as Record<string, string>)
}

/** Header mẫu — giống hình dạng `buildHeaderPayload` dựng ra. */
function sampleHeader(): HeaderPayload {
  return {
    bill_no: '',
    bill_nbr: 'ONE-123',
    e_shipper_nam: 'ACME TRADING',
    start_port_cod: 'CNSHA',
    dischrg_port_cod: 'IDBLW',
    total_piece_num: '',
    total_gweight_ton: '',
    total_gvol_num: '',
    mandatory_check: '',
    soft_check: '',
    is_all: '0',
  }
}

const OPTIONS = { baseUrl: '/api/test', cookieString: 'token=abc' }

describe('postSiteJson', () => {
  it('dựng URL đúng: path rỗng ⇒ URL kết thúc bằng "/"', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await postSiteJson('', {}, { ...OPTIONS, fetchImpl })
    await postSiteJson('cargo/add/', {}, { ...OPTIONS, fetchImpl })

    expect(calls[0]?.url).toBe('/api/test/')
    expect(calls[1]?.url).toBe('/api/test/cargo/add/')
  })

  it('gửi POST + credentials + Content-Type + Authorization', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await postSiteJson('cargo/add/', { a: 1 }, { ...OPTIONS, fetchImpl })

    const init = calls[0]?.init
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    const entries = sentHeaders(init?.headers)
    expect(entries.find(([name]) => name.toLowerCase() === 'content-type')?.[1]).toBe(
      'application/json',
    )
    expect(entries.find(([name]) => name.toLowerCase() === 'authorization')?.[1]).toBe('JWT abc')
  })

  it('body là JSON string parse lại được và đúng object đã gửi', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))
    const body = { bill_no: 'B-1', cntr_list: [{ cntr_no: 'X' }] }

    await postSiteJson('', body, { ...OPTIONS, fetchImpl })

    const raw = calls[0]?.init.body
    expect(typeof raw).toBe('string')
    expect(JSON.parse(String(raw))).toEqual(body)
  })

  it('không có token thì KHÔNG gửi header Authorization', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await postSiteJson('', {}, { ...OPTIONS, cookieString: '', fetchImpl })

    const entries = sentHeaders(calls[0]?.init.headers)
    expect(entries.filter(([name]) => name.toLowerCase() === 'authorization')).toHaveLength(0)
  })

  it('trả về envelope đã kiểm tra, KHÔNG bóc data', async () => {
    const envelope = { code: 2000, data: { bill_no: 'B-9' }, msg: 'ok' }
    const { fetchImpl } = captureFetch(() => okResponse(envelope))

    const result = await postSiteJson('', {}, { ...OPTIONS, fetchImpl })

    expect(result).toEqual(envelope)
  })

  it('code 4000 → kind session', async () => {
    const { fetchImpl } = captureFetch(() => okResponse({ code: 4000, data: null, msg: '身份认证信息未提供。' }))

    const err = await rejectionOf(postSiteJson('', {}, { ...OPTIONS, fetchImpl }))
    expect(err.kind).toBe('session')
    expect(err.code).toBe(4000)
  })

  it('code 5000 → kind site', async () => {
    const { fetchImpl } = captureFetch(() => okResponse({ code: 5000, data: [], msg: '系统错误' }))

    const err = await rejectionOf(postSiteJson('', {}, { ...OPTIONS, fetchImpl }))
    expect(err.kind).toBe('site')
    expect(err.code).toBe(5000)
  })

  it('HTTP 500 → kind http', async () => {
    const { fetchImpl } = captureFetch(
      () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response,
    )

    const err = await rejectionOf(postSiteJson('', {}, { ...OPTIONS, fetchImpl }))
    expect(err.kind).toBe('http')
    expect(err.code).toBe(500)
  })

  it('body không parse được JSON → kind bad_response', async () => {
    const { fetchImpl } = captureFetch(
      () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON at position 0')
          },
        }) as unknown as Response,
    )

    const err = await rejectionOf(postSiteJson('', {}, { ...OPTIONS, fetchImpl }))
    expect(err.kind).toBe('bad_response')
  })

  it('fetch ném → kind network', async () => {
    const fetchImpl = (async () => {
      throw new Error('Failed to fetch')
    }) as unknown as typeof fetch

    const err = await rejectionOf(postSiteJson('', {}, { ...OPTIONS, fetchImpl }))
    expect(err.kind).toBe('network')
  })

  it('fetch treo → kind timeout', async () => {
    // Fetch treo mãi, chỉ chờ tín hiệu abort của timeout.
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch

    const err = await rejectionOf(
      postSiteJson('', {}, { ...OPTIONS, fetchImpl, timeoutMs: 20 }),
    )
    expect(err.kind).toBe('timeout')
  })

  it('body cyclic → SiteApiError bad_request, KHÔNG phải TypeError thô', async () => {
    const { fetchImpl } = captureFetch(() => okResponse({ code: 2000, data: {} }))
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    const err = await rejectionOf(postSiteJson('', cyclic, { ...OPTIONS, fetchImpl }))
    expect(err.kind).toBe('bad_request')
  })

  it('body undefined ⇒ SiteApiError bad_request, KHÔNG gửi POST rỗng', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    const err = await rejectionOf(
      postSiteJson('', undefined as unknown as Record<string, unknown>, { ...OPTIONS, fetchImpl }),
    )
    expect(err.kind).toBe('bad_request')
    expect(calls).toHaveLength(0)
  })

  it('token trong cookie THẮNG Authorization của caller', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await postSiteJson('', {}, { ...OPTIONS, fetchImpl, headers: { Authorization: 'caller-token' } })

    const entries = sentHeaders(calls[0]?.init.headers)
    const auth = entries.filter(([name]) => name.toLowerCase() === 'authorization')
    expect(auth).toHaveLength(1)
    expect(auth[0]?.[1]).toBe('JWT abc')
    // Giá trị của caller KHÔNG được sót lại ở bất kỳ entry nào.
    expect(entries.some(([, value]) => value.includes('caller-token'))).toBe(false)
  })

  it('không có token trong cookie ⇒ giữ Authorization của caller', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await postSiteJson(
      '',
      {},
      { ...OPTIONS, cookieString: '', fetchImpl, headers: { Authorization: 'caller-token' } },
    )

    const sent = new Headers(calls[0]?.init.headers)
    expect(sent.get('authorization')).toBe('caller-token')
  })

  it('header viết hoa/thường không tạo 2 entry trùng tên', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await postSiteJson('', {}, { ...OPTIONS, fetchImpl, headers: { authorization: 'caller-token' } })

    const entries = sentHeaders(calls[0]?.init.headers)
    const auth = entries.filter(([name]) => name.toLowerCase() === 'authorization')
    expect(auth).toHaveLength(1)
    expect(auth[0]?.[1]).toBe('JWT abc')
  })

  it('header dạng mảng cặp KHÔNG bị drop', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await postSiteJson('', {}, { ...OPTIONS, fetchImpl, headers: [['X-Test', '1']] })

    const sent = new Headers(calls[0]?.init.headers)
    expect(sent.get('x-test')).toBe('1')
  })
})

describe('createManifestBill', () => {
  it('POST tới endpoint bill với body là header', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))
    const header = sampleHeader()

    await createManifestBill(header, { ...OPTIONS, fetchImpl })

    expect(calls[0]?.url).toBe('/api/test/')
    expect(calls[0]?.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(header)
  })

  it('không sửa header của caller', async () => {
    const { fetchImpl } = captureFetch(() => okResponse({ code: 2000, data: {} }))
    const header = sampleHeader()

    await createManifestBill(header, { ...OPTIONS, fetchImpl })

    expect(header.bill_no).toBe('')
    expect(header.is_all).toBe('0')
  })
})

describe('addCargoRow', () => {
  it('POST tới endpoint cargo/add/ với bill_no do tham số gán', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))
    const cargo = { e_cargo_nam: 'SILENT DIESEL GENERATOR', piece_num: 114 }

    await addCargoRow(cargo, 'B-1', { ...OPTIONS, fetchImpl })

    expect(calls[0]?.url).toBe('/api/test/cargo/add/')
    expect(calls[0]?.init.method).toBe('POST')
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body.bill_no).toBe('B-1')
    expect(body.e_cargo_nam).toBe('SILENT DIESEL GENERATOR')
    expect(body.piece_num).toBe(114)
  })

  it('billNo rỗng ⇒ ném SiteApiError, KHÔNG gửi bill_no rỗng lên site', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    const err = await rejectionOf(addCargoRow({ piece_num: 1 }, '', { ...OPTIONS, fetchImpl }))
    expect(err.kind).toBe('bad_request')
    expect(calls).toHaveLength(0)
  })

  it('billNo chỉ có khoảng trắng ⇒ ném SiteApiError, KHÔNG gửi request', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    const err = await rejectionOf(addCargoRow({ piece_num: 1 }, '   ', { ...OPTIONS, fetchImpl }))
    expect(err.kind).toBe('bad_request')
    expect(calls).toHaveLength(0)
  })

  it('key trong cargo được lowercase trước khi gửi lên site', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await addCargoRow(
      { E_CARGO_NAM: 'SILENT DIESEL GENERATOR' } as Record<string, unknown>,
      'B-1',
      { ...OPTIONS, fetchImpl },
    )

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body.e_cargo_nam).toBe('SILENT DIESEL GENERATOR')
    expect('E_CARGO_NAM' in body).toBe(false)
  })

  it('cargo chứa sẵn bill_no khác ⇒ tham số thắng', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await addCargoRow({ bill_no: 'OLD', piece_num: 1 }, 'NEW', { ...OPTIONS, fetchImpl })

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body.bill_no).toBe('NEW')
  })

  it('billNo giữ nguyên văn (không trim, không uppercase)', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await addCargoRow({ piece_num: 1 }, ' b-1 ', { ...OPTIONS, fetchImpl })

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body.bill_no).toBe(' b-1 ')
  })
})

describe('saveManifestContainers', () => {
  it('body có bill_no (nguyên văn) + is_all "1" + cntr_list', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))
    const header = sampleHeader()
    const billNo = '  b-1  '
    const containers = [{ cntr_no: 'X123', bill_no: 'b-1' }]

    await saveManifestContainers(header, containers, billNo, { ...OPTIONS, fetchImpl })

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(calls[0]?.url).toBe('/api/test/')
    expect(body.bill_no).toBe(billNo)
    expect(body.is_all).toBe('1')
    expect(body.cntr_list).toEqual(containers)
  })

  it('body KHÔNG có tổng do site tự tính, cũng không có cargo_list', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))
    const header = sampleHeader()

    await saveManifestContainers(header, [], 'B-1', { ...OPTIONS, fetchImpl })

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('total_piece_num')
    expect(body).not.toHaveProperty('total_gweight_ton')
    expect(body).not.toHaveProperty('total_gvol_num')
    expect(body).not.toHaveProperty('cargo_list')
  })

  it('KHÔNG mutate header gốc', async () => {
    const { fetchImpl } = captureFetch(() => okResponse({ code: 2000, data: {} }))
    const header = sampleHeader()

    await saveManifestContainers(header, [{ cntr_no: 'X123' }], 'B-1', { ...OPTIONS, fetchImpl })

    expect(header.bill_no).toBe('')
    expect(header.is_all).toBe('0')
    expect(header).not.toHaveProperty('cntr_list')
    // Tổng vẫn còn nguyên trong header gốc (chỉ bản copy bị xoá).
    expect(header.total_piece_num).toBe('')
    expect(header.total_gweight_ton).toBe('')
    expect(header.total_gvol_num).toBe('')
  })

  it('lowerKeys áp dụng ở tầng POST: key viết hoa thành chữ thường', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))

    await saveManifestContainers(
      sampleHeader(),
      [{ CNTR_NO: 'X123', cntr_size_cod: '40' }],
      'B-1',
      { ...OPTIONS, fetchImpl },
    )

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    const list = body.cntr_list as Record<string, unknown>[]
    expect(list[0]?.cntr_no).toBe('X123')
    expect(list[0]).not.toHaveProperty('CNTR_NO')
  })
})

describe('extractBillNo', () => {
  it('lấy bill_no trong data', () => {
    expect(extractBillNo({ code: 2000, data: { bill_no: 'B-1' } })).toBe('B-1')
  })

  it('bill_no thắng billNo khi cả hai cùng có', () => {
    expect(extractBillNo({ code: 2000, data: { bill_no: 'B-1', billNo: 'B-2' } })).toBe('B-1')
  })

  it('lần lượt thử billNo, bill_id, billId', () => {
    expect(extractBillNo({ code: 2000, data: { billNo: 'B-2' } })).toBe('B-2')
    expect(extractBillNo({ code: 2000, data: { bill_id: 'B-3' } })).toBe('B-3')
    expect(extractBillNo({ code: 2000, data: { billId: 'B-4' } })).toBe('B-4')
  })

  it('tra data TRƯỚC top-level của envelope', () => {
    expect(extractBillNo({ code: 2000, data: { bill_no: 'B-1' }, bill_id: 'B-9' })).toBe('B-1')
  })

  it('lấy ở top-level khi data không chứa mã bill', () => {
    expect(extractBillNo({ code: 2000, data: null, bill_no: 'B-7' })).toBe('B-7')
  })

  it('id KHÔNG phải mã bill ⇒ ném lỗi', () => {
    const err = thrownOf(() => extractBillNo({ code: 2000, data: { id: 123 } }))
    expect(err.kind).toBe('bad_response')
  })

  it('không tìm thấy mã bill ⇒ ném SiteApiError bad_response', () => {
    const err = thrownOf(() => extractBillNo({ code: 2000, data: { other: 'x' } }))
    expect(err.kind).toBe('bad_response')
  })

  it('trả mã bill NGUYÊN VĂN (không trim, không uppercase)', () => {
    expect(extractBillNo({ code: 2000, data: { bill_no: ' B-1 ' } })).toBe(' B-1 ')
  })

  it('bill_no rỗng ⇒ ném lỗi', () => {
    const err = thrownOf(() => extractBillNo({ code: 2000, data: { bill_no: '' } }))
    expect(err.kind).toBe('bad_response')
  })

  it('data không phải object / envelope không phải object ⇒ ném lỗi', () => {
    expect(thrownOf(() => extractBillNo({ code: 2000, data: 'x' })).kind).toBe('bad_response')
    expect(thrownOf(() => extractBillNo(null)).kind).toBe('bad_response')
    expect(thrownOf(() => extractBillNo('nope')).kind).toBe('bad_response')
  })

  it('bill_no là số hữu lệ ⇒ trả String(value)', () => {
    expect(extractBillNo({ code: 2000, data: { bill_no: 12345 } })).toBe('12345')
  })

  it('data là mảng ⇒ lùi xuống envelope top-level', () => {
    expect(extractBillNo({ code: 2000, data: [], bill_no: 'B-9' })).toBe('B-9')
  })

  it('bill_no là object/boolean ⇒ không phải mã bill ⇒ ném lỗi', () => {
    expect(() => extractBillNo({ code: 2000, data: { bill_no: { id: 1 } } })).toThrow(SiteApiError)
    expect(() => extractBillNo({ code: 2000, data: { bill_no: true } })).toThrow(SiteApiError)
  })

  it('bill_no là NaN/Infinity ⇒ không phải mã bill ⇒ ném lỗi', () => {
    expect(() => extractBillNo({ code: 2000, data: { bill_no: Number.NaN } })).toThrow(SiteApiError)
    expect(() =>
      extractBillNo({ code: 2000, data: { bill_no: Number.POSITIVE_INFINITY } }),
    ).toThrow(SiteApiError)
  })

  it('bill_no chỉ có khoảng trắng ⇒ không phải mã bill ⇒ ném lỗi', () => {
    expect(() => extractBillNo({ code: 2000, data: { bill_no: '   ' } })).toThrow(SiteApiError)
  })
})

describe('hằng số endpoint', () => {
  it('BILL_PATH rỗng, CARGO_PATH là cargo/add/', () => {
    expect(BILL_PATH).toBe('')
    expect(CARGO_PATH).toBe('cargo/add/')
  })
})
