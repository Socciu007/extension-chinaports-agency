import { nextFrame, sleep, waitFor } from './wait'
import type { SetResult } from './dom'

/** Danh sách gợi ý của `el-autocomplete` (mỗi `li` là một option `名称/代码`). */
const AUTOCOMPLETE_LIST_SELECTOR = '.el-autocomplete-suggestion'

/**
 * Option của dropdown `el-select` và popper của site.
 *
 * KHÔNG gộp `.el-autocomplete-suggestion li` vào đây: 5 ô cảng dùng chung một
 * list gợi ý `名称/代码`, adapter của select/popper bấm nhầm vào đó là ghi sai
 * chỗ mà vẫn báo thành công. `pickFromAutocomplete` dùng danh sách riêng.
 */
const OPTION_SELECTORS = [
  '.el-select-dropdown__item',
  '.el-cascader-node',
  '[role="option"]',
  '.el-popper li',
].join(',')

/** Selector riêng cho adapter autocomplete (tìm trong list gợi ý). */
const AUTOCOMPLETE_OPTION_SELECTORS = [
  `${AUTOCOMPLETE_LIST_SELECTOR} li`,
  '.el-select-dropdown__item',
  '[role="option"]',
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

/** Cách tìm option bên trong một container. */
export interface OptionQuery {
  /** Danh sách selector dùng để thu thập option. */
  selectors?: string
  /** Có tính cả option nằm trong list gợi ý của `el-autocomplete` hay không. */
  includeAutocomplete?: boolean
}

/** Query dùng cho adapter autocomplete (tìm trong list gợi ý `名称/代码`). */
const AUTOCOMPLETE_QUERY: OptionQuery = {
  selectors: AUTOCOMPLETE_OPTION_SELECTORS,
  includeAutocomplete: true,
}

/**
 * Tìm option khớp `value` bên trong `container`.
 *
 * Các mức khớp, mỗi mức ưu tiên phần tử đang hiển thị:
 * 1. khớp chính xác `matchValue` (nếu có) — dùng cho cảng: ta gõ tên (`上海`)
 *    nhưng suggestion của site hiển thị `名称/代码` (`上海/CNSHA`);
 * 2. khớp chính xác `value`;
 * 3. `value` là tiền tố của text option;
 * 4. `value` nằm trong text option.
 *
 * `value` rỗng thì không khớp gì (trước đây `''.includes('')` khớp option đầu tiên).
 *
 * Mặc định bỏ qua option nằm trong list gợi ý của `el-autocomplete` — đó là
 * danh sách riêng của 5 ô cảng, adapter select/popper bấm vào đó là ghi sai chỗ.
 */
export function findOptionIn(
  container: ParentNode,
  value: string,
  matchValue?: string,
  query: OptionQuery = {},
): HTMLElement | null {
  const needle = value.trim()
  if (needle === '') return null

  const selectors = query.selectors ?? OPTION_SELECTORS
  const includeAutocomplete = query.includeAutocomplete ?? false
  const all = Array.from(container.querySelectorAll<HTMLElement>(selectors)).filter(
    (el) => includeAutocomplete || el.closest(AUTOCOMPLETE_LIST_SELECTOR) === null,
  )
  const textOf = (el: HTMLElement): string => (el.textContent ?? '').trim()

  const tiers: Array<(text: string) => boolean> = []
  const match = matchValue?.trim()
  if (match) tiers.push((text) => text === match)
  tiers.push((text) => text === needle)
  tiers.push((text) => text.startsWith(needle))
  tiers.push((text) => text.includes(needle))

  for (const tier of tiers) {
    const matched = all.filter((el) => tier(textOf(el)))
    if (matched.length === 0) continue
    const visible = matched.find((el) => visibilityProbe(el))
    return visible ?? matched[0]!
  }
  return null
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
 * 1. `aria-controls` **đã resolve** → trả về dropdown đó, kể cả khi nó đang ẩn
 *    (Vue flush DOM ở microtask nên ngay sau click popper mới vẫn chưa hiện —
 *    tìm option sẽ chờ nó hiện ra);
 * 2. `aria-controls` có nhưng **chưa resolve** (Element Plus mount popper lazily)
 *    → rơi xuống tầng "dropdown vừa mở": chỉ nhận dropdown trước đó không có
 *    trong DOM hoặc trước đó đang ẩn, nên không bao giờ là dropdown cũ;
 * 3. tầng "dropdown hiển thị cuối cùng" **chỉ** dùng khi trigger không có liên
 *    kết `aria-controls` nào — nếu có, dropdown đang hiện có thể là dropdown cũ
 *    của field trước, bấm vào đó là ghi sai chỗ mà vẫn báo thành công.
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
    if (linked) {
      // Vue flush DOM ở microtask nên ngay sau click, popper mới vẫn đang ẩn →
      // phải trả về dropdown liên kết (tìm option sẽ chờ nó hiện ra).
      return linked
    }
    // Popper chưa được mount → KHÔNG trả về null ở đây, tầng "dropdown vừa mở"
    // bên dưới vẫn tìm được dropdown của field này.
  }

  // Thu thập candidate theo THỨ TỰ DOM: Element Plus append popper mới vào
  // cuối `body` nên phần tử mới nhất là phần tử cuối cùng trong DOM.
  // (Gom theo thứ tự ưu tiên class sẽ khiến `.pop()` trả về `.el-popper` cuối
  // cùng — có thể là popper của field khác, không phải dropdown vừa mở.)
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(classes.map((cls) => `.${cls}`).join(',')),
  )

  const justOpened = candidates
    .filter((el) => visibilityProbe(el) && (!before.has(el) || !visibleBefore.has(el)))
    .pop()
  if (justOpened) return justOpened

  // Có liên kết `aria-controls` nhưng chưa resolve: tuyệt đối KHÔNG fallback
  // sang "dropdown hiển thị cuối cùng" — đó là dropdown cũ của field trước.
  if (controls) return null

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

