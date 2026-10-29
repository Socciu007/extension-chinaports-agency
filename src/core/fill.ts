/**
 * Biết ĐIỀN GÌ và ĐIỀU PHỐI việc điền.
 *
 * Module này quyết định điền field nào, điền theo thứ tự nào (mở dialog → điền →
 * báo cáo) và trả về báo cáo cho người dùng. Từ vựng DOM của site (tìm section,
 * nút, bảng, dialog…) nằm ở `site.ts`.
 */
import { nextFrame, sleep, waitFor } from './wait'
import { readFieldValue, setFieldValue } from './dom'
import { mapCargo, mapContainer, mapHeader, type FieldPlan, type MappingContext } from './mapping'
import type { FillScope } from './protocol'
import {
  countGoodsListRows,
  currentCargoDialog,
  findAddButtonBySectionTitle,
  findButtonByText,
  findContainerAddButton,
  findContainerTable,
  findManifestDialog,
  findNewCargoDialog,
  findReusedCargoDialog,
  findTableBySectionTitle,
  findVisibleCargoDialog,
  isDisabled,
  isHidden,
  isReusableCargoDialog,
  snapshotDialogs,
  snapshotHiddenDialogs,
} from './site'
import { findColumnIndex, getCell, readTableHandles, setCellValue } from './table'
import type { ManifestCargo, ManifestContainer, ManifestData } from './types'

/**
 * Trạng thái của một field trong báo cáo:
 * - `ok`    ✅ đã ghi giá trị thành công;
 * - `warn`  ⚠️ muốn ghi nhưng chưa được (field không có trên trang, option không
 *            tồn tại, site không nhận dữ liệu…) — người dùng phải xử lý;
 * - `error` ❌ ghi giá trị hỏng, hoặc một bước cấu trúc hỏng (dialog không mở…);
 * - `skip`  ⏭ không có dữ liệu nguồn nên cố ý để trống.
 */
export type FillStatus = 'ok' | 'warn' | 'error' | 'skip'

export interface FillItem {
  scope: FillScope
  prop: string
  label: string
  status: FillStatus
  /**
   * Số thứ tự dòng (1-based) của item — bắt buộc vì nhiều dòng dùng chung
   * một bộ prop (24 prop của hàng, 9 prop của container).
   */
  row?: number
  note?: string
  /**
   * site BẮT BUỘC có field này — bỏ trống thì manifest không submit được.
   * `skip` ở field bắt buộc ⇒ `ok` của cả lần điền là `false`.
   */
  required?: boolean
}

export interface FillReport {
  items: FillItem[]
  cargoRows: number
  containerRows: number
  ok: boolean
  message?: string
}

export interface FillOptions {
  root: ParentNode
  data: ManifestData
  ctx: MappingContext
  autoSubmit?: boolean
  log?: (message: string) => void
}

/* ------------------------------------------------------------------ *
 *  Điền field
 * ------------------------------------------------------------------ */

export async function fillPlans(
  root: ParentNode,
  plans: FieldPlan[],
  scope: FillScope = 'header',
  options: { row?: number } = {},
): Promise<{ items: FillItem[] }> {
  const items: FillItem[] = []
  const row = options.row

  for (const plan of plans) {
    if (plan.status === 'skip') {
      items.push({
        scope,
        prop: plan.prop,
        label: plan.label,
        status: 'skip',
        row,
        note: plan.note,
        required: plan.required,
      })
      // Nhánh skip không đụng DOM ⇒ không cần chờ frame (17/24 plan của hàng là skip).
      continue
    }

    const result = await setFieldValue(root, plan.prop, plan.value ?? '', {
      matchValue: plan.matchValue,
    })
    if (!result.ok) {
      items.push({
        scope,
        prop: plan.prop,
        label: plan.label,
        // Không tìm thấy field / không có option → cảnh báo, người dùng tự xử lý.
        // Chỉ lỗi ghi giá trị (strategy 'text') mới là lỗi thật.
        status: result.strategy === 'text' ? 'error' : 'warn',
        row,
        note: result.reason,
        required: plan.required,
      })
      await nextFrame()
      continue
    }

    if (plan.verify) {
      const actual = readFieldValue(root, plan.verify.prop)
      if (!actual) {
        items.push({
          scope,
          prop: plan.prop,
          label: plan.label,
          status: 'warn',
          row,
          note: plan.verify.note,
          required: plan.required,
        })
        await nextFrame()
        continue
      }
    }

    // `ok` cũng mang note: ví dụ "The site stores the code \"P\" for \"预付\"" để
    // người dùng đối chiếu mã mà site lưu.
    items.push({
      scope,
      prop: plan.prop,
      label: plan.label,
      status: 'ok',
      row,
      note: plan.note,
      required: plan.required,
    })
    await nextFrame()
  }

  return { items }
}

