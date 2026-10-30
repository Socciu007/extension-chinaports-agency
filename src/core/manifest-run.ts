/**
 * Tầng điều phối của luồng manifest — gọi API manifest, dựng body của site,
 * báo cáo field bị bỏ trống, và (tuỳ chọn) ghi lên site.
 *
 * Luồng:
 *
 *   1) `fetchManifest`      — lấy dữ liệu manifest từ API bên ngoài
 *   2) `loadSiteDicts`      — lấy dict của site (承运人, 交货条款, 箱型, 尺寸…)
 *   3) `build*Payload`      — dựng header + dòng hàng + dòng container
 *   4) dựng report          — liệt kê field BỊ BỎ TRỐNG (kèm lý do)
 *   5) nếu `allowWrite`     — tạo bill → gắn dòng hàng → lưu bill + container
 *
 * `runManifest` KHÔNG BAO GIỜ reject: mọi lỗi được đổi thành
 * `ManifestRunResult` với `ok: false` + `message` tiếng Anh.
 *
 * Ranh giới an toàn (KHÔNG được nới):
 *
 * - KHÔNG gọi `send/`, `upload/`, `deleteBill/`, `downloadTemplate/` của site;
 * - manifest chỉ được lưu dạng NHÁP (`is_all` = "1"), KHÔNG "2" (发送);
 * - mã bill do server gán lấy NGUYÊN VEN (không trim, không uppercase);
 * - tên cảng lấy từ `PortData.name` (tiếng Trung), KHÔNG dùng `nameEn`.
 */
import { describeApiError, fetchManifest, ManifestApiError } from './api'
import { HTTP_TIMEOUT_MS } from './http'
import {
  BLANK_NOTES,
  DANGER_FIELDS,
  deriveCargoKind,
  isBlankPayloadValue,
  labelOf,
  optionalBlankNote,
  REQUIRED_BY_KIND,
  REQUIRED_CONTAINER,
  REQUIRED_HEADER,
  requiredBlankNote,
  TEMP_FIELDS,
  type CargoKind,
} from './field-meta'
import {
  buildCargoPayload,
  buildContainerPayload,
  buildHeaderPayload,
  type HeaderPayload,
} from './payload'
import type { FillScope, ReportItem } from './protocol'
import {
  createMappingContext,
  describeSiteError,
  loadSiteDicts,
  SiteApiError,
  type SiteFetchOptions,
} from './site-api'
import {
  addCargoRow,
  createManifestBill,
  extractBillNo,
  saveManifestContainers,
} from './site-write'
import type { ManifestCargo, ManifestContainer } from './types'

/** Hạn mặc định của cả một lần chạy (4 phút). */
export const DEFAULT_DEADLINE_MS = 240_000

export interface ManifestRunOptions {
  /** Số bill — `fetchManifest` tự chuẩn hoá (trim, uppercase, bỏ hậu tố `P<n>`). */
  blNo: string
  /** `true` ⇒ ghi lên site. Thiếu / `false` ⇒ CHỈ preview, KHÔNG gửi POST nào. */
  allowWrite?: boolean
  /** Base URL của API manifest bên ngoài. */
  apiBase?: string
  /** Base URL của API site. */
  siteApiBase?: string
  /** `fetch` cho API manifest (test inject). */
  fetchImpl?: typeof fetch
  /** `fetch` cho API site (test inject). */
  siteFetchImpl?: typeof fetch
  /** Cookie của site (chứa `token` cho header `Authorization`). */
  cookieString?: string
  /**
   * Timeout cho MỖI request (ms).
   *
   * Mặc định = `min(HTTP_TIMEOUT_MS, phần hạn còn lại của lần chạy)`.
   */
  timeoutMs?: number
  /** Hạn của cả lần chạy (ms). Mặc định `DEFAULT_DEADLINE_MS`. */
  deadlineMs?: number
}

export interface ManifestRunPreview {
  header: HeaderPayload
  cargo: Record<string, unknown>[]
  containers: Record<string, unknown>[]
}

