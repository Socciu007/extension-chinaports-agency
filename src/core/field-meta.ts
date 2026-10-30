/**
 * Metadata về các field của site — nguồn sự thật DUY NHẤT của đường API.
 *
 * Module này trả lời bốn câu hỏi mà cả `payload.ts` (dựng body) và
 * `manifest-run.ts` (dựng report) đều cần, và phải trả lời GIỐNG NHAU:
 * - site BẮT BUỘC field nào, và field nào chỉ bắt buộc với loại hàng nào;
 * - loại hàng nào thì site xoá & disable field nào;
 * - mỗi field tên gì (nhãn hiển thị lấy theo tên tiếng Trung của site);
 * - vì sao một ô bị bỏ trống (note để operator biết phải làm gì).
 *
 * Không được import từ `protocol.ts` (`protocol.ts` → `manifest-run.ts` →
 * `field-meta.ts`) ⇒ import kiểu ngược lại sẽ tạo vòng.
 */
import type { ManifestCargo, ManifestContact } from './types'

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

export interface MappingContext {
  findTrustCode(supplyId?: number): string | undefined
  findDrType(code?: string): string | undefined
  /** Tên cảng tiếng Trung — dict `getPort()` của site lưu tên Trung ở `E_PORT_NAM`. */
  findPort(code?: string): string | undefined
  findCntrType(raw?: number | string | null): string | undefined
  findCntrSize(raw?: number | string | null): string | undefined
}

/**
 * 付款方式 của site — site lưu MÃ, KHÔNG lưu nhãn hiển thị.
 *
 * Đường API chỉ có hai mã: 预付='P' và 到付='C' (không có 'F'/免费).
 * `payWayOf` bên dưới ánh xạ `payType` của API sang đúng mã ấy.
 */
const PAY_WAY_OPTIONS: Record<'P' | 'C', { label: string; code: string }> = {
  P: { label: '预付', code: 'P' },
  C: { label: '到付', code: 'C' },
}

/**
 * Map `payType` của API sang option của site.
 *
 * - `true` / `1` → 预付 (site lưu mã "P");
 * - `false` / `0` → 到付 (site lưu mã "C");
 * - còn lại (`null`/`undefined`, hoặc giá trị lạ như `2`, `-1`) → `undefined`:
 *   KHÔNG đoán, bỏ trống 付款方式. Lý do cụ thể do caller ghi vào note.
 */
export function payWayOf(
  payType: boolean | number | null | undefined,
): { label: string; code: string } | undefined {
  if (payType === true || payType === 1) return PAY_WAY_OPTIONS.P
  if (payType === false || payType === 0) return PAY_WAY_OPTIONS.C
  return undefined
}

export type ContactRole = 0 | 1 | 2

export function contactRole(contact: ManifestContact): ContactRole | null {
  const t = contact.type
  if (t === true) return 1
  if (t === false) return 0
  if (t === 2) return 2
  if (t === 1) return 1
  if (t === 0) return 0
  return null
}

/**
 * Loại hàng: S = thường, D = hàng nguy hiểm, R = hàng kiểm dịch (refrigerated/quarantine),
 * G = vừa nguy hiểm vừa kiểm dịch.
 */
export type CargoKind = 'S' | 'D' | 'R' | 'G'

export function deriveCargoKind(goods: ManifestCargo): CargoKind {
  const danger = !isBlank(goods.dangerClass) || !isBlank(goods.unNub)
  const cold = !isBlank(goods.quarantineName) || !isBlank(goods.quarantineCode)
  if (danger && cold) return 'G'
  if (danger) return 'D'
  if (cold) return 'R'
  return 'S'
}

/**
 * Field BẮT BUỘC của site ở form đầu (FACT 1 của plan live-site-alignment).
 *
 * `START_PORT_COD`/`DISCHRG_PORT_COD` cũng BẮT BUỘC, và ở đường API chúng
 * được điền thẳng bởi `buildHeaderPayload` (mã cảng lấy từ `loadCode`/
 * `uploadCode`) ⇒ cần nằm trong danh sách này để report báo "còn trống" khi
 * API không có mã cảng.
 *
 * `SHIPPER_COUNTRY_COD` và toàn bộ field 通知人 KHÔNG nằm trong danh sách này:
 * site không bắt buộc chúng.
 */
export const REQUIRED_HEADER: readonly string[] = [
  'BILL_NBR',
  'E_SHIP_NAM',
  'OUT_VOYAGE_NO',
  'TRUST_COD',
  'PAY_WAY_ID',
  'DR_TYPE_STR',
  'START_PORT_NAM',
  'DISCHRG_PORT_NAM',
  'E_SHIPPER_NAM',
  'SHIPPER_ADD_STR',
  'E_CONSIGNEE_NAM',
  'CONSIGNEE_ADD_STR',
  'CONSIGNEE_COUNTRY_COD',
  'START_PORT_COD',
  'DISCHRG_PORT_COD',
]

