import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import OptionsApp from '../src/options/App.vue'
import { DEFAULT_SETTINGS } from '../src/core/options'

/**
 * Test tầng WIRING của trang tuỳ chọn — mount component thật
 * `src/options/App.vue` (giống `tests/popup.test.ts`), không chỉ test
 * primitive trong `src/core/options.ts`.
 *
 * Stub `chrome` giống hệt pattern của `tests/options.test.ts`: store trong
 * memory + `vi.stubGlobal`.
 */

const store: Record<string, unknown> = {}
/** Payload thực sự gửi cho `chrome.storage.sync.set` — để assert key nào bị ghi. */
let setCalls: Record<string, unknown>[]
let storageGet: (defaults: Record<string, unknown>) => Promise<Record<string, unknown>>
let storageSet: (values: Record<string, unknown>) => Promise<void>

type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>
type ChangeListener = (changes: StorageChanges, areaName: string) => void
let changeListeners: ChangeListener[]

/** Bắn `chrome.storage.onChanged` — mô phỏng nơi khác ghi storage. */
function fireStorageChange(changes: StorageChanges, areaName = 'sync'): void {
  for (const listener of [...changeListeners]) listener(changes, areaName)
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  setCalls = []
  changeListeners = []
  storageGet = async (defaults) => ({ ...defaults, ...store })
  storageSet = async (values) => {
    setCalls.push(values)
    const changes: StorageChanges = {}
    for (const [key, newValue] of Object.entries(values)) {
      changes[key] = { oldValue: store[key], newValue }
      store[key] = newValue
    }
    // Chrome bắn `storage.onChanged` cho chính nơi ghi ⇒ stub làm vậy để
    // hành vi thật được diễn lại.
    if (Object.keys(changes).length > 0) fireStorageChange(changes, 'sync')
  }

  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: (defaults: Record<string, unknown>) => storageGet(defaults),
        set: (values: Record<string, unknown>) => storageSet(values),
      },
      onChanged: {
        addListener: (listener: ChangeListener) => {
          changeListeners.push(listener)
        },
        removeListener: (listener: ChangeListener) => {
          changeListeners = changeListeners.filter((l) => l !== listener)
        },
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Wrapper = ReturnType<typeof mount>

/** Nút Save — tìm theo class để không phụ thuộc vào chữ trên nút. */
function saveButton(wrapper: Wrapper) {
  return wrapper.find('button.primary')
}

/** Nút Retry (hiện khi đọc setting thất bại). */
function retryButton(wrapper: Wrapper) {
  return wrapper.find('button.retry')
}

function inputValue(wrapper: Wrapper, selector: string): string {
  return (wrapper.find(selector).element as HTMLInputElement).value
}

function checkbox(wrapper: Wrapper) {
  return wrapper.find('input[type="checkbox"]')
}

function isChecked(wrapper: Wrapper): boolean {
  return (checkbox(wrapper).element as HTMLInputElement).checked
}

function isDisabled(wrapper: Wrapper): boolean {
  return (saveButton(wrapper).element as HTMLButtonElement).disabled
}

/** Chữ hiện trên badge trạng thái (rỗng = không có badge). */
function statusText(wrapper: Wrapper): string {
  const badge = wrapper.find('.status')
  return badge.exists() ? badge.text() : ''
}

describe('options — đọc setting thành công', () => {
  it('điền form bằng giá trị ĐÃ LƯU, không phải giá trị mặc định', async () => {
    store.apiBase = 'https://custom.example/api'
    store.siteApiBase = '/api/custom'
    store.autoSubmit = true

    const wrapper = mount(OptionsApp)
    await flushPromises()

    expect(inputValue(wrapper, '#api-base')).toBe('https://custom.example/api')
    expect(inputValue(wrapper, '#site-api-base')).toBe('/api/custom')
    expect(isChecked(wrapper)).toBe(true)
    // Đọc xong ⇒ nút Save phải bấm được.
    expect(isDisabled(wrapper)).toBe(false)
  })
})

describe('options — đọc setting chưa xong', () => {
  it('read còn treo ⇒ form chưa hiện và Save bị khoá', async () => {
    let resolveGet: ((values: Record<string, unknown>) => void) | undefined
    storageGet = () =>
      new Promise((resolve) => {
        resolveGet = resolve
      })

    const wrapper = mount(OptionsApp)
    await flushPromises()

    // Chưa đọc xong ⇒ KHÔNG hiện ô nhập (chưa biết giá trị đã lưu là gì) và
    // KHÔNG cho ghi.
    expect(wrapper.find('#api-base').exists()).toBe(false)
    expect(isDisabled(wrapper)).toBe(true)

    resolveGet?.({ ...DEFAULT_SETTINGS, autoSubmit: true })
    await flushPromises()

    // Đọc xong ⇒ form hiện, Save bấm được, và opt-in đã lưu phải hiện ĐÃ tick
    // (không phải unchecked).
    expect(wrapper.find('#api-base').exists()).toBe(true)
    expect(isDisabled(wrapper)).toBe(false)
    expect(isChecked(wrapper)).toBe(true)
  })
})

describe('options — đọc setting thất bại', () => {
  it('storage.get lỗi ⇒ KHÔNG điền form bằng mặc định, báo lỗi và khoá Save', async () => {
    storageGet = async () => {
      throw new Error('storage disabled')
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wrapper = mount(OptionsApp)
      await flushPromises()

      // KHÔNG được hiện form như là đại diện của setting đã lưu: ta không biết
      // setting là gì, nên cũng không được điền bằng giá trị mặc định (bấm Save
      // sau đó sẽ GHI ĐÈ base tuỳ chỉnh của người dùng).
      expect(wrapper.find('#api-base').exists()).toBe(false)
      expect(wrapper.find('#site-api-base').exists()).toBe(false)
      expect(wrapper.text()).not.toContain(DEFAULT_SETTINGS.apiBase)

      // Lỗi phải hiện ra cho người dùng.
      expect(wrapper.find('.load-error').text()).toBe('Could not read the settings.')

      // Save phải bị khoá — và bấm cũng không được ghi gì.
      expect(isDisabled(wrapper)).toBe(true)
      await saveButton(wrapper).trigger('click')
      await flushPromises()
      expect(setCalls).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('đọc lỗi ⇒ có nút Retry, bấm lại thì đọc được và form hiện', async () => {
    // Lần đọc đầu hỏng, lần sau thành công ⇒ người dùng không phải tải lại
    // trang mới cấu hình được.
    let failNext = true
    storageGet = async (defaults) => {
      if (failNext) {
        failNext = false
        throw new Error('storage disabled')
      }
      return { ...defaults, ...store }
    }
    store.apiBase = 'https://custom.example/api'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wrapper = mount(OptionsApp)
      await flushPromises()

      expect(wrapper.find('.load-error').exists()).toBe(true)
      expect(retryButton(wrapper).exists()).toBe(true)

      await retryButton(wrapper).trigger('click')
      await flushPromises()

      // Đọc được ⇒ form hiện với giá trị đã lưu, lỗi biến mất, Save bấm được.
      expect(wrapper.find('.load-error').exists()).toBe(false)
      expect(inputValue(wrapper, '#api-base')).toBe('https://custom.example/api')
      expect(isDisabled(wrapper)).toBe(false)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('options — lưu setting', () => {
  it('lưu thành công ⇒ hiện "Saved." và ghi các key ĐÃ sửa', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#api-base').setValue('https://custom.example/api')
    await wrapper.find('#site-api-base').setValue('/api/custom')
    await checkbox(wrapper).setValue(true)
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.status').text()).toBe('Saved.')
    expect(wrapper.find('.error').exists()).toBe(false)

    expect(store.apiBase).toBe('https://custom.example/api')
    expect(store.siteApiBase).toBe('/api/custom')
    expect(store.autoSubmit).toBe(true)

    // Payload ghi đi phải chứa đúng ba key của setting.
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0]).toEqual({
      apiBase: 'https://custom.example/api',
      siteApiBase: '/api/custom',
      autoSubmit: true,
    })
  })

  it('lưu thất bại ⇒ báo lỗi và KHÔNG hiện "Saved."', async () => {
    storageSet = async () => {
      throw new Error('storage disabled')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(OptionsApp)
      await flushPromises()

      // Phải có thay đổi thì mới có gì để ghi ⇒ mới gặp được lỗi ghi.
      await wrapper.find('#api-base').setValue('https://custom.example/api')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      expect(wrapper.find('.save-error').text()).toBe(
        'Could not save the settings. Please try again.',
      )
      // "Saved." phải CÓ NGHĨA là đã lưu được — lỗi thì không được hiện.
      expect(wrapper.find('.status').exists()).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('lưu xong ⇒ form GIỮ NGUYÊN giá trị người dùng gõ', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#api-base').setValue('')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    // Storage đã có giá trị mặc định, nhưng ô nhập phải vẫn trống — người dùng
    // vừa gõ trống, ta không được tự ý thay bằng kết quả merge của lần lưu.
    expect(inputValue(wrapper, '#api-base')).toBe('')
  })
})

describe('options — chỉ ghi những key người dùng ĐÃ sửa', () => {
  it('không ghi đè opt-in đã bật ở nơi khác (popup)', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    // Popup (tab khác) vừa bật auto-submit ⇒ storage đổi NGOÀI tầm hiểu của
    // trang này.
    store.autoSubmit = true

    await wrapper.find('#api-base').setValue('https://new.example/api')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    // Người dùng chỉ sửa `apiBase` ⇒ payload KHÔNG được mang theo
    // `autoSubmit`, nếu không thì opt-in của popup bị XOÁ trong im lặng.
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0]).not.toHaveProperty('autoSubmit')
    expect(store.autoSubmit).toBe(true)
    expect(store.apiBase).toBe('https://new.example/api')
  })

  it('không ghi đè base mới đã lưu ở tab khác', async () => {
    store.apiBase = 'https://old.example/api'
    const wrapper = mount(OptionsApp)
    await flushPromises()

    // Tab khác vừa lưu base mới ⇒ trang này đang còn giá trị cũ.
    store.apiBase = 'https://new.example/api'

    await wrapper.find('#site-api-base').setValue('/api/custom')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(setCalls[0]).not.toHaveProperty('apiBase')
    expect(store.apiBase).toBe('https://new.example/api')
    expect(store.siteApiBase).toBe('/api/custom')
  })

  it('lưu lần hai không ghi lại patch đã lưu', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#api-base').setValue('https://custom.example/api')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(setCalls).toHaveLength(1)

    await saveButton(wrapper).trigger('click')
    await flushPromises()

    // Form đã khớp storage ⇒ không có gì để ghi ⇒ KHÔNG được ghi lại.
    expect(setCalls).toHaveLength(1)
    expect(statusText(wrapper)).toBe('Nothing to save.')
  })
})

describe('options — storage đổi từ nơi khác', () => {
  it('ô CHƯA sửa được đồng bộ theo giá trị mới', async () => {
    store.apiBase = 'https://old.example/api'
    const wrapper = mount(OptionsApp)
    await flushPromises()
    expect(inputValue(wrapper, '#api-base')).toBe('https://old.example/api')

    fireStorageChange({ apiBase: { newValue: 'https://new.example/api' } }, 'sync')
    await flushPromises()

    expect(inputValue(wrapper, '#api-base')).toBe('https://new.example/api')
  })

  it('ô ĐÃ sửa KHÔNG bị ghi đè, và chỉnh sửa đang dở được ghi lại', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#api-base').setValue('https://mine.example/api')
    fireStorageChange({ apiBase: { newValue: 'https://new.example/api' } }, 'sync')
    await flushPromises()

    // Chỉnh sửa đang dở của người dùng phải được giữ nguyên.
    expect(inputValue(wrapper, '#api-base')).toBe('https://mine.example/api')

    // Ảnh chụp đã cập nhật theo giá trị mới ⇒ khi lưu, chỉnh sửa của người
    // dùng vẫn được ghi (không bị coi là không đổi).
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(setCalls[0]).toEqual({ apiBase: 'https://mine.example/api' })
  })

  it('thay đổi ở area khác (local) thì bỏ qua', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    fireStorageChange({ apiBase: { newValue: 'https://other.example/api' } }, 'local')
    await flushPromises()

    expect(inputValue(wrapper, '#api-base')).toBe(DEFAULT_SETTINGS.apiBase)
  })

  it('listener được gỡ khi component unmount', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    expect(changeListeners).toHaveLength(1)

    wrapper.unmount()

    // Listener sống sót sẽ giữ closure của component đã rời khỏi DOM.
    expect(changeListeners).toHaveLength(0)
  })
})