export async function fillHeader(root: ParentNode, plans: FieldPlan[]) {
  return fillPlans(root, plans, 'header')
}

/* ------------------------------------------------------------------ *
 *  Dòng hàng (dialog 货物信息)
 * ------------------------------------------------------------------ */

/** Thời gian chờ tối thiểu sau khi bấm 新增 của section hàng (site dùng setTimeout 400ms). */
const CARGO_DIALOG_DELAY_MS = 600

/** Thời gian chờ POST `/cargo/add/` land trước khi mở dòng hàng tiếp theo. */
const CARGO_COMMIT_DELAY_MS = 800

/** Thời gian chờ site chấp nhận (hoặc từ chối) dòng hàng sau khi bấm 保存. */
const CARGO_SAVE_TIMEOUT_MS = 3000

/** Thời gian chờ dialog đầu đóng lại sau khi bấm 确定 (auto-submit). */
const HEADER_SUBMIT_TIMEOUT_MS = 3000

/**
 * Kết quả hỏi "site đã nhận dòng hàng chưa".
 *
 * - `accepted` — site đã nhận (bảng DANH SÁCH có dòng mới, hoặc không có bảng
 *   DANH SÁCH mà dialog đã đóng).
 * - `refused`  — site đã TỪ CHỐI: còn bảng DANH SÁCH mà số dòng không tăng và
 *   site VẪN GIỮ dialog hàng mở (validate fail ⇒ cần người dùng chọn
 *   包装类型/代码 rồi lưu lại).
 * - `timeout`  — KHÔNG xác nhận được trong `CARGO_SAVE_TIMEOUT_MS` (mạng chậm,
 *   bảng chưa render lại…). TUYỆT ĐỐI không nói "site từ chối" ở nhánh này:
 *   dòng có thể ĐÃ được lưu ⇒ bảo người dùng nhập lại là tạo dòng TRÙNG.
 */
type CargoAcceptance = 'accepted' | 'refused' | 'timeout'

/**
 * Site có thật sự nhận dòng hàng không?
 *
 * Với loại hàng `S` thì PACKAGE_STR và PACKAGE_COD là field **bắt buộc** mà API
 * không có ⇒ site validate fail (请填必填表格) và **không** POST ⇒ dòng hàng
 * không được lưu. Dấu hiệu nhận biết: bảng danh sách không có dòng mới.
 *
 * Nếu site CÓ bảng DANH SÁCH hàng ⇒ đó là tiêu chí DUY NHẤT. "Dialog đóng"
 * không đủ: node dialog có thể bị Vue gỡ khỏi DOM khi site dựng lại nó sau khi
 * từ chối lưu (B-13) — lúc đó coi như "đã lưu" là báo thành công sai.
 *
 * `captured` là node dialog mà extension vừa điền — chỉ dùng làm DỰ PHÒNG khi
 * trong DOM không còn dialog nào; không dùng nó làm tiêu chí chính vì node đó
 * có thể đã bị detach (xem `isHidden`).
 */