export interface ManifestRunResult {
  /** Run không gặp lỗi (không lỗi mạng / API ngoài / site). */
  ok: boolean
  /** Còn field BẮT BUỘC bị trống ⇒ bản nháp, operator phải điền tay trên site. */
  blocked: boolean
  /** Thông báo cho operator — luôn có khi `!ok` hoặc khi `blocked`. */
  message?: string
  /** Từng bước đã chạy (tiếng Anh), để operator theo dõi. */
  steps: string[]
  /** Các field bị bỏ trống. */
  items: ReportItem[]
  preview: ManifestRunPreview
  cargoRows: number
  containerRows: number
  /** Mã bill do server gán — chỉ có sau khi tạo bill thành công. */
  billNo?: string
  /**
   * Site đã XÁC NHẬN tạo bill.
   *
   * Mã bill (`billNo`) có thể vẫn còn thiếu — site đã tạo bill nhưng không
   * trả về mã ⇒ xem `billNo` và `steps` để biết chuyện đó có xảy ra không.
   */
  billCreated: boolean
  /** Manifest đã lưu trên site (bước lưu cuối đã thành công). */
  written: boolean
}

/** Lỗi của tầng điều phối — hiện chỉ có một loại: hết hạn. */
export class ManifestRunError extends Error {
  readonly kind: 'deadline'

  constructor(kind: 'deadline', message: string) {
    super(message)
    this.name = 'ManifestRunError'
    this.kind = kind
  }
}

/**
 * Lỗi nội bộ: site ĐÃ tạo bill nhưng không trả về mã bill.
 *
 * Không phải lỗi mạng/API ⇒ cần thông báo riêng: dòng hàng KHÔNG được gửi
 * (một dòng hàng gắn sai bill sẽ không báo lỗi nào), và bill có thể đã tồn
 * tại trên site ⇒ extension không tự xoá.
 */
class NoBillNumberError extends Error {
  constructor() {
    super('The site did not return a bill number.')
    this.name = 'NoBillNumberError'
  }
}

/*
 * LƯU Ý quy ước key — hai hệ khác nhau cùng nằm trong file này:
 *
 * - `IGNORED_PROPS` dùng TÊN FIELD VIẾT HOA (giống `prop` trong report);
 * - `byDesignBlanks` dùng key CHỮ THƯỜNG của payload.
 */

/**
 * Field mà site TỰ tính / server gán / điều khiển luồng.
 *
 * Để trống ở đây KHÔNG phải lỗi ⇒ KHÔNG báo trong report.
 */
const IGNORED_PROPS: ReadonlySet<string> = new Set([
  'BILL_NO',
  'TOTAL_PIECE_NUM',
  'TOTAL_GWEIGHT_TON',
  'TOTAL_GVOL_NUM',
  'MANDATORY_CHECK',
  'SOFT_CHECK',
  'IS_ALL',
])

/**
 * Câu nhắc operator — extension KHÔNG BAO GIỜ tự xoá bill trên site.
 *
 * Dùng chung ở nhiều message để câu chữ không lệch nhau.
 */
const NEVER_DELETES_BILLS =
  'The extension never deletes bills on its own — please finish this manifest by hand on the site.'

/** Field bị site XOÁ theo loại hàng — để trống là ĐÚNG, không phải lỗi. */
const ALL_BLANKED: ReadonlySet<string> = new Set([...DANGER_FIELDS, ...TEMP_FIELDS])
const DANGER_BLANKED: ReadonlySet<string> = new Set(DANGER_FIELDS)
const TEMP_BLANKED: ReadonlySet<string> = new Set(TEMP_FIELDS)
const NOTHING_BLANKED: ReadonlySet<string> = new Set<string>()

/**
 * Field bị site XOÁ theo loại hàng — để trống là ĐÚNG, không phải lỗi.
 *
 * - `S` (thường)      — site xoá CẢ field nguy hiểm lẫn field nhiệt độ;
 * - `D` (nguy hiểm)   — site xoá field nhiệt độ;
 * - `R` (kiểm dịch)   — site xoá field nguy hiểm;
 * - `G` (cả hai)      — site KHÔNG xoá gì.
 *
 * Key ở đây là key CHỮ THƯỜNG của payload (khác với `prop` viết HOA trong
 * report). Set được tạo MỘT LẦN ở cấp module ⇒ không cấp phát lại cho mỗi
 * dòng.
 */