describe('options — badge "Saved."', () => {
  it('sửa ô sau khi lưu ⇒ badge biến mất ngay', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#api-base').setValue('https://custom.example/api')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('.status').text()).toBe('Saved.')

    await wrapper.find('#api-base').setValue('https://other.example/api')
    await flushPromises()

    // Form đang chứa thay đổi CHƯA lưu ⇒ không được nói "Saved." nữa.
    expect(statusText(wrapper)).toBe('')
  })

  it('tự tắt sau 2000ms', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(OptionsApp)
      await vi.advanceTimersByTimeAsync(0)

      await wrapper.find('#api-base').setValue('https://custom.example/api')
      await saveButton(wrapper).trigger('click')
      await vi.advanceTimersByTimeAsync(0)
      expect(wrapper.find('.status').text()).toBe('Saved.')

      await vi.advanceTimersByTimeAsync(2000)
      expect(statusText(wrapper)).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('timer được dọn khi component unmount', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(OptionsApp)
      await vi.advanceTimersByTimeAsync(0)

      await wrapper.find('#api-base').setValue('https://custom.example/api')
      await saveButton(wrapper).trigger('click')
      await vi.advanceTimersByTimeAsync(0)

      expect(wrapper.find('.status').exists()).toBe(true)
      // Timer xoá thông báo đang treo.
      expect(vi.getTimerCount()).toBe(1)

      wrapper.unmount()

      // Unmount phải dọn timer — không để timer sống sót giữ closure của
      // component đã rời khỏi DOM.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('options — lưu bị chặn khi đang chạy', () => {
  it('bấm Save hai lần khi lần đầu còn đang ghi ⇒ chỉ MỘT lần storage.set', async () => {
    let resolveSet: (() => void) | undefined
    storageSet = async (values) => {
      setCalls.push(values)
      await new Promise<void>((resolve) => {
        resolveSet = resolve
      })
      Object.assign(store, values)
    }

    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#api-base').setValue('https://custom.example/api')

    await saveButton(wrapper).trigger('click')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(setCalls).toHaveLength(1)

    resolveSet?.()
    await flushPromises()
  })
})

describe('options — kiểm tra base API', () => {
  it('apiBase không phải URL tuyệt đối ⇒ lỗi tại chỗ và KHÔNG ghi gì', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#api-base').setValue('/relative/api')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.field-error').text()).toContain('http')
    expect(setCalls).toHaveLength(0)
    expect(statusText(wrapper)).toBe('')
  })

  it('apiBase sai giao thức (ftp) ⇒ cũng bị chặn', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#api-base').setValue('ftp://example.com/api')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.field-error').exists()).toBe(true)
    expect(setCalls).toHaveLength(0)
  })

  it('apiBase là URL http(s) ⇒ được chấp nhận', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#api-base').setValue('https://custom.example/api')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.field-error').exists()).toBe(false)
    expect(store.apiBase).toBe('https://custom.example/api')
  })

  it('siteApiBase tương đối ⇒ vẫn được chấp nhận (nó là path trên site)', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#site-api-base').setValue('/api/custom')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.field-error').exists()).toBe(false)
    expect(setCalls[0]).toEqual({ siteApiBase: '/api/custom' })
  })
})

