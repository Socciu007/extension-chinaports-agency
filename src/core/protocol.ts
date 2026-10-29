/**
 * Import CHỈ để lấy KIỂU ⇒ không có vòng import lúc chạy.
 *
 * `manifest-run.ts` cũng chỉ `import type` từ file này ⇒ hai file không
 * import nhau lúc chạy.
 */
import type { ManifestRunResult } from './manifest-run'

export const MSG_FILL = 'manifest-autofill:fill'

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
 * - `ok`    — điền thành công, đã xác minh lại giá trị trên form
 * - `warn`  — DOM path: điền xong nhưng bước xác minh không khớp (vd mã cảng
 *             site chưa cascade). API path: site BẮT BUỘC field này nhưng API
 *             không cung cấp ⇒ để trống, operator phải điền tay.
 * - `skip`  — API không cung cấp field này, cố ý để trống (có `note` giải thích)
 * - `error` — không điền được (không tìm thấy field, không chọn được option, …)
 */
export type ReportStatus = 'ok' | 'skip' | 'warn' | 'error'

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

export interface FillRequest {
  type: typeof MSG_FILL
  blNo: string
  autoSubmit?: boolean
  apiBase?: string
}

export interface FillResult {
  ok: boolean
  message?: string
  items: ReportItem[]
  cargoRows: number
  containerRows: number
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
