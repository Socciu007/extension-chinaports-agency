import type { FillScope } from './fill'

export const MSG_FILL = 'manifest-autofill:fill'
export const MSG_PING = 'manifest-autofill:ping'
export const MSG_GET_BL_NO = 'manifest-autofill:get-bl-no'

/**
 * - `ok`    — điền thành công, đã xác minh lại giá trị trên form
 * - `warn`  — điền xong nhưng bước xác minh không khớp (vd mã cảng site chưa cascade)
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

export interface GetBlNoResult {
  ok: boolean
  blNo?: string
}
