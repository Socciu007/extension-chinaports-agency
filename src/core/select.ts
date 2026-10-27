import { nextFrame, sleep, waitFor } from './wait'
import type { SetResult } from './dom'

const OPTION_SELECTORS = [
  '.el-select-dropdown__item',
  '.el-cascader-node',
  '[role="option"]',
  '.el-popper li',
].join(',')

/** Class của dropdown, theo thứ tự ưu tiên cho từng adapter. */
const SELECT_DROPDOWN_CLASSES = ['el-select-dropdown', 'el-popper']
const POPPER_DROPDOWN_CLASSES = ['el-popper', 'el-select-dropdown']

export type VisibilityProbe = (el: HTMLElement) => boolean

let hasLayoutEngine: boolean | null = null

/**
 * jsdom không có layout engine nên `getClientRects()` luôn rỗng — nếu không coi
 * mọi phần tử là hiển thị thì adapter sẽ không tìm thấy option trong test.
 */
function documentHasLayout(): boolean {
  if (hasLayoutEngine === null) {
    const root = document.documentElement
    hasLayoutEngine = root ? root.getClientRects().length > 0 : false
  }
  return hasLayoutEngine
}

function defaultIsVisible(el: HTMLElement): boolean {
  if (!documentHasLayout()) return true
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  }
  return el.getClientRects().length > 0 || el.offsetParent !== null
}

let visibilityProbe: VisibilityProbe = defaultIsVisible

/** Seam để test giả lập trạng thái hiển thị; truyền `null` để trở về mặc định. */
export function setVisibilityProbe(probe: VisibilityProbe | null): void {
  visibilityProbe = probe ?? defaultIsVisible
}

/** Kiểm tra hiển thị theo seam (mặc định dùng layout thật). */
export function isVisible(el: HTMLElement): boolean {
  return visibilityProbe(el)
}

/**
 * Tìm option khớp `value` bên trong `container`.
 * Ưu tiên độ khớp (chính xác > chứa); hiển thị chỉ là tiêu chí phụ khi cùng mức khớp.
 */
export function findOptionIn(container: ParentNode, value: string): HTMLElement | null {
  const all = Array.from(container.querySelectorAll<HTMLElement>(OPTION_SELECTORS))
  const needle = value.trim()

  const exact = all.filter((el) => (el.textContent ?? '').trim() === needle)
  const contains = all.filter((el) => (el.textContent ?? '').trim().includes(needle))

  const visibleExact = exact.find((el) => visibilityProbe(el))
  if (visibleExact) return visibleExact
  if (exact.length > 0) return exact[0]!

  const visibleContains = contains.find((el) => visibilityProbe(el))
  if (visibleContains) return visibleContains
  return contains[0] ?? null
}

/** Click giả: focus trước (component hay mở dropdown khi focus) rồi bắn chuột. */
function mouseClick(el: Element): void {
  try {
    const focusable = el as HTMLElement
    if (typeof focusable.focus === 'function') focusable.focus()
  } catch {
    // Không focus được thì bỏ qua, vẫn click tiếp.
  }
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function collectByClasses(classes: string[]): HTMLElement[] {
  const seen = new Set<HTMLElement>()
  const result: HTMLElement[] = []
  for (const cls of classes) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`.${cls}`))) {
      if (!seen.has(el)) {
        seen.add(el)
        result.push(el)
      }
    }
  }
  return result
}

function collectDropdowns(): HTMLElement[] {
  return collectByClasses(['el-select-dropdown', 'el-popper'])
}

/**
 * `aria-controls` trỏ tới id của dropdown.
 *
 * Element Plus đặt attribute này ở hai chỗ khác nhau tuỳ phiên bản: lên
 * `.el-select__wrapper` (role combobox) hoặc lên `<input class="el-select__input">`
 * bên trong nó. Vì vậy đọc trên trigger trước, rồi mới tìm trong hậu duệ —
 * nếu chỉ đọc một chỗ thì trên site thật nhánh này sẽ không bao giờ chạy.
 */
