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
import { postSiteJson, SiteApiError, type SiteFetchOptions } from './site-api'
import { lowerKeys, type HeaderPayload } from './payload'

/** Endpoint tạo bill và lưu bill — path rỗng ⇒ URL kết thúc bằng `/`. */
export const BILL_PATH = ''
/** Endpoint thêm dòng hàng. */
export const CARGO_PATH = 'cargo/add/'

/**
 * Nhãn endpoint bill trong message lỗi.
 *
 * `BILL_PATH` RỖNG nên nếu lấy `path` làm nhãn thì message sẽ có hai dấu
 * cách — nhãn riêng giữ message đọc được.
 */
const BILL_LABEL = 'the manifest bill'
/** Nhãn endpoint dòng hàng trong message lỗi. */
const CARGO_LABEL = 'the manifest cargo row'

/**
 * Key mà site TỰ tính — không gửi khi lưu bill.
 *
 * Site có `POST /computePgv/` nhưng endpoint đó tính tổng của BẢNG CONTAINER
 * (箱内总件数/箱内总毛重), không phải tổng của header ⇒ chưa có bằng chứng
 * server tự tính `total_*` khi lưu bill. Gửi `""` sẽ ghi đè giá trị site đã
 * tính ⇒ bước lưu KHÔNG gửi 3 key này. Việc server có tự tính tổng header
 * hay không sẽ kiểm chứng trên site thật.
 */
const SITE_COMPUTED_KEYS = ['total_piece_num', 'total_gweight_ton', 'total_gvol_num']

/**
 * Key `cargo_list` — dòng hàng đã lưu riêng qua `cargo/add/` nên gửi lại
 * sẽ đè mất dòng đó.
 */
const CARGO_LIST_KEY = 'cargo_list'

/** Gắn nhãn endpoint cho message lỗi (path rỗng ⇒ nhãn phải riêng). */
function withLabel(options: SiteFetchOptions | undefined, label: string): SiteFetchOptions {
  return { ...options, label: options?.label ?? label }
}

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
  return postSiteJson(BILL_PATH, lowerKeys(header), withLabel(options, BILL_LABEL))
}

/**
 * Bước 2 — gắn một dòng hàng vào bill đã tạo.
 *
 * `bill_no` do hàm này gán từ tham số `billNo` — KHÔNG lấy từ `cargo` (cargo
 * có thể mang mã cũ) và không để caller tự điền. Mã bill lấy NGUYÊN VEN
 * (không trim, không uppercase).
 */
export async function addCargoRow(
  cargo: Record<string, unknown>,
  billNo: string,
  options?: SiteFetchOptions,
): Promise<unknown> {
  if (billNo.trim() === '') {
    // Gửi `bill_no: ''` lên site ⇒ dòng hàng bị gắn vào bill khác/rác mà
    // không có bất kỳ lỗi nào báo ra ⇒ chặn ngay tại đây.
    throw new SiteApiError(
      'bad_response',
      'Cannot add a cargo row without a bill number — the site would attach the row to the wrong manifest.',
    )
  }
  return postSiteJson(
    CARGO_PATH,
    lowerKeys({ ...cargo, bill_no: billNo }),
    withLabel(options, CARGO_LABEL),
  )
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

  return postSiteJson(BILL_PATH, lowerKeys(body), withLabel(options, BILL_LABEL))
}

/**
 * Key chứa mã bill — thứ tự ưu tiên từ cao xuống thấp.
 *
 * KHÔNG có `id`: key đó quá generic — envelope có `data = {id: 123}` sẽ bị
 * đọc nhầm là mã bill ⇒ dòng hàng gắn vào bill khác/rác.
 */
const BILL_NO_KEYS = ['bill_no', 'billNo', 'bill_id', 'billId']

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
 *
 * Không tìm thấy mã bill ⇒ ném lỗi: "chưa có mã bill" là LỖI (dòng hàng sẽ
 * không gắn được vào bill nào), không phải một giá trị rỗng hợp lệ.
 */
export function extractBillNo(response: unknown): string {
  const envelope = asRecord(response)

  for (const candidate of [asRecord(envelope?.data), envelope]) {
    if (!candidate) continue
    for (const key of BILL_NO_KEYS) {
      const value = candidate[key]
      // `trim()` CHỈ dùng để kiểm tra "rỗng hay không" — giá trị trả về là
      // nguyên bản của server.
      if (typeof value === 'string' && value.trim() !== '') return String(value)
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
  }

  throw new SiteApiError(
    'bad_response',
    'The site response did not contain a bill number, so the manifest rows cannot be attached.',
  )
}
