import { nextFrame, waitFor } from './wait'
import { readFieldValue, setFieldValue } from './dom'
import { mapHeader, type FieldPlan, type MappingContext } from './mapping'
import type { ManifestData } from './types'

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

export async function fillHeader(
  root: ParentNode,
  plans: FieldPlan[],
): Promise<{ items: FillItem[] }> {
  const items: FillItem[] = []

  for (const plan of plans) {
    if (plan.status === 'skip') {
      items.push({
        scope: 'header',
        prop: plan.prop,
        label: plan.label,
        status: 'skip',
        note: plan.note,
      })
      continue
    }

    const result = await setFieldValue(root, plan.prop, plan.value ?? '')
    if (!result.ok) {
      items.push({
        scope: 'header',
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
          scope: 'header',
          prop: plan.prop,
          label: plan.label,
          status: 'ok',
          note: plan.verify.note,
        })
        await nextFrame()
        continue
      }
    }

    items.push({ scope: 'header', prop: plan.prop, label: plan.label, status: 'ok' })
    await nextFrame()
  }

  return { items }
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
