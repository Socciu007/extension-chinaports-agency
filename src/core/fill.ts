import { nextFrame, sleep, waitFor } from './wait'
import { readFieldValue, setFieldValue } from './dom'
import { mapCargo, mapContainer, mapHeader, type FieldPlan, type MappingContext } from './mapping'
import { findColumnIndex, getCell, readTableHandles, setCellValue } from './table'
import type { ManifestCargo, ManifestContainer, ManifestData } from './types'

export type FillStatus = 'ok' | 'skip' | 'error'

export interface FillItem {
  scope: 'header' | 'cargo' | 'container'
  prop: string
  label: string
  status: FillStatus
  note?: string
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

export function findButtonByText(text: string, root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, .el-button'))
  const exact = buttons.find((b) => (b.textContent ?? '').trim() === text)
  if (exact) return exact
  return buttons.find((b) => (b.textContent ?? '').trim().includes(text)) ?? null
}

/** Tìm phần tử chứa đúng tiêu đề section (phần tử sâu nhất). */
function findTitleElement(scope: ParentNode, title: string): HTMLElement | null {
  const needle = title.trim()
  const matches = Array.from(scope.querySelectorAll<HTMLElement>('*')).filter((el) => {
    const text = (el.textContent ?? '').trim()
    return text === needle || text.startsWith(needle)
  })
  if (matches.length === 0) return null
  return matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) ?? null
}

function findAddButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('button, .el-button')).filter((b) => {
    const text = (b.textContent ?? '').trim()
    return text === '新增' || text.endsWith('新增')
  })
}

/**
 * Tìm nút "新增" nằm trong section có tiêu đề `title` (ví dụ 货物信息).
 * Đi từ phần tử tiêu đề lên từng cấp cha; ở mỗi cấp lấy các nút 新增
 * chưa nằm trong section con sâu hơn đã chứa tiêu đề.
 */
export function findAddButtonBySectionTitle(
  scope: ParentNode,
  title: string,
): HTMLElement | null {
  const titleEl = findTitleElement(scope, title)
  if (!titleEl) return null

  let container: HTMLElement = titleEl
  let inner: HTMLElement | null = null

  for (let depth = 0; depth < 12; depth++) {
    const candidates = findAddButtons(container).filter((b) => !inner || !inner.contains(b))
    if (candidates.length > 0) return candidates[0]!
    inner = container
    const parent = container.parentElement
    if (!parent) break
    container = parent
  }

  return null
}

/** Tìm dialog có chứa field `prop` (dùng để phân biệt dialog hàng với dialog đầu). */
export function findDialogWithField(root: ParentNode, prop: string): HTMLElement | null {
  const dialogs = Array.from(root.querySelectorAll<HTMLElement>('.el-dialog'))
  for (let i = dialogs.length - 1; i >= 0; i--) {
    const dialog = dialogs[i]!
    if (dialog.querySelector(`input[id$="-${prop}"], textarea[id$="-${prop}"]`)) return dialog
  }
  return null
}

export type FillScope = 'header' | 'cargo' | 'container'

export async function fillPlans(
  root: ParentNode,
  plans: FieldPlan[],
  scope: FillScope = 'header',
): Promise<{ items: FillItem[] }> {
  const items: FillItem[] = []

  for (const plan of plans) {
    if (plan.status === 'skip') {
      items.push({
        scope,
        prop: plan.prop,
        label: plan.label,
        status: 'skip',
        note: plan.note,
      })
      await nextFrame()
      continue
    }

    const result = await setFieldValue(root, plan.prop, plan.value ?? '')
    if (!result.ok) {
      items.push({
        scope,
        prop: plan.prop,
        label: plan.label,
        status: 'error',
        note: result.reason,
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
          status: 'ok',
          note: plan.verify.note,
        })
        await nextFrame()
        continue
      }
    }

    items.push({ scope, prop: plan.prop, label: plan.label, status: 'ok' })
    await nextFrame()
  }

  return { items }
}

export async function fillHeader(root: ParentNode, plans: FieldPlan[]) {
  return fillPlans(root, plans, 'header')
}

/**
 * Tìm dialog đầu (form 舱单).
 *
 * Element Plus giữ lại dialog đã đóng trong DOM (chỉ ẩn đi), nên `.el-dialog`
 * ĐẦU TIÊN trong document có thể là dialog ẩn của một màn khác — lấy nó thì
 * mọi field đều "không tìm thấy" và lần điền im lặng thất bại. Ưu tiên dialog
 * có chứa field 提单号, fallback về dialog đang hiện, cuối cùng là dialog
 * cuối cùng trong DOM.
 */
export function findManifestDialog(root: ParentNode): HTMLElement | null {
  const byField = findDialogWithField(root, 'BILL_NBR')
  if (byField) return byField
  const dialogs = Array.from(root.querySelectorAll<HTMLElement>('.el-dialog'))
  const visible = dialogs.filter((d) => d.getClientRects().length > 0 || d.offsetParent !== null)
  return visible[visible.length - 1] ?? dialogs[dialogs.length - 1] ?? null
}

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

  log('Filling in the 舱单 information…')
  const header = await fillPlans(dialog, mapHeader(data, ctx), 'header')

  const cargo = await fillCargoRows(dialog, data.cdgoods ?? [], { log })
  const container = await fillContainerRows(dialog, data.cdCon ?? [], ctx, { log })

  if (options.autoSubmit) {
    const confirm = findButtonByText('确定', dialog)
    if (confirm) {
      log('Clicking 确定 in the header form…')
      confirm.click()
      await sleep(800)
    }
  }

  return {
    items: [...header.items, ...cargo.items, ...container.items],
    cargoRows: cargo.rows,
    containerRows: container.rows,
    ok: true,
  }
}