/** Blur trigger để Element Plus đóng popper — tránh dropdown cũ sót lại cho field sau. */
function blurTrigger(trigger: HTMLElement): void {
  try {
    if (typeof trigger.blur === 'function') trigger.blur()
  } catch {
    // Không blur được thì bỏ qua, không được làm hỏng cả lần điền.
  }
}

/** Thông điệp lỗi khi không chọn được option. */
function optionFailureReason(
  container: HTMLElement | null,
  value: string,
  matchValue: string | undefined,
  error: unknown,
  noun = 'option',
  query: OptionQuery = {},
): string {
  const hidden = container ? findOptionIn(container, value, matchValue, query) : null
  if (hidden && !visibilityProbe(hidden)) {
    return `The ${noun} "${matchValue ?? value}" is not visible`
  }
  return `Could not select the ${noun} "${value}": ${(error as Error).message}`
}

/**
 * Chờ option khớp **và đang hiển thị** trong `container`.
 *
 * Chờ tới khi hiện (chứ không lấy luôn option đầu tiên rồi mới kêu "không hiện")
 * vì popper vừa mở thường chưa hiển thị ngay — Vue flush DOM ở microtask.
 */
async function waitForVisibleOption(
  container: HTMLElement,
  value: string,
  matchValue: string | undefined,
  timeout: number,
  label: string,
  query: OptionQuery = {},
): Promise<HTMLElement> {
  return waitFor(
    () => {
      const found = findOptionIn(container, value, matchValue, query)
      return found && visibilityProbe(found) ? found : null
    },
    { timeout, interval: 100, label },
  )
}

