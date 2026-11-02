import { postSiteJson, SiteApiError, type SiteFetchOptions } from './site-api'
import { lowerKeys, toWireValue } from './payload'
import type { ManifestData } from './types'

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

/**
 * Key của body mà KHÔNG được gửi kèm lúc tạo bill.
 *
 * `cdgoods` (dòng hàng) đi qua endpoint riêng `cargo/add/`; gửi kèm ở đây
 * sẽ tạo TRÙNG dòng hàng. `cntr_list` (dòng container) chỉ đi kèm lúc LƯU
 * bill.
 */
const ROW_KEYS = ['cdgoods', 'cntr_list']

/** Gắn nhãn endpoint cho message lỗi (path rỗng ⇒ nhãn phải riêng). */
function withLabel(options: SiteFetchOptions | undefined, label: string): SiteFetchOptions {
  return { ...options, label: options?.label ?? label }
}

// Step 1 — create the manifest bill.
export function createManifestBill(
  body: ManifestData,
  options?: SiteFetchOptions,
): Promise<unknown> {
  const header: Record<string, unknown> = { ...body }
  for (const key of ROW_KEYS) delete header[key]
  return postSiteJson(
    BILL_PATH,
    toWireValue(lowerKeys(header)),
    withLabel(options, BILL_LABEL),
  )
}

// Step 2 — attach a cargo row to the manifest bill.
export async function addCargoRow(
  cargo: Record<string, unknown>,
  billNo: string,
  options?: SiteFetchOptions,
): Promise<unknown> {
  if (billNo.trim() === '') {
    throw new SiteApiError(
      'bad_request',
      'Cannot add a cargo row without a bill number — the site would attach the row to the wrong manifest.',
    )
  }

  return postSiteJson(
    CARGO_PATH,
    toWireValue(lowerKeys({ ...cargo, bill_no: Number(billNo) })),
    withLabel(options, CARGO_LABEL),
  )
}

// Step 3 — save the manifest bill with containers.
export function saveManifestContainers(
  body: ManifestData,
  billNo: string,
  options?: SiteFetchOptions,
): Promise<unknown> {
  const payload: Record<string, unknown> = { ...body }
  delete payload.cdgoods
  for (const key of SITE_COMPUTED_KEYS) delete payload[key]
  delete payload[CARGO_LIST_KEY]
  payload.bill_no = billNo
  payload.is_all = '1'
  payload.cntr_list = (body.cntr_list ?? []).map((row) => ({ ...row, bill_no: Number(billNo) }))

  return postSiteJson(
    BILL_PATH,
    toWireValue(lowerKeys(payload)),
    withLabel(options, BILL_LABEL),
  )
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

// Extract the bill number from the site response.
export function extractBillNo(response: any): string {
  const envelope = asRecord(response.data)

  if (envelope?.bill_no && Array.isArray(envelope.bill_no) && !!envelope.bill_no.length) return envelope.bill_no[0] as string

  throw new SiteApiError(
    'bad_response',
    'The site response did not contain a bill number, so the manifest rows cannot be attached.',
  )
}