/** Field BẮT BUỘC của site theo từng loại hàng (FACT 5.3 của plan live-site-alignment). */
export const REQUIRED_BASE: readonly string[] = [
  'CARGO_KIND_COD',
  'PACKAGE_COD',
  'PACKAGE_STR',
  'PIECE_NUM',
  'GWEIGHT_TON',
  'GVOL_NUM',
  'MARK_STR',
  'E_CARGO_NAM',
]
export const REQUIRED_DANGER: readonly string[] = [
  'DANG_CLASS_NAM',
  'DANG_UN_NO',
  'DANGER_CONTACT_NAM',
  'DANGER_TE_STR',
]
export const REQUIRED_COLD: readonly string[] = ['TEMP_ID', 'SET_TEMP_NUM']

/** Field BẮT BUỘC của site trong bảng container (FACT 5.3 + FACT 6). */
export const REQUIRED_CONTAINER: readonly string[] = [
  'CNTR_NO',
  'CNTR_SIZE_COD',
  'CNTR_TYPE_COD',
  'CNTR_EF_ID',
  'SEAL_NO',
  'SOC_ID',
]

export const REQUIRED_BY_KIND: Record<CargoKind, readonly string[]> = {
  S: REQUIRED_BASE,
  D: [...REQUIRED_BASE, ...REQUIRED_DANGER],
  R: [...REQUIRED_BASE, ...REQUIRED_COLD],
  G: [...REQUIRED_BASE, ...REQUIRED_DANGER, ...REQUIRED_COLD],
}

/**
 * Field `dang_*` + `danger_*` — site xoá & disable trừ khi loại hàng là `D`/`G`.
 */
export const DANGER_FIELDS: readonly string[] = [
  'dang_class_nam',
  'dang_page_no',
  'dang_un_no',
  'dang_lable_str',
  'dang_flash_point',
  'dang_ems_no',
  'dang_mfag_no',
  'dang_contactstr',
  'danger_contact_nam',
  'danger_te_str',
  'danger_em_str',
  'danger_fx_str',
]

/** Field nhiệt độ — site xoá trừ khi loại hàng là `R`/`G`. */
export const TEMP_FIELDS: readonly string[] = ['temp_id', 'set_temp_num']

/**
 * Nhãn hiển thị của field header — theo TÊN TIẾNG TRUNG của site.
 *
 * Key là TÊN FIELD VIẾT HOA của site (`prop`), tức `payload[key.toLowerCase()]`.
 * Nhãn tiếng Trung giữ nguyên vì đó là thứ operator thấy trên site; phần
 * chú thích tiếng Anh giúp tìm đúng ô khi site hiển thị tiếng Trung.
 */
export const HEADER_LABELS: Record<string, string> = {
  BILL_NO: 'Site bill ID',
  BILL_NBR: '提单号',
  E_SHIP_NAM: '船名',
  OUT_VOYAGE_NO: '航次',
  TRUST_COD: 'Trust code',
  PAY_WAY_ID: '付款方式',
  DR_TYPE_STR: 'Cargo type',
  SIGN_PLACE_COD: '提单签发地 (code)',
  SIGN_PLACE_STR: '提单签发地',
  START_PORT_COD: '装货港 (code)',
  START_PORT_NAM: '装货港',
  DISCHRG_PORT_COD: '卸货港 (code)',
  DISCHRG_PORT_NAM: '卸货港',
  DEST_PORT_COD: '交货地 (code)',
  DEST_PORT_NAM: '交货地',
  TRANS_PORT_COD: '中转港 (code)',
  TRANS_PORT_NAM: '中转港',
  E_SHIPPER_NAM: '发货人 (name)',
  SHIPPER_ADD_STR: '发货人 (address)',
  SHIPPER_COUNTRY_COD: '发货人 (country)',
  SHIPPER_TE_STR: '发货人 (telephone)',
  SHIPPER_EM_STR: '发货人 (email)',
  SHIPPER_FX_STR: '发货人 (fax)',
  SHIPPER_AEO: '发货人 (AEO)',
  E_CONSIGNEE_NAM: '收货人 (name)',
  CONSIGNEE_ADD_STR: '收货人 (address)',
  CONSIGNEE_COUNTRY_COD: '收货人 (country)',
  CONSIGNEE_TE_STR: '收货人 (telephone)',
  CONSIGNEE_EM_STR: '收货人 (email)',
  CONSIGNEE_FX_STR: '收货人 (fax)',
  CONSIGNEE_AEO: '收货人 (AEO)',
  E_NOTIFY_NAM: '通知人 (name)',
  NOTIFY_ADD_STR: '通知人 (address)',
  NOTIFY_COUNTRY_COD: '通知人 (country)',
  NOTIFY_TE_STR: '通知人 (telephone)',
  NOTIFY_EM_STR: '通知人 (email)',
  NOTIFY_FX_STR: '通知人 (fax)',
  NOTIFY_AEO: '通知人 (AEO)',
  TOTAL_PIECE_NUM: 'Total pieces',
  TOTAL_GWEIGHT_TON: 'Total gross weight (ton)',
  TOTAL_GVOL_NUM: 'Total volume (m³)',
  MANDATORY_CHECK: 'Mandatory check',
  SOFT_CHECK: 'Soft check',
  IS_ALL: 'Save mode',
}

