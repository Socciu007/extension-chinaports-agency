import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PopupApp from '../src/popup/App.vue'
import { MSG_FILL } from '../src/core/protocol'
import { DEFAULT_SETTINGS } from '../src/core/options'
import { MANIFEST_URL } from '../src/core/site-url'

/**
 * Test tầng WIRING của popup — không chỉ test primitive (`saveSettings`,
 * `withDeadline`) mà test chính component `src/popup/App.vue`.
 *
 * Stub `chrome` giống hệt pattern của `tests/options.test.ts`: store trong
 * memory + `vi.stubGlobal`.
 */

const store: Record<string, unknown> = {}

type StorageGet = (defaults: Record<string, unknown>) => Promise<Record<string, unknown>>
type StorageSet = (values: Record<string, unknown>) => Promise<void>
type SentMessage = { type: string; [key: string]: unknown }
type SendMessage = (message: SentMessage) => Promise<unknown>

let storageGet: StorageGet
let storageSet: StorageSet
let sendMessage: SendMessage
/** Ghi lại type của mọi message đã gửi đi — để assert "KHÔNG được gửi". */
let sentTypes: string[]
/** Ghi lại TOÀN BỘ message đã gửi đi — để assert payload (vd `autoSubmit`). */
let sentMessages: SentMessage[]
/** Ghi lại mọi lần ĐIỀU HƯỚNG tab — để assert tab nào bị đổi URL. */
let tabUpdates: { tabId: number; url?: string }[]
/** Ghi lại mọi lần TẠO tab mới — để assert không mở tab mới. */
let createdTabs: (string | undefined)[]

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  sentTypes = []
  sentMessages = []
  tabUpdates = []
  createdTabs = []
  storageGet = async (defaults) => ({ ...defaults, ...store })
  storageSet = async (values) => {
    Object.assign(store, values)
  }
  sendMessage = async () => ({ ok: true })

  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: (defaults: Record<string, unknown>) => storageGet(defaults),
        set: (values: Record<string, unknown>) => storageSet(values),
      },
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: (_tabId: number, message: SentMessage) => {
        sentTypes.push(message.type)
        // Copy chứ không giữ tham chiếu — để assert không bị ảnh hưởng nếu
        // sau này ai đó sửa lại object message đã gửi.
        sentMessages.push({ ...message })
        return sendMessage(message)
      },
      create: async (props: { url?: string }) => {
        createdTabs.push(props.url)
        return undefined
      },
      update: async (tabId: number, props: { url?: string }) => {
        tabUpdates.push({ tabId, url: props.url })
        return undefined
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Tìm nút theo đúng chữ hiện trên nó. */
function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find((b) => b.text() === text)
  if (!button) throw new Error(`could not find the button "${text}"`)
  return button
}

function checkbox(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('input[type="checkbox"]')
}

function isChecked(wrapper: ReturnType<typeof mount>): boolean {
  return (checkbox(wrapper).element as HTMLInputElement).checked
}

/**
 * Bấm checkbox KHÔNG chờ tick nào — mô phỏng double-click rất nhanh, lúc
 * DOM chưa kịp render trạng thái `disabled`.
 */
function fastToggle(wrapper: ReturnType<typeof mount>): void {
  const el = checkbox(wrapper).element as HTMLInputElement
  el.checked = !el.checked
  el.dispatchEvent(new Event('change'))
}

