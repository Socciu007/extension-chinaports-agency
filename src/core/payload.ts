/**
 * Dựng body cho API của site (`/api/booking/exportManifestDataMaintain/…`).
 *
 * Module này **KHÔNG gọi mạng** — chỉ biến dữ liệu manifest (API bên ngoài)
 * sang đúng hình dạng mà site POST đi:
 *
 * - mọi key trong body phải **chữ thường** (site gọi helper `keyToLowercase`
 *   trước khi POST) ⇒ xem `lowerKeys()`;
 * - thiếu dữ liệu ⇒ `""` cho field CHUỖI (header toàn chuỗi) và `0` cho
 *   field SỐ (dòng hàng / container) — KHÔNG `null`, KHÔNG `undefined`, KHÔNG
 *   bỏ hẳn key (site cần đủ key trong body);
 * - các field loại (付款方式, 货物标识, 货主箱标志) là **MÃ** của site
 *   (`P`/`C`, `S`/`D`/`R`/`G`, `Y`/`N`), KHÔNG phải nhãn tiếng Trung.
 *
 * `buildManifestBody` dựng BODY 45 key (43 key header + `cdgoods` +
 * `cntr_list`) — đây chính là hình dạng `ManifestData`.
 */
import {
  contactRole,
  deriveCargoKind,
  DANGER_FIELDS,
  payWayOf,
  TEMP_FIELDS,
  type MappingContext,
} from './field-meta'
import { billNoAsWritten } from './bill-no'
import type {
  ManifestApiData,
  ManifestCargo,
  ManifestContact,
  ManifestContainer,
  ManifestData,
} from './types'

/** Chuỗi đã trim; `null`/`undefined` ⇒ `""`. */
function str(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/**
 * Số từ API.
 *
 * - THIẾU dữ liệu (`null`/`undefined`/`''`) ⇒ `fallback` (0) ⇒ payload ghi 0
 *   ⇒ report coi là "API không có giá trị này";
 * - CÓ dữ liệu nhưng KHÔNG parse được (vd `"22,400"`) ⇒ `NaN` ⇒ đây là một
 *   lý do KHÁC ("không parse được"). Payload TRONG BỘ NHỚ giữ `NaN` để report
 *   phân biệt hai lý do; tầng gửi đi đổi thành `0` — cùng giá trị với case
 *   thiếu dữ liệu (xem `toWireValue`).
 *
 * Trước đây lỗi parse bị nuốt thành `0` ⇒ report nói "API không có giá trị
 * này" — một lý do SAI, và giá trị sai đó đi thẳng lên site.
 */
function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

/**
 * Số nguyên — site chỉ nhận số nguyên cho 包装件数 (`PIECE_NUM`) và
 * 货物件数 (`PIECE_NUM` của container): `"114.000"` ⇒ `114`.
 */
function int(value: unknown): number {
  return Math.trunc(num(value, 0))
}

/** Giá trị đầu tiên khác rỗng (fallback `shantou` → `sign`). */
function firstNonBlank(...values: unknown[]): string {
  for (const value of values) {
    const v = str(value)
    if (v !== '') return v
  }
  return ''
}

/**
 * Chuỗi mà site gửi đi: TRIM + UPPERCASE.
 *
 * Site làm vậy với giá trị của dòng hàng (vd `E_CARGO_NAM` thành
 * `"SILENT DIESEL GENERATOR"`); field của header/container giữ nguyên chữ
 * như API trả về.
 */
function upper(value: unknown): string {
  return str(value).toUpperCase()
}

/**
 * Chuyển key của object (đệ quy) sang chữ thường.
 *
 * Site gọi helper `keyToLowercase` trước khi POST ⇒ body phải có key chữ
 * thường. Mảng thì áp dụng cho từng phần tử, giá trị nguyên thủy giữ nguyên.
 *
 * Hàm trả về bản **copy** — không mutate input.
 */
export function lowerKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => lowerKeys(item)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(source)) {
      result[key.toLowerCase()] = lowerKeys(source[key])
    }
    return result as unknown as T
  }
  return value
}

