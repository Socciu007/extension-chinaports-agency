/**
 * Tầng điều phối của luồng manifest — gọi API manifest, dựng body của site,
 * báo cáo field bị bỏ trống, và ghi lên site.
 *
 * Luồng:
 *
 *   1) `loadSiteDicts`      — lấy dict của site (承运人, 箱型, 尺寸, cảng…)
 *   2) `createMappingContext`— gói dict thành `ctx` cho việc tra cứu
 *   3) `fetchManifest`      — lấy dữ liệu manifest từ API bên ngoài VÀ dựng
 *                             luôn body của site (45 key)
 *   4) dựng report          — liệt kê field BỊ BỎ TRỐNG (kèm lý do)
 *   5) ghi lên site         — tạo bill → gắn dòng hàng → lưu bill + container
 *
 * Dict của site phải load TRƯỚC khi fetch: body cần tên cảng và mã 承运人
 * từ dict ngay lúc dựng.
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
  isBlankPayloadValue,
  isUnparsablePayloadValue,
  labelOf,
  optionalBlankNote,
  partyContactRequiredNote,
  partiesWithoutContactChannel,
  REQUIRED_BY_KIND,
  REQUIRED_CONTAINER,
  REQUIRED_HEADER,
  requiredBlankNote,
  TEMP_FIELDS,
  unparsableNumberNote,
  type CargoKind,
} from './field-meta'
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
import type { ManifestCargoRow, ManifestContainerRow, ManifestData } from './types'

/** Hạn mặc định của cả một lần chạy (4 phút). */
export const DEFAULT_DEADLINE_MS = 240_000

export interface ManifestRunOptions {
  blNo: string
  apiBase?: string
  siteApiBase?: string
  fetchImpl?: typeof fetch
  siteFetchImpl?: typeof fetch
  cookieString?: string
  timeoutMs?: number
  deadlineMs?: number
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
 * `note` LUÔN có: note riêng do caller truyền (nếu có), sau đó là note của
 * lý do RIÊNG (`BLANK_NOTES`), sau đó là note chung theo việc field có bắt
 * buộc hay không.
 *
 * Số KHÔNG parse được (`NaN`) có note riêng: lý do KHÁC hẳn "API không có
 * giá trị này" ⇒ note riêng thắng `BLANK_NOTES`.
 */
function blankItem(
  scope: FillScope,
  prop: string,
  required: boolean,
  row: number | undefined,
  value: unknown,
  note?: string,
): ReportItem {
  const label = labelOf(scope, prop)
  const text =
    note ??
    (isUnparsablePayloadValue(value)
      ? unparsableNumberNote(prop, label)
      : BLANK_NOTES[prop] ??
        (required ? requiredBlankNote(prop, label) : optionalBlankNote(prop, label)))
  return {
    scope,
    prop,
    label,
    status: required ? 'warn' : 'skip',
    note: text,
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
   * Note RIÊNG cho một field — thắng `BLANK_NOTES` và note chung.
   *
   * Trả `undefined` ⇒ dùng note chung.
   */
  note?: (prop: string) => string | undefined
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
    items.push(
      blankItem(spec.scope, prop, spec.required(prop), spec.row, value, spec.note?.(prop)),
    )
  }
  return items
}

/**
 * Key của body KHÔNG phải field header — dòng hàng và dòng container.
 *
 * Report header chỉ liệt kê field HEADER ⇒ hai key này bị bỏ qua.
 */
const BODY_ROW_KEYS: ReadonlySet<string> = new Set(['cdgoods', 'cntr_list'])

/**
 * Report của header — theo thứ tự key trong body.
 *
 * Ngoài field BẮT BUỘC cố định, còn một quy tắc theo NHÓM: mỗi bên phải có
 * ÍT NHẤT một kênh liên hệ (电话 / EMAIL / 传真) — xem
 * `partiesWithoutContactChannel`.
 */
function reportHeader(body: ManifestData): ReportItem[] {
  // Tính MỘT LẦN: điều kiện là của BÊN, không phải của từng prop.
  const withoutContact = partiesWithoutContactChannel(body)
  // Bỏ 2 key dòng hàng / dòng container — chúng không phải field header.
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (BODY_ROW_KEYS.has(key)) continue
    values[key] = value
  }
  return reportRow({
    scope: 'header',
    values,
    required: (prop) => REQUIRED_HEADER.includes(prop) || withoutContact.has(prop),
    note: (prop) =>
      withoutContact.has(prop)
        ? partyContactRequiredNote(prop, labelOf('header', prop))
        : undefined,
  })
}

/**
 * Loại hàng của một dòng — đọc từ `cargo_kind_cod` của CHÍNH dòng đó.
 *
 * Dòng hàng trong body đã mang mã loại của site (`S`/`D`/`R`/`G`) ⇒ không
 * cần mảng loại hàng riêng.
 */
function cargoKindOf(row: Record<string, unknown>): CargoKind {
  const code = row.cargo_kind_cod
  if (code === 'D' || code === 'R' || code === 'G') return code
  return 'S'
}

