import { describe, it, expect } from 'vitest'
import { runManifest, type ManifestRunOptions, type ManifestRunResult } from '../src/core/manifest-run'
import {
  BLANK_NOTES,
  DANGER_FIELDS,
  TEMP_FIELDS,
} from '../src/core/field-meta'
import type { ManifestCargo, ManifestData } from '../src/core/types'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'

const SITE_BASE = 'https://site.test/api/booking/exportManifestDataMaintain'
const API_BASE = 'https://api.test/manifest'
const BL_NO = 'ONEYSHAGT1569600'

/** Dữ liệu mẫu (phần `data` của envelope của API). */
const manifest = fixture.data as ManifestData

/** Một lần gọi fetch đã bắt. */
interface RecordedCall {
  url: string
  method: string
  /** Body đã parse (chỉ có với POST). */
  body?: Record<string, unknown>
}

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

/** Fetch giả của API manifest — luôn trả về envelope `{status, data}`. */
function manifestFetch(envelope: unknown): {
  fetchImpl: typeof fetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: (init?.method ?? 'GET').toUpperCase() })
    return okResponse(envelope)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

/** Tuỳ chọn của fetch giả của site. */
interface SiteFakeOptions {
  /** Mã bill site trả về khi tạo bill — `null` ⇒ site KHÔNG trả mã bill. */
  billNo?: string | null
  /** Chỉ số (0-based) của dòng hàng bị site từ chối. */
  failCargoIndex?: number
  /** Trễ (ms) trước khi site trả lời ở bước tạo bill. */
  createDelayMs?: number
  /** Endpoint GET cần trả về mã lỗi 4000 (session hết hạn). */
  failGet?: string
  /** Site từ chối yêu cầu tạo bill (code 5000). */
  failCreate?: boolean
}

/**
 * Fetch giả của site.
 *
 * - GET `getTrustCode/` ⇒ `{code:'MAEU', id:'2'}` (khớp `supplyId: 2` của fixture);
 * - GET `getDrType/` ⇒ `{code:'1', name:'FOB'}` (khớp `transportTerms: '1'`);
 * - GET còn lại ⇒ rỗng (dict container và dict cảng cố tình để trống);
 * - POST `cargo/add/` ⇒ dòng hàng;
 * - POST `{base}/` ⇒ lần đầu là TẠO bill, sau đó là LƯU bill.
 */
function siteFetch(options: SiteFakeOptions = {}): {
  fetchImpl: typeof fetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const billNo = options.billNo === undefined ? 'BILL-1' : options.billNo
  let cargoCount = 0
  let billPostCount = 0

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const target = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined
    calls.push({ url: target, method, body })

    if (method === 'GET') {
      if (options.failGet && target.includes(options.failGet)) {
        return okResponse({ code: 4000, data: null, msg: 'session' })
      }
      if (target.includes('getTrustCode/')) {
        return okResponse({ code: 2000, data: [{ code: 'MAEU', id: '2' }] })
      }
      if (target.includes('getDrType/')) {
        return okResponse({ code: 2000, data: [{ code: '1', name: 'FOB' }] })
      }
      return okResponse({ code: 2000, data: [] })
    }

    if (target.includes('cargo/add/')) {
      const index = cargoCount
      cargoCount += 1
      if (options.failCargoIndex === index) {
        return okResponse({ code: 5000, data: null, msg: 'boom' })
      }
      return okResponse({ code: 2000, data: {} })
    }

    // POST tới endpoint bill: lần đầu TẠO bill, những lần sau LƯU bill.
    const billIndex = billPostCount
    billPostCount += 1
    if (billIndex === 0) {
      if (options.failCreate) {
        return okResponse({ code: 5000, data: null, msg: 'boom' })
      }
      if (options.createDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.createDelayMs))
      }
      return okResponse({
        code: 2000,
        data: billNo === null ? {} : { bill_no: billNo },
      })
    }
    return okResponse({ code: 2000, data: {} })
  }) as unknown as typeof fetch

  return { fetchImpl, calls }
}

