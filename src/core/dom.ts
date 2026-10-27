import { nextFrame, sleep, waitFor } from './wait'
import { pickFromAutocomplete, pickFromPopper, pickFromSelect } from './select'

export interface SetResult {
  ok: boolean
  strategy: 'text' | 'select' | 'autocomplete' | 'none'
  reason?: string
}

/**
 * Tìm field của form theo `prop`.
 * Element Plus gán `id = ${formId}-${prop}` cho input → ưu tiên selector theo đuôi id.
 */
export function findField(root: ParentNode, prop: string): HTMLElement | null {
  const byId = root.querySelector<HTMLElement>(
    `input[id$="-${prop}"], textarea[id$="-${prop}"]`,
  )
  if (byId) return byId

  const byName = root.querySelector<HTMLElement>(`[name="${prop}"]`)
  if (byName) return byName

  const label = root.querySelector<HTMLLabelElement>(`label[for$="-${prop}"]`)
  if (label) {
    const id = label.getAttribute('for')
    if (id) {
      const el = document.getElementById(id)
      if (el) return el
    }
  }

  return null
}

/**
 * Gán giá trị vào input/textarea theo cách Vue 3 không ghi đè:
 * dùng native value setter rồi bắn `input` / `change` / `blur`.
 */
export function setTextValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  if (!desc?.set) {
    throw new Error('Could not find the native value setter')
  }
  desc.set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
}

/** Đọc lại giá trị hiện tại của field để verify. */
export function readFieldValue(root: ParentNode, prop: string): string {
  const el = findField(root, prop)
  if (!el) return ''

  // el-select: label đang chọn nằm ở `.el-select__selected-item`, KHÔNG nằm trong
  // `input.value` (select filterable còn đẩy cả text đang gõ vào đó) → đọc label
  // trước. Chưa chọn gì thì trả '' chứ không phải placeholder ("请选择"): trả
  // placeholder sẽ làm một verify pass giả.
  const select = el.closest<HTMLElement>('.el-select')
  if (select) {
    const items = Array.from(select.querySelectorAll<HTMLElement>('.el-select__selected-item'))
    // `is-transparent` = placeholder đang trong suốt (site đang hiện label khác).
    const real = items.filter((node) => !node.classList.contains('is-transparent'))
    return (real[real.length - 1]?.textContent ?? '').trim()
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value

  return (el.textContent ?? '').trim()
}

/**
 * Adapter chung để điền một field bất kỳ: tự nhận diện input text,
 * el-select, el-autocomplete hoặc popper của site rồi gọi đúng strategy tương ứng.
 */
export async function setFieldValue(
  root: ParentNode,
  prop: string,
  value: string,
  options: { timeout?: number; matchValue?: string } = {},
): Promise<SetResult> {
  const el = findField(root, prop)
  if (!el) {
    return { ok: false, strategy: 'none', reason: 'Could not find the field on the page' }
  }

  const select = el.closest<HTMLElement>('.el-select')
  if (select) {
    return pickFromSelect(select, value, options.timeout, options.matchValue)
  }

  // 5 ô cảng của site là `el-autocomplete` và input bên trong KHÔNG readonly.
  // Không có nhánh này thì chúng rơi vào nhánh text: chỉ gõ chữ, không bao giờ
  // click gợi ý → site không cascade mã cảng và field sai âm thầm.
  const autocomplete = el.closest<HTMLElement>('.el-autocomplete')
  if (autocomplete) {
    const input =
      el instanceof HTMLInputElement ? el : autocomplete.querySelector<HTMLInputElement>('input')
    if (input) {
      return pickFromAutocomplete(input, value, options.timeout, options.matchValue)
    }
  }

  if (el instanceof HTMLInputElement && el.readOnly) {
    return pickFromPopper(el, value, options.timeout)
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try {
      setTextValue(el, value)
      return { ok: true, strategy: 'text' }
    } catch (e) {
      // Không ném lỗi ra ngoài: một field hỏng không được dừng cả lần điền.
      return { ok: false, strategy: 'text', reason: (e as Error).message }
    }
  }

  return { ok: false, strategy: 'none', reason: 'The field is not an input, textarea or select' }
}

export { nextFrame, sleep, waitFor }
