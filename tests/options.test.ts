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
    expect(settings.createOnSite).toBe(false)
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

  it('createOnSite trong storage không phải boolean ⇒ ép về false', async () => {
    store.createOnSite = 'true'
    const settings = await readSettings()
    expect(settings.createOnSite).toBe(false)
  })

  it('createOnSite trong storage là boolean ⇒ giữ nguyên', async () => {
    store.createOnSite = true
    const settings = await readSettings()
    expect(settings.createOnSite).toBe(true)
  })
})

describe('fallback từ key legacy `autoSubmit`', () => {
  it('storage có `autoSubmit: true` và KHÔNG có `createOnSite` ⇒ bật `createOnSite`', async () => {
    // Người dùng đời cũ đã bật opt-in (thời DOM: tự bấm 确定) ⇒ đổi tên
    // setting KHÔNG được làm mất lựa chọn đó trong im lặng.
    store.autoSubmit = true

    const settings = await readSettings()

    expect(settings.createOnSite).toBe(true)
  })

  it('storage có CẢ `autoSubmit: true` và `createOnSite: false` ⇒ key mới thắng', async () => {
    // Người dùng ĐÃ chọn trong UI mới ⇒ lựa chọn mới là chính, kể cả khi nó
    // là `false` (opt-out tường minh phải thắng opt-in cũ).
    store.autoSubmit = true
    store.createOnSite = false

    const settings = await readSettings()

    expect(settings.createOnSite).toBe(false)
  })

  it('`createOnSite: false` thắng dù storage còn ĐỦ key khác ở giá trị mặc định', async () => {
    // Không được có bất kỳ ngoại lệ nào: chỉ cần `createOnSite` CÓ trong
    // storage là lựa chọn của người dùng, dù các key khác có đang nằm ở giá
    // trị mặc định hay không. Nếu không, opt-out tường minh sẽ bị key legacy
    // lật ngược trong im lặng.
    store.autoSubmit = true
    store.createOnSite = false
    store.apiBase = DEFAULT_SETTINGS.apiBase
    store.siteApiBase = DEFAULT_SETTINGS.siteApiBase

    const settings = await readSettings()

    expect(settings.createOnSite).toBe(false)
  })

  it('`autoSubmit` trong storage không phải boolean `true` ⇒ KHÔNG bật', async () => {
    // Storage có thể bị sửa tay ⇒ ép kiểu nghiêm: chỉ `true` mới bật.
    store.autoSubmit = 'true'

    const settings = await readSettings()

    expect(settings.createOnSite).toBe(false)
  })
})

describe('readSettingsResult', () => {
  it('đọc được ⇒ ok = true và trả về setting đã chuẩn hoá', async () => {
    store.createOnSite = true
    store.apiBase = 'https://custom.example/api'

    const result = await readSettingsResult()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.createOnSite).toBe(true)
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
    await writeSettings({ createOnSite: true })
    const settings = await readSettings()
    expect(settings.createOnSite).toBe(true)
  })

  it('không ghi đè các setting khác', async () => {
    await writeSettings({ siteApiBase: '/api/custom' })
    await writeSettings({ createOnSite: true })
    const settings = await readSettings()
    expect(settings.siteApiBase).toBe('/api/custom')
    expect(settings.createOnSite).toBe(true)
  })

  it('không có chrome.storage ⇒ phải báo thất bại, KHÔNG được báo thành công', async () => {
    // Không có storage ⇒ không có gì được ghi ⇒ `writeSettings` phải ném lỗi.
    // Nếu nó vẫn trả về bình thường thì tầng UI sẽ hiện "Saved." dù không
    // có byte nào được lưu.
    vi.stubGlobal('chrome', undefined)

    await expect(writeSettings({ createOnSite: true })).rejects.toThrow()
  })

  it('create-on-site mặc định là tắt', () => {
    // Không bao giờ tạo manifest TRÊN SITE khi chưa được bật.
    expect(DEFAULT_SETTINGS.createOnSite).toBe(false)
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
      await writeSettings({ createOnSite: true })

      expect(store.apiBase).toBe('https://custom.example/api')
      expect(store.siteApiBase).toBe('/api/custom')
      expect(store.createOnSite).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('patch chỉ đụng createOnSite ⇒ KHÔNG ghi apiBase/siteApiBase', async () => {
    // Payload ghi đi phải ĐÚNG bằng patch. Ghi thêm key khác (dù chỉ là
    // giá trị mặc định) cũng là đè lên dữ liệu của người dùng.
    await writeSettings({ createOnSite: true })

    expect(setCalls).toHaveLength(1)
    expect(setCalls[0]).toEqual({ createOnSite: true })
    expect(setCalls[0]).not.toHaveProperty('apiBase')
    expect(setCalls[0]).not.toHaveProperty('siteApiBase')
  })

  it('ghi `createOnSite` ⇒ KHÔNG ghi lại key legacy `autoSubmit`', async () => {
    // Key `autoSubmit` đã bị thay bằng `createOnSite` ⇒ không được viết lại
    // nó (nếu không thì storage lại có hai key cho cùng một setting).
    await writeSettings({ createOnSite: true })

    expect(setCalls[0]).not.toHaveProperty('autoSubmit')
    expect(store.autoSubmit).toBeUndefined()
  })

  it('apiBase toàn khoảng trắng ⇒ ghi giá trị mặc định', async () => {
    await writeSettings({ apiBase: '  ' })

    expect(store.apiBase).toBe(DEFAULT_SETTINGS.apiBase)
    expect(setCalls[0]).toEqual({ apiBase: DEFAULT_SETTINGS.apiBase })
  })

  it('createOnSite không phải boolean ⇒ ép về false trước khi ghi', async () => {
    // Storage có thể bị sửa tay ⇒ giá trị ghi xuống cũng phải là boolean thật,
    // nếu không lần đọc sau sẽ thấy một giá trị lạ.
    await writeSettings({ createOnSite: 'yes' as unknown as boolean })

    expect(store.createOnSite).toBe(false)
    expect(setCalls[0]).toEqual({ createOnSite: false })
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
      const value = key === 'createOnSite' ? true : 'https://custom.example/api'
      await writeSettings({ [key]: value } as Partial<ExtensionSettings>)

      expect(store[key]).toBe(value)
    }
  })
})

describe('saveSettings', () => {
  it('lưu thành công ⇒ ok = true và giá trị thực sự được lưu', async () => {
    const result = await saveSettings({ createOnSite: true })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.createOnSite).toBe(true)
    }
    expect(store.createOnSite).toBe(true)

    const settings = await readSettings()
    expect(settings.createOnSite).toBe(true)
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
      const result = await saveSettings({ createOnSite: true })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Could not save the settings. Please try again.')
      }
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('không có chrome.storage ⇒ ok = false (không được báo "đã lưu")', async () => {
    // `writeSettings` ném lỗi khi không có storage ⇒ `saveSettings` phải báo
    // thất bại, để tầng UI hiện lỗi thay vì "Saved.".
    vi.stubGlobal('chrome', undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const result = await saveSettings({ createOnSite: true })

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
