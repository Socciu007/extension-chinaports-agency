/**
 * Các bước **ghi** tới API của site — tạo bill, thêm dòng hàng, lưu bill.
 *
 * Site không có endpoint riêng cho container: dòng container được gửi kèm
 * lúc lưu bill (biến `cntr_list`). Vì vậy thứ tự đúng là:
 *
 *   1) `createManifestBill`      → server gán một mã bill nội bộ
 *   2) `addCargoRow` (mỗi dòng) → dòng hàng gắn vào bill đó
 *   3) `saveManifestContainers`   → lưu bill kèm container
 *
 * Mọi body đi qua `lowerKeys` ở tầng này: site gọi helper `keyToLowercase`
 * trước khi POST nên key viết hoa sẽ bị site đọc sai.
 */
import { postSiteJson, type SiteFetchOptions } from './site-api'
import { lowerKeys, type HeaderPayload } from './payload'

/** Endpoint tạo bill và lưu bill — path rỗng ⇒ URL kết thúc bằng `/`. */
export const BILL_PATH = ''
/** Endpoint thêm dòng hàng. */
export const CARGO_PATH = 'cargo/add/'

/**
 * Key mà site TỰ tính — không gửi khi lưu bill.
 *
 * Bundle của site gọi `POST /computePgv/` để tính tổng, nên gửi `""` sẽ ghi
 * đè số do site tính ⇒ mất luôn tổng.
 */
const SITE_COMPUTED_KEYS = ['total_piece_num', 'total_gweight_ton', 'total_gvol_num']

/**
 * Key `cargo_list` — dòng hàng đã lưu riêng qua `cargo/add/` nên gửi lại
 * sẽ đè mất dòng đó.
 */
const CARGO_LIST_KEY = 'cargo_list'

/**
 * Bước 1 — tạo bill (chưa lưu, chưa gắn hàng).
 *
 * Header do `buildHeaderPayload` dựng đã có sẵn `bill_no: ''` và
 * `is_all: '0'` ("0" = tạo bill) ⇒ không sửa gì thêm.
 */
export function createManifestBill(
  header: HeaderPayload,
  options?: SiteFetchOptions,
): Promise<unknown> {
  return postSiteJson(BILL_PATH, lowerKeys(header), options)
}

/**
 * Bước 2 — gắn một dòng hàng vào bill đã tạo.
 *
 * `bill_no` phải là mã bill server gán (nguyên văn) — xem `extractBillNo`.
 */
export function addCargoRow(
  cargo: Record<string, unknown>,
  options?: SiteFetchOptions,
): Promise<unknown> {
  return postSiteJson(CARGO_PATH, lowerKeys(cargo), options)
}

/**
 * Bước 3 — lưu bill kèm container (`is_all` = "1" = 暂存).
 *
 * KHÔNG dùng `is_all` = "2" (发送) — extension không bao giờ tự gửi tờ khai.
 *
 * Header được **copy** (`{...header}`) rồi sửa: hàm nhận header của caller,
 * mutate nó sẽ làm hỏng lần POST sau (tổng đã bị xoá, `is_all` đã đổi).
 */
export function saveManifestContainers(
  header: HeaderPayload,
  containers: Record<string, unknown>[],
  billNo: string,
  options?: SiteFetchOptions,
): Promise<unknown> {
  const body: Record<string, unknown> = { ...header }
  for (const key of SITE_COMPUTED_KEYS) delete body[key]
  delete body[CARGO_LIST_KEY]
  // Mã bill do server gán — lấy NGUYÊN VEN (không uppercase, không trim).
  body.bill_no = billNo
  // "1" = 暂存 (KHÔNG phải "2" = 发送).
  body.is_all = '1'
  body.cntr_list = containers

  return postSiteJson(BILL_PATH, lowerKeys(body), options)
}

/** Key chứa mã bill — thứ tự ưu tiên từ cao xuống thấp. */
const BILL_NO_KEYS = ['bill_no', 'billNo', 'bill_id', 'billId', 'id']

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Lấy mã bill từ envelope `{code, data, msg}` của site.
 *
 * Tra `data` TRƯỚC top-level: site bọc kết quả trong `data`, còn top-level
 * chỉ là envelope. Mã bill lấy NGUYÊN VEN (không trim, không uppercase) vì
 * đó chính là giá trị server gán và dùng lại ở các bước sau.
 */
export function extractBillNo(response: unknown, fallback = ''): string {
  const envelope = asRecord(response)
  if (!envelope) return fallback

  for (const candidate of [asRecord(envelope.data), envelope]) {
    if (!candidate) continue
    for (const key of BILL_NO_KEYS) {
      const value = candidate[key]
      if (typeof value === 'string' && value.trim() !== '') return String(value)
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
  }

  return fallback
}