/** Hai fetch giả + options sẵn sàng để chạy. */
function harness(
  apiEnvelope: unknown = { status: 1, data: manifest },
  siteOptions: SiteFakeOptions = {},
): {
  api: { fetchImpl: typeof fetch; calls: RecordedCall[] }
  site: { fetchImpl: typeof fetch; calls: RecordedCall[] }
} {
  return {
    api: manifestFetch(apiEnvelope),
    site: siteFetch(siteOptions),
  }
}

function baseOptions(
  h: ReturnType<typeof harness>,
  overrides: Partial<ManifestRunOptions> = {},
): ManifestRunOptions {
  return {
    blNo: BL_NO,
    apiBase: API_BASE,
    siteApiBase: SITE_BASE,
    fetchImpl: h.api.fetchImpl,
    siteFetchImpl: h.site.fetchImpl,
    cookieString: 'token=test-token',
    ...overrides,
  }
}

/** Chạy ở chế độ preview (KHÔNG ghi lên site). */
async function preview(
  h: ReturnType<typeof harness>,
  overrides: Partial<ManifestRunOptions> = {},
): Promise<ManifestRunResult> {
  return runManifest(baseOptions(h, overrides))
}

/** Chạy ở chế độ ghi (tạo bill → gắn hàng → lưu). */
async function write(
  h: ReturnType<typeof harness>,
  overrides: Partial<ManifestRunOptions> = {},
): Promise<ManifestRunResult> {
  return runManifest(baseOptions(h, { allowWrite: true, ...overrides }))
}

/** Các POST mà site đã nhận. */
function postsOf(h: ReturnType<typeof harness>): RecordedCall[] {
  return h.site.calls.filter((call) => call.method === 'POST')
}

/** Fixture có 2 dòng hàng (dùng để kiểm tra lỗi giữa chừng). */
function twoGoodsEnvelope(): { status: number; data: ManifestData } {
  const goods = manifest.cdgoods?.[0] as ManifestCargo
  return {
    status: 1,
    data: { ...manifest, cdgoods: [goods, { ...goods, id: 131330 }] },
  }
}

/**
 * Dòng hàng mẫu, ép theo loại hàng cần test.
 *
 * `deriveCargoKind` xác định loại hàng như sau:
 *
 * - nguy hiểm = `dangerClass` khác rỗng **HOẶC** `unNub` khác rỗng;
 * - kiểm dịch = `quarantineName` khác rỗng **HOẶC** `quarantineCode` khác rỗng;
 * - `G` = cả hai, `D` = chỉ nguy hiểm, `R` = chỉ kiểm dịch, `S` = không có gì.
 */
function goodsOfKind(kind: 'D' | 'R' | 'G'): ManifestCargo {
  const goods = manifest.cdgoods?.[0] as ManifestCargo
  return {
    ...goods,
    // Nguy hiểm: có `dangerClass` ⇒ `deriveCargoKind` coi là hàng nguy hiểm.
    dangerClass: kind === 'R' ? null : '2.1',
    unNub: null,
    // Kiểm dịch: có `quarantineName` ⇒ `deriveCargoKind` coi là hàng kiểm dịch.
    // Loại `D` thì KHÔNG được kiểm dịch — có cả hai thì thành `G`.
    quarantineName: kind === 'D' ? null : '冷藏',
    quarantineCode: null,
    // API không có dữ liệu người liên hệ nguy hiểm ⇒ các field này trống.
    exigencyName: null,
    exigencyPhone: null,
  }
}

/** Envelope chứa đúng một dòng hàng loại `kind`. */
function kindEnvelope(kind: 'D' | 'R' | 'G'): { status: number; data: ManifestData } {
  return { status: 1, data: { ...manifest, cdgoods: [goodsOfKind(kind)] } }
}

