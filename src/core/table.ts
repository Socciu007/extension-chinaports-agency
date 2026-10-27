import { setTextValue } from './dom'
import { pickFromPopper, pickFromSelect } from './select'

export interface TableHandles {
  table: HTMLElement
  headerCells: HTMLElement[]
  bodyRows: HTMLElement[]
}

/** Đọc cấu trúc bảng (hỗ trợ cả `<table>` thật lẫn `el-table` của Element Plus). */
export function readTableHandles(table: HTMLElement): TableHandles {
  const headerCells = Array.from(
    table.querySelectorAll<HTMLElement>('thead th, .el-table__header th'),
  )
  const bodyRows = Array.from(
    table.querySelectorAll<HTMLElement>('tbody tr, .el-table__row'),
  ).filter((row) => !row.closest('thead'))
  return { table, headerCells, bodyRows }
}

/** Tìm chỉ số cột theo nhãn tiếng Trung; ưu tiên khớp chính xác. */
export function findColumnIndex(headerCells: HTMLElement[], columnLabel: string): number {
  const needle = columnLabel.trim()
  const exact = headerCells.findIndex((th) => (th.textContent ?? '').trim() === needle)
  if (exact >= 0) return exact
  return headerCells.findIndex((th) => (th.textContent ?? '').trim().includes(needle))
}

/** Lấy ô tương ứng với chỉ số cột trong một dòng. */
export function getCell(row: HTMLElement, columnIndex: number): HTMLElement | null {
  const cells = Array.from(row.querySelectorAll<HTMLElement>('td, th'))
  return cells[columnIndex] ?? null
}

/** Đặt giá trị cho một ô trong bảng inline editable. */
export async function setCellValue(
  cell: HTMLElement,
  value: string,
  timeout = 5000,
): Promise<{ ok: boolean; reason?: string }> {
  // Element Plus render input của select không filterable thành
  // <span class="el-select__input"> → trong ô không có <input> nào, nên phải
  // kiểm tra `.el-select` TRƯỚC khi tìm input.
  if (cell.querySelector('.el-select')) {
    const result = await pickFromSelect(cell, value, timeout)
    return { ok: result.ok, reason: result.reason }
  }

  const input = cell.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  if (!input) return { ok: false, reason: 'The table cell has no input' }

  if (input.readOnly) {
    const result = await pickFromPopper(cell, value, timeout)
    return { ok: result.ok, reason: result.reason }
  }

  setTextValue(input, value)
  return { ok: true }
}
