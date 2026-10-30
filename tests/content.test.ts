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

/**
 * Message từ chối khi site ĐÃ có manifest cho số bill này (FIX 1).
 *
 * Không còn "reload trang" trong message: chốt nằm trong `chrome.storage.local`
 * nên SỐNG SÓT qua reload ⇒ đường thoát đó không còn đúng.
 *
 * Câu cuối là đường thoát cho operator đã XOÁ nháp trên site: chốt bền ⇒
 * không còn cách nào khác để chạy lại số bill đó.
 */
const DUPLICATE_MESSAGE =
  'A manifest was already created on the site for this bill of lading number. Check the site and finish that manifest by hand — the extension does not create a second manifest for the same bill. If the site no longer has that manifest, clear the storage of the Manifest Autofill extension for this browser and run again.'

/** Message từ chối khi opt-in ĐÃ LƯU đang tắt (FIX 2). */
const OPT_IN_OFF_MESSAGE =
  'Creating the manifest on the site is turned off in the extension settings.'

/** Message báo sai trang — nói đúng route thật để operator tự điều hướng. */
const WRONG_PAGE_MESSAGE =
  'Open the manifest page (#/exportBusinessOperations/maintenanceOfManifestData) and try again.'

/** Message từ chối khi message từ popup sai hình dạng (thiếu `blNo`). */
const INVALID_REQUEST_MESSAGE =
  'The extension received an invalid request — reload the manifest page and try again.'

/**
 * Key của chốt trong `chrome.storage.local` — MỘT key cho MỘT số bill.
 *
 * Số bill là số ĐÃ GHI LÊN SITE (giữ hậu tố piece) — cùng một số bill thì
 * cùng một key.
 */
const localKeyOf = (blNo: string) => `manifest-autofill:created-bill-no:${blNo}`

let listener: Listener | undefined
/** Mở chốt để `fetch` treo cho tới khi test kết thúc. */
let release: (() => void) | undefined
let fetchMock: ReturnType<typeof vi.fn>
/**
 * Setting trong storage của extension.
 *
 * Mặc định `createOnSite: true` ⇒ các test ghi lên site đi qua. Test cần
 * tắt thì sửa biến này trước khi gửi message.
 */
let settings: Record<string, unknown>
/**
 * Store của `chrome.storage.local` — CHUNG cho MỌI tab của extension.
 *
 * Đây là nơi chốt "số bill đã có manifest trên site" được ghi ⇒ nó phải sống
 * lâu hơn một tab. Test phải xoá nó giữa các test, nếu không chốt của test
 * trước lọt vào test sau.
 */
let localStore: Record<string, unknown>
/** `set` của `chrome.storage.local` — để assert ĐÚNG key đã ghi. */
let localSet: ReturnType<typeof vi.fn>
/** `get` của `chrome.storage.local` — để assert đã đọc storage. */
let localGet: ReturnType<typeof vi.fn>

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
 * - POST endpoint bill  ⇒ TẠO bill (`is_all` = "0") hoặc LƯU bill (`is_all` = "1").
 *
 * Mỗi lần TẠO bill nhận một mã bill KHÁC nhau ⇒ test phân biệt được "bill thứ
 * hai cho cùng một số bill" chỉ bằng cách đếm POST.
 */