async function waitForCargoRowAccepted(
  scope: ParentNode,
  rowsBefore: number,
  captured: HTMLElement | null = null,
): Promise<CargoAcceptance> {
  const hasGoodsList = findTableBySectionTitle(scope, '货物信息') !== null

  const accepted = await waitFor(
    () => {
      if (hasGoodsList) return countGoodsListRows(scope) > rowsBefore
      // Không có bảng DANH SÁCH ⇒ chỉ còn cách hỏi dialog hiện tại.
      // PHẢI tra lại (node cũ có thể đã bị site gỡ khỏi DOM) rồi mới hỏi nó.
      const current = currentCargoDialog() ?? captured
      if (!current) return true
      return isHidden(current)
    },
    { timeout: CARGO_SAVE_TIMEOUT_MS, interval: 100, label: 'cargo row accepted' },
  ).catch(() => false)

  if (accepted) return 'accepted'

  // Hết giờ chờ mà vẫn chưa xác nhận được.
  if (hasGoodsList) {
    // Site còn GIỮ dialog hàng mở ⇒ site đã từ chối (validate fail), không
    // phải chậm mạng: nhắc đúng cần chọn 包装类型/代码.
    const current = currentCargoDialog() ?? captured
    if (current && !isHidden(current)) return 'refused'
  }
  // Còn lại (bảng chưa render lại, dialog đã đóng nhưng list chưa có dòng):
  // KHÔNG xác nhận được ⇒ nói "chưa xác nhận được", không nói "site từ chối".
  return 'timeout'
}