/** Mở dropdown `el-select` rồi click option khớp. */
export async function pickFromSelect(
  scope: HTMLElement,
  value: string,
  timeout = 5000,
  matchValue?: string,
): Promise<SetResult> {
  const select = scope.querySelector<HTMLElement>('.el-select') ?? scope
  const trigger =
    select.querySelector<HTMLElement>('.el-select__wrapper') ??
    select.querySelector<HTMLElement>('input') ??
    select

  const before = new Set(collectDropdowns())
  const visibleBefore = new Set(Array.from(before).filter((el) => visibilityProbe(el)))
  let dropdown: HTMLElement | null = null

  try {
    mouseClick(trigger)

    dropdown = await waitFor(
      () => resolveDropdown(trigger, before, visibleBefore, SELECT_DROPDOWN_CLASSES),
      { timeout, interval: 100, label: `dropdown for "${value}"` },
    )
    const box = dropdown

    const search = select.querySelector<HTMLInputElement>('input:not([readonly])')
    if (search) {
      // Chỉ gõ khi option CHƯA có sẵn (và đang hiện) trong dropdown: select lọc
      // theo thứ khác (không phải label) sẽ mất option cần chọn khi bị gõ đè.
      // Option tồn tại nhưng đang ẩn (dropdown còn giữ filter cũ) thì vẫn phải
      // gõ — nếu không, `waitForVisibleOption` sẽ timeout.
      const present = findOptionIn(box, value, matchValue)
      if (!present || !visibilityProbe(present)) {
        typeIntoInput(search, value)
        await sleep(300)
      }
    }

    const option = await waitForVisibleOption(
      box,
      value,
      matchValue,
      timeout,
      `option "${matchValue ?? value}"`,
    )

    mouseClick(option)
    await nextFrame()
    return { ok: true, strategy: 'select' }
  } catch (e) {
    blurTrigger(trigger)
    return {
      ok: false,
      strategy: 'select',
      reason: optionFailureReason(dropdown, value, matchValue, e),
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
  let popper: HTMLElement | null = null

  try {
    mouseClick(trigger)

    popper = await waitFor(
      () => resolveDropdown(trigger, before, visibleBefore, POPPER_DROPDOWN_CLASSES),
      { timeout, interval: 100, label: `popper for "${value}"` },
    )
    const box = popper

    // Chỉ gõ vào ô filter KHÔNG readonly — input readonly đầu tiên trong popper
    // có thể là chính input display của field.
    const filter = box.querySelector<HTMLInputElement>('input:not([readonly])')
    if (filter) {
      typeIntoInput(filter, value)
      await sleep(300)
    }

    const option = await waitForVisibleOption(
      box,
      value,
      undefined,
      timeout,
      `option "${value}" in the popper`,
    )

    mouseClick(option)
    await nextFrame()
    return { ok: true, strategy: 'select' }
  } catch (e) {
    blurTrigger(trigger)
    return {
      ok: false,
      strategy: 'select',
      reason: optionFailureReason(popper, value, undefined, e),
    }
  }
}

/** Các list gợi ý của `el-autocomplete` đang có trong DOM. */
function collectSuggestionLists(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(AUTOCOMPLETE_LIST_SELECTOR))
}

/**
 * Tìm list gợi ý mà `el-autocomplete` vừa mở.
 *
 * Ưu tiên list sinh ra sau khi gõ; nếu không có (popper được tái dùng) thì lấy
 * list đang hiển thị; cuối cùng mới lấy list mới nhất trong DOM.
 */
function resolveSuggestionList(before: Set<HTMLElement>): HTMLElement | null {
  const lists = collectSuggestionLists().filter((el) => el.querySelector('li'))
  if (lists.length === 0) return null
  const fresh = lists.filter((el) => !before.has(el))
  if (fresh.length > 0) return fresh[fresh.length - 1]!
  // Popper của field khác vẫn nằm trong DOM nhưng đã đóng → tính hiển thị theo popper.
  const visible = lists.filter((el) => visibilityProbe(el.closest<HTMLElement>('.el-popper') ?? el))
  if (visible.length > 0) return visible[visible.length - 1]!
  return lists[lists.length - 1]!
}

/**
 * Điền một ô `el-autocomplete` (5 ô cảng của site).
 *
 * Gõ giá trị bằng native setter + event `input` → Element Plus gọi
 * `fetch-suggestions` và render list gợi ý (`li` có dạng `名称/代码`). Click vào
 * đúng suggestion đó thì site mới cascade mã cảng vào ô `*_PORT_COD`.
 */
export async function pickFromAutocomplete(
  input: HTMLInputElement,
  value: string,
  timeout = 5000,
  matchValue?: string,
): Promise<SetResult> {
  const before = new Set(collectSuggestionLists())
  let list: HTMLElement | null = null

  try {
    // KHÔNG blur/change trước: blur sẽ đóng list gợi ý.
    input.focus()
    typeIntoInput(input, value)

    list = await waitFor(() => resolveSuggestionList(before), {
      timeout,
      interval: 100,
      label: `suggestions for "${value}"`,
    })
    const box = list

    const option = await waitForVisibleOption(
      box,
      value,
      matchValue,
      timeout,
      `suggestion "${matchValue ?? value}"`,
      AUTOCOMPLETE_QUERY,
    )

    mouseClick(option)
    await nextFrame()
    return { ok: true, strategy: 'autocomplete' }
  } catch (e) {
    blurTrigger(input)
    return {
      ok: false,
      strategy: 'autocomplete',
      reason: optionFailureReason(list, value, matchValue, e, 'suggestion', AUTOCOMPLETE_QUERY),
    }
  }
}