/**
 * Giá trị đi ĐÚNG TRÊN WIRE.
 *
 * - Số KHÔNG parse được (`NaN`) ⇒ `0`: đó CHÍNH là giá trị mà case "API
 *   không có dữ liệu" đã gửi từ trước ⇒ field số giữ nguyên kiểu JSON
 *   **number** (site validate 货物毛重/货物体积/包装件数 bằng regex số, KHÔNG
 *   chấp nhận chuỗi rỗng). `NaN` chỉ có thể xảy ra ở field SỐ của dòng hàng /
 *   container — mọi field chuỗi đi qua `str()` nên KHÔNG BAO GIỜ ra `NaN`.
 *   Report đọc payload TRONG BỘ NHỚ (vẫn giữ `NaN`) ⇒ đó là nơi phân biệt
 *   "không parse được" với "API không có giá trị này".
 * - `null`/`undefined` ⇒ `""`: giữ key trong body (`JSON.stringify` bỏ hẳn
 *   key có giá trị `undefined`) và tránh `null` (site từ chối giá trị null).
 *
 * Đi đệ quy (mảng, object lồng nhau — vd `cntr_list`) và KHÔNG mutate input.
 */
export function toWireValue(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (value === null || value === undefined) {
    return ''
  }
  if (Array.isArray(value)) {
    return value.map((item) => toWireValue(item))
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      result[key] = toWireValue(item)
    }
    return result
  }
  return value
}

/**
 * Contact by role (0 = 发货人, 1 = 收货人, 2 = 通知人).
 *
 * Matches when `type` equals the role: `false` or `0` = 发货人, `true` or
 * `1` = 收货人, `2` = 通知人 (see `contactRole`).
 */
function contactOf(data: ManifestApiData, role: 0 | 1 | 2): ManifestContact | undefined {
  const contacts = data.cabContacts ?? []
  return contacts.find((contact) => contactRole(contact) === role)
}

/**
 * The bill number written to 提单号 on the site.
 *
 * The bill number MAY carry a piece suffix (`P1`, `P12`) — that is the number
 * the operator typed, i.e. the bill number ON THE SITE. The dadaex API only
 * returns the bare code (`normalizeBlNo` drops the suffix when looking up),
 * so writing the bare code to 提单号 would SILENTLY change the bill number on
 * the manifest.
 *
 * Hence: take the OPERATOR's number (keeping the suffix, trimmed +
 * upper-cased to match how the site writes bill numbers — see
 * `billNoAsWritten`); only when the operator typed nothing do we fall back to
 * the API's `blNo`.
 */
function billNbrOf(data: ManifestApiData, operatorBlNo?: string): string {
  const written = billNoAsWritten(operatorBlNo ?? '')
  return written !== '' ? written : billNoAsWritten(data.blNo ?? '')
}

// Build the site body for the manifest API.
export function buildManifestBody(
  data: ManifestApiData,
  ctx: MappingContext,
  operatorBlNo?: string,
): ManifestData {
  const aimCode = str(data.aimPortCode)
  const uploadCode = str(data.uploadCode)

  // The 3 parties — matched by the contact's ROLE, not by its order in the array.
  const shipper = contactOf(data, 0)
  const consignee = contactOf(data, 1)
  const notify = contactOf(data, 2)

  return {
    cdgoods: (data.cdgoods ?? []).map((goods) => buildCargoPayload(goods, '')),
    cntr_list: (data.cdCon ?? []).map((container) => buildContainerPayload(container, ctx, '')),
    bill_no: '',
    bill_nbr: billNbrOf(data, operatorBlNo),
    e_ship_nam: str(data.shipName),
    out_voyage_no: str(data.voyage),
    trust_cod: str(ctx.findTrustCode(data.sea_order?.sea_order_bind?.supplyId)),
    pay_way_id: payWayOf(data.payType)?.code ?? '',
    dr_type_str: str(data.transportTerms) === '1' ? 'CY/CY' : 'CY/CY',
    sign_place_cod: '',
    sign_place_str: '',
    start_port_cod: str(data.loadCode),
    start_port_nam: str(data.loadPortData?.nameEn) || str(ctx.findPort(data.loadCode ?? undefined)),
    dischrg_port_cod: aimCode,
    dischrg_port_nam:
      str(data.aimPortData?.nameEn) || str(ctx.findPort(aimCode ?? undefined)),
    trans_port_cod: '',
    trans_port_nam: '',
    dest_port_cod: uploadCode,
    dest_port_nam: str(data.uploadPortData?.nameEn) || str(ctx.findPort(uploadCode)),
    e_shipper_nam: str(shipper?.master),
    shipper_add_str: str(shipper?.address?.slice(-70)),
    shipper_country_cod: str(shipper?.country),
    shipper_te_str: str(shipper?.phone),
    shipper_em_str: '',
    shipper_fx_str: '',
    shipper_aeo: '',
    e_consignee_nam: str(consignee?.master),
    consignee_add_str: str(consignee?.address?.slice(-70)),
    consignee_country_cod: str(consignee?.country),
    consignee_te_str: str(consignee?.phone),
    consignee_em_str: '',
    consignee_fx_str: '',
    consignee_aeo: '',
    e_notify_nam: str(notify?.master),
    notify_add_str: str(notify?.address?.slice(-70)),
    notify_country_cod: str(notify?.country),
    notify_te_str: str(notify?.phone),
    notify_em_str: '',
    notify_fx_str: '',
    total_piece_num: '',
    total_gweight_ton: '',
    total_gvol_num: '',
    mandatory_check: '',
    soft_check: '',
    is_all: '0',
  }
}

