import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MSG_CREATE_MANIFEST, type CreateResult } from '../src/core/protocol'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'

type SendResponse = (response: unknown) => void
type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: SendResponse,
) => boolean | undefined

const MANIFEST_HASH = '#/exportBusinessOperations/maintenanceOfManifestData'
const BL_NO = 'ONEYSHAGT1569600'

let listener: Listener | undefined
/** Mở chốt để `fetch` treo cho tới khi test kết thúc. */
let release: (() => void) | undefined
let fetchMock: ReturnType<typeof vi.fn>

/** Một lần gọi fetch đã bắt. */
interface RecordedCall {
  url: string
  method: string
  headers: [string, string][]
}

/**
 * Đọc header gửi đi theo shape THẬT của `init.headers`.
 *
 * KHÔNG dựng lại `Headers`: `Headers` gộp header trùng tên ⇒ một record hỏng
 * chứa cả `authorization` và `Authorization` vẫn ra đúng 1 entry.
 */
function sentHeaders(init: HeadersInit | undefined): [string, string][] {
  if (init instanceof Headers) return Array.from(init.entries())
  if (Array.isArray(init)) return init.map(([name, value]) => [String(name), String(value)])
  return Object.entries((init ?? {}) as Record<string, string>)
}

/** Giá trị của một header trong call đã bắt (không phân biệt hoa/thường). */
function headerValue(call: RecordedCall, name: string): string | undefined {
  return call.headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

/**
 * Fetch giả — phân biệt API manifest và API của site theo URL.
 *
 * - API manifest (URL có `dadaex` hoặc KHÔNG có `/api/booking/`)
 *   ⇒ `{status: 1, data: <fixture>}`;
 * - GET `getTrustCode/` ⇒ `{code:'MAEU', id:'2'}`;
 * - GET `getDrType/`   ⇒ `{code:'1', name:'FOB'}`;
 * - GET còn lại         ⇒ rỗng;
 * - POST `cargo/add/`   ⇒ dòng hàng;
 * - POST endpoint bill  ⇒ lần đầu TẠO bill (`bill_no`), sau đó LƯU bill.
 */
function fakeFetch(): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  let billPostCount = 0

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const target = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url: target, method, headers: sentHeaders(init?.headers) })

    // API manifest — khác API của site.
    if (target.includes('dadaex') || !target.includes('/api/booking/')) {
      return jsonResponse({ status: 1, data: fixture.data })
    }

    if (method === 'GET') {
      if (target.includes('getTrustCode/')) {
        return jsonResponse({ code: 2000, data: [{ code: 'MAEU', id: '2' }] })
      }
      if (target.includes('getDrType/')) {
        return jsonResponse({ code: 2000, data: [{ code: '1', name: 'FOB' }] })
      }
      return jsonResponse({ code: 2000, data: [] })
    }

    if (target.includes('cargo/add/')) {
      return jsonResponse({ code: 2000, data: {} })
    }

    // Endpoint bill: lần đầu TẠO bill, những lần sau LƯU bill.
    const index = billPostCount
    billPostCount += 1
    if (index === 0) return jsonResponse({ code: 2000, data: { bill_no: 'BILL-1' } })
    return jsonResponse({ code: 2000, data: {} })
  }) as unknown as typeof fetch

  return { fetchImpl, calls }
}

/** Gửi message cho content script và chờ câu trả lời. */
async function send(message: unknown): Promise<CreateResult> {
  const respond = vi.fn()
  listener?.(message, {}, respond)
  await vi.waitFor(() => expect(respond).toHaveBeenCalled())
  return respond.mock.calls[0]?.[0] as CreateResult
}

beforeEach(async () => {
  // `inFlight` là trạng thái ở MỨC MODULE ⇒ phải nạp lại module cho mỗi test.
  vi.resetModules()
  listener = undefined
  release = undefined

  // `fetch` treo mãi ⇒ lần chạy đầu vẫn đang chạy ⇒ lần chạy thứ hai phải
  // bị chặn. Hết test thì mở chốt để chuỗi promise settle và timer timeout
  // trong `http.ts` được clear.
  fetchMock = vi.fn(
    async () =>
      new Promise((_resolve, reject) => {
        release = () => reject(new Error('test: fetch released'))
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn
        },
      },
    },
  })

  location.hash = MANIFEST_HASH
  await import('../src/content/index')
})

afterEach(async () => {
  release?.()
  // Đợi chuỗi promise kịp settle.
  await new Promise((resolve) => setTimeout(resolve, 0))
  location.hash = ''
  document.body.innerHTML = ''
  // Cookie đã stub trong test ⇒ gỡ own property, trả lại getter của jsdom.
  Reflect.deleteProperty(document, 'cookie')
  vi.unstubAllGlobals()
})