/** Nhãn hiển thị của field dòng hàng — theo TÊN TIẾNG TRUNG của site. */
export const CARGO_LABELS: Record<string, string> = {
  BILL_NO: 'Site bill ID',
  PIECE_NUM: '包装件数',
  GWEIGHT_TON: '毛重 (ton)',
  GVOL_NUM: '体积 (m³)',
  NWEIGHT_TON: '净重 (ton)',
  CARGO_KIND_COD: '货物标识',
  CARGO_HS_COD: '海关编码',
  PACKAGE_COD: '包装代码',
  PACKAGE_STR: '包装类型',
  MARK_STR: '唛头',
  E_CARGO_NAM: '货物名称',
  DANG_CLASS_NAM: '危险品类别',
  DANG_PAGE_NO: '危险品页号',
  DANG_UN_NO: 'UN 编号',
  DANG_LABLE_STR: '危险品标签',
  DANG_FLASH_POINT: '闪点',
  DANG_EMS_NO: 'EMS',
  DANG_MFAG_NO: 'MFAG',
  DANG_CONTACTSTR: '危险品联系人',
  DANGER_CONTACT_NAM: '危险品联系人 (name)',
  DANGER_TE_STR: '危险品联系人 (telephone)',
  DANGER_EM_STR: '危险品联系人 (email)',
  DANGER_FX_STR: '危险品联系人 (fax)',
  TEMP_ID: '温度设置 (id)',
  SET_TEMP_NUM: '温度设置 (°C)',
}

/** Nhãn hiển thị của field container — theo TÊN TIẾNG TRUNG của site. */
export const CONTAINER_LABELS: Record<string, string> = {
  BILL_NO: 'Site bill ID',
  CNTR_NO: '箱号',
  CNTR_SIZE_COD: '尺寸',
  CNTR_TYPE_COD: '箱型',
  CNTR_EF_ID: '箱状态',
  SEAL_NO: '铅封号',
  PIECE_NUM: '箱内件数',
  WEIGH_TON: '箱内毛重 (ton)',
  VOLUME_NUM: '箱内体积 (m³)',
  SOC_ID: '货主箱标志',
}

/**
 * Note RIÊNG cho các field mà API không có dữ liệu.
 *
 * Key là TÊN FIELD VIẾT HOA của site. Note này thay cho note chung — vì
 * operator cần biết VÌ SAO ô đó trống, không chỉ biết nó trống.
 */