describe('popup — checkbox auto-submit chỉ hiện SAU khi đọc setting xong', () => {
  it('setting đọc chưa xong ⇒ chưa có checkbox', async () => {
    // Giữ promise `get` treo ⇒ `onMounted` chưa xong.
    let resolveGet: ((values: Record<string, unknown>) => void) | undefined
    storageGet = () =>
      new Promise((resolve) => {
        resolveGet = resolve
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    // Control chưa có ⇒ không thể tick sớm (không đè lên lựa chọn của user).
    expect(checkbox(wrapper).exists()).toBe(false)

    resolveGet?.({ ...DEFAULT_SETTINGS, autoSubmit: true })
    await flushPromises()

    // Setting đã lưu là `true` ⇒ phải hiện ĐÃ TICK, không phải unchecked.
    expect(checkbox(wrapper).exists()).toBe(true)
    expect(isChecked(wrapper)).toBe(true)
  })
})

describe('popup — đọc setting thất bại', () => {
  it('storage.get lỗi ⇒ KHÔNG gửi autoSubmit, KHÔNG hiện checkbox, và báo lỗi', async () => {
    // Opt-in ĐÃ lưu là `true` (đây là sự thật trong storage) nhưng lần đọc
    // hỏng ⇒ popup KHÔNG biết điều đó. Nếu popup coi như "setting = false"
    // rồi gửi `autoSubmit: false` đi thì content script coi đó là giá trị
    // HỢP LỆ (`request.autoSubmit ?? settings.autoSubmit`) ⇒ ĐÈ LÊN opt-in
    // đã lưu: auto-submit bị tắt trong im lặng, còn checkbox thì hiện chưa
    // tick ⇒ control nói dối.
    store.autoSubmit = true
    storageGet = async () => {
      throw new Error('storage disabled')
    }
    sendMessage = async () => ({ ok: true, items: [], cargoRows: 0, containerRows: 0 })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      // Control phải ẨN — không được hiện ra một checkbox "tắt" bịa đặt.
      expect(checkbox(wrapper).exists()).toBe(false)
      // Lỗi đọc phải nằm ở khe lỗi của setting, không phải khe lỗi trang.
      expect(wrapper.find('.settings-error').text()).toBe('Could not read the settings.')
      expect(wrapper.find('.error').exists()).toBe(false)

      await wrapper.find('input[type="text"]').setValue('BL123')
      await buttonByText(wrapper, 'Fill data').trigger('click')
      await flushPromises()

      const fillMessage = sentMessages.find((m) => m.type === MSG_FILL)
      expect(fillMessage).toBeDefined()
      // Key `autoSubmit` phải VẮNG MẶT — để content script tự đọc setting
      // (lần đọc MỚI của nó) và tôn trọng opt-in đã lưu.
      expect('autoSubmit' in (fillMessage as SentMessage)).toBe(false)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('popup — lưu setting thất bại', () => {
  it('lưu lỗi ⇒ rollback checkbox về giá trị đã lưu thật và báo lỗi', async () => {
    store.autoSubmit = false
    storageSet = async () => {
      throw new Error('storage disabled')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      expect(checkbox(wrapper).exists()).toBe(true)
      expect(isChecked(wrapper)).toBe(false)

      await checkbox(wrapper).setValue(true)
      await flushPromises()

      // Checkbox phải QUAY LẠI unchecked — không được nằm trong trạng thái
      // "đã tick" trong khi setting thật sự chưa lưu được.
      expect(isChecked(wrapper)).toBe(false)
      expect(wrapper.find('.settings-error').text()).toBe(
        'Could not save the settings. Please try again.',
      )
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('lưu lỗi khi giá trị đã lưu là `true` ⇒ rollback về checked', async () => {
    // Trường hợp ngược của test trên: nếu drop `savedAutoSubmit` thì rollback
    // sẽ về `false` ⇒ test này bắt được.
    store.autoSubmit = true
    storageSet = async () => {
      throw new Error('storage disabled')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      expect(isChecked(wrapper)).toBe(true)

      await checkbox(wrapper).setValue(false)
      await flushPromises()

      // Giá trị ĐÃ LƯU là `true` ⇒ phải quay lại `true`.
      expect(isChecked(wrapper)).toBe(true)
      expect(wrapper.find('.settings-error').text()).toBe(
        'Could not save the settings. Please try again.',
      )
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('popup — lưu setting thành công', () => {
  it('lưu được ⇒ checkbox giữ nguyên ticked và không báo lỗi', async () => {
    store.autoSubmit = false

    const wrapper = mount(PopupApp)
    await flushPromises()

    await checkbox(wrapper).setValue(true)
    await flushPromises()

    expect(store.autoSubmit).toBe(true)
    expect(isChecked(wrapper)).toBe(true)
    expect(wrapper.find('.settings-error').exists()).toBe(false)
    expect(wrapper.find('.error').exists()).toBe(false)
  })
})

describe('popup — lưu setting bị chặn khi đang chạy', () => {
  it('tick lần hai trong lúc lần đầu còn treo ⇒ KHÔNG ghi thêm', async () => {
    let setCalls = 0
    let resolveSet: (() => void) | undefined
    storageSet = async (values) => {
      setCalls += 1
      await new Promise<void>((resolve) => {
        resolveSet = resolve
      })
      Object.assign(store, values)
    }

    const wrapper = mount(PopupApp)
    await flushPromises()

    // Hai lần bấm liên tiếp, KHÔNG chờ render ⇒ lần hai phải bị chặn.
    fastToggle(wrapper)
    fastToggle(wrapper)
    await flushPromises()

    expect(setCalls).toBe(1)

    resolveSet?.()
    await flushPromises()

    // Giá trị đã lưu phải khớp với ý định của lần đang chạy, và control
    // KHÔNG được lệch với storage.
    expect(store.autoSubmit).toBe(true)
    expect(isChecked(wrapper)).toBe(true)
  })
})

describe('popup — báo cáo field bị chặn', () => {
  it('field `warn` bắt buộc ⇒ báo lý do, KHÔNG quy cho API thiếu dữ liệu', async () => {
    sendMessage = async () => ({
      ok: false,
      items: [
        {
          scope: 'header',
          prop: 'START_PORT_NAM',
          label: '卸货港',
          status: 'warn',
          required: true,
          note: 'The site did not fill the port code from the port name.',
        },
      ],
      cargoRows: 0,
      containerRows: 0,
    })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await buttonByText(wrapper, 'Fill data').trigger('click')
    await flushPromises()

    const errorText = wrapper.find('.error').text()
    // KHÔNG được quy field `warn` là "API không có dữ liệu" — API CÓ dữ liệu,
    // site không verify được giá trị đó.
    expect(errorText).not.toContain('no data from the API')
    expect(errorText).toContain('卸货港')

    // Panel blocking phải liệt kê field KÈM note (note mới là lý do thật).
    const panel = wrapper.find('.blocking')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('卸货港')
    expect(panel.text()).toContain('START_PORT_NAM')
    expect(wrapper.find('.blocking-note').text()).toBe(
      'The site did not fill the port code from the port name.',
    )
  })
})

describe('popup — chạy lần điền', () => {
  it('Enter với ô trống ⇒ báo lỗi và KHÔNG gửi MSG_FILL', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').trigger('keyup.enter')
    await flushPromises()

    expect(wrapper.find('.error').text()).toBe('Enter a bill of lading number first.')
    expect(sentTypes.filter((t) => t === MSG_FILL)).toHaveLength(0)
  })

  it('Enter hai lần khi đang điền ⇒ chỉ gửi MSG_FILL đúng MỘT lần', async () => {
    // Fill treo ⇒ nếu gửi 2 lần thì site sẽ bấm 新增舱单信息 hai lần và sinh
    // dòng hàng TRÙNG.
    let resolveFill: ((value: unknown) => void) | undefined
    sendMessage = async (message) => {
      if (message.type === MSG_FILL) {
        return new Promise((resolve) => {
          resolveFill = resolve
        })
      }
      return { ok: true }
    }

    const wrapper = mount(PopupApp)
    await flushPromises()

    const input = wrapper.find('input[type="text"]')
    await input.setValue('ONEYSHAGT1569600')
    await input.trigger('keyup.enter')
    await input.trigger('keyup.enter')
    await flushPromises()

    expect(sentTypes.filter((t) => t === MSG_FILL)).toHaveLength(1)

    // Nở chốt để lần điền kết thúc ⇒ không rò timer ra ngoài test.
    resolveFill?.({ ok: true, items: [], cargoRows: 0, containerRows: 0 })
    await flushPromises()
  })

  it('điền thành công ⇒ không báo lỗi và hiện số dòng hàng/ container', async () => {
    sendMessage = async () => ({
      ok: true,
      items: [],
      cargoRows: 2,
      containerRows: 1,
    })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await buttonByText(wrapper, 'Fill data').trigger('click')
    await flushPromises()

    expect(wrapper.find('.error').exists()).toBe(false)
    const summary = wrapper.find('.summary').text()
    expect(summary).toContain('cargo: 2')
    expect(summary).toContain('containers: 1')
  })

  it('điền khi setting CHƯA đọc xong ⇒ payload KHÔNG mang autoSubmit', async () => {
    // Gửi `autoSubmit: false` placeholder sẽ bị content script dùng (vì
    // `request.autoSubmit ?? settings.autoSubmit` coi `false` là CÓ giá trị)
    // ⇒ opt-in đã lưu bị bỏ qua trong im lặng. Bỏ trống key ⇒ content script
    // tự đọc setting đã lưu.
    let resolveGet: ((values: Record<string, unknown>) => void) | undefined
    storageGet = () =>
      new Promise((resolve) => {
        resolveGet = resolve
      })
    sendMessage = async () => ({ ok: true, items: [], cargoRows: 0, containerRows: 0 })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await buttonByText(wrapper, 'Fill data').trigger('click')
    await flushPromises()

    const fillMessage = sentMessages.find((m) => m.type === MSG_FILL)
    expect(fillMessage).toBeDefined()
    // Key `autoSubmit` phải VẮNG MẶT — không phải `false`.
    expect('autoSubmit' in (fillMessage as SentMessage)).toBe(false)

    resolveGet?.({ ...DEFAULT_SETTINGS, autoSubmit: true })
    await flushPromises()
  })
})

describe('popup — hai khe lỗi tách biệt', () => {
  it('lỗi lưu setting và lỗi điền cùng hiện được', async () => {
    storageSet = async () => {
      throw new Error('storage disabled')
    }
    sendMessage = async (message) => {
      if (message.type === MSG_FILL) {
        return {
          ok: false,
          message: 'The manifest could not be filled.',
          items: [],
          cargoRows: 0,
          containerRows: 0,
        }
      }
      return { ok: true }
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      await checkbox(wrapper).setValue(true)
      await flushPromises()

      await wrapper.find('input[type="text"]').setValue('BL123')
      await buttonByText(wrapper, 'Fill data').trigger('click')
      await flushPromises()

      expect(wrapper.find('.settings-error').exists()).toBe(true)
      expect(wrapper.find('.error').exists()).toBe(true)
      expect(wrapper.find('.error').text()).toBe('The manifest could not be filled.')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('lưu setting thành công ⇒ KHÔNG xoá lỗi điền', async () => {
    sendMessage = async (message) => {
      if (message.type === MSG_FILL) {
        return {
          ok: false,
          message: 'The manifest could not be filled.',
          items: [],
          cargoRows: 0,
          containerRows: 0,
        }
      }
      return { ok: true }
    }

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await buttonByText(wrapper, 'Fill data').trigger('click')
    await flushPromises()
    expect(wrapper.find('.error').exists()).toBe(true)

    await checkbox(wrapper).setValue(true)
    await flushPromises()

    // Lỗi điền vẫn còn nguyên — lưu setting KHÔNG được xoá nó.
    expect(wrapper.find('.error').text()).toBe('The manifest could not be filled.')
    expect(wrapper.find('.settings-error').exists()).toBe(false)
  })

  it('bắt đầu lần điền ⇒ KHÔNG xoá lỗi lưu setting', async () => {
    storageSet = async () => {
      throw new Error('storage disabled')
    }
    sendMessage = async () => ({ ok: true, items: [], cargoRows: 0, containerRows: 0 })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      await checkbox(wrapper).setValue(true)
      await flushPromises()
      expect(wrapper.find('.settings-error').exists()).toBe(true)

      await wrapper.find('input[type="text"]').setValue('BL123')
      await buttonByText(wrapper, 'Fill data').trigger('click')
      await flushPromises()

      // Lỗi lưu setting vẫn còn — lần điền KHÔNG được xoá nó.
      expect(wrapper.find('.settings-error').exists()).toBe(true)
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('popup — nút Open page', () => {
  it('điều hướng CHÍNH tab đang mở sang trang khai báo, KHÔNG tạo tab mới', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await buttonByText(wrapper, 'Open page').trigger('click')
    await flushPromises()

    // Tab active (id = 1 trong stub) phải bị đổi URL sang trang khai 预配舱单.
    expect(tabUpdates).toEqual([{ tabId: 1, url: MANIFEST_URL }])
    // KHÔNG được mở thêm tab mới — người dùng chọn điều hướng tab hiện tại.
    expect(createdTabs).toEqual([])
  })
})