export async function fillCargoRows(
  scope: ParentNode,
  goodsList: ManifestCargo[],
  options: { log?: (message: string) => void } = {},
): Promise<{ items: FillItem[]; rows: number }> {
  const log = options.log ?? (() => {})
  const items: FillItem[] = []
  let rows = 0

  // Không có dòng nào để điền ⇒ không cần tìm nút 新增, không báo lỗi gì cả.
  if (goodsList.length === 0) return { items, rows }

  // Nút 新增 của section 货物信息.
  //
  // Site có thể DỰNG LẠI section sau mỗi lần lưu ⇒ node nút cũ bị gỡ khỏi DOM
  // và `click()` trên node đó là no-op ⇒ phải tra lại nút ở MỔI dòng.
  const resolveAddButton = (): HTMLElement | null =>
    findAddButtonBySectionTitle(scope, '货物信息')

  // Node dialog đã dùng cho dòng trước — dùng lại được khi site DÙNG LẠI một
  // element cho mọi dòng (lúc đó không có node mới nào xuất hiện).
  let lastDialog: HTMLElement | null = null

  // Không có nút 新增 ⇒ báo MỘT lỗi cho cả lần điền (không lặp lại theo dòng).
  if (!resolveAddButton()) {
    items.push({
      scope: 'cargo',
      prop: 'ADD_BUTTON',
      label: 'Cargo rows',
      status: 'error',
      note: 'Could not find the "新增" button in the 货物信息 section',
    })
    return { items, rows }
  }

  for (const [index, goods] of goodsList.entries()) {
    const rowNo = index + 1
    const label = `Cargo ${rowNo}/${goodsList.length}`

    try {
      // Chụp lại các dialog TRƯỚC khi bấm 新增: Element Plus giữ dialog cũ trong
      // DOM ⇒ không có snapshot thì dòng 2 sẽ bị ghi vào dialog của dòng 1.
      const before = snapshotDialogs()
      // Các dialog đang ẩn lúc này: dùng để nhận ra ca "site dùng lại element
      // đã mount sẵn" (trước đó ẩn, giờ hiện) mà không đụng vào dialog đã hiện
      // sẵn (dialog của dòng trước / do người dùng tự mở).
      const beforeHidden = snapshotHiddenDialogs()

      // Tra lại nút ở MỖI dòng: node đã bị site dựng lại thì click là no-op.
      const addButton = resolveAddButton()
      if (!addButton) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'Could not find the "新增" button in the 货物信息 section',
        })
        continue
      }
      if (isDisabled(addButton)) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'The "新增" button of the 货物信息 section is disabled',
        })
        continue
      }
      addButton.click()
      await sleep(CARGO_DIALOG_DELAY_MS)

      let dialog = await waitFor(
        () => {
          // 1) Node MỚI: site mount dialog mới cho dòng này.
          const fresh = findNewCargoDialog(before)
          if (fresh) return fresh
          // 2) Site DÙNG LẠI một element dialog cho mọi dòng: node của dòng
          //    trước vẫn còn trong DOM, đang hiện và form đã được site reset.
          if (isReusableCargoDialog(lastDialog)) return lastDialog
          // 3) Site dùng lại một element ĐÃ MOUNT SẴN (trước đó ẩn, giờ site
          //    hiện lại) ⇒ không có node mới nào để tìm. Chỉ nhận dialog trước
          //    đây đang ẩn: dialog đã hiện sẵn là dialog của dòng trước hoặc do
          //    người dùng tự mở ⇒ không được ghi đè.
          const reused = findReusedCargoDialog(beforeHidden)
          if (reused) return reused
          return null
        },
        {
          timeout: 5000,
          interval: 100,
          label: `cargo dialog ${rowNo}`,
        },
      ).catch(() => null)

      if (!dialog) {
        // Hết thời gian mà vẫn không có node mới ⇒ site dùng lại một element
        // dialog. Dự phòng chỉ dùng được dialog đang hiện mà form TRỐNG.
        dialog = findVisibleCargoDialog()
      }
      if (dialog) lastDialog = dialog

      if (!dialog) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'The cargo dialog did not open within 5 seconds',
        })
        continue
      }

      log(`Filling in ${label}…`)
      const filled = await fillPlans(dialog, mapCargo(goods), 'cargo', { row: rowNo })
      items.push(...filled.items)

      // Site có thể thay element dialog NGAY TRONG LÚC đang điền (Vue thay vì
      // patch) ⇒ node đang ghi đã rời DOM ⇒ mọi field ghi vào đó là field
      // "ok" trên một node chết ⇒ bấm 保存 vào node đó là vô nghĩa.
      if (!dialog.isConnected) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note:
            'The cargo dialog was replaced by the site while it was being filled — ' +
            'the row was not saved, please fill it in on the page',
        })
        continue
      }

      const written = filled.items.filter((i) => i.status === 'ok').length
      if (written === 0) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'No field of this row could be filled',
        })
        continue
      }

      // Nút lưu của dialog hàng là 保存 (không phải 确定).
      const save = findButtonByText('保存', dialog)
      if (!save) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'Could not find the "保存" button in the cargo dialog',
        })
        continue
      }

      if (isDisabled(save)) {
        // Site khoá nút lưu khi form chưa hợp lệ — 包装类型/代码 bị bỏ trống
        // nên đây là trạng thái có thật trên site, phải nói rõ để người dùng
        // biết cần làm gì (cùng gợi ý với B-13).
        //
        // Khác với nhánh "site từ chối" (bấm 保存 xong mà site không nhận):
        // ở đây nút lưu **bị khoá** ⇒ chưa có gì được gửi đi.
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'warn',
          note:
            'the "保存" button of the cargo dialog is disabled — the site requires ' +
            '包装类型/代码 (PACKAGE_STR / PACKAGE_COD) before it accepts the row; ' +
            'please choose them on the page and save again',
        })
        continue
      }

      const goodsRowsBefore = countGoodsListRows(scope)
      save.click()

      // Site có thật sự nhận dòng không? (B-13)
      const acceptance = await waitForCargoRowAccepted(scope, goodsRowsBefore, dialog)
      if (acceptance !== 'accepted') {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'warn',
          // "Site từ chối" và "chưa xác nhận được" là HAI câu khác nhau:
          // nói nhầm "site từ chối" khi dòng đã lưu được sẽ khiến người dùng
          // nhập lại ⇒ dòng hàng TRÙNG trong manifest.
          note:
            acceptance === 'refused'
              ? 'the site did not accept the row — it requires 包装类型/代码 ' +
                '(PACKAGE_STR / PACKAGE_COD), please choose them on the page and save again'
              : `the site did not confirm the row within ${
                  Math.round(CARGO_SAVE_TIMEOUT_MS / 1000)
                } s — please check the 货物信息 list before entering it again`,
        })
        continue
      }

      rows += 1

      // POST /cargo/add/ phải land trước khi mở dòng tiếp theo (B-2).
      await sleep(CARGO_COMMIT_DELAY_MS)
    } catch (e) {
      // Một dòng hỏng không được làm hỏng các dòng còn lại (B-8).
      items.push({
        scope: 'cargo',
        prop: `ROW_${rowNo}`,
        label,
        row: rowNo,
        status: 'error',
        note: `Row ${rowNo} failed: ${(e as Error).message}`,
      })
    }
  }

  return { items, rows }
}

/* ------------------------------------------------------------------ *
 *  Dòng container (bảng inline editable 箱信息)
 * ------------------------------------------------------------------ */