export const BLANK_NOTES: Record<string, string> = {
  SHIPPER_EM_STR: 'The API does not provide email addresses — fill this in by hand on the site.',
  SHIPPER_FX_STR: 'The API does not provide fax numbers — fill this in by hand on the site.',
  CONSIGNEE_EM_STR:
    'The API does not provide email addresses — fill this in by hand on the site.',
  CONSIGNEE_FX_STR: 'The API does not provide fax numbers — fill this in by hand on the site.',
  NOTIFY_EM_STR: 'The API does not provide email addresses — fill this in by hand on the site.',
  NOTIFY_FX_STR: 'The API does not provide fax numbers — fill this in by hand on the site.',
  DANGER_EM_STR: 'The API does not provide email addresses — fill this in by hand on the site.',
  DANGER_FX_STR: 'The API does not provide fax numbers — fill this in by hand on the site.',
  SHIPPER_AEO:
    'The API provides a business registration number (USCI/TIN), not an AEO code — leave this blank unless you know the AEO code.',
  CONSIGNEE_AEO:
    'The API provides a business registration number (USCI/TIN), not an AEO code — leave this blank unless you know the AEO code.',
  NOTIFY_AEO:
    'The API provides a business registration number (USCI/TIN), not an AEO code — leave this blank unless you know the AEO code.',
  SIGN_PLACE_COD:
    'The API does not provide the bill of lading issue place — fill this in by hand on the site.',
  SIGN_PLACE_STR:
    'The API does not provide the bill of lading issue place — fill this in by hand on the site.',
  TRANS_PORT_COD:
    'The API does not provide transit ports — fill this in by hand on the site.',
  TRANS_PORT_NAM:
    'The API does not provide transit ports — fill this in by hand on the site.',
  DANG_PAGE_NO:
    'The API does not provide the dangerous-goods page number — fill this in by hand on the site.',
  DANG_EMS_NO: 'The API does not provide the EMS number — fill this in by hand on the site.',
  DANG_MFAG_NO: 'The API does not provide the MFAG number — fill this in by hand on the site.',
  PACKAGE_COD:
    'The API does not provide the package type code — fill this in by hand on the site.',
  PACKAGE_STR:
    'The API does not provide the package type — fill this in by hand on the site.',
  CNTR_SIZE_COD:
    'The API returns a numeric container size code that does not match the site dictionary — fill this in by hand on the site.',
  CNTR_TYPE_COD:
    'The API returns a numeric container type code that does not match the site dictionary — fill this in by hand on the site.',
  CNTR_EF_ID:
    'The API does not provide the container status — fill this in by hand on the site.',
  SOC_ID:
    'The API does not say whether this container belongs to the cargo owner — fill this in by hand on the site.',
  CARGO_HS_COD: 'The API does not provide the HS code — fill this in by hand on the site.',
  NWEIGHT_TON: 'The API does not provide the net weight — fill this in by hand on the site.',
  TEMP_ID: 'The API does not provide the temperature setting — fill this in by hand on the site.',
  SET_TEMP_NUM: 'The API does not provide the temperature setting — fill this in by hand on the site.',
}

/**
 * Note chung cho field BẮT BUỘC bị trống.
 *
 * Dùng khi `BLANK_NOTES` không có mục riêng cho field đó.
 */
export function requiredBlankNote(prop: string, label: string): string {
  return `${label} (${prop}) is required by the site but the API does not provide it — fill it in by hand on the site.`
}

/**
 * Note chung cho field TUỲ CHỌN bị trống.
 *
 * Dùng khi `BLANK_NOTES` không có mục riêng cho field đó.
 */
export function optionalBlankNote(prop: string, label: string): string {
  return `${label} (${prop}) is not provided by the API — it was left blank on purpose.`
}

/**
 * Giá trị trong PAYLOAD có bị bỏ trống không?
 *
 * KHÁC `isBlank` ở trên, và khác CÓ CHỦ ĐÍCH:
 * - `isBlank` đọc DỮ LIỆU THÔ của API ⇒ số `0` là một giá trị THẬT
 *   (vd `dangerClass = 0` ⇒ không phải hàng nguy hiểm);
 * - hàm này đọc PAYLOAD đã dựng ⇒ số `0` là cách `buildCargoPayload` /
 *   `buildContainerPayload` ghi "API không có giá trị này" (0 kiện / 0 tấn /
 *   0 m³ thì vô nghĩa).
 *
 * Vì vậy HAI quy tắc KHÔNG được gộp làm một. Dùng nhầm quy tắc nào cũng
 * làm sai: gộp vào `isBlank` thì hàng có `dangerClass = 0` bị coi là hàng
 * nguy hiểm; dùng `isBlank` ở đây thì field số `0` không bao giờ được báo là
 * trống.
 *
 * `null`/`undefined` cũng là trống — payload không bao giờ chứa chúng, nhưng
 * nếu có thì field đó rõ ràng là chưa có giá trị.
 */
export function isBlankPayloadValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'number') return value === 0
  return false
}

/**
 * Nhãn hiển thị của field — fallback về chính tên field.
 *
 * `prop` là TÊN FIELD VIẾT HOA (giống `prop` trong report). Key của PAYLOAD thì
 * là CHỮ THƯỜNG ⇒ caller phải uppercase trước khi gọi.
 *
 * Scope dùng union viết TAY chứ KHÔNG import `FillScope` từ `protocol.ts`:
 * `protocol.ts` → `manifest-run.ts` → `field-meta.ts` ⇒ import kiểu sẽ tạo
 * vòng.
 */
export function labelOf(
  scope: 'header' | 'cargo' | 'container',
  prop: string,
): string {
  if (scope === 'header') return HEADER_LABELS[prop] ?? prop
  if (scope === 'cargo') return CARGO_LABELS[prop] ?? prop
  return CONTAINER_LABELS[prop] ?? prop
}