describe('options — không có chrome.storage', () => {
  it('lưu ⇒ phải báo lỗi, KHÔNG được hiện "Saved."', async () => {
    vi.stubGlobal('chrome', undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(OptionsApp)
      await flushPromises()

      await wrapper.find('#api-base').setValue('https://custom.example/api')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      // Không có storage ⇒ không có gì được lưu ⇒ KHÔNG được báo "Saved.".
      expect(wrapper.find('.save-error').text()).toBe(
        'Could not save the settings. Please try again.',
      )
      expect(statusText(wrapper)).toBe('')
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('options — base rỗng ⇒ lưu giá trị mặc định', () => {
  it('apiBase để trống ⇒ storage nhận giá trị MẶC ĐỊNH', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#api-base').setValue('')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    // `withDefaults` ép base rỗng về mặc định ⇒ xoá ô KHÔNG xoá base.
    expect(store.apiBase).toBe(DEFAULT_SETTINGS.apiBase)
    expect(setCalls[0]).toMatchObject({ apiBase: DEFAULT_SETTINGS.apiBase })
  })

  it('siteApiBase để trống ⇒ storage nhận giá trị MẶC ĐỊNH', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    await wrapper.find('#site-api-base').setValue('')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(store.siteApiBase).toBe(DEFAULT_SETTINGS.siteApiBase)
    expect(setCalls[0]).toMatchObject({ siteApiBase: DEFAULT_SETTINGS.siteApiBase })
  })

  it('hint của CẢ HAI ô nói rõ base rỗng sẽ THAY THẾ base hiện tại', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    const apiHint = wrapper.find('#api-base-hint').text()
    expect(apiHint).toContain(DEFAULT_SETTINGS.apiBase)
    expect(apiHint.toLowerCase()).toContain('replaces')
    expect(apiHint.toLowerCase()).toContain('not kept')

    const siteHint = wrapper.find('#site-api-base-hint').text()
    expect(siteHint).toContain(DEFAULT_SETTINGS.siteApiBase)
    expect(siteHint.toLowerCase()).toContain('replaces')
    expect(siteHint.toLowerCase()).toContain('not kept')
  })
})

describe('options — auto-submit là opt-in', () => {
  it('checkbox không tick khi chưa lưu gì', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    expect(isChecked(wrapper)).toBe(false)
  })
})

describe('options — a11y / hygiene ô nhập', () => {
  it('hint được liên kết với ô nhập và tắt spellcheck', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    const apiInput = wrapper.find('#api-base')
    expect(apiInput.attributes('aria-describedby')).toBe('api-base-hint')
    expect(apiInput.attributes('spellcheck')).toBe('false')

    const siteInput = wrapper.find('#site-api-base')
    expect(siteInput.attributes('aria-describedby')).toBe('site-api-base-hint')
    expect(siteInput.attributes('spellcheck')).toBe('false')
  })
})