/** Thời gian chờ tối thiểu sau khi bấm 新增 của section hàng (site dùng setTimeout 400ms). */
const CARGO_DIALOG_DELAY_MS = 600

export async function fillCargoRows(
  scope: ParentNode,
  goodsList: ManifestCargo[],
  options: { log?: (message: string) => void } = {},
): Promise<{ items: FillItem[]; rows: number }> {
  const log = options.log ?? (() => {})
  const items: FillItem[] = []
  let rows = 0

  for (const [index, goods] of goodsList.entries()) {
    const label = `Cargo ${index + 1}/${goodsList.length}`

    const addButton = findAddButtonBySectionTitle(scope, '货物信息')
    if (!addButton) {
      items.push({
        scope: 'cargo',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'Could not find the "新增" button in the 货物信息 section',
      })
      continue
    }

    addButton.click()
    await sleep(CARGO_DIALOG_DELAY_MS)

    const dialog = await waitFor(() => findDialogWithField(document, 'E_CARGO_NAM'), {
      timeout: 5000,
      interval: 100,
      label: `cargo dialog ${index + 1}`,
    }).catch(() => null)

    if (!dialog) {
      items.push({
        scope: 'cargo',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'The cargo dialog did not open within 5 seconds',
      })
      continue
    }

    log(`Filling in ${label}…`)
    const filled = await fillPlans(dialog, mapCargo(goods), 'cargo')
    items.push(...filled.items)

    const confirm = findButtonByText('确定', dialog)
    if (confirm) {
      confirm.click()
      await sleep(CARGO_DIALOG_DELAY_MS)
      rows += 1
    } else {
      items.push({
        scope: 'cargo',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'Could not find the "确定" button in the cargo dialog',
      })
    }
  }

  return { items, rows }
}

const CONTAINER_SECTION_TITLES = ['箱信息', '集装箱信息', '集装箱']

/** Tìm bảng container trong scope (ưu tiên bảng nằm trong section container). */
function findContainerTable(scope: ParentNode): HTMLElement | null {
  const tables = Array.from(scope.querySelectorAll<HTMLElement>('.el-table, table'))
  for (const title of CONTAINER_SECTION_TITLES) {
    const titleEl = findTitleElement(scope, title)
    if (!titleEl) continue
    let node: HTMLElement | null = titleEl
    for (let depth = 0; depth < 12 && node; depth++) {
      const table = node.querySelector<HTMLElement>('.el-table, table')
      if (table) return table
      node = node.parentElement
    }
  }
  return tables[0] ?? null
}

export async function fillContainerRows(
  scope: ParentNode,
  containers: ManifestContainer[],
  ctx: MappingContext,
  options: { log?: (message: string) => void } = {},
): Promise<{ items: FillItem[]; rows: number }> {
  const log = options.log ?? (() => {})
  const items: FillItem[] = []
  let rows = 0

  const table = findContainerTable(scope)
  if (!table) {
    items.push({
      scope: 'container',
      prop: 'TABLE',
      label: 'Container table',
      status: 'error',
      note: 'Could not find the container table (.el-table)',
    })
    return { items, rows }
  }

  const addButton =
    CONTAINER_SECTION_TITLES.map((title) => findAddButtonBySectionTitle(scope, title)).find(
      (button) => button !== null,
    ) ?? null

  const handles = readTableHandles(table)

  for (const [index, container] of containers.entries()) {
    const label = `Container ${index + 1}/${containers.length}`
    const plans = mapContainer(container, ctx)

    if (!addButton) {
      items.push({
        scope: 'container',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'Could not find the add-row button of the container table',
      })
      continue
    }

    const before = readTableHandles(table).bodyRows.length
    addButton.click()

    const grown = await waitFor(
      () => readTableHandles(table).bodyRows.length > before,
      { timeout: 5000, interval: 100, label: `container row ${index + 1}` },
    ).catch(() => false)

    if (!grown) {
      items.push({
        scope: 'container',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'The container table did not accept a new row within 5 seconds',
      })
      continue
    }

    const rowsNow = readTableHandles(table).bodyRows
    const row = rowsNow[rowsNow.length - 1]!
    log(`Filling in ${label}…`)

    for (const plan of plans) {
      if (plan.status === 'skip') {
        items.push({
          scope: 'container',
          prop: plan.prop,
          label: plan.label,
          status: 'skip',
          note: plan.note,
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
          note: `Could not find the column "${columnLabel}" in the table`,
        })
        continue
      }

      const cell = getCell(row, columnIndex)
      if (!cell) {
        items.push({
          scope: 'container',
          prop: plan.prop,
          label: plan.label,
          status: 'error',
          note: `Could not find the cell of the column "${columnLabel}"`,
        })
        continue
      }

      const result = await setCellValue(cell, plan.value ?? '')
      items.push({
        scope: 'container',
        prop: plan.prop,
        label: plan.label,
        status: result.ok ? 'ok' : 'error',
        note: result.reason,
      })
      await nextFrame()
    }

    rows += 1
  }

  return { items, rows }
}