export async function fillContainerRows(
  scope: ParentNode,
  containers: ManifestContainer[],
  ctx: MappingContext,
  options: { log?: (message: string) => void } = {},
): Promise<{ items: FillItem[]; rows: number }> {
  const log = options.log ?? (() => {})
  const items: FillItem[] = []
  let rows = 0

  // Không có container nào để điền ⇒ không cần tìm bảng, không báo lỗi gì cả.
  if (containers.length === 0) return { items, rows }

  // Bảng container + nút 新增: nếu thiếu thì KHÔNG dòng nào điền được ⇒ báo
  // MỘT lỗi cho cả lần điền, không lặp lại N lỗi giống nhau theo từng dòng.
  const firstTable = findContainerTable(scope)
  if (!firstTable) {
    items.push({
      scope: 'container',
      prop: 'TABLE',
      label: 'Container table',
      status: 'error',
      note: 'Could not find the container table',
    })
    return { items, rows }
  }
  const firstAddButton = findContainerAddButton(scope, firstTable)
  if (!firstAddButton) {
    items.push({
      scope: 'container',
      prop: 'ADD_BUTTON',
      label: 'Container rows',
      status: 'error',
      note: 'Could not find the add-row button of the container table',
    })
    return { items, rows }
  }
  if (isDisabled(firstAddButton)) {
    items.push({
      scope: 'container',
      prop: 'ADD_BUTTON',
      label: 'Container rows',
      status: 'error',
      note: 'The add-row button of the container table is disabled',
    })
    return { items, rows }
  }

  for (const [index, container] of containers.entries()) {
    const rowNo = index + 1
    const label = `Container ${rowNo}/${containers.length}`
    const plans = mapContainer(container, ctx)

    // Số field đã ghi được của dòng — nằm NGOÀI try để `catch` cũng thấy
    // (một dòng gì được một phần vẫn là dòng đã tồn tại trong bảng).
    let written = 0

    try {
      // Element Plus render lại bảng khi data đổi ⇒ phải tra lại bảng và đọc lại
      // header ở MỖI dòng, không giữ handle cũ (B-6).
      const table = findContainerTable(scope)
      if (!table) {
        items.push({
          scope: 'container',
          prop: 'TABLE',
          label: 'Container table',
          status: 'error',
          note: 'Could not find the container table',
        })
        break
      }

      const addButton = findContainerAddButton(scope, table)
      if (!addButton) {
        // Bảng bị site thay thế và bảng mới không có nút 新增 ⇒ dừng luôn, báo
        // MỘT lỗi (không lặp lại y hệt cho từng dòng còn lại).
        items.push({
          scope: 'container',
          prop: 'ADD_BUTTON',
          label: 'Container rows',
          status: 'error',
          note: 'Could not find the add-row button of the container table',
        })
        break
      }
      if (isDisabled(addButton)) {
        items.push({
          scope: 'container',
          prop: 'ADD_BUTTON',
          label: 'Container rows',
          status: 'error',
          note: 'The add-row button of the container table is disabled',
        })
        break
      }

      // Chụp lại số dòng TRƯỚC khi bấm: site chèn dòng mới ở index 0
      // (`insertTableRow(0, {})`) ⇒ dòng mới KHÔNG phải dòng cuối (B-5/D-2).
      const beforeCount = readTableHandles(table).bodyRows.length
      addButton.click()

      /**
       * Dòng mới LUÔN ở index 0.
       *
       * KHÔNG được nhận diện bằng "node không nằm trong ảnh chụp trước": nếu
       * `el-table` không có `row-key` thì key của dòng là INDEX của nó ⇒ Vue
       * TÁI SỬ DỤNG node `<tr>` #0 cho dòng mới và chỉ mount node mới cho dòng
       * cũ cuối ⇒ "node mới" là dòng CUỐI, tức dòng cũ ⇒ ghi đè dòng trước.
       *
       * Bảng được cache theo dòng (tra cứu section rất tốn trên dialog thật);
       * nếu bảng bị site thay thế thì cache tự động bị bỏ.
       */
      let cachedTable: HTMLElement | null = table
      const resolveTable = (): HTMLElement | null => {
        if (cachedTable?.isConnected) return cachedTable
        cachedTable = findContainerTable(scope)
        return cachedTable
      }

      /** Dòng mới = dòng ĐẦU TIÊN của bảng (dòng site vừa chèn ở index 0). */
      const resolveNewRow = (): HTMLElement | null => {
        const current = resolveTable()
        if (!current) return null
        const rows = readTableHandles(current).bodyRows
        // Dòng mới ⇔ bảng dài thêm MỘT dòng.
        //
        // KHÔNG dò "node mới": `el-table` không có `row-key` thì key của dòng là
        // INDEX của nó ⇒ Vue tái sử dụng node `<tr>` #0 cho dòng mới và chỉ mount
        // node mới cho dòng cũ cuối ⇒ "node mới" là dòng CUỐI, tức dòng cũ ⇒
        // ghi đè dòng trước.
        //
        // Số dòng KHÔNG tăng ⇒ site chưa thêm dòng nào ⇒ không có dòng mới để
        // điền. Kể cả khi node ở index 0 trông "lạ" (site vừa dựng lại cả
        // bảng): lúc đó index 0 là dòng CŨ được render lại ⇒ ghi vào đó là ghi
        // đè dòng đã có.
        return rows.length > beforeCount ? rows[0] ?? null : null
      }

      const newRow = await waitFor(resolveNewRow, {
        timeout: 5000,
        interval: 100,
        label: `container row ${rowNo}`,
      }).catch(() => null)

      if (!newRow) {
        items.push({
          scope: 'container',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'The container table did not accept a new row within 5 seconds',
        })
        continue
      }

      log(`Filling in ${label}…`)
      const handles = readTableHandles(resolveTable() ?? table)

      for (const plan of plans) {
        if (plan.status === 'skip') {
          items.push({
            scope: 'container',
            prop: plan.prop,
            label: plan.label,
            status: 'skip',
            row: rowNo,
            note: plan.note,
            required: plan.required,
          })
          continue
        }

        const columnLabel = plan.columnLabel ?? plan.label
        const columnIndex = findColumnIndex(handles.headerCells, columnLabel)
        if (columnIndex < 0) {
          items.push({
            scope: 'container',
            prop: plan.prop,
            label: plan.label,
            status: 'error',
            row: rowNo,
            note: `Could not find the column "${columnLabel}" in the table`,
            required: plan.required,
          })
          continue
        }

        // Element Plus có thể dựng lại `<tr>` khi model đổi ⇒ tra lại dòng mới ở
        // MỖI field, không dùng node đã bị detach.
        const cell = getCell(resolveNewRow() ?? newRow, columnIndex)
        if (!cell) {
          items.push({
            scope: 'container',
            prop: plan.prop,
            label: plan.label,
            status: 'error',
            row: rowNo,
            note: `Could not find the cell of the column "${columnLabel}"`,
            required: plan.required,
          })
          continue
        }

        const result = await setCellValue(cell, plan.value ?? '')
        if (result.ok) written += 1
        items.push({
          scope: 'container',
          prop: plan.prop,
          label: plan.label,
          status: result.ok ? 'ok' : 'error',
          row: rowNo,
          // `ok` cũng mang note (ví dụ mã mà site lưu cho 货主箱标志).
          note: result.ok ? plan.note : result.reason,
          required: plan.required,
        })
        await nextFrame()
      }

      // Chỉ tính dòng khi ít nhất một field của dòng đó thật sự được ghi (B-7).
      if (written === 0) {
        items.push({
          scope: 'container',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'No field of this row could be filled',
        })
        continue
      }

      rows += 1
    } catch (e) {
      // Một dòng hỏng không được làm hỏng các dòng còn lại (B-8).
      //
      // Dòng đã ghi được MỘT PHẦN thì dòng ĐÃ tồn tại trong bảng ⇒ vẫn tính
      // vào `rows` (B-7) và phải nói rõ là ghi được một phần.
      if (written > 0) rows += 1
      items.push({
        scope: 'container',
        prop: `ROW_${rowNo}`,
        label,
        row: rowNo,
        status: 'error',
        note:
          written > 0
            ? `Row ${rowNo} failed after ${written} field(s) had been written: ${(e as Error).message}`
            : `Row ${rowNo} failed: ${(e as Error).message}`,
      })
    }
  }

  return { items, rows }
}

