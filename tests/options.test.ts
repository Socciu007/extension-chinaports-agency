import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  readSettings,
  readSettingsResult,
  writeSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
} from '../src/core/options'
import { DEFAULT_API_BASE } from '../src/core/api'
import { DEFAULT_SITE_API_BASE } from '../src/core/site-api'

const store: Record<string, unknown> = {}
/** Payload thực sự gửi cho `chrome.storage.sync.set` — để assert key nào bị ghi. */
let setCalls: Record<string, unknown>[]

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  setCalls = []
  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...store }),
        set: async (values: Record<string, unknown>) => {
          setCalls.push(values)
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

  it('storage lỗi ⇒ trả về mặc định thay vì ném', async () => {
    // Storage bị chặn bởi policy hoặc lỗi quota ⇒ không được làm hỏng cả
    // lần điền dữ liệu.
    vi.stubGlobal('chrome', {
      storage: {
        sync: {
          get: async () => {
            throw new Error('storage disabled')
          },
          set: async () => undefined,
        },
      },
    })

    const settings = await readSettings()

    expect(settings).toEqual(DEFAULT_SETTINGS)
  })

  it('base rỗng trong storage ⇒ dùng mặc định', async () => {
    // `apiBase: ''` sẽ tạo URL tương đối ⇒ phải coi như chưa cấu hình.
    //
    // Phải seed thẳng vào store: `writeSettings` đã chuẩn hoá giá trị rỗng
    // thành mặc định TRƯỚC khi lưu ⇒ gọi `writeSettings` không bao giờ tạo ra
    // trạng thái "storage chứa base rỗng" mà `readSettings` phải xử lý.
    store.apiBase = ''
    const settings = await readSettings()

    expect(settings.apiBase).toBe(DEFAULT_SETTINGS.apiBase)
  })

  it('siteApiBase rỗng trong storage ⇒ dùng mặc định', async () => {
    store.siteApiBase = '   '
    const settings = await readSettings()

    expect(settings.siteApiBase).toBe(DEFAULT_SETTINGS.siteApiBase)
  })

  it('autoSubmit trong storage không phải boolean ⇒ ép về false', async () => {
    store.autoSubmit = 'true'
    const settings = await readSettings()
    expect(settings.autoSubmit).toBe(false)
  })

  it('autoSubmit trong storage là boolean ⇒ giữ nguyên', async () => {
    store.autoSubmit = true
    const settings = await readSettings()
    expect(settings.autoSubmit).toBe(true)
  })
})

