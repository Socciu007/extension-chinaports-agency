import type { ReportItem } from './protocol'

/** Một field mà site BẮT BUỘC có nhưng lần điền này không điền được. */
export interface BlockingField {
  /** nhãn tiếng Trung của field trên site (vd 付款方式) */
  label: string
  /** tên prop của field (vd PAY_WAY_ID) */
  prop: string
  /** scope của field (header / cargo / container) */
  scope: ReportItem['scope']
  /** số thứ tự dòng (chỉ có với scope cargo/container) */
  row?: number
  /** giải thích vì sao field bị bỏ trống */
  note?: string
}

/**
 * Field mà SITE bắt buộc nhưng lần điền này không điền được.
 *
 * Đây là những field chặn việc submit manifest. `skip` với `required` false
 * (EMAIL, FAX, 中转港…) KHÔNG chặn ⇒ không có trong danh sách này.
 *
 * NGUYÊN NHÂN khác nhau theo `status`, nên đừng quy tất cả về một lý do:
 * - `skip`  — API không có dữ liệu cho field này (xem `headerSkippedNote`).
 * - `warn`  — ta ĐÃ ghi giá trị nhưng site không cascade/verify được (mã cảng
 *             chưa được sinh) — lỗi nằm ở phía site, không phải thiếu dữ liệu.
 * - `error` — site từ chối giá trị (không tìm thấy field, không có option).
 *
 * Vì vậy lý do cụ thể nằm ở `note` của từng item; tầng UI phải hiện note đó
 * thay vì tự bịa một lý do chung.
 */
export function blockingFields(items: ReportItem[]): BlockingField[] {
  return items
    .filter((item) => item.required === true && item.status !== 'ok')
    .map((item) => ({
      label: item.label,
      prop: item.prop,
      scope: item.scope,
      row: item.row,
      note: item.note,
    }))
}

/**
 * Câu thông báo cho người dùng khi lần điền KHÔNG thành công.
 *
 * `message` của `FillResult` chỉ có khi content script dừng sớm (không tìm
 * thấy nút, dialog không mở…) — lúc đó chưa field nào được điền nên câu đó
 * là thông tin quan trọng nhất. Ngược lại, khi form đã điền xong nhưng còn
 * field bắt buộc bị bỏ trống thì `message` là undefined ⇒ phải tự dựng câu
 * từ danh sách field bị chặn, nếu không popup chỉ báo chung chung và người
 * dùng không biết phải điền tay cái gì.
 */
export function describeIncompleteFill(items: ReportItem[], message?: string): string {
  if (message) return message

  const blocking = blockingFields(items)
  if (blocking.length > 0) {
    const names = blocking.map((field) => field.label).join(', ')
    return (
      `The site requires ${blocking.length} field(s) that could not be filled in: ` +
      `${names}. See the note under each field for the reason, then complete them on the page.`
    )
  }

  const failed = items.filter((item) => item.status === 'warn' || item.status === 'error')
  if (failed.length > 0) {
    const names = failed.map((item) => item.label).join(', ')
    return `Some fields could not be filled in: ${names}.`
  }

  return 'Could not fill the manifest data.'
}
