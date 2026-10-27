import { nextFrame, sleep, waitFor } from './wait'
import { readFieldValue, setFieldValue } from './dom'
import { mapCargo, mapHeader, type FieldPlan, type MappingContext } from './mapping'
import type { ManifestCargo, ManifestData } from './types'

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

  const dialog = await waitFor(
    () => root.querySelector<HTMLElement>('.el-dialog'),
    { timeout: 5000, interval: 100, label: 'dialog 新增舱单信息' },
  ).catch(() => null)

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
  const header = await fillHeader(dialog, mapHeader(data, ctx))

  return {
    items: header.items,
    cargoRows: 0,
    containerRows: 0,
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
    } else {
      items.push({
        scope: 'cargo',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'Could not find the "确定" button in the cargo dialog',
      })
    }

    rows += 1
  }

  return { items, rows }
}