function byDesignBlanks(kind: CargoKind): ReadonlySet<string> {
  if (kind === 'S') return ALL_BLANKED
  if (kind === 'D') return TEMP_BLANKED
  if (kind === 'R') return DANGER_BLANKED
  return NOTHING_BLANKED
}

/**
 * Dựng một item của report cho field bị bỏ trống.
 *
 * `note` LUÔN có: note riêng (`BLANK_NOTES`) nếu có, nếu không thì note
 * chung theo việc field có bắt buộc hay không.
 */
function blankItem(
  scope: FillScope,
  prop: string,
  required: boolean,
  row: number | undefined,
): ReportItem {
  const label = labelOf(scope, prop)
  const note =
    BLANK_NOTES[prop] ??
    (required ? requiredBlankNote(prop, label) : optionalBlankNote(prop, label))
  return {
    scope,
    prop,
    label,
    status: required ? 'warn' : 'skip',
    note,
    row,
    required,
  }
}

/** Một dòng cần dựng report (header là 1 dòng, không có số thứ tự). */
interface ReportRowSpec {
  scope: FillScope
  values: Record<string, unknown>
  /** số thứ tự của dòng — `undefined` cho header */
  row?: number
  /** field này có BẮT BUỘC không */
  required: (prop: string) => boolean
  /**
   * Key mà site XOÁ theo loại hàng — để trống là ĐÚNG ⇒ không báo.
   *
   * Key ở đây là key CHỮ THƯỜNG của payload (khác với `prop` viết HOA).
   */
  skipped?: ReadonlySet<string>
}

/** Report của MỘT dòng — theo thứ tự key trong dòng. */
function reportRow(spec: ReportRowSpec): ReportItem[] {
  const items: ReportItem[] = []
  for (const [key, value] of Object.entries(spec.values)) {
    const prop = key.toUpperCase()
    if (IGNORED_PROPS.has(prop)) continue
    // Field site xoá theo loại hàng ⇒ để trống là ĐÚNG ⇒ không báo.
    if (spec.skipped?.has(key)) continue
    if (!isBlankPayloadValue(value)) continue
    items.push(blankItem(spec.scope, prop, spec.required(prop), spec.row))
  }
  return items
}

/** Report của header — theo thứ tự key trong payload. */
function reportHeader(header: HeaderPayload): ReportItem[] {
  return reportRow({
    scope: 'header',
    values: header,
    required: (prop) => REQUIRED_HEADER.includes(prop),
  })
}

/** Report của các dòng hàng — theo thứ tự dòng, rồi thứ tự key trong dòng. */
function reportCargo(
  rows: Record<string, unknown>[],
  kinds: CargoKind[],
): ReportItem[] {
  return rows.flatMap((row, index) => {
    const kind = kinds[index] ?? 'S'
    return reportRow({
      scope: 'cargo',
      values: row,
      row: index + 1,
      required: (prop) => REQUIRED_BY_KIND[kind].includes(prop),
      skipped: byDesignBlanks(kind),
    })
  })
}

/** Report của các dòng container — theo thứ tự dòng, rồi thứ tự key trong dòng. */
function reportContainers(rows: Record<string, unknown>[]): ReportItem[] {
  return rows.flatMap((row, index) =>
    reportRow({
      scope: 'container',
      values: row,
      row: index + 1,
      required: (prop) => REQUIRED_CONTAINER.includes(prop),
    }),
  )
}

/**
 * Câu mô tả trạng thái trên site — luôn nói rõ extension đã làm gì.
 *
 * Ba cờ có ý nghĩa khác nhau: `createAttempted` (đã CỐ gửi yêu cầu tạo bill —
 * không đảm bảo site đã nhận), `billCreated` (bill ĐÃ được tạo) và `written`
 * (đã lưu xong).
 */
