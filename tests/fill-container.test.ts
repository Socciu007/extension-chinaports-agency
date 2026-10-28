import { describe, it, expect, beforeEach } from 'vitest'
import { fillContainerRows } from '../src/core/fill'
import { readTableHandles, findColumnIndex } from '../src/core/table'
import { mapContainer, type MappingContext } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'
import {
  buildCargoSection,
  buildContainerSection,
  simulateAddRow,
  selectedOptions,
  CONTAINER_COLUMNS,
} from './helpers/dom'

const data = fixture.data as unknown as ManifestData
const container = data.cdCon![0]!

const ctx: MappingContext = {
  findTrustCode: () => undefined,
  findDrType: () => undefined,
  findPort: () => undefined,
  findCntrType: (raw) => (String(raw) === '2' ? '20GP' : undefined),
  findCntrSize: (raw) => (String(raw) === '0' ? "20'" : undefined),
}

beforeEach(() => {
  document.body.innerHTML = ''
})

/** Giá trị của ô input trong dòng `row`, cột `column`. */
function cellValue(row: Element, column: number): string {
  const cell = row.querySelectorAll('td')[column]
  const input = cell?.querySelector('input') as HTMLInputElement | undefined
  return input?.value ?? ''
}

/**
 * Làm hỏng setter `value` của input từ lần gọi thứ `failAt` trở đi.
 *
 * Mô phỏng lỗi ghi giá trị: `setTextValue` ném exception ⇒ ô đó không được ghi
 * nhưng các ô ghi TRƯỚC đó trong cùng dòng đã có giá trị.
 */
function breakValueSetter(failAt: number): () => void {
  const proto = HTMLInputElement.prototype
  const original = Object.getOwnPropertyDescriptor(proto, 'value')!
  let calls = 0
  Object.defineProperty(proto, 'value', {
    configurable: true,
    get(this: HTMLInputElement) {
      return original.get!.call(this)
    },
    set(this: HTMLInputElement, value: string) {
      calls += 1
      if (calls === failAt) throw new Error('Could not find the native value setter')
      original.set!.call(this, value)
    },
  })
  return () => Object.defineProperty(proto, 'value', original)
}

describe('readTableHandles / findColumnIndex', () => {
  it('đọc được 9 cột header', () => {
    buildContainerSection()
    const table = document.querySelector('.el-table') as HTMLElement
    const handles = readTableHandles(table)
    expect(handles.headerCells).toHaveLength(9)
  })

  it('tìm đúng index của cột 箱号', () => {
    buildContainerSection()
    const table = document.querySelector('.el-table') as HTMLElement
    const handles = readTableHandles(table)
    expect(findColumnIndex(handles.headerCells, '箱号')).toBe(0)
    expect(findColumnIndex(handles.headerCells, '铅封号')).toBe(CONTAINER_COLUMNS.indexOf('铅封号'))
  })

  it('ô gutter của Element Plus không được tính vào header', () => {
    // Site thêm ô `<th class="el-table__gutter">` khi bảng cuộn ngang nhưng body
    // KHÔNG có ô tương ứng ⇒ tính luôn gutter thì mọi cột lệch sang phải 1 ô
    // (箱号 sẽ ghi vào 尺寸).
    buildContainerSection()
    const table = document.querySelector('.el-table') as HTMLElement
    const handles = readTableHandles(table)

    expect(table.querySelectorAll('thead th')).toHaveLength(10)
    expect(handles.headerCells).toHaveLength(9)
    expect(handles.headerCells[0]?.textContent?.trim()).toBe('箱号')
  })
})