describe('runManifest — preview mode', () => {
  it('KHÔNG gửi POST nào lên site', async () => {
    const h = harness()
    const result = await preview(h)

    expect(result.ok).toBe(true)
    expect(h.site.calls.length).toBeGreaterThan(0)
    for (const call of h.site.calls) {
      expect(call.method).toBe('GET')
    }
    expect(postsOf(h)).toHaveLength(0)
    expect(result.billCreated).toBe(false)
    expect(result.written).toBe(false)
    expect(result.billNo).toBeUndefined()
  })

  it('dựng tên cảng tiếng Trung (KHÔNG dùng nameEn)', async () => {
    const h = harness()
    const result = await preview(h)

    expect(result.preview.header.start_port_nam).toBe('上海')
    expect(result.preview.header.dischrg_port_nam).toBe('勿拉湾')
    expect(result.preview.header.start_port_nam).not.toBe('SHANGHAI')
    expect(result.preview.header.dischrg_port_nam).not.toBe('BELAWAN')
  })

  it('báo field BẮT BUỘC bị trống với `warn`', async () => {
    const h = harness()
    const result = await preview(h)

    const item = result.items.find(
      (entry) => entry.scope === 'cargo' && entry.prop === 'PACKAGE_COD',
    )
    expect(item).toBeDefined()
    expect(item?.status).toBe('warn')
    expect(item?.required).toBe(true)
    expect(item?.scope).toBe('cargo')
    expect(item?.row).toBe(1)
    expect(item?.label).toBe('包装代码')
    expect((item?.note ?? '').trim().length).toBeGreaterThan(0)
  })

  it('báo field thường bị trống với `skip`', async () => {
    const h = harness()
    const result = await preview(h)

    const item = result.items.find((entry) => entry.prop === 'SHIPPER_EM_STR')
    expect(item).toBeDefined()
    expect(item?.status).toBe('skip')
    expect(item?.required).toBe(false)
    expect(item?.scope).toBe('header')
    expect(item?.row).toBeUndefined()
    expect(item?.note).toBe(BLANK_NOTES.SHIPPER_EM_STR)
    expect(item?.note).toContain('email')
  })

  it('báo ĐÚNG số field bắt buộc bị trống', async () => {
    const h = harness()
    const result = await preview(h)

    const required = result.items.filter((entry) => entry.required === true)
    expect(required.map((entry) => entry.prop)).toEqual([
      'PACKAGE_COD',
      'PACKAGE_STR',
      'CNTR_SIZE_COD',
      'CNTR_TYPE_COD',
      'CNTR_EF_ID',
    ])
    expect(required).toHaveLength(5)
    expect(result.blocked).toBe(true)
  })

  it('KHÔNG báo field bị site xoá theo loại hàng', async () => {
    const h = harness()
    const result = await preview(h)

    const props = result.items.map((entry) => entry.prop)
    for (const prop of [...DANGER_FIELDS, ...TEMP_FIELDS]) {
      expect(props).not.toContain(prop.toUpperCase())
    }
    // Fixture là hàng thường (loại `S`) ⇒ cả field nguy hiểm lẫn nhiệt độ
    // đều bị site xoá ⇒ không phải lỗi.
    expect(result.preview.cargo[0]?.cargo_kind_cod).toBe('S')
  })

  it('hàng NGUY HIỂM (D) ⇒ báo field nguy hiểm bắt buộc, KHÔNG báo field nhiệt độ', async () => {
    const h = harness(kindEnvelope('D'))
    const result = await preview(h)

    expect(result.preview.cargo[0]?.cargo_kind_cod).toBe('D')
    const cargoItems = result.items.filter((entry) => entry.scope === 'cargo')
    const required = cargoItems
      .filter((entry) => entry.required === true)
      .map((entry) => entry.prop)
    const reported = cargoItems.map((entry) => entry.prop)
    // Field nguy hiểm mà API không có dữ liệu ⇒ BẮT BUỘC phải báo.
    expect(required).toContain('DANG_UN_NO')
    expect(required).toContain('DANGER_CONTACT_NAM')
    expect(required).toContain('DANGER_TE_STR')
    // `DANG_CLASS_NAM` CÓ giá trị ('2.1') ⇒ không phải field trống.
    expect(required).not.toContain('DANG_CLASS_NAM')
    // Site XOÁ field nhiệt độ với loại `D` ⇒ KHÔNG được báo (kể cả `skip`).
    expect(reported).not.toContain('TEMP_ID')
    expect(reported).not.toContain('SET_TEMP_NUM')
  })

  it('hàng KIỂM DỊCH (R) ⇒ báo field nhiệt độ bắt buộc, KHÔNG báo field nguy hiểm', async () => {
    const h = harness(kindEnvelope('R'))
    const result = await preview(h)

    expect(result.preview.cargo[0]?.cargo_kind_cod).toBe('R')
    const cargoItems = result.items.filter((entry) => entry.scope === 'cargo')
    const required = cargoItems
      .filter((entry) => entry.required === true)
      .map((entry) => entry.prop)
    const reported = cargoItems.map((entry) => entry.prop)
    expect(required).toContain('TEMP_ID')
    expect(required).toContain('SET_TEMP_NUM')
    // Site XOÁ field nguy hiểm với loại `R` ⇒ KHÔNG được báo (kể cả `skip`).
    expect(reported).not.toContain('DANG_UN_NO')
    expect(reported).not.toContain('DANGER_CONTACT_NAM')
    expect(reported).not.toContain('DANGER_TE_STR')
  })

  it('hàng NGUY HIỂM + KIỂM DỊCH (G) ⇒ báo CẢ hai nhóm field bắt buộc', async () => {
    const h = harness(kindEnvelope('G'))
    const result = await preview(h)

    expect(result.preview.cargo[0]?.cargo_kind_cod).toBe('G')
    const required = result.items
      .filter((entry) => entry.scope === 'cargo' && entry.required === true)
      .map((entry) => entry.prop)
    expect(required).toContain('DANG_UN_NO')
    expect(required).toContain('DANGER_CONTACT_NAM')
    expect(required).toContain('DANGER_TE_STR')
    expect(required).toContain('TEMP_ID')
    expect(required).toContain('SET_TEMP_NUM')
  })

  it('preview mode CŨNG mang message khi còn field bắt buộc bị trống', async () => {
    const h = harness()
    const result = await preview(h)

    expect(result.ok).toBe(true)
    expect(result.blocked).toBe(true)
    expect(result.message).toBe(
      '5 field(s) required by the site are not provided by the API — they are listed in the report and must be filled in by hand on the site.',
    )
  })

  it('mọi item đều có note', async () => {
    const h = harness()
    const result = await preview(h)

    expect(result.items.length).toBeGreaterThan(0)
    for (const item of result.items) {
      expect(typeof item.note).toBe('string')
      expect((item.note ?? '').trim().length).toBeGreaterThan(0)
    }
  })

  it('preview có đủ dòng hàng + dòng container, và đúng số dòng', async () => {
    const h = harness()
    const result = await preview(h)

    expect(result.cargoRows).toBe(1)
    expect(result.containerRows).toBe(1)
    expect(result.preview.cargo).toHaveLength(1)
    expect(result.preview.containers).toHaveLength(1)
    // Mã bill chưa biết lúc dựng preview ⇒ để trống.
    expect(result.preview.cargo[0]?.bill_no).toBe('')
    expect(result.preview.containers[0]?.bill_no).toBe('')
  })
})

