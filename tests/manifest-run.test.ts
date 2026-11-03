import { describe, it, expect } from 'vitest'
import { runManifest, type ManifestRunOptions, type ManifestRunResult } from '../src/core/manifest-run'
import {
  BLANK_NOTES,
  DANGER_FIELDS,
  TEMP_FIELDS,
} from '../src/core/field-meta'
import type { ManifestApiData, ManifestCargo } from '../src/core/types'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'

const SITE_BASE = 'https://site.test/api/booking/exportManifestDataMaintain'
const API_BASE = 'https://api.test/manifest'
const BL_NO = 'ONEYSHAGT1569600'

/** Dữ liệu mẫu (phần `data` của envelope của API) — hình dạng RAW. */
const manifest = fixture.data as ManifestApiData

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
function manifestFetch(
  envelope: unknown,
  timeline: string[] = [],
): {
  fetchImpl: typeof fetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: (init?.method ?? 'GET').toUpperCase() })
    timeline.push(`api:${String(url)}`)
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
  /** Endpoint POST cần trả về mã lỗi 4000 (session hết hạn). */
  failPost?: string
  /** Site từ chối yêu cầu tạo bill (code 5000). */
  failCreate?: boolean
  /** Mã 包装代码 mà site trả về cho dict `getPackageCode/`. */
  packageCode?: string
  /**
   * Mã cảng mà site trả về cho dict `getPort/`.
   *
   * Chuỗi ⇒ mã đó cho MỌI cảng; object ⇒ mã theo tên cảng tiếng Anh
   * (khớp `kw` của request).
   */
  portCode?: string | Record<string, string>
}

/** Tên cảng tiếng Anh của `kw` trong URL — '' khi URL không có `kw`. */
function kwOf(url: string): string {
  const match = /[?&]kw=([^&]*)/.exec(url)
  if (!match?.[1]) return ''
  return decodeURIComponent(match[1])
}

/** Mã cảng của fake cho tên cảng tiếng Anh `kw`. */
function portCodeFor(
  portCode: SiteFakeOptions['portCode'],
  kw: string,
): string | undefined {
  if (portCode === undefined) return undefined
  if (typeof portCode === 'string') return portCode
  return portCode[kw] ?? portCode[kw.toUpperCase()]
}

/**
 * Fetch giả của site.
 *
 * - GET `getPort/` ⇒ mã cảng theo tên cảng tiếng Anh trong `kw` (rỗng nếu
 *   không đặt `portCode`);
 * - GET `getPackageCode/` ⇒ mã 包装代码 (rỗng nếu không đặt `packageCode`);
 * - GET còn lại ⇒ rỗng;
 * - POST `cargo/add/` ⇒ dòng hàng;
 * - POST `{base}/` ⇒ lần đầu là TẠO bill, sau đó là LƯU bill.
 */
