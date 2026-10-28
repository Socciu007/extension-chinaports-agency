import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readSettings, writeSettings, DEFAULT_SETTINGS } from '../src/core/options'
import { DEFAULT_API_BASE } from '../src/core/api'
import { DEFAULT_SITE_API_BASE } from '../src/core/site-api'

const store: Record<string, unknown> = {}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...store }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values)
        },
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readSettings', () => {
  it('trả về mặc định khi chưa lưu gì', async () => {
    const settings = await readSettings()
    expect(settings.apiBase).toBe(DEFAULT_SETTINGS.apiBase)
    expect(settings.autoSubmit).toBe(false)
  })

  it('mặc định lấy base API từ đúng module của nó', () => {
    // Base của site phải lấy từ `site-api` chứ không hardcode lần thứ hai.
    expect(DEFAULT_SETTINGS.apiBase).toBe(DEFAULT_API_BASE)
    expect(DEFAULT_SETTINGS.siteApiBase).toBe(DEFAULT_SITE_API_BASE)
  })

  it('trả về mặc định khi không có chrome.storage', async () => {
    vi.stubGlobal('chrome', undefined)

    const settings = await readSettings()

    expect(settings).toEqual(DEFAULT_SETTINGS)
  })
})

describe('writeSettings', () => {
  it('lưu và đọc lại được', async () => {
    await writeSettings({ autoSubmit: true })
    const settings = await readSettings()
    expect(settings.autoSubmit).toBe(true)
  })

  it('không ghi đè các setting khác', async () => {
    await writeSettings({ siteApiBase: '/api/custom' })
    await writeSettings({ autoSubmit: true })
    const settings = await readSettings()
    expect(settings.siteApiBase).toBe('/api/custom')
    expect(settings.autoSubmit).toBe(true)
  })

  it('không ném lỗi khi không có chrome.storage', async () => {
    vi.stubGlobal('chrome', undefined)

    const settings = await writeSettings({ autoSubmit: true })

    expect(settings.autoSubmit).toBe(true)
    expect(settings.apiBase).toBe(DEFAULT_SETTINGS.apiBase)
  })

  it('auto-submit mặc định là tắt', () => {
    // Không bao giờ tự bấm 确定 khi chưa được bật.
    expect(DEFAULT_SETTINGS.autoSubmit).toBe(false)
  })
})