describe('runManifest — write mode', () => {
  it('gửi đúng 3 POST theo thứ tự create → cargo → save', async () => {
    const h = harness()
    const result = await write(h)

    expect(result.ok).toBe(true)
    const posts = postsOf(h)
    expect(posts).toHaveLength(3)
    expect(posts[0]?.url).toBe(`${SITE_BASE}/`)
    expect(posts[1]?.url).toBe(`${SITE_BASE}/cargo/add/`)
    expect(posts[2]?.url).toBe(`${SITE_BASE}/`)
    // Bước TẠO bill dùng `is_all` = "0" (KHÔNG phải "2" = 发送).
    expect(posts[0]?.body?.is_all).toBe('0')
    for (const post of posts) {
      expect(post.method).toBe('POST')
    }
  })

  it('dòng hàng mang bill_no do server gán (nguyên văn)', async () => {
    // Mã bill CHỨA chữ thường ⇒ nếu bị uppercase thì test này bắt được.
    const h = harness({ status: 1, data: manifest }, { billNo: 'bill-1' })
    await write(h)

    const cargoPost = h.site.calls.find((call) => call.url.includes('cargo/add/'))
    expect(cargoPost?.body?.bill_no).toBe('bill-1')
    expect(cargoPost?.body?.bill_no).not.toBe('')
    expect(cargoPost?.body?.bill_no).not.toBe('BILL-1')
  })

  it('bước lưu có is_all "1" + cntr_list, KHÔNG có cargo_list', async () => {
    const h = harness()
    await write(h)

    const posts = postsOf(h)
    const saveBody = posts[posts.length - 1]?.body ?? {}
    expect(saveBody.is_all).toBe('1')
    expect(Array.isArray(saveBody.cntr_list)).toBe(true)
    const list = saveBody.cntr_list as Record<string, unknown>[]
    expect(list).toHaveLength(1)
    expect(list[0]?.bill_no).toBe('BILL-1')
    // KHÔNG bao giờ gửi "2" (发送) và KHÔNG gửi lại `cargo_list`.
    expect(JSON.stringify(saveBody)).not.toContain('"is_all":"2"')
    expect(saveBody).not.toHaveProperty('cargo_list')
  })

  it('KHÔNG gọi send/ upload/ deleteBill/ downloadTemplate/', async () => {
    const h = harness()
    await write(h)

    for (const call of h.site.calls) {
      expect(call.url).not.toContain('send/')
      expect(call.url).not.toContain('upload/')
      expect(call.url).not.toContain('deleteBill/')
      expect(call.url).not.toContain('downloadTemplate/')
    }
  })

  it('báo thành công + vẫn còn field bắt buộc phải điền tay', async () => {
    const h = harness()
    const result = await write(h)

    expect(result.ok).toBe(true)
    expect(result.billCreated).toBe(true)
    expect(result.billNo).toBe('BILL-1')
    expect(result.written).toBe(true)
    // 5 field bắt buộc vẫn trống ⇒ bản nháp, operator phải điền tay.
    expect(result.blocked).toBe(true)
    expect(result.message).toContain('5 field(s)')
  })

  it('site tạo bill xong nhưng không trả mã bill ⇒ KHÔNG POST dòng hàng nào', async () => {
    const h = harness({ status: 1, data: manifest }, { billNo: null })
    const result = await write(h)

    expect(postsOf(h)).toHaveLength(1)
    expect(postsOf(h)[0]?.url).toBe(`${SITE_BASE}/`)
    expect(result.billCreated).toBe(true)
    expect(result.billNo).toBeUndefined()
    expect(result.written).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('finish this manifest by hand')
  })

  it('dòng hàng lỗi ⇒ báo trạng thái một phần', async () => {
    const h = harness(twoGoodsEnvelope(), { failCargoIndex: 1 })
    const result = await write(h)

    expect(result.billCreated).toBe(true)
    expect(result.billNo).toBe('BILL-1')
    expect(result.written).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('The manifest bill was created on the site')
    // Dòng hàng 1 gắn được, dòng hàng 2 bị site từ chối ⇒ báo đúng số dòng.
    expect(result.message).toContain('1 of 2 cargo rows were added')
    expect(result.message).toContain('never deletes bills on its own')
  })

  it('KHÔNG mutate header khi ghi (bill_no + is_all giữ nguyên)', async () => {
    const h = harness()
    const result = await write(h)

    // `saveManifestContainers` copy header rồi sửa bản copy ⇒ header gốc
    // (mà caller có thể dùng lại) không bị đổi.
    expect(result.preview.header.is_all).toBe('0')
    expect(result.preview.header.bill_no).toBe('')
  })
})

