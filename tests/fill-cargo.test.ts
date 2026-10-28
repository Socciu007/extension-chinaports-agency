import { describe, it, expect, beforeEach } from 'vitest'
import { fillCargoRows, fillManifest, findAddButtonBySectionTitle } from '../src/core/fill'
import type { MappingContext } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'
import {
  buildCargoDialog,
  buildCargoSection,
  buildHeaderForm,
  cargoDialog,
  cargoDialogs,
  cargoFieldValue,
  cargoSaveClicks,
  cargoSelectValue,
  goodsListRowCount,
  selectedOptions,
} from './helpers/dom'

const data = fixture.data as unknown as ManifestData
const goods = data.cdgoods![0]!

const ctx: MappingContext = {
  findTrustCode: () => 'MAEU',
  findDrType: () => 'FOB',
  findPort: (code) => (code === 'CNSHA' ? '上海' : code === 'IDBLW' ? '勿拉湾' : undefined),
  findCntrType: () => undefined,
  findCntrSize: () => undefined,
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('findAddButtonBySectionTitle', () => {
  it('tìm nút 新增 trong section 货物信息', () => {
    buildCargoSection()
    const btn = findAddButtonBySectionTitle(document, '货物信息')
    expect(btn?.textContent?.trim()).toBe('新增')
  })

  it('trả null khi không có section', () => {
    document.body.innerHTML = '<div>không có gì</div>'
    expect(findAddButtonBySectionTitle(document, '货物信息')).toBeNull()
  })

  it('không bấm nhầm nút 新增 của section khác (货物信息 vs 箱信息)', () => {
    document.body.innerHTML = `
      <div class="CargoInformation">
        <div class="fs-crud-title">货物信息</div>
        <button class="el-button" id="add-cargo">新增</button>
      </div>
      <div class="ContainerInformation">
        <div class="fs-crud-title">箱信息</div>
        <button class="el-button" id="add-container">新增</button>
      </div>`

    const cargo = findAddButtonBySectionTitle(document, '货物信息')
    const container = findAddButtonBySectionTitle(document, '箱信息')

    expect(cargo?.id).toBe('add-cargo')
    expect(container?.id).toBe('add-container')
  })

  it('ưu tiên nút có text đúng 新增', () => {
    document.body.innerHTML = `
      <div class="CargoInformation">
        <div class="fs-crud-title">货物信息</div>
        <button class="el-button" id="add-more">新增货物信息</button>
        <button class="el-button" id="add-plain">新增</button>
      </div>`

    expect(findAddButtonBySectionTitle(document, '货物信息')?.id).toBe('add-plain')
  })

  it('tiêu đề section có hậu tố (货物信息 (2)) ⇒ vẫn tìm đúng nút trong section', () => {
    // Site có thể ghi kèm số lượng vào tiêu đề section ⇒ phải khớp theo
    // "bắt đầu bằng", nếu không sẽ không tìm thấy section nào.
    document.body.innerHTML = `
      <div class="CargoInformation">
        <div class="fs-crud-title">货物信息 (2)</div>
        <button class="el-button" id="add-cargo">新增</button>
      </div>
      <div class="ContainerInformation">
        <div class="fs-crud-title">箱信息</div>
        <button class="el-button" id="add-container">新增</button>
      </div>`

    expect(findAddButtonBySectionTitle(document, '货物信息')?.id).toBe('add-cargo')
    expect(findAddButtonBySectionTitle(document, '箱信息')?.id).toBe('add-container')
  })
})

describe('fillCargoRows', () => {
  it('mở dialog hàng mới, điền 24 field và bấm 保存', async () => {
    buildCargoSection()
    let addClicks = 0
    document.getElementById('add-cargo')!.addEventListener('click', () => {
      addClicks += 1
    })

    const result = await fillCargoRows(document, [goods])

    // Nút 新增 và nút 保存 đều phải được bấm.
    expect(addClicks).toBe(1)
    expect(cargoSaveClicks()).toBe(1)
    expect(result.rows).toBe(1)

    const dialog = cargoDialog(0)!
    expect(cargoFieldValue(dialog, 'E_CARGO_NAM')).toBe('SILENT DIESEL GENERATOR')
    expect(cargoFieldValue(dialog, 'CARGO_KIND_COD')).toBe('普货')
    // PIECE_NUM phải là số nguyên (site chỉ nhận /^\d*$/).
    expect(cargoFieldValue(dialog, 'PIECE_NUM')).toBe('114')
    // Site đã nhận dòng ⇒ bảng DANH SÁCH hàng có 1 dòng.
    expect(goodsListRowCount()).toBe(1)
  })

  it('rows = 0 khi dialog hàng không có nút 保存', async () => {
    buildCargoSection({ saveButton: false })

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(0)
    expect(result.items.some((i) => i.status === 'error' && i.note?.includes('保存'))).toBe(true)
  })

  it('dòng 2 rơi vào dialog MỚI, không ghi đè dialog của dòng 1', async () => {
    buildCargoSection()
    const second = { ...goods, name: 'SECOND GOODS' }

    const result = await fillCargoRows(document, [goods, second])

    expect(result.rows).toBe(2)
    expect(cargoDialogs()).toHaveLength(2)
    expect(cargoFieldValue(cargoDialog(0)!, 'E_CARGO_NAM')).toBe('SILENT DIESEL GENERATOR')
    expect(cargoFieldValue(cargoDialog(1)!, 'E_CARGO_NAM')).toBe('SECOND GOODS')
  })

  it('site từ chối lưu ⇒ rows = 0 và có cảnh báo nói rõ thiếu 包装类型', async () => {
    buildCargoSection({ rejectSave: true })

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(0)
    const warn = result.items.find((i) => i.status === 'warn')
    expect(warn?.note).toContain('the site did not accept the row')
    expect(warn?.note).toContain('PACKAGE_STR')
    expect(warn?.note).toContain('PACKAGE_COD')
  })

  it('ghi nhận lỗi khi không tìm thấy nút 新增', async () => {
    document.body.innerHTML = '<div></div>'
    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(0)
    expect(result.items.some((i) => i.status === 'error')).toBe(true)
  })

  it('bỏ qua field không có dữ liệu', async () => {
    buildCargoSection()

    const result = await fillCargoRows(document, [goods])
    const dang = result.items.find((i) => i.prop === 'DANG_EMS_NO')

    expect(dang?.status).toBe('skip')
  })

  it('mọi item của hàng mang số thứ tự dòng', async () => {
    buildCargoSection()
    const second = { ...goods, name: 'SECOND GOODS' }

    const result = await fillCargoRows(document, [goods, second])

    expect(result.items.filter((i) => i.row === 1).length).toBeGreaterThan(0)
    expect(result.items.filter((i) => i.row === 2).length).toBeGreaterThan(0)
  })

  it('item "ok" vẫn mang note để đối chiếu mã mà site lưu', async () => {
    buildCargoSection()

    const result = await fillCargoRows(document, [goods])
    const kind = result.items.find((i) => i.prop === 'CARGO_KIND_COD')

    expect(kind?.status).toBe('ok')
    expect(kind?.note).toContain('S')
  })

  it('không dùng dialog hàng đã có sẵn trước khi bấm 新增', async () => {
    // Dialog cũ đã nằm trong DOM trước khi bấm ⇒ phải bỏ qua, dùng dialog MỚI.
    // Fixture mở dialog sau 800ms (> CARGO_DIALOG_DELAY_MS 600ms) ⇒ nếu code
    // tra cứu dialog quá sớm thì nó chỉ thấy dialog CŨ ⇒ test này bắt được
    // đúng lỗi đó.
    buildCargoSection()
    const stale = buildCargoDialog()

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(1)
    expect(cargoFieldValue(stale, 'E_CARGO_NAM')).toBe('')
    expect(cargoFieldValue(cargoDialog(1)!, 'E_CARGO_NAM')).toBe('SILENT DIESEL GENERATOR')
  })

  it('site dựng lại dialog sau khi từ chối ⇒ KHÔNG được coi là đã lưu', async () => {
    // Site vừa từ chối lưu vừa dựng lại dialog (node cũ bị gỡ khỏi DOM) ⇒
    // "node cũ không còn trong DOM" KHÔNG phải bằng chứng dòng đã được lưu.
    buildCargoSection({ rejectSave: true, replaceDialogOnSave: true })

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(0)
    const warn = result.items.find((i) => i.status === 'warn')
    expect(warn?.note).toContain('the site did not accept the row')
  })

  it('không có bảng DANH SÁCH + site dựng lại dialog ⇒ cũng không được coi là đã lưu', async () => {
    // Không có bảng DANH SÁCH thì tín hiệu duy nhất là "dialog đã đóng" ⇒
    // phải hỏi dialog HIỆN TẠI (tra lại), không hỏi node đã bị detach.
    buildCargoSection({ goodsList: false, rejectSave: true, replaceDialogOnSave: true })

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(0)
    expect(result.items.some((i) => i.status === 'warn')).toBe(true)
  })

  it('site dựng lại nút 新增 sau khi lưu ⇒ dòng sau vẫn điền được', async () => {
    // Site dựng lại section ⇒ node nút 新增 cũ bị gỡ khỏi DOM ⇒ `click()` vào
    // node cũ là no-op ⇒ nếu code giữ node cũ thì mọi dòng từ thứ hai hỏng.
    buildCargoSection({ replaceAddButtonOnSave: true })
    const second = { ...goods, name: 'SECOND GOODS' }

    const result = await fillCargoRows(document, [goods, second])

    expect(result.rows).toBe(2)
    expect(cargoDialogs()).toHaveLength(2)
    expect(cargoFieldValue(cargoDialog(1)!, 'E_CARGO_NAM')).toBe('SECOND GOODS')
  })

  it('section 货物信息 không có nút 新增 ⇒ KHÔNG bấm nhầm nút 新增 của section 箱信息', async () => {
    document.body.innerHTML = `
      <div class="CargoInformation">
        <div class="fs-crud-title">货物信息</div>
      </div>
      <div class="ContainerInformation">
        <div class="fs-crud-title">箱信息</div>
        <button class="el-button" id="add-container">新增</button>
      </div>`
    let containerClicks = 0
    document.getElementById('add-container')!.addEventListener('click', () => {
      containerClicks += 1
    })

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(0)
    // Nút 新增 của section 箱信息 KHÔNG được bấm.
    expect(containerClicks).toBe(0)
    // Một lỗi duy nhất cho cả lần điền.
    expect(result.items.filter((i) => i.status === 'error')).toHaveLength(1)
  })

  it('không có nút 新增 của section 货物信息 ⇒ chỉ MỘT lỗi cho cả lần điền', async () => {
    document.body.innerHTML = '<div></div>'

    const result = await fillCargoRows(document, [goods, goods])

    expect(result.rows).toBe(0)
    expect(result.items.filter((i) => i.status === 'error')).toHaveLength(1)
  })

  it('site dùng lại MỘT element dialog cho mọi dòng ⇒ vẫn điền được dòng sau', async () => {
    // Biến thể khác của site: bấm 新增 thì site reset form của dialog sẵn có
    // thay vì mount dialog mới ⇒ không có node mới để tìm.
    buildCargoSection({ reuseDialog: true })
    const second = { ...goods, name: 'SECOND GOODS' }

    const result = await fillCargoRows(document, [goods, second])

    expect(result.rows).toBe(2)
    expect(cargoDialogs()).toHaveLength(1)
    // Dialog dùng lại chứa dữ liệu của dòng 2.
    expect(cargoFieldValue(cargoDialog(0)!, 'E_CARGO_NAM')).toBe('SECOND GOODS')
  })
})

/* ------------------------------------------------------------------ *
 *  Nút bị disable / option của el-select / bộ đếm click
 * ------------------------------------------------------------------ */

describe('fillCargoRows — nút bị disable', () => {
  it('nút 保存 bị disable ⇒ cảnh báo nói rõ cần chọn 包装类型/代码', async () => {
    // Site khoá nút lưu khi form chưa hợp lệ ⇒ phải phân biệt với nhánh
    // "không tìm thấy nút 保存" và đưa đúng gợi ý của B-13.
    buildCargoSection({ disabledSaveButton: true })

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(0)
    // Nút bị disable ⇒ KHÔNG được bấm.
    expect(cargoSaveClicks()).toBe(0)

    const warn = result.items.find((i) => i.status === 'warn')
    expect(warn?.note).toContain('disabled')
    expect(warn?.note).toContain('PACKAGE_STR')
    expect(warn?.note).toContain('PACKAGE_COD')
    // Không được lẫn với nhánh "không tìm thấy nút 保存"…
    expect(
      result.items.some((i) => i.note?.includes('Could not find the "保存" button')),
    ).toBe(false)
    // …hay với nhánh "đã bấm 保存 nhưng site từ chối".
    expect(warn?.note).not.toContain('the site did not accept the row')
  })

  it('nút 新增 của section 货物信息 bị disable ⇒ báo lỗi, không mở dialog hàng', async () => {
    document.body.innerHTML = `
      <div class="CargoInformation">
        <div class="fs-crud-title">货物信息</div>
        <button class="el-button" id="add-cargo" disabled>新增</button>
      </div>`

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(0)
    expect(cargoDialogs()).toHaveLength(0)
    const error = result.items.find((i) => i.status === 'error')
    expect(error?.note).toContain('disabled')
  })
})

describe('fillCargoRows — field el-select của hàng', () => {
  it('click option 普货 của 货物标识 và đọc lại được nhãn đang chọn', async () => {
    buildCargoSection()

    const result = await fillCargoRows(document, [goods])

    const kind = result.items.find((i) => i.prop === 'CARGO_KIND_COD')
    expect(kind?.status).toBe('ok')
    // Option THẬT đã bị click (không phải chỉ gõ chữ vào ô) ⇒ nhánh select của
    // adapter chạy đúng trên site.
    expect(selectedOptions()).toContain('普货')
    // Field đọc lại được nhãn đang chọn (el-select giữ nhãn, không giữ trong input).
    expect(cargoSelectValue(cargoDialog(0)!, 'CARGO_KIND_COD')).toBe('普货')
    expect(cargoFieldValue(cargoDialog(0)!, 'CARGO_KIND_COD')).toBe('普货')
  })
})

describe('bộ đếm click của fixture', () => {
  it('được đặt lại khi dựng fixture mới (không rò rỉ giữa các lần dựng)', async () => {
    buildCargoSection()
    await fillCargoRows(document, [goods])
    expect(cargoSaveClicks()).toBe(1)

    // Dựng lại fixture ⇒ bộ đếm phải về 0, không phải cộng dồn (2).
    document.body.innerHTML = ''
    buildCargoSection()
    await fillCargoRows(document, [goods])

    expect(cargoSaveClicks()).toBe(1)
  })
})

describe('fillCargoRows — bảng DANH SÁCH hàng', () => {
  it('không có bảng DANH SÁCH hàng ⇒ dialog đóng vẫn được coi là site đã nhận', async () => {
    // Site chỉ có bảng DANH SÁCH ở một số màn hình ⇒ tín hiệu nhận duy nhất là
    // dialog hàng đã đóng.
    buildCargoSection({ goodsList: false })

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(1)
    expect(result.items.some((i) => i.status === 'warn')).toBe(false)
  })
})

describe('fillCargoRows — cơ chế Element Plus: overlay, không phải .el-dialog', () => {
  it('site đóng dialog hàng bằng cách ẨN OVERLAY ⇒ coi là đã nhận dòng', async () => {
    // Element Plus đặt `v-show` trên `.el-overlay`, KHÔNG phải trên `.el-dialog`
    // ⇒ khi đóng, `.el-dialog` vẫn còn trong DOM và vẫn "hiện" (display khác
    // 'none'). Chỉ overlay bị ẩn. Đây là cơ chế thật của site ⇒ nhánh
    // `ownOverlay()` của `isHidden()` mới là nhánh quyết định "đã đóng".
    buildCargoSection({ goodsList: false })

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(1)
    expect(result.items.some((i) => i.status === 'warn')).toBe(false)

    // Cơ chế: overlay bị ẩn, còn `.el-dialog` thì KHÔNG bị ẩn.
    const dialog = cargoDialog(0)!
    expect(dialog.style.display).not.toBe('none')
    expect(dialog.closest<HTMLElement>('.el-overlay')?.style.display).toBe('none')
  })

  it('dialog hàng NẰM TRONG dialog đầu (không teleport) ⇒ đóng dialog đầu KHÔNG được coi là đã lưu', async () => {
    // Site không teleport ⇒ `.el-dialog` của hàng nằm thẳng trong
    // `.el-overlay-dialog` của dialog đầu, KHÔNG có overlay riêng. Khi overlay
    // của dialog đầu bị ẩn thì `closest('.el-overlay')` leo lên thấy overlay
    // CỦA CHA ⇒ nếu mượn overlay của cha thì dialog hàng bị coi là "đã đóng"
    // ⇒ báo thành công sai. Overlay cha chứa 2 `.el-dialog` ⇒ phải từ chối.
    buildHeaderForm({ nestedCargoDialog: true, goodsList: false })

    const result = await fillCargoRows(document, [goods])

    // Extension ĐÃ điền được dialog hàng…
    expect(cargoFieldValue(cargoDialog(0)!, 'E_CARGO_NAM')).toBe('SILENT DIESEL GENERATOR')
    // …nhưng KHÔNG được tính là site đã nhận dòng.
    expect(result.rows).toBe(0)
    const warn = result.items.find((i) => i.status === 'warn')
    expect(warn).toBeTruthy()
    // "Chưa xác nhận được" — KHÔNG phải "site đã từ chối" (khác hẳn nhánh
    // validate fail, ở đó bảng danh sách vẫn còn và số dòng không tăng).
    expect(warn?.note).toContain('did not confirm')
  })
})

describe('fillCargoRows — site dựng lại section', () => {
  it('site dựng lại CẢ SECTION 货物信息 sau khi lưu ⇒ dòng sau vẫn điền được', async () => {
    // Site dựng lại section ⇒ node nút 新增 cũ bị gỡ khỏi DOM (click trên
    // node đó là no-op) và cả bảng DANH SÁCH cũ bị thay ⇒ mọi node bắt trước
    // khi bấm 新增 đều chết.
    buildCargoSection({ replaceSectionOnSave: true })
    const second = { ...goods, name: 'SECOND GOODS' }

    const result = await fillCargoRows(document, [goods, second])

    expect(result.rows).toBe(2)
    expect(cargoDialogs()).toHaveLength(2)
    // Dòng 2 nằm đúng ở dialog thứ hai, đúng giá trị.
    expect(cargoFieldValue(cargoDialog(1)!, 'E_CARGO_NAM')).toBe('SECOND GOODS')
  })
})

describe('fillManifest — site từ chối lưu dòng hàng', () => {
  it('cảnh báo đi tới báo cáo cuối, cargoRows = 0 và ok = false', async () => {
    buildHeaderForm({ rejectCargoSave: true })

    const report = await fillManifest({ data, ctx, root: document })

    const warn = report.items.find((i) => i.status === 'warn' && i.scope === 'cargo')
    expect(warn?.note).toContain('the site did not accept the row')
    expect(warn?.note).toContain('PACKAGE_STR')
    // Dòng hàng KHÔNG được tính là đã ghi.
    expect(report.cargoRows).toBe(0)
    // Không được báo thành công.
    expect(report.ok).toBe(false)
  })
})
