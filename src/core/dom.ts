import { nextFrame, sleep, waitFor } from './wait'
import { pickFromPopper, pickFromSelect } from './select'

export interface SetResult {
  ok: boolean
  strategy: 'text' | 'select' | 'none'
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
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value
  return (el.textContent ?? '').trim()
}

/**
 * Adapter chung để điền một field bất kỳ: tự nhận diện input text,
 * el-select hoặc popper của site rồi gọi đúng strategy tương ứng.
 */
export async function setFieldValue(
  root: ParentNode,
  prop: string,
  value: string,
  options: { timeout?: number } = {},
): Promise<SetResult> {
  const el = findField(root, prop)
  if (!el) {
    return { ok: false, strategy: 'none', reason: 'Could not find the field on the page' }
  }

  const scope = (el.closest('.el-form-item') as HTMLElement | null) ?? el.parentElement ?? null
  if (scope?.querySelector('.el-select')) {
    return pickFromSelect(scope, value, options.timeout)
  }

  if (el instanceof HTMLInputElement && el.readOnly) {
    return pickFromPopper(scope ?? el, value, options.timeout)
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setTextValue(el, value)
    return { ok: true, strategy: 'text' }
  }

  return { ok: false, strategy: 'none', reason: 'The field is not an input, textarea or select' }
}

export { nextFrame, sleep, waitFor }
