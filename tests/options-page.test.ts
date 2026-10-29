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

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  setCalls = []
  storageGet = async (defaults) => ({ ...defaults, ...store })
  storageSet = async (values) => {
    setCalls.push(values)
    Object.assign(store, values)
  }

  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: (defaults: Record<string, unknown>) => storageGet(defaults),
        set: (values: Record<string, unknown>) => storageSet(values),
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
})

describe('options — lưu setting', () => {
  it('lưu thành công ⇒ hiện "Saved." và ghi đủ ba giá trị', async () => {
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

  it('hint của CẢ HAI ô nói rõ base rỗng sẽ lưu thành giá trị mặc định', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    const apiHint = wrapper.find('#api-base-hint').text()
    expect(apiHint.toLowerCase()).toContain('blank')
    expect(apiHint).toContain(DEFAULT_SETTINGS.apiBase)

    const siteHint = wrapper.find('#site-api-base-hint').text()
    expect(siteHint.toLowerCase()).toContain('blank')
    expect(siteHint).toContain(DEFAULT_SETTINGS.siteApiBase)
  })
})

describe('options — auto-submit là opt-in', () => {
  it('mặc định tắt', () => {
    // Không bao giờ tự bấm 确定 khi chưa được bật.
    expect(DEFAULT_SETTINGS.autoSubmit).toBe(false)
  })

  it('checkbox không tick khi chưa lưu gì', async () => {
    const wrapper = mount(OptionsApp)
    await flushPromises()

    expect(isChecked(wrapper)).toBe(false)
  })
})

describe('options — timer của thông báo "Saved."', () => {
  it('được dọn khi component unmount', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(OptionsApp)
      await vi.advanceTimersByTimeAsync(0)
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