function partialStateSentence(
  createAttempted: boolean,
  billCreated: boolean,
  rowsAdded: number,
  cargoRows: number,
): string {
  if (!createAttempted) return 'Nothing was created on the site.'
  if (!billCreated) {
    return 'The manifest bill may already exist on the site — the site did not confirm the creation. Check the site before trying again.'
  }
  if (rowsAdded < cargoRows) {
    return `The manifest bill was created on the site and ${rowsAdded} of ${cargoRows} cargo rows were added. ${NEVER_DELETES_BILLS}`
  }
  return `The manifest bill was created on the site. ${NEVER_DELETES_BILLS}`
}

/** Message khi run thành công nhưng còn field BẮT BUỘC bị trống. */
function blockedMessage(requiredCount: number): string {
  return `${requiredCount} field(s) required by the site are not provided by the API — they are listed in the report and must be filled in by hand on the site.`
}

/** Text lỗi cho người dùng — theo loại lỗi. */
function describeError(error: unknown): string {
  if (error instanceof ManifestApiError) return describeApiError(error)
  if (error instanceof SiteApiError) return describeSiteError(error)
  if (error instanceof ManifestRunError) return error.message
  return 'Something went wrong while running the manifest.'
}

/**
 * Chạy toàn bộ luồng manifest.
 *
 * KHÔNG reject — lỗi nào cũng được đổi thành `ManifestRunResult` với
 * `ok: false` và `message` tiếng Anh.
 */
