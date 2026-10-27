import { nextFrame, sleep, waitFor } from './wait'
import type { SetResult } from './dom'

const OPTION_SELECTORS = [
  '.el-select-dropdown__item',
  '.el-cascader-node',
  '[role="option"]',
  '.el-popper li',
].join(',')

function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 || el.offsetParent !== null
}

/** Tìm option khớp `value` bên trong `container`. Ưu tiên khớp chính xác. */
export function findOptionIn(container: ParentNode, value: string): HTMLElement | null {
  const all = Array.from(container.querySelectorAll<HTMLElement>(OPTION_SELECTORS))
  const visible = all.filter(isVisible)
  const pool = visible.length > 0 ? visible : all
  const needle = value.trim()

  const exact = pool.find((el) => (el.textContent ?? '').trim() === needle)
  if (exact) return exact

  return pool.find((el) => (el.textContent ?? '').trim().includes(needle)) ?? null
}

function mouseClick(el: Element): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function findVisiblePopper(): HTMLElement | null {
  const poppers = Array.from(document.querySelectorAll<HTMLElement>('.el-popper, .el-select-dropdown'))
  const visible = poppers.filter(isVisible)
  if (visible.length > 0) return visible[visible.length - 1]!
  return poppers[poppers.length - 1] ?? null
}

/** Mở dropdown `el-select` rồi click option khớp. */
export async function pickFromSelect(
  scope: HTMLElement,
  value: string,
  timeout = 5000,
): Promise<SetResult> {
  const select = scope.querySelector<HTMLElement>('.el-select') ?? scope
  const trigger =
    select.querySelector<HTMLElement>('.el-select__wrapper') ??
    select.querySelector<HTMLElement>('input') ??
    select

  mouseClick(trigger)

  try {
    const option = await waitFor(() => findOptionIn(document, value), {
      timeout,
      interval: 100,
      label: `option "${value}"`,
    })
    mouseClick(option)
    await nextFrame()
    return { ok: true, strategy: 'select' }
  } catch (e) {
    return {
      ok: false,
      strategy: 'select',
      reason: `Could not find the option "${value}": ${(e as Error).message}`,
    }
  }
}

/** Mở popper tự dựng (component cảng của site), gõ lọc nếu có ô filter, rồi click option. */
export async function pickFromPopper(
  scope: HTMLElement,
  value: string,
  timeout = 5000,
): Promise<SetResult> {
  const trigger = scope.querySelector<HTMLElement>('input') ?? scope
  mouseClick(trigger)

  try {
    const popper = await waitFor(findVisiblePopper, {
      timeout,
      interval: 100,
      label: `popper for "${value}"`,
    })

    const filter = popper.querySelector<HTMLInputElement>('input')
    if (filter) {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      desc?.set?.call(filter, value)
      filter.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(300)
    }

    const option = await waitFor(() => findOptionIn(popper, value), {
      timeout,
      interval: 100,
      label: `option "${value}" in the popper`,
    })
    mouseClick(option)
    await nextFrame()
    return { ok: true, strategy: 'select' }
  } catch (e) {
    return {
      ok: false,
      strategy: 'select',
      reason: `Could not select "${value}": ${(e as Error).message}`,
    }
  }
}
