import { describe, it, expect, vi } from 'vitest'
import { DeadlineError, withDeadline } from '../src/core/http'

describe('withDeadline', () => {
  it('promise settle trước hạn ⇒ trả về giá trị', async () => {
    const value = await withDeadline(Promise.resolve('done'), 1000, 'Test')
    expect(value).toBe('done')
  })

  it('promise không bao giờ settle ⇒ ném DeadlineError', async () => {
    const never = new Promise<never>(() => {
      // không bao giờ resolve
    })
    await expect(withDeadline(never, 20, 'Test')).rejects.toBeInstanceOf(DeadlineError)
  })

  it('lỗi DeadlineError có đúng tên và thông điệp', async () => {
    const never = new Promise<never>(() => {
      // không bao giờ resolve
    })
    await expect(withDeadline(never, 20, 'The manifest fill')).rejects.toMatchObject({
      name: 'DeadlineError',
      message: 'The manifest fill timed out after 20ms',
    })
  })

  it('promise bị reject trước hạn ⇒ giữ nguyên lỗi gốc', async () => {
    const boom = new Error('boom')
    await expect(withDeadline(Promise.reject(boom), 1000, 'Test')).rejects.toBe(boom)
  })

  it('promise reject bằng lỗi khác DeadlineError ⇒ KHÔNG bị báo nhầm thành hết giờ', async () => {
    const boom = new TypeError('nope')
    await expect(withDeadline(Promise.reject(boom), 1000, 'Test')).rejects.not.toBeInstanceOf(
      DeadlineError,
    )
  })

  it('promise resolve SAU khi hạn đã hết ⇒ vẫn phải ném DeadlineError', async () => {
    let release: (() => void) | undefined
    const late = new Promise<string>((resolve) => {
      release = () => resolve('late')
    })
    await expect(withDeadline(late, 20, 'Test')).rejects.toBeInstanceOf(DeadlineError)
    release?.()
  })

  it('không để lại timer đang chạy khi promise settle trước hạn', async () => {
    vi.useFakeTimers()
    try {
      const before = vi.getTimerCount()
      await expect(withDeadline(Promise.resolve('done'), 5000, 'Test')).resolves.toBe('done')
      expect(vi.getTimerCount()).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })
})