describe('fillContainerRows', () => {
  it('thêm dòng và điền các ô trong bảng', async () => {
    buildContainerSection()
    simulateAddRow()

    const result = await fillContainerRows(document, [container], ctx)

    expect(result.rows).toBe(1)
    const tbody = document.querySelector('#container-table .el-table__body tbody')!
    const cells = tbody.querySelectorAll('td')
    expect((cells[0]!.querySelector('input') as HTMLInputElement).value).toBe('ONEU1437898')
    expect((cells[4]!.querySelector('input') as HTMLInputElement).value).toBe('CN28731BH')
  })

  it('hai container ⇒ hai dòng khác nhau với giá trị đúng', async () => {
    buildContainerSection()
    simulateAddRow()
    const second = { ...container, boxNub: 'TGHU7654321', sealNUb: 'SEAL-2' }

    const result = await fillContainerRows(document, [container, second], ctx)

    expect(result.rows).toBe(2)
    const rows = document.querySelectorAll('#container-table .el-table__body tbody tr')
    expect(rows).toHaveLength(2)
    // Site chèn dòng mới ở index 0 (`insertTableRow(0, {})`).
    expect(cellValue(rows[0]!, 0)).toBe('TGHU7654321')
    expect(cellValue(rows[0]!, 4)).toBe('SEAL-2')
    expect(cellValue(rows[1]!, 0)).toBe('ONEU1437898')
    expect(cellValue(rows[1]!, 4)).toBe('CN28731BH')
  })

  it('ô render bằng el-select (không có input) ⇒ nhánh select chạy', async () => {
    buildContainerSection()
    simulateAddRow('#add-container', { selectColumns: ['尺寸'] })

    const result = await fillContainerRows(document, [container], ctx)

    expect(result.rows).toBe(1)
    // Option của dropdown đã bị click ⇒ nhánh select thật sự chạy.
    expect(selectedOptions()).toContain("20'")
    const size = result.items.find((i) => i.prop === 'CNTR_SIZE_COD')
    expect(size?.status).toBe('ok')
  })

  it('nút 新增 không thêm dòng ⇒ rows = 0 và có 1 lỗi', async () => {
    buildContainerSection()
    // KHÔNG gắn handler ⇒ bấm 新增 không sinh dòng nào.

    const result = await fillContainerRows(document, [container], ctx)

    expect(result.rows).toBe(0)
    expect(result.items.filter((i) => i.status === 'error')).toHaveLength(1)
  })

  it('scope có cả bảng hàng và bảng container ⇒ dòng thêm vào bảng container', async () => {
    buildCargoSection()
    buildContainerSection()
    simulateAddRow()

    let cargoClicks = 0
    document.getElementById('add-cargo')!.addEventListener('click', () => {
      cargoClicks += 1
    })

    const result = await fillContainerRows(document, [container], ctx)

    expect(result.rows).toBe(1)
    // Nút 新增 của section 货物信息 KHÔNG được bấm.
    expect(cargoClicks).toBe(0)
    expect(document.querySelectorAll('#goods-table .el-table__body tbody tr')).toHaveLength(0)
    expect(document.querySelectorAll('#container-table .el-table__body tbody tr')).toHaveLength(1)
  })

  it('báo lỗi khi không thấy bảng container', async () => {
    document.body.innerHTML = '<div></div>'
    const result = await fillContainerRows(document, [container], ctx)
    expect(result.rows).toBe(0)
    expect(result.items.some((i) => i.status === 'error')).toBe(true)
  })

  it('item "ok" mang note để đối chiếu mã mà site lưu', async () => {
    buildContainerSection()
    simulateAddRow()

    const result = await fillContainerRows(document, [container], ctx)
    const soc = result.items.find((i) => i.prop === 'SOC_ID')

    expect(soc?.status).toBe('ok')
    expect(soc?.note).toContain('非货主箱')
  })

  it('site dựng lại <tr> sau khi ghi ô đầu ⇒ các ô còn lại vẫn được ghi', async () => {
    // Element Plus dựng lại `<tr>` khi model của dòng đổi ⇒ node dòng đã bị
    // detach, không được giữ lại để ghi tiếp.
    buildContainerSection()
    simulateAddRow('#add-container', { rerenderOnInput: true })

    const result = await fillContainerRows(document, [container], ctx)

    expect(result.rows).toBe(1)
    const rows = document.querySelectorAll('#container-table .el-table__body tbody tr')
    expect(rows).toHaveLength(1)
    const cells = rows[0]!.querySelectorAll('td')
    expect((cells[0]!.querySelector('input') as HTMLInputElement).value).toBe('ONEU1437898')
    // Ô ghi SAU khi dòng bị dựng lại ⇒ cũng phải có giá trị.
    expect((cells[4]!.querySelector('input') as HTMLInputElement).value).toBe('CN28731BH')
  })

  it('el-table KHÔNG có row-key (site tái sử dụng <tr>) ⇒ dòng mới là dòng index 0', async () => {
    // `el-table` không có `row-key` ⇒ key của dòng là INDEX của nó ⇒ khi site
    // `insertTableRow(0, {})`, Vue TÁI SỬ DỤNG node `<tr>` #0 cho dòng mới và
    // chỉ mount node mới cho dòng cũ cuối ⇒ "node mới" là dòng CUỐI (dòng cũ).
    // Nhận diện dòng mới bằng node ⇒ ghi đè dòng trước.
    buildContainerSection()
    simulateAddRow('#add-container', { reuseRows: true })
    const second = { ...container, boxNub: 'TGHU7654321', sealNUb: 'SEAL-2' }

    const result = await fillContainerRows(document, [container, second], ctx)

    expect(result.rows).toBe(2)
    const rows = document.querySelectorAll('#container-table .el-table__body tbody tr')
    expect(rows).toHaveLength(2)
    // Dòng index 0 là dòng VỪA thêm (site luôn chèn ở index 0).
    expect(cellValue(rows[0]!, 0)).toBe('TGHU7654321')
    expect(cellValue(rows[0]!, 4)).toBe('SEAL-2')
    // Dòng cũ giữ nguyên dữ liệu của chính nó.
    expect(cellValue(rows[1]!, 0)).toBe('ONEU1437898')
    expect(cellValue(rows[1]!, 4)).toBe('CN28731BH')
  })

  it('không có nút 新增 của bảng container ⇒ báo MỘT lỗi cho cả lần điền', async () => {
    buildContainerSection({ noAddButton: true })
    const second = { ...container, boxNub: 'TGHU7654321' }

    const result = await fillContainerRows(document, [container, second], ctx)

    expect(result.rows).toBe(0)
    // Một lỗi duy nhất, không lặp lại y hệt cho từng dòng.
    expect(result.items.filter((i) => i.status === 'error')).toHaveLength(1)
    expect(result.items[0]?.note).toContain('Could not find the add-row button')
  })

  it('nút 新增 của bảng container bị disable ⇒ lỗi nói rõ nút bị disable', async () => {
    buildContainerSection({ disabledAddButton: true })

    const result = await fillContainerRows(document, [container], ctx)

    expect(result.rows).toBe(0)
    const error = result.items.find((i) => i.status === 'error')
    expect(error?.note).toContain('disabled')
    // Không được lẫn với nhánh "không tìm thấy nút 新增".
    expect(error?.note).not.toContain('Could not find')
  })

  it('dòng ghi được MỘT PHẦN rồi hỏng ⇒ vẫn tính là 1 dòng và nói rõ', async () => {
    // Dòng đã có field được ghi ⇒ dòng ĐÃ tồn tại trong bảng của site ⇒ phải
    // tính vào `rows` (nếu không, báo cáo nói 0 dòng trong khi bảng có dòng).
    buildContainerSection()
    simulateAddRow()
    const restore = breakValueSetter(2) // hỏng ở ô thứ 2 (尺寸), ô đầu đã ghi xong

    try {
      const result = await fillContainerRows(document, [container], ctx)

      expect(result.rows).toBe(1)
      const error = result.items.find((i) => i.status === 'error' && i.prop === 'ROW_1')
      expect(error?.note).toContain('1 field(s) had been written')
    } finally {
      restore()
    }
  })

  it('lỗi ghi một dòng không làm dừng các dòng sau', async () => {
    buildContainerSection()
    simulateAddRow()
    const second = { ...container, boxNub: 'TGHU7654321', sealNUb: 'SEAL-2' }
    const restore = breakValueSetter(1) // hỏng ngay ở ô đầu tiên của dòng 1

    try {
      const result = await fillContainerRows(document, [container, second], ctx)

      // Dòng 1 hỏng…
      expect(result.items.some((i) => i.row === 1 && i.status === 'error')).toBe(true)
      // …nhưng dòng 2 vẫn được điền đầy đủ.
      expect(result.items.filter((i) => i.row === 2 && i.status === 'ok').length).toBeGreaterThan(0)
      const rows = document.querySelectorAll('#container-table .el-table__body tbody tr')
      expect(cellValue(rows[0]!, 0)).toBe('TGHU7654321')
      expect(cellValue(rows[0]!, 4)).toBe('SEAL-2')
    } finally {
      restore()
    }
  })
})