/** Report của các dòng hàng — theo thứ tự dòng, rồi thứ tự key trong dòng. */
function reportCargo(rows: ManifestCargoRow[]): ReportItem[] {
  return rows.flatMap((row, index) => {
    const kind = cargoKindOf(row)
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
function reportContainers(rows: ManifestContainerRow[]): ReportItem[] {
  return rows.flatMap((row, index) =>
    reportRow({
      scope: 'container',
      values: row,
      row: index + 1,
      required: (prop) => REQUIRED_CONTAINER.includes(prop),
    }),
  )
}

// A sentence describing the state on the site — always mentioning what the extension has done.
function partialStateSentence(
  createAttempted: boolean,
  billCreated: boolean,
  rowsAdded: number,
  cargoRows: number,
): string {
  if (!createAttempted) return 'Nothing was created on the site.'
  if (!billCreated) {
    return 'The manifest bill may already exist on the site.'
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

/**
 * Câu nhắc khi số bill GHI LÊN SITE khác số bill của API.
 *
 * Số bill trên site CÓ THỂ mang hậu tố piece (`P1`, `P12`) còn API chỉ trả
 * mã gốc ⇒ site nhận số khác số API trả về. Không nói ra thì operator mở
 * site, thấy số khác số mình gõ, và tưởng extension ghi sai.
 */
function billNoMismatchStep(written: string, apiBillNo: string): string {
  if (apiBillNo === '') {
    return `The manifest will use the bill number ${written} — the API did not return a bill number.`
  }
  return `The manifest will use the bill number ${written} — the API returned ${apiBillNo}.`
}

/** Text lỗi cho người dùng — theo loại lỗi. */
function describeError(error: unknown): string {
  if (error instanceof ManifestApiError) return describeApiError(error)
  if (error instanceof SiteApiError) return describeSiteError(error)
  if (error instanceof ManifestRunError) return error.message
  return 'Something went wrong while running the manifest.'
}

// Run the entire manifest flow.
export async function runManifest(options: ManifestRunOptions): Promise<ManifestRunResult> {
  const steps: string[] = []
  const items: ReportItem[] = []
  const deadlineAt = Date.now() + (options?.deadlineMs ?? DEFAULT_DEADLINE_MS)

  let cargoRows = 0
  let containerRows = 0
  let billNo: string | undefined
  let billCreated = false
  let written = false
  let createAttempted = false
  let rowsAdded = 0

  // Remaining time of the run (ms) — at least 1 ms.
  const remaining = (): number => Math.max(1, deadlineAt - Date.now())
  // Timeout for each request.
  const requestTimeout = (): number =>
    options.timeoutMs ?? Math.min(HTTP_TIMEOUT_MS, remaining())
  // Options for all requests to the site API.
  const siteOptions = (): SiteFetchOptions => ({
    baseUrl: options.siteApiBase,
    fetchImpl: options.siteFetchImpl,
    cookieString: options.cookieString,
    timeoutMs: requestTimeout(),
  })
  // Check if the run has reached its deadline — before each network call.
  const checkDeadline = (step: string): void => {
    if (Date.now() >= deadlineAt) {
      throw new ManifestRunError('deadline', `The run reached its time limit before "${step}".`)
    }
  }
  // Build the result from the current state of the run.
  const buildResult = (overrides: Partial<ManifestRunResult> = {}): ManifestRunResult => {
    const requiredCount = items.filter((item) => item.required === true).length
    const result: ManifestRunResult = {
      ok: false,
      blocked: requiredCount > 0,
      steps,
      items,
      cargoRows,
      containerRows,
      billCreated,
      written,
    }
    if (billNo !== undefined) result.billNo = billNo
    Object.assign(result, overrides)
    // Default message when there are required fields missing. The message
    // passed through `overrides.message` is kept.
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

    // The site dictionaries are loaded FIRST — the body needs the Chinese port
    // names and the carrier code from the dictionaries at the moment it is built.
    checkDeadline('loading the site dictionaries')
    const dicts = await loadSiteDicts(siteOptions())
    const ctx = createMappingContext(dicts)
    steps.push('Loaded the site dictionaries')

    checkDeadline('fetching the manifest data')
    const { body, apiBillNo } = await fetchManifest(options.blNo, {
      baseUrl: options.apiBase,
      fetchImpl: options.fetchImpl,
      timeoutMs: requestTimeout(),
      ctx,
      operatorBlNo: options.blNo,
    })
    steps.push('Fetched the manifest data from external API (eb)')

    // The bill number as written by the operator.
    const writtenBillNo = body.bill_nbr
    if (writtenBillNo !== '' && writtenBillNo !== apiBillNo) {
      steps.push(billNoMismatchStep(writtenBillNo, apiBillNo))
    }

    cargoRows = body.cdgoods.length
    containerRows = body.cntr_list.length
    items.push(...reportHeader(body))
    items.push(...reportCargo(body.cdgoods))
    items.push(...reportContainers(body.cntr_list))

    // Create the manifest bill — the server assigns the internal bill number.
    checkDeadline('creating the manifest bill')
    createAttempted = true
    const created = await createManifestBill(body, siteOptions())
    steps.push('Created the manifest bill on the site')
    // The site has confirmed the creation of the bill ⇒ the bill exists on the site, even if the step of reading the bill number below fails (special case).
    billCreated = true

    // Read the bill number — if there is no bill number, no cargo rows are sent (a cargo row attached to the wrong bill will not report any error).
    let assignedBillNo: string
    try {
      assignedBillNo = extractBillNo(created)
    } catch {
      steps.push('The site did not return a bill number, so no cargo rows were attached')
      throw new NoBillNumberError()
    }
    billNo = assignedBillNo
    steps.push('Read the bill number from the site')

    // Attach each cargo row to the bill.
    for (const row of body.cdgoods) {
      // Check the deadline before each row — many rows can exceed the deadline.
      checkDeadline('adding the cargo rows')
      await addCargoRow(row, assignedBillNo, siteOptions())
      rowsAdded += 1
    }
    steps.push(`Added ${rowsAdded} cargo row(s) to the bill`)

    // Save the manifest bill with its containers (`is_all` = "1" = 暂存).
    checkDeadline('saving the manifest')
    await saveManifestContainers(body, assignedBillNo, siteOptions())
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