// Add a cargo row to the manifest body.
export function buildCargoPayload(goods: ManifestCargo, billNo: string): Record<string, unknown> {
  const kind = deriveCargoKind(goods)

  const payload: Record<string, unknown> = {
    bill_no: billNo,
    piece_num: int(goods.amount),
    gweight_ton: num(goods.weight),
    gvol_num: num(goods.volume),
    nweight_ton: num(goods.grossWeight),
    cargo_kind_cod: kind,
    cargo_hs_cod: upper(goods.hscode) || '',
    package_cod: '',
    package_str: upper(goods.unit) || '',
    mark_str: upper(firstNonBlank(goods.shantou, goods.sign) || 'N/M'),
    e_cargo_nam: upper(goods.name),
    dang_class_nam: upper(goods.dangerClass) || '',
    dang_page_no: '',
    dang_un_no: upper(goods.unNub) || '',
    dang_lable_str: upper(goods.dangerCode) || '',
    dang_flash_point: upper(goods.dangerPoint) || '',
    dang_ems_no: '',
    dang_mfag_no: '',
    dang_contactstr: '',
    danger_contact_nam: upper(goods.exigencyName) || '',
    danger_te_str: upper(goods.exigencyPhone) || '',
    danger_em_str: upper(goods.exigencyEmail) || '',
    danger_fx_str: upper(goods.exigencyFax) || '',
    temp_id: '',
    set_temp_num: '',
  }

  // Site xoá field theo loại hàng — nhưng body VẪN phải có đủ key (giá trị "").
  if (kind === 'S' || kind === 'R') {
    for (const key of DANGER_FIELDS) payload[key] = ''
  }
  if (kind === 'S' || kind === 'D') {
    for (const key of TEMP_FIELDS) payload[key] = ''
  }

  return payload
}

/**
 * Dựng 1 dòng container.
 *
 * `ctx` cần cho `findCntrSize`/`findCntrType`: dict của site chỉ chứa chuỗi
 * "20"/"GP" còn `vC`/`cType` của API là mã số ⇒ thường tra không được ⇒ để
 * rỗng, KHÔNG đoán.
 */
export function buildContainerPayload(
  container: ManifestContainer,
  ctx: MappingContext,
  billNo: string,
): Record<string, unknown> {
  return {
    // Mã bill do server gán — lấy NGUYÊN VEN (không uppercase).
    bill_no: billNo,
    cntr_no: str(container.boxNub),
    cntr_size_cod: str(ctx.findCntrSize(container.vC ?? undefined)),
    cntr_type_cod: str(ctx.findCntrType(container.cType ?? undefined)),
    // 箱状态 — API không có dữ liệu.
    cntr_ef_id: '',
    seal_no: str(container.sealNUb),
    piece_num: int(container.amount),
    weigh_ton: num(container.weight),
    volume_num: num(container.volume),
    // 货主箱标志 — site lưu MÃ: 货主箱='Y', 非货主箱='N'.
    soc_id: container.self === true ? 'Y' : container.self === false ? 'N' : '',
  }
}