/* ------------------------------------------------------------------ *
 *  Luồng tổng thể
 * ------------------------------------------------------------------ */

export async function fillManifest(options: FillOptions): Promise<FillReport> {
  const { root, data, ctx } = options
  const log = options.log ?? (() => {})

  const addButton = findButtonByText('新增舱单信息', root)
  if (!addButton) {
    return {
      items: [],
      cargoRows: 0,
      containerRows: 0,
      ok: false,
      message:
        'Could not find the "新增舱单信息" button — open the 预配舱单申报平台 page and select the 待发送 tab.',
    }
  }

  if (isDisabled(addButton)) {
    return {
      items: [],
      cargoRows: 0,
      containerRows: 0,
      ok: false,
      message:
        'The "新增舱单信息" button is disabled — open the 预配舱单申报平台 page and select the 待发送 tab.',
    }
  }

  addButton.click()

  const dialog = await waitFor(() => findManifestDialog(root), {
    timeout: 5000,
    interval: 100,
    label: 'dialog 新增舱单信息',
  }).catch(() => null)

  if (!dialog) {
    return {
      items: [],
      cargoRows: 0,
      containerRows: 0,
      ok: false,
      message: 'The "新增舱单信息" dialog did not open within 5 seconds.',
    }
  }

  // Vue render bất đồng bộ: handler "新增" của site thường reset lại model của
  // form — cho nó một frame để flush trước khi bắt đầu điền field đầu tiên.
  await nextFrame()

  log('Filling in the manifest information…')
  const header = await fillPlans(dialog, mapHeader(data, ctx), 'header')

  const cargo = await fillCargoRows(dialog, data.cdgoods ?? [], { log })
  const container = await fillContainerRows(dialog, data.cdCon ?? [], ctx, { log })

  const items = [...header.items, ...cargo.items, ...container.items]

  if (options.autoSubmit) {
    const confirm = findButtonByText('确定', dialog)
    if (!confirm) {
      // Không có nút ⇒ không có gì được submit ⇒ tuyệt đối không báo thành công.
      items.push({
        scope: 'header',
        prop: 'SUBMIT',
        label: 'Submit the manifest',
        status: 'warn',
        note:
          'Could not find the "确定" button in the manifest dialog — the form was not ' +
          'submitted, please submit it by hand on the page',
      })
    } else if (isDisabled(confirm)) {
      items.push({
        scope: 'header',
        prop: 'SUBMIT',
        label: 'Submit the manifest',
        status: 'warn',
        note:
          'The "确定" button of the manifest dialog is disabled — the form was not ' +
          'submitted, please submit it by hand on the page',
      })
    } else {
      log('Clicking 确定 in the header form…')
      confirm.click()
      // Site có thật sự nhận form không? (B-15) — 尺寸/箱型/箱状态 bị bỏ trống
      // nên site từ chối ⇒ dialog vẫn mở ⇒ KHÔNG được báo thành công.
      //
      // Tra lại dialog HIỆN TẠI: nếu site dựng lại dialog sau khi từ chối thì
      // node đã bắt bị gỡ khỏi DOM — hỏi node đó là hỏi sai đối tượng.
      const closed = await waitFor(
        () => {
          const current = findManifestDialog(root)
          if (!current) return true
          return isHidden(current)
        },
        {
          timeout: HEADER_SUBMIT_TIMEOUT_MS,
          interval: 100,
          label: 'manifest dialog closed',
        },
      )
        .then(() => true)
        .catch(() => false)

      if (!closed) {
        items.push({
          scope: 'header',
          prop: 'SUBMIT',
          label: 'Submit the manifest',
          status: 'warn',
          note:
            'the site did not accept the form — the container rows still require ' +
            '尺寸 / 箱型 / 箱状态',
        })
      }
    }
  }

  return {
    items,
    cargoRows: cargo.rows,
    containerRows: container.rows,
    // `ok` = mọi thứ định ghi đều đã ghi được; `warn`/`error` đều cần người dùng xử lý.
    //
    // `skip` chỉ được coi là ổn khi site KHÔNG bắt buộc field đó.
    // Field site bắt buộc mà API không có (包装类型/代码, 尺寸, 箱型, 箱状态…)
    // ⇒ manifest không thể submit ⇒ `ok` phải là false.
    ok: items.every(
      (i) => i.status === 'ok' || (i.status === 'skip' && !i.required),
    ),
  }
}
