/**
 * Metadata về các field của site — dùng CHUNG cho DOM path và API path.
 *
 * Tách ra module riêng vì hai đường đi của extension cần cùng một nguồn sự
 * thật: site BẮT BUỘC field nào, loại hàng nào thì site xoá field nào, tra
 * cảng bằng tên nào, và map dữ liệu của bên ngoài sang field nào.
 *
 * - DOM path (`mapping.ts`) đọc để dựng plan điền form.
 * - API path (`payload.ts`, `manifest-run.ts`) đọc để dựng body gửi lên site.
 *
 * DOM path sẽ bị bỏ ở task sau ⇒ module này KHÔNG được import từ
 * `mapping.ts` (import ngược lại tạo vòng).
 */
import type { ManifestCargo, ManifestContact } from './types'

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

export function text(value: unknown): string {
  return isBlank(value) ? '' : String(value).trim()
}

export interface MappingContext {
  findTrustCode(supplyId?: number): string | undefined
  findDrType(code?: string): string | undefined
  /** Tên cảng tiếng Trung — widget của site chỉ gợi ý tên Trung (filter `E_PORT_NAM`). */
  findPort(code?: string): string | undefined
  findCntrType(raw?: number | string | null): string | undefined
  findCntrSize(raw?: number | string | null): string | undefined
}

/**
 * 付款方式 của site: 预付='P', 到付='C', 免费='F'. Adapter click theo TEXT hiển thị.
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
 * Nhãn hiển thị của loại hàng trên site.
 *
 * `el-select` của site khớp option theo **TEXT hiển thị** ⇒ plan phải chứa
 * nhãn (`普货`), mã (`S`) chỉ nằm trong `note` để người dùng đối chiếu.
 */
export const CARGO_KIND_LABELS: Record<CargoKind, string> = {
  S: '普货',
  D: '危险品',
  R: '冷藏品',
  G: '危险品+冷藏品',
}

/**
 * Field BẮT BUỘC của site ở form đầu (FACT 1 của plan live-site-alignment).
 *
 * `START_PORT_COD`/`DISCHRG_PORT_COD` KHÔNG có plan riêng: site cascade chúng
 * khi suggestion của `*_PORT_NAM` được click, và `fill.ts` verify lại ngay sau
 * đó ⇒ không cascade được thì báo `warn`, mà `warn` thì `ok` đã là false.
 *
 * Site vẫn BẮT BUỘC cả hai field mã cảng ⇒ chúng nằm trong danh sách này.
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
