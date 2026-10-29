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
  headers?: Record<string, string>
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
    expect(init?.headers?.['Content-Type']).toBe('application/json')
    expect(init?.headers?.['Authorization']).toBe('JWT abc')
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

    const headers = calls[0]?.init.headers ?? {}
    expect(headers['Authorization']).toBeUndefined()
    expect('Authorization' in headers).toBe(false)
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
  it('POST tới endpoint cargo/add/ với body là dòng hàng', async () => {
    const { fetchImpl, calls } = captureFetch(() => okResponse({ code: 2000, data: {} }))
    const cargo = { bill_no: 'B-1', e_cargo_nam: 'SILENT DIESEL GENERATOR', piece_num: 114 }

    await addCargoRow(cargo, { ...OPTIONS, fetchImpl })

    expect(calls[0]?.url).toBe('/api/test/cargo/add/')
    expect(calls[0]?.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(cargo)
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

  it('lần lượt thử billNo, bill_id, billId, id', () => {
    expect(extractBillNo({ code: 2000, data: { billNo: 'B-2' } })).toBe('B-2')
    expect(extractBillNo({ code: 2000, data: { bill_id: 'B-3' } })).toBe('B-3')
    expect(extractBillNo({ code: 2000, data: { billId: 'B-4' } })).toBe('B-4')
    expect(extractBillNo({ code: 2000, data: { id: 'B-5' } })).toBe('B-5')
  })

  it('tra data TRƯỚC top-level của envelope', () => {
    expect(extractBillNo({ code: 2000, data: { bill_no: 'B-1' }, bill_id: 'B-9' })).toBe('B-1')
  })

  it('không tìm thấy ⇒ trả fallback đã truyền vào', () => {
    expect(extractBillNo({ code: 2000, data: null }, 'FB')).toBe('FB')
    expect(extractBillNo({ code: 2000, data: { other: 'x' } })).toBe('')
    expect(extractBillNo(null, 'FB')).toBe('FB')
  })

  it('giá trị number ⇒ trả dạng string', () => {
    expect(extractBillNo({ code: 2000, data: { bill_no: 12345 } })).toBe('12345')
  })

  it('bỏ qua giá trị rỗng', () => {
    expect(extractBillNo({ code: 2000, data: { bill_no: '   ' } }, 'FB')).toBe('FB')
  })
})

describe('hằng số endpoint', () => {
  it('BILL_PATH rỗng, CARGO_PATH là cargo/add/', () => {
    expect(BILL_PATH).toBe('')
    expect(CARGO_PATH).toBe('cargo/add/')
  })
})