function ariaControlsOf(trigger: HTMLElement): string | null {
  const own = trigger.getAttribute('aria-controls')
  if (own) return own
  const inner = trigger.querySelector<HTMLElement>('[aria-controls]')
  return inner?.getAttribute('aria-controls') ?? null
}

/**
 * Xác định dropdown mà trigger vừa mở ra:
 * 1. `aria-controls` trỏ thẳng tới dropdown và dropdown đang hiện;
 * 2. dropdown vừa xuất hiện (trước đó không có trong DOM, hoặc trước đó đang ẩn);
 * 3. fallback: dropdown hiển thị cuối cùng đúng class.
 * Không bao giờ trả về dropdown đang ẩn — nếu không sẽ thao tác nhầm dropdown cũ.
 */
function resolveDropdown(
  trigger: HTMLElement,
  before: Set<HTMLElement>,
  visibleBefore: Set<HTMLElement>,
  classes: string[],
): HTMLElement | null {
  const controls = ariaControlsOf(trigger)
  if (controls) {
    const linked = document.getElementById(controls)
    if (linked && visibilityProbe(linked)) return linked
  }

  const candidates = collectByClasses(classes)

  const justOpened = candidates.find(
    (el) => visibilityProbe(el) && (!before.has(el) || !visibleBefore.has(el)),
  )
  if (justOpened) return justOpened

  for (const cls of classes) {
    const visible = candidates.filter((el) => el.classList.contains(cls) && visibilityProbe(el))
    if (visible.length > 0) return visible[visible.length - 1]!
  }
  return null
}

/** Gõ giá trị vào input bằng native setter để Vue 3 không ghi đè, rồi bắn event `input`. */
function typeIntoInput(input: HTMLInputElement, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  if (!desc?.set) {
    throw new Error('Could not find the native value setter')
  }
  desc.set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
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

  const before = new Set(collectDropdowns())
  const visibleBefore = new Set(Array.from(before).filter((el) => visibilityProbe(el)))

  try {
    mouseClick(trigger)

    const dropdown = await waitFor(
      () => resolveDropdown(trigger, before, visibleBefore, SELECT_DROPDOWN_CLASSES),
      { timeout, interval: 100, label: `dropdown for "${value}"` },
    )

    const search = select.querySelector<HTMLInputElement>('input:not([readonly])')
    if (search) {
      typeIntoInput(search, value)
      await sleep(300)
    }

    const option = await waitFor(() => findOptionIn(dropdown, value), {
      timeout,
      interval: 100,
      label: `option "${value}"`,
    })

    if (!visibilityProbe(option)) {
      return { ok: false, strategy: 'select', reason: `The option "${value}" is not visible` }
    }

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

/** Mở popper tự dựng (component cảng của site), gõ lọc nếu có ô filter, rồi click option. */
export async function pickFromPopper(
  scope: HTMLElement,
  value: string,
  timeout = 5000,
): Promise<SetResult> {
  const trigger =
    scope instanceof HTMLInputElement
      ? scope
      : scope.querySelector<HTMLElement>('input[readonly]') ??
        scope.querySelector<HTMLElement>('input') ??
        scope

  const before = new Set(collectDropdowns())
  const visibleBefore = new Set(Array.from(before).filter((el) => visibilityProbe(el)))

  try {
    mouseClick(trigger)

    const popper = await waitFor(
      () => resolveDropdown(trigger, before, visibleBefore, POPPER_DROPDOWN_CLASSES),
      { timeout, interval: 100, label: `popper for "${value}"` },
    )

    const filter = popper.querySelector<HTMLInputElement>('input')
    if (filter) {
      typeIntoInput(filter, value)
      await sleep(300)
    }

    const option = await waitFor(() => findOptionIn(popper, value), {
      timeout,
      interval: 100,
      label: `option "${value}" in the popper`,
    })

    if (!visibilityProbe(option)) {
      return { ok: false, strategy: 'select', reason: `The option "${value}" is not visible` }
    }

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
