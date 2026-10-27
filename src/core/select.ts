import type { SetResult } from './dom'

export async function pickFromSelect(
  _scope: HTMLElement,
  _value: string,
  _timeout?: number,
): Promise<SetResult> {
  return { ok: false, strategy: 'select', reason: 'Not implemented yet' }
}

export async function pickFromPopper(
  _scope: HTMLElement,
  _value: string,
  _timeout?: number,
): Promise<SetResult> {
  return { ok: false, strategy: 'select', reason: 'Not implemented yet' }
}