describe('content script — chống chạy chồng', () => {
  it('message thứ hai bị từ chối NGAY, KHÔNG gọi network thêm', async () => {
    const send1 = vi.fn()
    const send2 = vi.fn()

    const ret1 = listener?.({ type: MSG_CREATE_MANIFEST, blNo: BL_NO }, {}, send1)
    const ret2 = listener?.({ type: MSG_CREATE_MANIFEST, blNo: BL_NO }, {}, send2)

    // Lần đầu trả `true` (trả lời bất đồng bộ); lần thứ hai trả `false`
    // vì đã trả lời ngay trong lời gọi.
    expect(ret1).toBe(true)
    expect(ret2).toBe(false)

    expect(send2).toHaveBeenCalledTimes(1)
    const rejected = send2.mock.calls[0]?.[0] as CreateResult
    expect(rejected.ok).toBe(false)
    expect(rejected.message).toBe(
      'A manifest run is already in progress — wait for it to finish.',
    )

    // Chỉ MỘT lần gọi API: lần chạy thứ hai phải bị chặn TRƯỚC khi chạm
    // network — nếu không thì site bị tạo bill hai lần ⇒ dòng hàng TRÙNG.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sau khi run đầu kết thúc thì một run MỚI chạy được', async () => {
    const send1 = vi.fn()
    const ret1 = listener?.({ type: MSG_CREATE_MANIFEST, blNo: BL_NO }, {}, send1)
    expect(ret1).toBe(true)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Lần đầu kết thúc (fetch bị lỗi) ⇒ chốt được mở lại ⇒ lần chạy SAU đó
    // phải chạy lại bình thường.
    release?.()
    await vi.waitFor(() => expect(send1).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))

    const send2 = vi.fn()
    const ret2 = listener?.({ type: MSG_CREATE_MANIFEST, blNo: BL_NO }, {}, send2)
    expect(ret2).toBe(true)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})

describe('content script — chạy manifest qua API', () => {
  it('sai trang ⇒ báo lỗi, KHÔNG gọi network', async () => {
    location.hash = '#/someOtherRoute'

    const result = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })

    expect(result.ok).toBe(false)
    expect(result.message).toBe(
      'Open the manifest page (#/exportBusinessOperations/maintenanceOfManifestData) and try again.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('KHÔNG có allowWrite ⇒ KHÔNG POST lên site (chỉ preview)', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const result = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })

    expect(result.ok).toBe(true)
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(0)
    expect(result.billCreated).toBe(false)
    expect(result.written).toBe(false)
  })

  it('allowWrite: true ⇒ tạo bill + gắn dòng hàng + lưu bill', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const result = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO, allowWrite: true })

    const posts = fake.calls.filter((call) => call.method === 'POST')
    expect(posts).toHaveLength(3)
    expect(posts[0]?.url.endsWith('/')).toBe(true)
    expect(posts[1]?.url).toContain('cargo/add/')
    expect(posts[2]?.url.endsWith('/')).toBe(true)

    expect(result.ok).toBe(true)
    expect(result.billCreated).toBe(true)
    expect(result.written).toBe(true)
    expect(result.billNo).toBe('BILL-1')
  })

  it('allowWrite là CHUỖI ⇒ KHÔNG POST lên site (opt-in phải là boolean true)', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const result = await send({
      type: MSG_CREATE_MANIFEST,
      blNo: BL_NO,
      allowWrite: 'true',
    })

    expect(result.ok).toBe(true)
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(0)
    expect(result.billCreated).toBe(false)
    expect(result.written).toBe(false)
  })

  it('ghi hai lần cùng số bill ⇒ lần hai bị từ chối, KHÔNG POST thêm', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const first = await send({
      type: MSG_CREATE_MANIFEST,
      blNo: BL_NO,
      allowWrite: true,
    })
    expect(first.ok).toBe(true)
    expect(first.written).toBe(true)

    const postsAfterFirst = fake.calls.filter((call) => call.method === 'POST').length
    expect(postsAfterFirst).toBeGreaterThan(0)

    // Số bill KHÁC CHỮ HOA vẫn là CÙNG một số bill (chuẩn hoá) ⇒ vẫn bị chặn.
    const second = await send({
      type: MSG_CREATE_MANIFEST,
      blNo: BL_NO.toLowerCase(),
      allowWrite: true,
    })

    expect(second.ok).toBe(false)
    expect(second.message).toBe(
      'A manifest was already created on the site for this bill of lading number in this tab. Reload the page first if you really need to create another one.',
    )
    expect(second.billCreated).toBe(false)
    expect(second.written).toBe(false)

    // KHÔNG có POST nào nữa tới site — lần hai phải bị chặn TRƯỚC khi chạm
    // network, nếu không thì site bị tạo bill hai lần.
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(postsAfterFirst)
  })

  it('cookie của site ⇒ header Authorization: JWT <token>', async () => {
    // Cookie-jar của jsdom rất dễ lỗi khi set cookie trên `about:blank`
    // ⇒ chặn thẳng thuộc tính `cookie` của document.
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'token=test-token',
    })

    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })

    const siteCalls = fake.calls.filter((call) => call.url.includes('/api/booking/'))
    expect(siteCalls.length).toBeGreaterThan(0)
    for (const call of siteCalls) {
      expect(headerValue(call, 'authorization')).toBe('JWT test-token')
    }
  })
})