function siteFetch(
  options: SiteFakeOptions = {},
  timeline: string[] = [],
): {
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
    timeline.push(`site:${target}`)

    if (method === 'GET') {
      if (options.failGet && target.includes(options.failGet)) {
        return okResponse({ code: 4000, data: null, msg: 'session' })
      }
      if (target.includes('getPort/')) {
        const kw = kwOf(target)
        const code = portCodeFor(options.portCode, kw)
        if (code === undefined) return okResponse({ code: 2000, data: [] })
        // Dict của site lưu tên Trung ở `E_PORT_NAM`, tên Anh ở cột khác.
        return okResponse({
          code: 2000,
          data: [{ PORT_COD: code, E_PORT_NAM: '上海', E_PORT_NAM_EN: kw }],
        })
      }
      if (target.includes('getPackageCode/')) {
        return okResponse({
          code: 2000,
          data:
            options.packageCode === undefined
              ? []
              : [{ PACKAGE_COD: options.packageCode, E_PACKAGE_NAM: 'PACKAGES' }],
        })
      }
      return okResponse({ code: 2000, data: [] })
    }

    if (options.failPost && target.includes(options.failPost)) {
      return okResponse({ code: 4000, data: null, msg: 'session' })
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
        // `extractBillNo` của site chỉ nhận MẢNG ⇒ fake cũng trả mảng.
        data: billNo === null ? {} : { bill_no: [billNo] },
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
  /** Thứ tự THỜI GIAN của mọi request (API + site). */
  timeline: string[]
} {
  const timeline: string[] = []
  return {
    api: manifestFetch(apiEnvelope, timeline),
    site: siteFetch(siteOptions, timeline),
    timeline,
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

/**
 * Chạy manifest — extension CHỈ CÓ MỘT hành động: ghi lên site
 * (tạo bill → gắn hàng → lưu nháp).
 */
async function run(
  h: ReturnType<typeof harness>,
  overrides: Partial<ManifestRunOptions> = {},
): Promise<ManifestRunResult> {
  return runManifest(baseOptions(h, overrides))
}

/** Các POST mà site đã nhận. */
function postsOf(h: ReturnType<typeof harness>): RecordedCall[] {
  return h.site.calls.filter((call) => call.method === 'POST')
}

/** POST gắn dòng hàng (`cargo/add/`) — dòng hàng đầu tiên. */
function cargoPostOf(h: ReturnType<typeof harness>): RecordedCall | undefined {
  return h.site.calls.find((call) => call.url.includes('cargo/add/'))
}

/** Fixture có 2 dòng hàng (dùng để kiểm tra lỗi giữa chừng). */
function twoGoodsEnvelope(): { status: number; data: ManifestApiData } {
  const goods = manifest.cdgoods?.[0] as ManifestCargo
  return {
    status: 1,
    data: { ...manifest, cdgoods: [goods, { ...goods, id: 131330 }] },
  }
}

/**
 * Envelope whose API gives NO port code (the codes are blank) — the port
 * NAMES are still there.
 *
 * The only case where the extension asks the site's port dictionary: with a
 * code in place, the code of the API is kept and the site is not called.
 */
function blankPortCodesEnvelope(): { status: number; data: ManifestApiData } {
  return {
    status: 1,
    data: { ...manifest, loadCode: '', aimPortCode: '', uploadCode: '' },
  }
}

/**
 * Envelope whose API gives only ONE port code (装货港 has one, 卸货港 /
 * 交货地 are blank).
 */
function onePortCodeEnvelope(): { status: number; data: ManifestApiData } {
  return {
    status: 1,
    data: { ...manifest, loadCode: 'CNSHA', aimPortCode: '', uploadCode: '' },
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
function kindEnvelope(kind: 'D' | 'R' | 'G'): { status: number; data: ManifestApiData } {
  return { status: 1, data: { ...manifest, cdgoods: [goodsOfKind(kind)] } }
}

/**
 * Envelope có MỘT bên (收货人) KHÔNG có phone.
 *
 * Site kiểm tra ở form: mỗi bên phải có ÍT NHẤT một kênh liên hệ
 * (电话 / EMAIL / 传真). Extension chỉ điền được 电话 ⇒ bên không có phone
 * thì cả ba kênh đều trống.
 */
function partyWithoutPhoneEnvelope(): { status: number; data: ManifestApiData } {
  const contacts = (manifest.cabContacts ?? []).map((contact) =>
    contact.type === true ? { ...contact, phone: null } : contact,
  )
  return { status: 1, data: { ...manifest, cabContacts: contacts } }
}

/** Envelope có một dòng hàng mà số API trả về KHÔNG parse được. */
function unparsableWeightEnvelope(): { status: number; data: ManifestApiData } {
  const goods = manifest.cdgoods?.[0] as ManifestCargo
  return {
    status: 1,
    data: { ...manifest, cdgoods: [{ ...goods, weight: '22,400' }] },
  }
}

/** Trong body đã gửi đi có giá trị `null` nào không? */
function hasNullValue(value: unknown): boolean {
  if (value === null) return true
  if (Array.isArray(value)) return value.some((item) => hasNullValue(item))
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some((item) => hasNullValue(item))
  }
  return false
}

describe('runManifest — dựng payload và report', () => {
  it('KHÔNG load dict của site trước khi fetch manifest', async () => {
    const h = harness()
    await run(h)

    // Dict 承运人 và dict 箱型/尺寸 KHÔNG còn được gọi nữa.
    for (const call of h.site.calls) {
      expect(call.url).not.toContain('getTrustCode/')
      expect(call.url).not.toContain('getCntrCode/')
    }
  })

  it('tra MÃ CẢNG đi SAU API (cần tên cảng) và TRƯỚC POST đầu tiên', async () => {
    // The dictionary is only asked when the API has NO port code ⇒ use the blank-code envelope.
    const h = harness(blankPortCodesEnvelope())
    await run(h)

    const apiIndex = h.timeline.findIndex((entry) => entry.startsWith('api:'))
    const portIndex = h.timeline.findIndex((entry) => entry.includes('getPort/'))
    // POST đầu tiên là bước TẠO bill ⇒ URL của nó là `${SITE_BASE}/`.
    const firstPostIndex = h.timeline.findIndex((entry) => entry === `site:${SITE_BASE}/`)

    expect(apiIndex).toBeGreaterThan(-1)
    expect(portIndex).toBeGreaterThan(apiIndex)
    expect(firstPostIndex).toBeGreaterThan(-1)
    expect(portIndex).toBeLessThan(firstPostIndex)
  })

  it('tra MÃ 包装代码 đi SAU API (cần tên bao bị) và TRƯỚC POST đầu tiên', async () => {
    const h = harness()
    await run(h)

    const apiIndex = h.timeline.findIndex((entry) => entry.startsWith('api:'))
    const packageIndex = h.timeline.findIndex((entry) => entry.includes('getPackageCode/'))
    // POST đầu tiên là bước TẠO bill ⇒ URL của nó là `${SITE_BASE}/`.
    const firstPostIndex = h.timeline.findIndex((entry) => entry === `site:${SITE_BASE}/`)

    expect(apiIndex).toBeGreaterThan(-1)
    expect(packageIndex).toBeGreaterThan(apiIndex)
    expect(firstPostIndex).toBeGreaterThan(-1)
    expect(packageIndex).toBeLessThan(firstPostIndex)
  })

  it('tra được MÃ 包装代码 ⇒ điền vào dòng hàng, KHÔNG báo field trống', async () => {
    const h = harness(undefined, { packageCode: 'PKGS' })
    const result = await run(h)

    // Mã đi kèm dòng hàng gửi lên site.
    expect(cargoPostOf(h)?.body?.package_cod).toBe('PKGS')
    // Đã điền ⇒ KHÔNG còn báo là field BẮT BUỘC bị trống.
    const item = result.items.find(
      (entry) => entry.scope === 'cargo' && entry.prop === 'PACKAGE_COD',
    )
    expect(item).toBeUndefined()
  })

  it('dict KHÔNG trả mã ⇒ PACKAGE_COD vẫn trống và vẫn báo cho operator', async () => {
    const h = harness(undefined, {})
    const result = await run(h)

    const item = result.items.find(
      (entry) => entry.scope === 'cargo' && entry.prop === 'PACKAGE_COD',
    )
    expect(item).toBeDefined()
    expect(item?.required).toBe(true)
    expect(item?.status).toBe('warn')
    // Dòng hàng gửi lên site vẫn mang mã rỗng.
    expect(cargoPostOf(h)?.body?.package_cod).toBe('')
  })

  it('tra MÃ 包装代码 MỘT LẦN cho mỗi tên bao bì (2 dòng cùng tên ⇒ 1 request)', async () => {
    const h = harness(twoGoodsEnvelope(), { packageCode: 'PKGS' })
    await run(h)

    const packageCalls = h.site.calls.filter((call) => call.url.includes('getPackageCode/'))
    expect(packageCalls).toHaveLength(1)
    expect(packageCalls[0]?.url).toContain('kw=PACKAGES')
    // Cả hai dòng hàng đều mang mã.
    const cargoPosts = h.site.calls.filter((call) => call.url.includes('cargo/add/'))
    expect(cargoPosts).toHaveLength(2)
    for (const post of cargoPosts) {
      expect(post.body?.package_cod).toBe('PKGS')
    }
  })

  it('dựng tên cảng tiếng Anh (`nameEn`)', async () => {
    const h = harness()
    await run(h)

    // Header đi lên site ở bước TẠO bill (POST đầu tiên).
    const createPost = postsOf(h)[0]
    expect(createPost?.body?.start_port_nam).toBe('SHANGHAI')
    expect(createPost?.body?.dischrg_port_nam).toBe('BELAWAN')
  })

  it('付款方式 đảo chiều: payType false ⇒ "P" (预付)', async () => {
    const h = harness()
    await run(h)

    // Fixture: `payType: false` ⇒ 预付 ⇒ mã "P".
    expect(postsOf(h)[0]?.body?.pay_way_id).toBe('P')
  })

  it('交货条款 lấy THẲNG giá trị của API (KHÔNG tra dict)', async () => {
    const h = harness()
    await run(h)

    // Fixture: `transportTerms` = "1"; body lấy thẳng giá trị của API.
    expect(postsOf(h)[0]?.body?.dr_type_str).toBe('1')
  })

  it('bước TẠO bill KHÔNG gửi kèm dòng hàng / dòng container', async () => {
    const h = harness()
    await run(h)

    const createPost = postsOf(h)[0]
    expect(createPost?.body).not.toHaveProperty('cdgoods')
    expect(createPost?.body).not.toHaveProperty('cntr_list')
    // Chỉ 43 key header.
    expect(Object.keys(createPost?.body ?? {})).toHaveLength(43)
  })

  it('báo field BẮT BUỘC bị trống với `warn`', async () => {
    const h = harness()
    const result = await run(h)

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
    const result = await run(h)

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
    const result = await run(h)

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
    const result = await run(h)

    const props = result.items.map((entry) => entry.prop)
    for (const prop of [...DANGER_FIELDS, ...TEMP_FIELDS]) {
      expect(props).not.toContain(prop.toUpperCase())
    }
    // Fixture là hàng thường (loại `S`) ⇒ cả field nguy hiểm lẫn nhiệt độ
    // đều bị site xoá ⇒ không phải lỗi.
    expect(cargoPostOf(h)?.body?.cargo_kind_cod).toBe('S')
  })

  it('hàng NGUY HIỂM (D) ⇒ báo field nguy hiểm bắt buộc, KHÔNG báo field nhiệt độ', async () => {
    const h = harness(kindEnvelope('D'))
    const result = await run(h)

    expect(cargoPostOf(h)?.body?.cargo_kind_cod).toBe('D')
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
    const result = await run(h)

    expect(cargoPostOf(h)?.body?.cargo_kind_cod).toBe('R')
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
    const result = await run(h)

    expect(cargoPostOf(h)?.body?.cargo_kind_cod).toBe('G')
    const required = result.items
      .filter((entry) => entry.scope === 'cargo' && entry.required === true)
      .map((entry) => entry.prop)
    expect(required).toContain('DANG_UN_NO')
    expect(required).toContain('DANGER_CONTACT_NAM')
    expect(required).toContain('DANGER_TE_STR')
    expect(required).toContain('TEMP_ID')
    expect(required).toContain('SET_TEMP_NUM')
  })

  it('ghi xong VẪN mang message khi còn field bắt buộc bị trống', async () => {
    const h = harness()
    const result = await run(h)

    expect(result.ok).toBe(true)
    expect(result.blocked).toBe(true)
    expect(result.message).toBe(
      '5 field(s) required by the site are not provided by the API — fill them in by hand on the site.',
    )
  })

  it('mọi item đều có note', async () => {
    const h = harness()
    const result = await run(h)

    expect(result.items.length).toBeGreaterThan(0)
    for (const item of result.items) {
      expect(typeof item.note).toBe('string')
      expect((item.note ?? '').trim().length).toBeGreaterThan(0)
    }
  })

  it('ghi đủ dòng hàng + dòng container, và đúng số dòng', async () => {
    const h = harness()
    const result = await run(h)

    expect(result.cargoRows).toBe(1)
    expect(result.containerRows).toBe(1)
    // MỘT dòng hàng ⇒ MỘT POST `cargo/add/`.
    expect(h.site.calls.filter((call) => call.url.includes('cargo/add/'))).toHaveLength(1)
    // MỘT dòng container ⇒ `cntr_list` của bước LƯU có đúng một phần tử.
    const savePost = postsOf(h)[postsOf(h).length - 1]
    expect(savePost?.body?.cntr_list).toHaveLength(1)
    // Dòng hàng đi lên site với mã bill DO SERVER GÁN.
    expect(cargoPostOf(h)?.body?.bill_no).toBe('BILL-1')
  })
})

/**
 * Tra MÃ CẢNG trong dict cảng của site.
 *
 * Dict cảng chỉ là LỰA CHỌN CUỐI: site KHÔNG được gọi khi API đã có mã ở
 * 装货港 HOẶC 卸货港 — mã của API được giữ nguyên. Tra SAU khi đã có tên
 * cảng tiếng Anh của API; tra lỗi thì mã vẫn TRỐNG (không được làm hỏng cả
 * lần chạy).
 */
describe('runManifest — tra mã cảng', () => {
  it('tra được mã cảng ⇒ điền vào header', async () => {
    // The site returns a code the API does NOT have (the API codes are blank)
    // ⇒ this test only passes when `fillPortCodes` really writes the lookup
    // result into the header.
    const h = harness(blankPortCodesEnvelope(), {
      portCode: { SHANGHAI: 'SITE-SHA', BELAWAN: 'SITE-BLW' },
    })
    const result = await run(h)

    const createPost = postsOf(h)[0]
    expect(createPost?.body?.start_port_cod).toBe('SITE-SHA')
    expect(createPost?.body?.dischrg_port_cod).toBe('SITE-BLW')
    expect(createPost?.body?.dest_port_cod).toBe('SITE-BLW')
    expect(result.steps.join('\n')).toContain('Looked up the port codes on the site')
  })

  it('API ĐÃ có mã cảng ⇒ KHÔNG gọi site, KHÔNG ghi đè mã của API', async () => {
    const h = harness(undefined, {
      portCode: { SHANGHAI: 'SITE-SHA', BELAWAN: 'SITE-BLW' },
    })
    const result = await run(h)

    // The site's port dictionary must NOT be called.
    const portCalls = h.site.calls.filter((call) => call.url.includes('getPort/'))
    expect(portCalls).toHaveLength(0)
    // The codes of the API are kept exactly as they are.
    const createPost = postsOf(h)[0]
    expect(createPost?.body?.start_port_cod).toBe('CNSHA')
    expect(createPost?.body?.dischrg_port_cod).toBe('IDBLW')
    expect(createPost?.body?.dest_port_cod).toBe('IDBLW')
    expect(result.steps.join('\n')).toContain('No port code lookup was needed')
  })

  it('chỉ MỘT trong hai mã cảng có ⇒ KHÔNG tra (phải trống CẢ HAI mới tra)', async () => {
    const h = harness(onePortCodeEnvelope(), {
      portCode: { SHANGHAI: 'SITE-SHA', BELAWAN: 'SITE-BLW' },
    })
    const result = await run(h)

    // 装货港 already has the code of the API ⇒ NO lookup.
    const portCalls = h.site.calls.filter((call) => call.url.includes('getPort/'))
    expect(portCalls).toHaveLength(0)
    const createPost = postsOf(h)[0]
    expect(createPost?.body?.start_port_cod).toBe('CNSHA')
    expect(createPost?.body?.dischrg_port_cod).toBe('')
    expect(createPost?.body?.dest_port_cod).toBe('')
    // 卸货港 is still blank ⇒ the operator must fill it in by hand.
    const dischrg = result.items.find((entry) => entry.prop === 'DISCHRG_PORT_COD')
    expect(dischrg?.required).toBe(true)
    expect(dischrg?.status).toBe('warn')
    expect(result.blocked).toBe(true)
  })

  it('mã cảng đã điền ⇒ KHÔNG báo field trống', async () => {
    // The API gives NO code ⇒ the codes come from the site's dictionary.
    const h = harness(blankPortCodesEnvelope(), {
      portCode: { SHANGHAI: 'CNSHA', BELAWAN: 'IDBLW' },
    })
    const result = await run(h)

    const props = result.items.map((entry) => entry.prop)
    expect(props).not.toContain('START_PORT_COD')
    expect(props).not.toContain('DISCHRG_PORT_COD')
    expect(props).not.toContain('DEST_PORT_COD')
  })

  it('tra MỘT LẦN cho mỗi tên cảng (SHANGHAI + BELAWAN ⇒ 2 request)', async () => {
    const h = harness(blankPortCodesEnvelope(), {
      portCode: { SHANGHAI: 'CNSHA', BELAWAN: 'IDBLW' },
    })
    await run(h)

    const portCalls = h.site.calls.filter((call) => call.url.includes('getPort/'))
    expect(portCalls).toHaveLength(2)
    // 卸货港 và 交货地 cùng tên (BELAWAN) ⇒ chỉ tra MỘT lần.
    expect(portCalls.map((call) => kwOf(call.url)).sort()).toEqual(['BELAWAN', 'SHANGHAI'])
  })

  it('dict KHÔNG trả mã ⇒ mã vẫn TRỐNG và vẫn báo cho operator', async () => {
    const h = harness(blankPortCodesEnvelope(), {})
    const result = await run(h)

    // The dictionary WAS asked — it simply has no answer.
    const portCalls = h.site.calls.filter((call) => call.url.includes('getPort/'))
    expect(portCalls).toHaveLength(2)

    const createPost = postsOf(h)[0]
    expect(createPost?.body?.start_port_cod).toBe('')
    expect(createPost?.body?.dischrg_port_cod).toBe('')
    // The two required port codes are still blank ⇒ the operator must fill them in by hand.
    const start = result.items.find((entry) => entry.prop === 'START_PORT_COD')
    expect(start?.required).toBe(true)
    expect(start?.status).toBe('warn')
    const dischrg = result.items.find((entry) => entry.prop === 'DISCHRG_PORT_COD')
    expect(dischrg?.required).toBe(true)
    expect(dischrg?.status).toBe('warn')
    expect(result.ok).toBe(true)
  })

  it('tra mã cảng LỖI ⇒ mã vẫn TRỐNG, run vẫn thành công', async () => {
    // Site trả 4000 cho `getPort/` ⇒ lỗi bị nuốt, mã vẫn TRỐNG.
    const h = harness(blankPortCodesEnvelope(), { failGet: 'getPort/' })
    const result = await run(h)

    // The dictionary WAS asked — the site answered with an error.
    const portCalls = h.site.calls.filter((call) => call.url.includes('getPort/'))
    expect(portCalls).toHaveLength(2)

    const createPost = postsOf(h)[0]
    expect(createPost?.body?.start_port_cod).toBe('')
    expect(createPost?.body?.dischrg_port_cod).toBe('')
    expect(result.ok).toBe(true)
    expect(result.written).toBe(true)
  })
})

describe('runManifest — ghi lên site', () => {
  it('gửi đúng 3 POST theo thứ tự create → cargo → save', async () => {
    const h = harness()
    const result = await run(h)

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
    await run(h)

    const cargoPost = h.site.calls.find((call) => call.url.includes('cargo/add/'))
    expect(cargoPost?.body?.bill_no).toBe('bill-1')
    expect(cargoPost?.body?.bill_no).not.toBe('')
    expect(cargoPost?.body?.bill_no).not.toBe('BILL-1')
  })

  it('bước lưu có is_all "1" + cntr_list, KHÔNG có cargo_list', async () => {
    const h = harness()
    await run(h)

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
    await run(h)

    for (const call of h.site.calls) {
      expect(call.url).not.toContain('send/')
      expect(call.url).not.toContain('upload/')
      expect(call.url).not.toContain('deleteBill/')
      expect(call.url).not.toContain('downloadTemplate/')
    }
  })

  it('báo thành công + vẫn còn field bắt buộc phải điền tay', async () => {
    const h = harness()
    const result = await run(h)

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
    const result = await run(h)

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
    const result = await run(h)

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
    await run(h)

    // `saveManifestContainers` copy header rồi sửa bản copy ⇒ header gốc
    // (mà caller có thể dùng lại) không bị đổi ⇒ bước TẠO bill vẫn gửi
    // `bill_no` rỗng và `is_all` = "0" (KHÔNG phải "2" = 发送).
    const createPost = postsOf(h)[0]
    expect(createPost?.body?.is_all).toBe('0')
    expect(createPost?.body?.bill_no).toBe('')
  })
})

describe('runManifest — lỗi', () => {
  it('lỗi API manifest ⇒ ok false + message đúng, KHÔNG gửi POST nào', async () => {
    const h = harness({ status: 0, data: null })
    const result = await run(h)

    expect(result.ok).toBe(false)
    expect(result.message).toContain(
      'No manifest was found for this bill of lading number.',
    )
    expect(result.message).toContain('Nothing was created on the site.')
    expect(postsOf(h)).toHaveLength(0)
  })

  it('lỗi session của site (code 4000) ⇒ message đúng', async () => {
    // Session hết hạn lộ ra ở bước TẠO bill — hai lần tra dict (cảng, bao bị)
    // cố tình nuốt lỗi để không làm hỏng cả lần chạy.
    const h = harness({ status: 1, data: manifest }, { failPost: `${SITE_BASE}/` })
    const result = await run(h)

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
    const result = await run(h, { deadlineMs: 0 })

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
    const result = await run(h, { deadlineMs: 300, timeoutMs: 5000 })

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
    const result = await run(h, { blNo: '   ' })

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
    const result = await run(h)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Something went wrong while running the manifest.')
    expect(result.message).toContain('Nothing was created on the site.')
    expect(postsOf(h)).toHaveLength(0)
  })

  it('site từ chối tạo bill ⇒ không POST dòng hàng, cảnh báo bill có thể đã tồn tại', async () => {
    const h = harness({ status: 1, data: manifest }, { failCreate: true })
    const result = await run(h)

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

/**
 * Số bill ghi lên site.
 *
 * Số bill trên site CÓ THỂ mang hậu tố piece (`P1`, `P12`); API chỉ trả mã
 * gốc ⇒ tra cứu thì bỏ hậu tố, ghi lên site thì PHẢI GIỮ.
 */
describe('runManifest — số bill ghi lên site', () => {
  it('API tra MÃ GỐC (bỏ hậu tố piece)', async () => {
    const h = harness()
    await run(h, { blNo: 'ONEYSHAGT1569600P1' })

    expect(h.api.calls[0]?.url).toContain('blNo=ONEYSHAGT1569600')
    expect(h.api.calls[0]?.url).not.toContain('P1')
  })

  it('site nhận số bill CÓ hậu tố piece', async () => {
    const h = harness()
    await run(h, { blNo: 'ONEYSHAGT1569600P1' })

    const createPost = postsOf(h)[0]
    expect(createPost?.body?.bill_nbr).toBe('ONEYSHAGT1569600P1')
  })

  it('số bill ghi lên site KHÁC số bill của API ⇒ báo cho operator', async () => {
    const h = harness()
    const result = await run(h, { blNo: 'ONEYSHAGT1569600P1' })

    expect(result.steps.join('\n')).toContain(
      'The manifest will use the bill number ONEYSHAGT1569600P1 — the API returned ONEYSHAGT1569600.',
    )
  })

  it('số bill TRÙNG số bill của API ⇒ KHÔNG báo', async () => {
    const h = harness()
    const result = await run(h)

    expect(result.steps.join('\n')).not.toContain('The manifest will use the bill number')
  })

  it('số bill của API KHÁC chữ HOA ⇒ KHÔNG báo nhầm (site upper-case mọi field)', async () => {
    const h = harness({ status: 1, data: { ...manifest, blNo: 'oneySHAGT1569600' } })
    const result = await run(h)

    const createPost = postsOf(h)[0]
    expect(createPost?.body?.bill_nbr).toBe('ONEYSHAGT1569600')
    expect(result.steps.join('\n')).not.toContain('The manifest will use the bill number')
  })

  it('số bill ghi lên site giữ nguyên qua cả bước TẠO bill', async () => {
    const h = harness()
    await run(h, { blNo: 'ONEYSHAGT1569600P1' })

    const createPost = postsOf(h)[0]
    expect(createPost?.body?.bill_nbr).toBe('ONEYSHAGT1569600P1')
  })
})

/**
 * Bên KHÔNG có kênh liên hệ nào.
 *
 * Site kiểm tra ở form: mỗi bên phải có ÍT NHẤT một kênh liên hệ
 * (电话 / EMAIL / 传真). Extension chỉ điền được 电话 ⇒ bên không có phone
 * thì cả ba kênh đều trống ⇒ phải báo là BẮT BUỘC, KHÔNG được báo là
 * "không bắt buộc, để trống là đúng".
 */
describe('runManifest — bên không có kênh liên hệ', () => {
  it('bên không có phone ⇒ ô điện thoại BẮT BUỘC, kèm lý do đúng', async () => {
    const h = harness(partyWithoutPhoneEnvelope())
    const result = await run(h)

    const item = result.items.find((entry) => entry.prop === 'CONSIGNEE_TE_STR')
    expect(item).toBeDefined()
    expect(item?.status).toBe('warn')
    expect(item?.required).toBe(true)
    expect(item?.scope).toBe('header')
    expect(item?.note).toContain('at least one of phone, email or fax')
    expect(item?.note).toContain('The API only provides the phone')
    expect(item?.note).toContain('by hand on the site')
  })

  it('bên CÓ phone ⇒ KHÔNG có dòng báo cho ô điện thoại đó', async () => {
    const h = harness()
    const result = await run(h)

    expect(result.items.map((entry) => entry.prop)).not.toContain('CONSIGNEE_TE_STR')
  })

  it('các ô EMAIL / FAX giữ NGUYÊN note cũ (không phải bắt buộc)', async () => {
    const h = harness(partyWithoutPhoneEnvelope())
    const result = await run(h)

    const email = result.items.find((entry) => entry.prop === 'CONSIGNEE_EM_STR')
    expect(email?.required).toBe(false)
    expect(email?.status).toBe('skip')
    expect(email?.note).toBe(BLANK_NOTES.CONSIGNEE_EM_STR)
  })

  it('bên không có phone ⇒ vẫn GHI được (bắt buộc chỉ là cảnh báo)', async () => {
    const h = harness(partyWithoutPhoneEnvelope())
    const result = await run(h)

    expect(result.ok).toBe(true)
    expect(result.written).toBe(true)
    expect(result.billCreated).toBe(true)
    expect(result.blocked).toBe(true)
  })
})

/**
 * Số API trả về mà extension KHÔNG parse được.
 *
 * `num()` trước đây nuốt lỗi parse thành `0` ⇒ report nói "API không có
 * giá trị này" — một lý do SAI. Nay phải nói đúng: API CÓ giá trị nhưng
 * extension không đọc được.
 */
describe('runManifest — số không parse được', () => {
  it('báo "could not be parsed", KHÔNG phải "does not provide"', async () => {
    const h = harness(unparsableWeightEnvelope())
    const result = await run(h)

    const item = result.items.find(
      (entry) => entry.scope === 'cargo' && entry.prop === 'GWEIGHT_TON',
    )
    expect(item).toBeDefined()
    expect(item?.required).toBe(true)
    expect(item?.status).toBe('warn')
    expect(item?.note).toContain('could not be parsed')
    expect(item?.note).not.toContain('does not provide')
  })

  it('body gửi đi KHÔNG có null, số không parse được đi ra là 0', async () => {
    const h = harness(unparsableWeightEnvelope())
    await run(h)

    const cargoPost = h.site.calls.find((call) => call.url.includes('cargo/add/'))
    expect(cargoPost?.body?.gweight_ton).toBe(0)
    expect(hasNullValue(cargoPost?.body)).toBe(false)
  })
})
