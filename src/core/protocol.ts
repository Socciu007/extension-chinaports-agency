/**
 * Import CHỈ để lấy KIỂU ⇒ không có vòng import lúc chạy.
 *
 * `manifest-run.ts` cũng chỉ `import type` từ file này ⇒ hai file không
 * import nhau lúc chạy.
 */
import type { ManifestRunResult } from './manifest-run'

/**
 * Message tạo manifest qua API — đường CHÍNH.
 *
 * Popup gửi message này, content script gọi `runManifest` (đọc manifest từ
 * API bên ngoài → dựng payload → gọi API của site).
 */
export const MSG_CREATE_MANIFEST = 'manifest-autofill:create'

/** Section mà một item thuộc về. */
export type FillScope = 'header' | 'cargo' | 'container'

/**
 * Trạng thái của một field trong report.
 *
 * Ở ĐƯỜNG API, report chỉ liệt kê field BỊ BỎ TRỐNG — mọi field đã điền
 * đều KHÔNG có mặt trong report:
 * - `warn` — site BẮT BUỘC có field này nhưng API không cung cấp ⇒ để trống,
 *             operator phải điền tay trên site;
 * - `skip` — field KHÔNG bắt buộc và API không cung cấp ⇒ để trống là đúng.
 *
 * `ok` và `error` thuộc về đường DOM đã bị gỡ ⇒ chúng KHÔNG còn tồn tại.
 * Union hẹp lại còn `warn | skip` vì đó là đúng những gì đường API sinh ra.
 */
export type ReportStatus = 'warn' | 'skip'

export interface ReportItem {
  scope: FillScope
  prop: string
  label: string
  status: ReportStatus
  note?: string
  /** số thứ tự của dòng (chỉ có với scope cargo/container) — phân biệt các dòng trùng prop */
  row?: number
  /**
   * site BẮT BUỘC có field này — bỏ trống thì manifest không submit được.
   * Popup dùng cờ này để chỉ ra field đang chặn việc submit.
   */
  required?: boolean
}

export interface CreateRequest {
  type: typeof MSG_CREATE_MANIFEST
  /** Số bill — `runManifest` tự chuẩn hoá (trim, uppercase, bỏ hậu tố `P<n>`). */
  blNo: string
  /** `true` ⇒ ghi lên site (tạo bill + gắn hàng + lưu nháp). Thiếu/`false` ⇒ CHỈ preview, KHÔNG POST. */
  allowWrite?: boolean
  /** Base URL của API manifest bên ngoài. */
  apiBase?: string
  /** Base URL của API của site. */
  siteApiBase?: string
}

/** Kết quả trả về cho popup — cùng hình dạng với `ManifestRunResult`. */
export type CreateResult = ManifestRunResult