function fakeFetch(options: { failSave?: boolean } = {}): {
  fetchImpl: typeof fetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  let createCount = 0

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

    // Endpoint bill: `is_all` = "1" là bước LƯU, còn lại là bước TẠO.
    const body = typeof init?.body === 'string' ? init.body : ''
    if (body.includes('"is_all":"1"')) {
      if (options.failSave) {
        // Site từ chối ⇒ bill ĐÃ tạo nhưng KHÔNG lưu được (trạng thái nguy
        // hiểm nhất: site có bill, extension không có bằng chứng lưu).
        return jsonResponse({ code: 5000, data: null, msg: 'save failed' })
      }
      return jsonResponse({ code: 2000, data: {} })
    }

    // Bước TẠO bill — mã bill do server gán.
    createCount += 1
    return jsonResponse({ code: 2000, data: { bill_no: `BILL-${createCount}` } })
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
  // Chốt "bill đã tạo" nằm trong `chrome.storage.local` ⇒ nó SỐNG SÓT qua
  // test ⇒ phải xoá, nếu không test sau thừa hưởng chốt của test trước.
  localStore = {}
  localGet = vi.fn(async (keys?: string | string[] | null) => {
    if (keys === null || keys === undefined) return { ...localStore }
    const wanted = typeof keys === 'string' ? [keys] : keys
    const out: Record<string, unknown> = {}
    for (const key of wanted) {
      if (key in localStore) out[key] = localStore[key]
    }
    return out
  })
  localSet = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(localStore, values)
  })
  // `sessionStorage` vẫn phải xoá: đường DỰ PHÒNG (khi storage bị chặn) dùng
  // nó, và xoá nó cũng làm "tab mới" trong test chống chạy chồng.
  sessionStorage.clear()

  // Opt-in ĐÃ LƯU mặc định là bật — các test ghi lên site cần nó.
  settings = { createOnSite: true }

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
    storage: {
      sync: {
        get: async () => ({ ...settings }),
      },
      local: {
        get: (keys?: string | string[] | null) => localGet(keys),
        set: (values: Record<string, unknown>) => localSet(values),
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
    expect(result.message).toBe(WRONG_PAGE_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('route GIỐNG TIỀN TỐ ⇒ KHÔNG phải trang manifest, KHÔNG gọi network', async () => {
    // Route `…maintenanceOfManifestDataExtra` chỉ CHUNG TIỀN TỐ với route
    // thật ⇒ khớp bằng `includes` sẽ nhận nhầm và điền manifest vào trang
    // không có form ⇒ phải khớp CHÍNH XÁC.
    location.hash = '#/exportBusinessOperations/maintenanceOfManifestDataExtra'

    const result = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })

    expect(result.ok).toBe(false)
    expect(result.message).toBe(WRONG_PAGE_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('route kèm QUERY ⇒ VẪN là trang manifest', async () => {
    location.hash = '#/exportBusinessOperations/maintenanceOfManifestData?x=1'

    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const result = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })

    expect(result.message).not.toBe(WRONG_PAGE_MESSAGE)
    expect(result.ok).toBe(true)
    expect(fake.calls.filter((call) => call.url.includes('/api/booking/')).length).toBeGreaterThan(0)
  })

  it('message sai hình dạng ⇒ từ chối NGAY, KHÔNG gọi network', async () => {
    const respond = vi.fn()
    const ret = listener?.({ type: MSG_CREATE_MANIFEST }, {}, respond)

    // Từ chối NGAY: câu trả lời đã có TRƯỚC khi listener trả về ⇒ không mở
    // lần gọi mạng nào, và không phải chờ promise nào.
    expect(ret).toBe(false)
    expect(respond).toHaveBeenCalledTimes(1)

    const result = respond.mock.calls[0]?.[0] as CreateResult
    expect(result.ok).toBe(false)
    expect(result.message).toBe(INVALID_REQUEST_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blNo RỖNG ⇒ từ chối NGAY, KHÔNG gọi network', () => {
    const respond = vi.fn()
    const ret = listener?.({ type: MSG_CREATE_MANIFEST, blNo: '' }, {}, respond)

    // Từ chối NGAY: câu trả lời đã có TRƯỚC khi listener trả về ⇒ không mở
    // lần gọi mạng nào, và không phải chờ promise nào.
    expect(ret).toBe(false)
    expect(respond).toHaveBeenCalledTimes(1)

    const result = respond.mock.calls[0]?.[0] as CreateResult
    expect(result.ok).toBe(false)
    expect(result.message).toBe(INVALID_REQUEST_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blNo chỉ có KHOẢNG TRẮNG ⇒ từ chối NGAY, KHÔNG gọi network', () => {
    const respond = vi.fn()
    const ret = listener?.({ type: MSG_CREATE_MANIFEST, blNo: '   ' }, {}, respond)

    // Từ chối NGAY: câu trả lời đã có TRƯỚC khi listener trả về ⇒ không mở
    // lần gọi mạng nào, và không phải chờ promise nào.
    expect(ret).toBe(false)
    expect(respond).toHaveBeenCalledTimes(1)

    const result = respond.mock.calls[0]?.[0] as CreateResult
    expect(result.ok).toBe(false)
    expect(result.message).toBe(INVALID_REQUEST_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tạo bill + gắn dòng hàng + lưu bill', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const result = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })

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

  it('opt-in ĐÃ LƯU đang bật ⇒ KHÔNG có cờ nào trong request, vẫn ghi lên site', async () => {
    // Request KHÔNG còn mang cờ "chỉ đọc" ⇒ mọi request đều ghi lên
    // site (sau khi qua chốt opt-in ĐÃ LƯU).
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const result = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })

    expect(result.ok).toBe(true)
    expect(result.written).toBe(true)
    expect(fake.calls.filter((call) => call.method === 'POST').length).toBeGreaterThan(0)
  })

  it('ghi hai lần cùng số bill ⇒ lần hai bị từ chối, KHÔNG POST thêm', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const first = await send({
      type: MSG_CREATE_MANIFEST,
      blNo: BL_NO,
    })
    expect(first.ok).toBe(true)
    expect(first.written).toBe(true)

    const postsAfterFirst = fake.calls.filter((call) => call.method === 'POST').length
    expect(postsAfterFirst).toBeGreaterThan(0)

    // Số bill KHÁC CHỮ HOA vẫn là CÙNG một số bill (chuẩn hoá) ⇒ vẫn bị chặn.
    const second = await send({
      type: MSG_CREATE_MANIFEST,
      blNo: BL_NO.toLowerCase(),
    })

    expect(second.ok).toBe(false)
    expect(second.message).toBe(DUPLICATE_MESSAGE)
    expect(second.billCreated).toBe(false)
    expect(second.written).toBe(false)

    // KHÔNG có POST nào nữa tới site — lần hai phải bị chặn TRƯỚC khi chạm
    // network, nếu không thì site bị tạo bill hai lần.
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(postsAfterFirst)
  })

  it('hai piece KHÁC nhau (P1 / P2) của cùng mã gốc ⇒ KHÔNG bị coi là trùng bill', async () => {
    // `…P1` và `…P2` là HAI bản ghi KHÁC NHAU trên site ⇒ chốt phải tách.
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const first = await send({
      type: MSG_CREATE_MANIFEST,
      blNo: `${BL_NO}P1`,
    })
    expect(first.ok).toBe(true)
    expect(first.written).toBe(true)

    const second = await send({
      type: MSG_CREATE_MANIFEST,
      blNo: `${BL_NO}P2`,
    })
    expect(second.ok).toBe(true)
    expect(second.written).toBe(true)
  })

  it('cùng MỘT piece ⇒ lần sau bị từ chối, KHÔNG tạo bill thứ hai', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const first = await send({
      type: MSG_CREATE_MANIFEST,
      blNo: `${BL_NO}P1`,
    })
    expect(first.ok).toBe(true)

    const postsAfterFirst = fake.calls.filter((call) => call.method === 'POST').length

    const second = await send({
      type: MSG_CREATE_MANIFEST,
      blNo: `${BL_NO}P1`,
    })
    expect(second.ok).toBe(false)
    expect(second.message).toBe(DUPLICATE_MESSAGE)
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(postsAfterFirst)
  })

  it('A → B → A ⇒ lần thứ ba bị từ chối, KHÔNG tạo bill thứ hai cho A', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const first = await send({ type: MSG_CREATE_MANIFEST, blNo: 'BL-A' })
    expect(first.ok).toBe(true)
    expect(first.written).toBe(true)

    // Bill KHÁC ghi đè bill trước đó — chốt phải nhớ TẤT CẢ, không chỉ bill
    // cuối cùng, nếu không lần chạy lại cho A sẽ lọt.
    const second = await send({ type: MSG_CREATE_MANIFEST, blNo: 'BL-B' })
    expect(second.ok).toBe(true)
    expect(second.written).toBe(true)

    const postsBeforeThird = fake.calls.filter((call) => call.method === 'POST').length

    const third = await send({ type: MSG_CREATE_MANIFEST, blNo: 'BL-A' })
    expect(third.ok).toBe(false)
    expect(third.message).toBe(DUPLICATE_MESSAGE)
    expect(third.billCreated).toBe(false)
    expect(third.written).toBe(false)

    // KHÔNG POST thêm — lần ba phải bị chặn TRƯỚC khi chạm network.
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(postsBeforeThird)
  })

  it('bill ĐÃ tạo nhưng lưu hỏng ⇒ lần chạy lại bị từ chối, KHÔNG tạo bill thứ hai', async () => {
    const fake = fakeFetch({ failSave: true })
    vi.stubGlobal('fetch', fake.fetchImpl)

    const first = await send({ type: MSG_CREATE_MANIFEST, blNo: 'BL-C' })
    // Site ĐÃ tạo bill nhưng bước lưu hỏng ⇒ `billCreated` mà CHƯA `written`.
    expect(first.billCreated).toBe(true)
    expect(first.written).toBe(false)
    expect(first.ok).toBe(false)

    const postsAfterFirst = fake.calls.filter((call) => call.method === 'POST').length

    // Chốt phải ghi nhớ khi bill ĐÃ có trên site, không chờ tới khi lưu xong.
    const second = await send({ type: MSG_CREATE_MANIFEST, blNo: 'BL-C' })
    expect(second.ok).toBe(false)
    expect(second.message).toBe(DUPLICATE_MESSAGE)
    expect(second.billCreated).toBe(false)
    expect(second.written).toBe(false)

    // KHÔNG có bill thứ hai cho cùng một số bill.
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(postsAfterFirst)
  })

  it('chốt SỐNG SÓT qua lần reload trang (module content script nạp lại)', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const first = await send({ type: MSG_CREATE_MANIFEST, blNo: 'BL-D' })
    expect(first.written).toBe(true)

    // Nạp lại module content script — giống reload trang.
    vi.resetModules()
    await import('../src/content/index')

    const second = await send({ type: MSG_CREATE_MANIFEST, blNo: 'BL-D' })
    expect(second.ok).toBe(false)
    expect(second.message).toBe(DUPLICATE_MESSAGE)
    expect(second.billCreated).toBe(false)
    expect(second.written).toBe(false)
  })

  it('chốt được ghi vào `chrome.storage.local` theo key RIÊNG cho từng số bill', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const first = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })
    expect(first.written).toBe(true)

    // Chốt phải nằm trong `chrome.storage.local` (CHUNG cho mọi tab) chứ không
    // phải trong RAM/`sessionStorage` của riêng tab này.
    expect(localSet).toHaveBeenCalledWith({
      [localKeyOf(BL_NO)]: expect.any(Number),
    })
    expect(localStore[localKeyOf(BL_NO)]).toEqual(expect.any(Number))
  })

  it('chốt của piece GIỮ hậu tố ⇒ khác key với mã gốc', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    await send({ type: MSG_CREATE_MANIFEST, blNo: `${BL_NO}P1` })

    // Key là số bill ĐÃ GHI LÊN SITE (giữ hậu tố piece) — KHÔNG phải mã gốc.
    expect(localSet).toHaveBeenCalledWith({
      [localKeyOf(`${BL_NO}P1`)]: expect.any(Number),
    })
    expect(localStore[localKeyOf(BL_NO)]).toBeUndefined()
  })

  it('TAB KHÁC chạy lại cùng số bill ⇒ bị từ chối, KHÔNG tạo bill thứ hai', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const first = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })
    expect(first.written).toBe(true)
    const postsAfterFirst = fake.calls.filter((call) => call.method === 'POST').length

    // TAB MỚI: tab khác có `sessionStorage` RIÊNG ⇒ xoá nó đi, và nạp lại
    // module content script (mỗi module có bộ nhớ RAM riêng).
    sessionStorage.clear()
    // Query `?tab2` ⇒ một instance module RIÊNG (khác instance ở `beforeEach`).
    //
    // Specifier phải có kiểu `string` (không phải literal) vì TypeScript không
    // tìm được module có query ⇒ lỗi "Cannot find module".
    const tab2Module: string = '../src/content/index?tab2'
    await import(tab2Module)

    const second = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })

    // Chốt nằm trong `chrome.storage.local` ⇒ tab mới vẫn thấy ⇒ từ chối.
    expect(second.ok).toBe(false)
    expect(second.message).toBe(DUPLICATE_MESSAGE)
    expect(second.billCreated).toBe(false)
    expect(second.written).toBe(false)

    // KHÔNG POST thêm — phải bị chặn TRƯỚC khi chạm network.
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(postsAfterFirst)
  })

  it('operator XOÁ storage của extension ⇒ chạy lại được (đường thoát)', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const first = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })
    expect(first.written).toBe(true)

    // Operator xoá nháp trên site rồi xoá storage của extension ⇒ phải chạy
    // lại được. Nếu chốt còn nằm trong bộ nhớ RAM của tab này thì đường thoát
    // trong message từ chối sẽ là lời nói dối.
    for (const key of Object.keys(localStore)) delete localStore[key]

    const second = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })
    expect(second.ok).toBe(true)
    expect(second.written).toBe(true)
  })

  it('KHÔNG có `chrome.storage.local` ⇒ rơi về `sessionStorage`, KHÔNG ném lỗi', async () => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    // Storage bị policy chặn ⇒ không có `storage.local`.
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: (fn: Listener) => {
            listener = fn
          },
        },
      },
      storage: {
        sync: {
          get: async () => ({ ...settings }),
        },
      },
    })
    vi.resetModules()
    await import('../src/content/index')

    const first = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })
    expect(first.written).toBe(true)
    expect(localSet).not.toHaveBeenCalled()

    // Đường dự phòng vẫn chốt được (trong `sessionStorage` của tab này).
    const postsAfterFirst = fake.calls.filter((call) => call.method === 'POST').length
    const second = await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })
    expect(second.ok).toBe(false)
    expect(second.message).toBe(DUPLICATE_MESSAGE)
    expect(fake.calls.filter((call) => call.method === 'POST')).toHaveLength(postsAfterFirst)
  })

  it('opt-in ĐÃ LƯU đang tắt ⇒ từ chối, KHÔNG chạm network', async () => {
    settings.createOnSite = false
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetchImpl)

    const result = await send({
      type: MSG_CREATE_MANIFEST,
      blNo: BL_NO,
    })

    expect(result.ok).toBe(false)
    expect(result.message).toBe(OPT_IN_OFF_MESSAGE)
    expect(result.billCreated).toBe(false)
    expect(result.written).toBe(false)
    // Chặn phải xảy ra TRƯỚC mọi lần gọi mạng — kể cả lúc đọc dữ liệu.
    expect(fake.calls).toHaveLength(0)
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

  it('token được đọc LẠI cho MỖI request', async () => {
    // Cookie MUTABLE: site xoay token giữa hai lần gọi ⇒ extension phải dùng
    // token MỚI, không phải ảnh chụp lúc bắt đầu lần chạy.
    let token = 'token-1'
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => `token=${token}`,
    })

    const fake = fakeFetch()
    let siteCallCount = 0
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      // Xoay token ngay sau lần gọi site ĐẦU TIÊN.
      if (String(url).includes('/api/booking/')) {
        siteCallCount += 1
        if (siteCallCount === 1) token = 'token-2'
      }
      return fake.fetchImpl(url, init)
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchImpl)

    await send({ type: MSG_CREATE_MANIFEST, blNo: BL_NO })

    const siteCalls = fake.calls.filter((call) => call.url.includes('/api/booking/'))
    expect(siteCalls.length).toBeGreaterThan(1)

    const authHeaders = siteCalls.map((call) => headerValue(call, 'authorization'))
    expect(authHeaders[0]).toBe('JWT token-1')
    for (const auth of authHeaders.slice(1)) {
      expect(auth).toBe('JWT token-2')
    }
  })
})
