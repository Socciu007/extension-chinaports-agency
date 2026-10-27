import { describe, it, expect } from 'vitest'
import { sleep, nextFrame, waitFor, WaitTimeoutError } from '../src/core/wait'

describe('sleep', () => {
  it('resolve sau khoảng thời gian yêu cầu', async () => {
    const t0 = Date.now()
    await sleep(30)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25)
  })
})

describe('nextFrame', () => {
  it('resolve', async () => {
    await expect(nextFrame()).resolves.toBeUndefined()
  })
})

describe('waitFor', () => {
  it('trả về ngay khi probe có kết quả', async () => {
    expect(await waitFor(() => 'x')).toBe('x')
  })

  it('đợi tới khi probe có kết quả', async () => {
    let n = 0
    const result = await waitFor(
      () => {
        n += 1
        return n >= 3 ? 'ready' : null
      },
      { interval: 10, timeout: 1000 },
    )
    expect(result).toBe('ready')
  })

  it('ném WaitTimeoutError khi hết thời gian', async () => {
    let err: unknown
    try {
      await waitFor(() => null, { interval: 10, timeout: 50, label: 'popup' })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(WaitTimeoutError)
    expect((err as Error).message).toContain('popup')
  })

  it('coi giá trị false là chưa có kết quả', async () => {
    let err: unknown
    try {
      await waitFor(() => false, { interval: 10, timeout: 40 })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(WaitTimeoutError)
  })
})