describe('runManifest — lỗi', () => {
  it('lỗi API manifest ⇒ ok false + message đúng, KHÔNG gửi POST nào', async () => {
    const h = harness({ status: 0, data: null })
    const result = await preview(h)

    expect(result.ok).toBe(false)
    expect(result.message).toContain(
      'No manifest was found for this bill of lading number.',
    )
    expect(result.message).toContain('Nothing was created on the site.')
    expect(postsOf(h)).toHaveLength(0)
  })

  it('lỗi session của site (code 4000) ⇒ message đúng', async () => {
    const h = harness({ status: 1, data: manifest }, { failGet: 'getTrustCode/' })
    const result = await preview(h)

    expect(result.ok).toBe(false)
    expect(result.message).toContain(
      'Your session on the site has expired — log in to the site and try again.',
    )
    // Gợi ý HttpOnly phải có mặt — nếu không, operator đã đăng nhập vẫn bị
    // bắt vòng lặp "đăng nhập lại" mà không biết vì sao.
    expect(result.message).toContain("the site's token cookie may be HttpOnly")
  })

  it('hết hạn trước khi làm gì ⇒ không gọi mạng', async () => {
    const h = harness()
    const result = await preview(h, { deadlineMs: 0 })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('time limit')
    expect(result.billCreated).toBe(false)
    expect(h.site.calls).toHaveLength(0)
    expect(h.api.calls).toHaveLength(0)
  })

  it('hết hạn giữa chừng ⇒ không POST dòng hàng, báo trạng thái một phần', async () => {
    // Cửa sổ thời gian rộng (400 ms trễ vs 300 ms hạn) ⇒ không bị flake do
    // máy chậm.
    const h = harness({ status: 1, data: manifest }, { createDelayMs: 400 })
    const result = await write(h, { deadlineMs: 300, timeoutMs: 5000 })

    const posts = postsOf(h)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.url).toBe(`${SITE_BASE}/`)
    expect(result.billCreated).toBe(true)
    expect(result.written).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('time limit')
    expect(h.site.calls.filter((call) => call.url.includes('cargo/add/'))).toHaveLength(0)
  })

  it('blNo rỗng ⇒ không gọi mạng', async () => {
    const h = harness()
    const result = await preview(h, { blNo: '   ' })

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Enter a bill of lading number before running the manifest.')
    expect(result.steps).toHaveLength(0)
    expect(h.api.calls).toHaveLength(0)
    expect(h.site.calls).toHaveLength(0)
  })

  it('lỗi không phải ApiError ⇒ message chung, KHÔNG reject', async () => {
    // Dữ liệu hỏng (`cdgoods` chứa `null`) ⇒ `TypeError` lọt ra ngoài các
    // lớp lỗi của API ⇒ phải rơi vào message chung, không reject.
    const h = harness({ status: 1, data: { ...manifest, cdgoods: [null] } })
    const result = await preview(h)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Something went wrong while running the manifest.')
    expect(result.message).toContain('Nothing was created on the site.')
    expect(postsOf(h)).toHaveLength(0)
  })

  it('site từ chối tạo bill ⇒ không POST dòng hàng, cảnh báo bill có thể đã tồn tại', async () => {
    const h = harness({ status: 1, data: manifest }, { failCreate: true })
    const result = await write(h)

    expect(result.ok).toBe(false)
    expect(result.billCreated).toBe(false)
    expect(result.billNo).toBeUndefined()
    expect(result.written).toBe(false)

    // Chỉ có đúng 1 POST (tạo bill) — KHÔNG có POST dòng hàng nào.
    const posts = postsOf(h)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.url).toBe(`${SITE_BASE}/`)
    expect(posts.filter((post) => post.url.includes('cargo/add/'))).toHaveLength(0)

    expect(result.message).toContain('The site rejected the request.')
    expect(result.message).toContain('may already exist on the site')
    // KHÔNG được nói "chưa tạo gì cả" — yêu cầu ĐÃ gửi lên site.
    expect(result.message).not.toContain('Nothing was created on the site.')
  })
})
