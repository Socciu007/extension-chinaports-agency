import type { ReportItem } from './protocol'

/** Một field mà site BẮT BUỘC có nhưng lần chạy này không lấp được. */
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
 * Field mà SITE bắt buộc nhưng API KHÔNG cung cấp.
 *
 * Ở đường API, report chỉ liệt kê field BỊ BỎ TRỐNG, nên "chặn" ở đây
 * nghĩa là: site BẮT BUỘC có field này mà extension KHÔNG lấp được ⇒
 * manifest không hoàn chỉnh và operator phải điền tay trên site.
 *
 * Field KHÔNG bắt buộc (EMAIL, FAX, 中转港…) KHÔNG chặn ⇒ không có trong
 * danh sách này.
 *
 * Lý do cụ thể nằm ở `note` của từng item (`warn` = site bắt buộc nhưng API
 * không có dữ liệu, `skip` = không bắt buộc nên để trống là đúng) ⇒ tầng UI
 * phải hiện note đó thay vì tự bịa một lý do chung.
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