describe('readSettingsResult', () => {
  it('đọc được ⇒ ok = true và trả về setting đã chuẩn hoá', async () => {
    store.autoSubmit = true
    store.apiBase = 'https://custom.example/api'

    const result = await readSettingsResult()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.autoSubmit).toBe(true)
      expect(result.settings.apiBase).toBe('https://custom.example/api')
    }
  })

  it('đọc lỗi ⇒ ok = false và KHÔNG ném ra ngoài', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        sync: {
          get: async () => {
            throw new Error('storage disabled')
          },
          set: async () => undefined,
        },
      },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const result = await readSettingsResult()

      // Phải PHÂN BIỆT được "đọc hỏng" với "setting = false" — nếu nuốt lỗi
      // ở đây thì tầng UI sẽ tưởng setting tắt và đè lên opt-in đã lưu.
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Could not read the settings.')
      }
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('không có chrome.storage ⇒ ok = true với giá trị mặc định', async () => {
    vi.stubGlobal('chrome', undefined)

    const result = await readSettingsResult()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('đọc lỗi ⇒ `readSettings()` VẪN trả về mặc định, không ném', async () => {
    // Content script dùng `readSettings()`: lỗi ở đó chỉ được báo qua giá
    // trị mặc định, vì hỏng cả lần điền dữ liệu còn tệ hơn việc điền bằng
    // base API mặc định. Hàm này KHÔNG được ném.
    vi.stubGlobal('chrome', {
      storage: {
        sync: {
          get: async () => {
            throw new Error('storage disabled')
          },
          set: async () => undefined,
        },
      },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const settings = await readSettings()

      expect(settings).toEqual(DEFAULT_SETTINGS)
    } finally {
      warnSpy.mockRestore()
    }
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

  it('storage đọc lỗi ⇒ KHÔNG ghi đè apiBase/siteApiBase đã lưu', async () => {
    // `readSettings` nuốt lỗi và trả về MẶC ĐỊNH. Nếu `writeSettings` ghi toàn
    // bộ settings đã merge thì một lần đọc lỗi sẽ khiến base API tuỳ chỉnh
    // của người dùng bị ghi đè bằng giá trị mặc định ⇒ MẤT dữ liệu.
    store.apiBase = 'https://custom.example/api'
    store.siteApiBase = '/api/custom'
    vi.stubGlobal('chrome', {
      storage: {
        sync: {
          get: async () => {
            throw new Error('read failed')
          },
          set: async (values: Record<string, unknown>) => {
            Object.assign(store, values)
          },
        },
      },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await writeSettings({ autoSubmit: true })

      expect(store.apiBase).toBe('https://custom.example/api')
      expect(store.siteApiBase).toBe('/api/custom')
      expect(store.autoSubmit).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('patch chỉ đụng autoSubmit ⇒ KHÔNG ghi apiBase/siteApiBase', async () => {
    // Payload ghi đi phải ĐÚNG bằng patch. Ghi thêm key khác (dù chỉ là
    // giá trị mặc định) cũng là đè lên dữ liệu của người dùng.
    await writeSettings({ autoSubmit: true })

    expect(setCalls).toHaveLength(1)
    expect(setCalls[0]).toEqual({ autoSubmit: true })
    expect(setCalls[0]).not.toHaveProperty('apiBase')
    expect(setCalls[0]).not.toHaveProperty('siteApiBase')
  })

  it('apiBase toàn khoảng trắng ⇒ ghi giá trị mặc định', async () => {
    await writeSettings({ apiBase: '  ' })

    expect(store.apiBase).toBe(DEFAULT_SETTINGS.apiBase)
    expect(setCalls[0]).toEqual({ apiBase: DEFAULT_SETTINGS.apiBase })
  })

  it('autoSubmit không phải boolean ⇒ ép về false trước khi ghi', async () => {
    // Storage có thể bị sửa tay ⇒ giá trị ghi xuống cũng phải là boolean thật,
    // nếu không lần đọc sau sẽ thấy một giá trị lạ.
    await writeSettings({ autoSubmit: 'yes' as unknown as boolean })

    expect(store.autoSubmit).toBe(false)
    expect(setCalls[0]).toEqual({ autoSubmit: false })
  })

  it('apiBase null trong storage ⇒ dùng mặc định, không ném', async () => {
    // Storage bị sửa tay có thể chứa `null` ⇒ không được gọi `.trim()` trực
    // tiếp lên nó.
    store.apiBase = null
    const settings = await readSettings()

    expect(settings.apiBase).toBe(DEFAULT_SETTINGS.apiBase)
  })

  it('apiBase null trong patch ⇒ ghi giá trị mặc định, không ném', async () => {
    // `normalizePatch` phải dùng CHUNG quy tắc với `withDefaults` (tức là
    // `?.trim()`), không tự gọi `.trim()` trực tiếp lên giá trị thô ⇒ `null`
    // sẽ ném TypeError và làm hỏng cả lần lưu setting.
    await writeSettings({ apiBase: null as unknown as string })

    expect(store.apiBase).toBe(DEFAULT_SETTINGS.apiBase)
  })

  it('thêm setting mới vào DEFAULT_SETTINGS ⇒ vẫn được ghi, không bị bỏ sót', async () => {
    // Danh sách key của `normalizePatch` phải lấy từ CẤU TRÚC
    // (`DEFAULT_SETTINGS`), không liệt kê tay. Nếu liệt kê tay thì một
    // setting mới sẽ bị BỎ QUA khi ghi — không lỗi, `saveSettings` vẫn báo
    // thành công ⇒ mất setting trong im lặng.
    //
    // Test này tự thêm một key mới vào `DEFAULT_SETTINGS` để chứng minh điều
    // đó: với bản liệt kê tay, key này sẽ không bao giờ được ghi.
    const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>
    defaults.newSetting = 'https://new.example/api'
    try {
      await writeSettings({
        newSetting: 'https://patched.example/api',
      } as unknown as Partial<ExtensionSettings>)

      expect(store.newSetting).toBe('https://patched.example/api')
    } finally {
      delete defaults.newSetting
    }
  })

  it('mọi key trong DEFAULT_SETTINGS đều được ghi khi patch', async () => {
    // Hợp đồng với người dùng: patch setting nào thì setting đó được lưu.
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const value = key === 'autoSubmit' ? true : 'https://custom.example/api'
      await writeSettings({ [key]: value } as Partial<ExtensionSettings>)

      expect(store[key]).toBe(value)
    }
  })
})

describe('saveSettings', () => {
  it('lưu thành công ⇒ ok = true và giá trị thực sự được lưu', async () => {
    const result = await saveSettings({ autoSubmit: true })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.autoSubmit).toBe(true)
    }
    expect(store.autoSubmit).toBe(true)

    const settings = await readSettings()
    expect(settings.autoSubmit).toBe(true)
  })

  it('storage set lỗi ⇒ ok = false và KHÔNG ném ra ngoài', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        sync: {
          get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...store }),
          set: async () => {
            throw new Error('storage disabled')
          },
        },
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const result = await saveSettings({ autoSubmit: true })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Could not save the settings. Please try again.')
      }
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
