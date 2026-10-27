export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(() => resolve(), 16)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export class WaitTimeoutError extends Error {
  constructor(label: string) {
    super(`Timed out waiting for "${label}"`)
    this.name = 'WaitTimeoutError'
  }
}

export interface WaitForOptions {
  timeout?: number
  interval?: number
  label?: string
}

export async function waitFor<T>(
  probe: () => T | null | undefined | false,
  options: WaitForOptions = {},
): Promise<T> {
  const timeout = options.timeout ?? 5000
  const interval = options.interval ?? 100
  const deadline = Date.now() + timeout

  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() >= deadline) {
      throw new WaitTimeoutError(options.label ?? 'waitFor')
    }
    await sleep(interval)
  }
}