export async function runManifest(options: ManifestRunOptions): Promise<ManifestRunResult> {
  const steps: string[] = []
  const items: ReportItem[] = []
  /** Hạn của lần chạy — tính một lần, lúc bắt đầu run. */
  const deadlineAt = Date.now() + (options?.deadlineMs ?? DEFAULT_DEADLINE_MS)

  let preview: ManifestRunPreview = { header: {}, cargo: [], containers: [] }
  let cargoRows = 0
  let containerRows = 0
  let billNo: string | undefined
  let billCreated = false
  let written = false
  let createAttempted = false
  let rowsAdded = 0

  /** Phần hạn còn lại của lần chạy (ms) — luôn ít nhất 1 ms. */
  const remaining = (): number => Math.max(1, deadlineAt - Date.now())
  /**
   * Timeout cho MỖI request.
   *
   * - `options.timeoutMs` do caller truyền ⇒ dùng NGUYÊN VẸN (một số tình
   *   huống cần một request được phép vượt hạn của lần chạy);
   * - mặc định ⇒ `min(HTTP_TIMEOUT_MS, phần hạn còn lại)` ⇒ một request treo
   *   KHÔNG giữ cả lần chạy (mặc định 4 phút) bị treo.
   */
  const requestTimeout = (): number =>
    options.timeoutMs ?? Math.min(HTTP_TIMEOUT_MS, remaining())
  /** Options cho mọi request tới API của site. */
  const siteOptions = (): SiteFetchOptions => ({
    baseUrl: options.siteApiBase,
    fetchImpl: options.siteFetchImpl,
    cookieString: options.cookieString,
    timeoutMs: requestTimeout(),
  })
  /** Chặn nếu đã hết hạn — trước MỖI bước gọi mạng. */
  const checkDeadline = (step: string): void => {
    if (Date.now() >= deadlineAt) {
      throw new ManifestRunError('deadline', `The run reached its time limit before "${step}".`)
    }
  }
  /**
   * Dựng `ManifestRunResult` từ trạng thái hiện tại của lần chạy.
   *
   * Số field BẮT BUỘC bị trống được tính ĐÚNG MỘT LẦN ở đây ⇒ `blocked` và
   * `message` không thể lệch nhau.
   */
  const buildResult = (overrides: Partial<ManifestRunResult> = {}): ManifestRunResult => {
    const requiredCount = items.filter((item) => item.required === true).length
    const result: ManifestRunResult = {
      ok: false,
      blocked: requiredCount > 0,
      steps,
      items,
      preview,
      cargoRows,
      containerRows,
      billCreated,
      written,
    }
    if (billNo !== undefined) result.billNo = billNo
    Object.assign(result, overrides)
    // Message mặc định khi còn field BẮT BUỘC bị trống. Message do caller
    // truyền qua `overrides.message` được giữ nguyên.
    if (result.message === undefined && requiredCount > 0) {
      result.message = blockedMessage(requiredCount)
    }
    return result
  }

  try {
    if ((options.blNo ?? '').trim() === '') {
      return buildResult({
        ok: false,
        message: 'Enter a bill of lading number before running the manifest.',
      })
    }

    checkDeadline('fetching the manifest data')
    const data = await fetchManifest(options.blNo, {
      baseUrl: options.apiBase,
      fetchImpl: options.fetchImpl,
      timeoutMs: requestTimeout(),
    })
    steps.push('Fetched the manifest data')

    checkDeadline('loading the site dictionaries')
    const dicts = await loadSiteDicts(siteOptions())
    const ctx = createMappingContext(dicts)
    steps.push('Loaded the site dictionaries')

    const goods: ManifestCargo[] = data.cdgoods ?? []
    const containers: ManifestContainer[] = data.cdCon ?? []

    const header = buildHeaderPayload(data, ctx)
    const cargoPayloads = goods.map((item) => buildCargoPayload(item, ''))
    const containerPayloads = containers.map((item) => buildContainerPayload(item, ctx, ''))
    const kinds = goods.map((item) => deriveCargoKind(item))

    cargoRows = cargoPayloads.length
    containerRows = containerPayloads.length
    preview = { header, cargo: cargoPayloads, containers: containerPayloads }

    items.push(...reportHeader(header))
    items.push(...reportCargo(cargoPayloads, kinds))
    items.push(...reportContainers(containerPayloads))

    // KHÔNG ghi (preview) ⇒ dừng luôn ở đây, KHÔNG gửi POST nào.
    if (options.allowWrite !== true) {
      steps.push('Preview only — nothing was written to the site')
      return buildResult({ ok: true })
    }

    // 1) Tạo bill — server gán mã bill nội bộ.
    checkDeadline('creating the manifest bill')
    createAttempted = true
    const created = await createManifestBill(header, siteOptions())
    steps.push('Created the manifest bill on the site')
    // Site ĐÃ xác nhận tạo bill ⇒ bill tồn tại trên site, kể cả khi bước
    // đọc mã bill bên dưới thất bại (trường hợp đặc biệt).
    billCreated = true

    // 2) Đọc mã bill — KHÔNG có mã thì KHÔNG gửi dòng hàng nào (một dòng
    //    hàng gắn sai bill sẽ không báo lỗi nào).
    let assignedBillNo: string
    try {
      assignedBillNo = extractBillNo(created)
    } catch {
      steps.push('The site did not return a bill number, so no cargo rows were attached')
      throw new NoBillNumberError()
    }
    billNo = assignedBillNo
    steps.push('Read the bill number from the site')

    // 3) Gắn từng dòng hàng vào bill.
    for (const row of cargoPayloads) {
      // Kiểm tra hạn trước TỪNG dòng — nhiều dòng có thể vượt hạn.
      checkDeadline('adding the cargo rows')
      await addCargoRow(row, assignedBillNo, siteOptions())
      rowsAdded += 1
    }
    steps.push(`Added ${rowsAdded} cargo row(s) to the bill`)

    // 4) Lưu bill kèm container (`is_all` = "1" = 暂存).
    //    `saveManifestContainers` tự copy header, tự gán `bill_no`, tự đặt
    //    `is_all`, tự thêm `cntr_list` và tự bỏ 3 key tổng do site tính.
    checkDeadline('saving the manifest')
    const containersWithBill = containerPayloads.map((row) => ({
      ...row,
      bill_no: assignedBillNo,
    }))
    await saveManifestContainers(header, containersWithBill, assignedBillNo, siteOptions())
    steps.push('Saved the manifest with its containers')
    written = true

    return buildResult({ ok: true })
  } catch (e) {
    const result = buildResult()
    if (e instanceof NoBillNumberError) {
      result.message =
        'The manifest bill was created on the site, but the site did not return its bill number, so no cargo rows were attached. ' +
        NEVER_DELETES_BILLS
    } else {
      const state = partialStateSentence(createAttempted, billCreated, rowsAdded, cargoRows)
      result.message = `${describeError(e)} ${state}`
    }
    return result
  }
}
