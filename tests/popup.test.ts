import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PopupApp from '../src/popup/App.vue'
import { MSG_CREATE_MANIFEST } from '../src/core/protocol'
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

type StorageGet = (
  defaults?: Record<string, unknown> | null,
) => Promise<Record<string, unknown>>
type StorageSet = (values: Record<string, unknown>) => Promise<void>
type SentMessage = { type: string; [key: string]: unknown }
type SendMessage = (message: SentMessage) => Promise<unknown>
type StorageListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void

let storageGet: StorageGet
let storageSet: StorageSet
let sendMessage: SendMessage
/** Ghi lại type của mọi message đã gửi đi — để assert "KHÔNG được gửi". */
let sentTypes: string[]
/** Ghi lại TOÀN BỘ message đã gửi đi — để assert payload (vd `allowWrite`). */
let sentMessages: SentMessage[]
/** Ghi lại mọi lần ĐIỀU HƯỚNG tab — để assert tab nào bị đổi URL. */
let tabUpdates: { tabId: number; url?: string }[]
/** Ghi lại mọi lần TẠO tab mới — để assert không mở tab mới. */
let createdTabs: (string | undefined)[]
/** Ghi lại mọi lần TẢI LẠI tab — để assert tab đang ở trang khai báo được reload. */
let tabReloads: number[]
/** URL của tab active trong stub — đổi được để test cả nhánh "đã ở trang khai báo". */
let activeTabUrl: string
/** Id của tab active — `undefined` ⇒ KHÔNG có tab active nào. */
let activeTabId: number | undefined
/** Listener của `chrome.storage.onChanged` — để test đổi setting từ nơi khác. */
let storageListeners: StorageListener[]

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  sentTypes = []
  sentMessages = []
  tabUpdates = []
  createdTabs = []
  tabReloads = []
  storageListeners = []
  activeTabUrl = 'https://example.test/'
  activeTabId = 1
  storageGet = async (defaults) => ({ ...(defaults ?? {}), ...store })
  storageSet = async (values) => {
    Object.assign(store, values)
  }
  sendMessage = async () => successResult()

  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: (defaults?: Record<string, unknown> | null) => storageGet(defaults),
        set: (values: Record<string, unknown>) => storageSet(values),
      },
      onChanged: {
        addListener: (fn: StorageListener) => {
          storageListeners.push(fn)
        },
        removeListener: (fn: StorageListener) => {
          storageListeners = storageListeners.filter((listener) => listener !== fn)
        },
      },
    },
    tabs: {
      query: async () => (activeTabId === undefined ? [] : [{ id: activeTabId }]),
      get: async (tabId: number) => ({ id: tabId, url: activeTabUrl }),
      reload: async (tabId: number) => {
        tabReloads.push(tabId)
        return undefined
      },
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

/**
 * Kết quả "thành công" mặc định — đủ shape để popup dựng được UI.
 */
function successResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    blocked: false,
    steps: ['Fetched the manifest data'],
    items: [],
    preview: { header: {}, cargo: [], containers: [] },
    cargoRows: 0,
    containerRows: 0,
    billCreated: false,
    written: false,
    ...overrides,
  }
}

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

/** Nút có bị disable không. */
function isDisabled(wrapper: ReturnType<typeof mount>, text: string): boolean {
  return buttonByText(wrapper, text).attributes('disabled') !== undefined
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

/** Mô phỏng storage bị đổi từ nơi khác (trang options). */
function emitStorageChange(changes: Record<string, { newValue?: unknown }>): void {
  for (const listener of storageListeners) listener(changes, 'sync')
}

/**
 * Bắn event click TRỰC TIẾP lên nút, bỏ qua việc VTU bỏ qua nút bị disable.
 *
 * `trigger` của VTU KHÔNG bắn event cho nút disabled ⇒ nếu chỉ dùng `trigger`
 * thì test "bấm hai lần" pass TRONG VAI như nút bị disable, chứ không phải vì
 * khoá busy bên trong component — tức là test sẽ không bắt được lỗi.
 *
 * `_vts` phải đặt tay: Vue bỏ qua event có `_vts` cũ hơn lúc listener được
 * gắn (xem `createInvoker` trong runtime-dom).
 */
function rawClick(button: { element: Element }): void {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  Object.assign(event, { _vts: Date.now() + 1 })
  button.element.dispatchEvent(event)
}

/** Bấm nút "Preview data" — hành động CHỈ preview. */
async function clickPreview(wrapper: ReturnType<typeof mount>): Promise<void> {
  await buttonByText(wrapper, 'Preview data').trigger('click')
  await flushPromises()
}

describe('popup — chạy manifest qua API', () => {
  it('ô trống ⇒ báo lỗi và KHÔNG gửi message nào', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').trigger('keyup.enter')
    await flushPromises()

    expect(wrapper.find('.error').text()).toBe('Enter a bill of lading number first.')
    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(0)
  })

  it('Enter ⇒ gửi đúng MỘT message, type MSG_CREATE_MANIFEST', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await wrapper.find('input[type="text"]').trigger('keyup.enter')
    await flushPromises()

    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(1)
  })

  it('bấm hai lần liên tiếp ⇒ chỉ gửi MỘT message (khoá busy)', async () => {
    // Run treo ⇒ nếu gửi 2 lần thì site bị tạo bill hai lần và sinh dòng
    // hàng TRÙNG.
    let resolveSend: ((value: unknown) => void) | undefined
    sendMessage = async () =>
      new Promise((resolve) => {
        resolveSend = resolve
      })

    const wrapper = mount(PopupApp)
    await flushPromises()
    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')

    // Giữ nguyên wrapper của nút: nhãn của nó đổi thành "Running…" khi bấm.
    const button = buttonByText(wrapper, 'Preview data')
    await button.trigger('click')
    await flushPromises()

    // Nút bị disable trong lúc chạy ⇒ `trigger` của VTU sẽ bỏ qua event.
    // Bắn trực tiếp để kiểm tra khoá busy BÊN TRONG component.
    expect(button.attributes('disabled')).toBeDefined()
    rawClick(button)
    await flushPromises()

    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(1)

    // Nở chốt để lần chạy kết thúc ⇒ không rò timer ra ngoài test.
    resolveSend?.(successResult())
    await flushPromises()
  })

  it('"Preview data" ⇒ message có allowWrite === false', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickPreview(wrapper)

    const message = sentMessages.find((m) => m.type === MSG_CREATE_MANIFEST)
    expect(message).toBeDefined()
    // Boolean THẬT — không phải `undefined`, không phải chuỗi.
    expect(message?.allowWrite).toBe(false)
  })

  it('"Create draft on site" CHƯA tick ⇒ nút bị disable, KHÔNG gửi message', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    expect(isDisabled(wrapper, 'Create draft on site')).toBe(true)

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    // Bắn trực tiếp (nút đang bị disable nên `trigger` của VTU bỏ qua) để
    // chứng minh component TỰ chặn, chứ không chỉ nhờ nút bị disable.
    rawClick(buttonByText(wrapper, 'Create draft on site'))
    await flushPromises()

    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(0)
  })

  it('"Create draft on site" ĐÃ tick ⇒ message có allowWrite === true', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await checkbox(wrapper).setValue(true)
    await flushPromises()

    expect(isDisabled(wrapper, 'Create draft on site')).toBe(false)

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await buttonByText(wrapper, 'Create draft on site').trigger('click')
    await flushPromises()

    const message = sentMessages.find((m) => m.type === MSG_CREATE_MANIFEST)
    expect(message).toBeDefined()
    expect(message?.allowWrite).toBe(true)
  })

  it('Enter trên ô nhập KHÔNG bao giờ chạy hành động create', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await checkbox(wrapper).setValue(true)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await wrapper.find('input[type="text"]').trigger('keyup.enter')
    await flushPromises()

    const message = sentMessages.find((m) => m.type === MSG_CREATE_MANIFEST)
    expect(message?.allowWrite).toBe(false)
  })
})

describe('popup — lỗi vận chuyển', () => {
  it('sendMessage lỗi ⇒ báo lỗi cho operator và ghi chi tiết ra console', async () => {
    sendMessage = async () => {
      throw new Error('The message port closed before a response was received.')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      await wrapper.find('input[type="text"]').setValue('BL123')
      await clickPreview(wrapper)

      expect(wrapper.find('.error').text()).toBe(
        'Could not reach the page. Open the manifest declaration page and try again.',
      )
      // Chi tiết kỹ thuật phải nằm ở console — không bị nuốt.
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('popup — hiện kết quả của lần chạy', () => {
  it('kết quả thành công ⇒ hiện các bước, số bill và report field bị trống', async () => {
    sendMessage = async () =>
      successResult({
        steps: ['Fetched the manifest data', 'Created the manifest bill on the site'],
        items: [
          {
            scope: 'header',
            prop: 'PAY_WAY_ID',
            label: '付款方式',
            status: 'warn',
            required: true,
            note: 'The API does not provide the payment method.',
          },
          {
            scope: 'header',
            prop: 'SHIPPER_EM_STR',
            label: '发货人 (email)',
            status: 'skip',
            required: false,
            note: 'The API does not provide email addresses.',
          },
        ],
        preview: {
          header: { bill_nbr: 'ONEYSHAGT1569600', pay_way_id: '' },
          cargo: [{ piece_num: 10, e_cargo_nam: 'STEEL COIL' }],
          containers: [{ cntr_no: 'ABCU1234567' }],
        },
        cargoRows: 1,
        containerRows: 1,
        billNo: 'BILL-1',
        billCreated: true,
        written: true,
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickPreview(wrapper)

    // Các bước của lần chạy — operator thấy run tới đâu.
    const steps = wrapper.find('.steps')
    expect(steps.exists()).toBe(true)
    expect(steps.text()).toContain('Fetched the manifest data')
    expect(steps.text()).toContain('Created the manifest bill on the site')

    // Số bill do site gán.
    expect(wrapper.text()).toContain('Bill number: BILL-1')

    // Report field bị trống — kèm note (note mới là lý do thật).
    const table = wrapper.find('table.table')
    expect(table.exists()).toBe(true)
    expect(table.text()).toContain('付款方式')
    expect(table.text()).toContain('The API does not provide the payment method.')

    // Đếm field trống: required và optional tách riêng.
    const summary = wrapper.find('.summary').text()
    expect(summary).toContain('cargo: 1')
    expect(summary).toContain('containers: 1')
    expect(summary).toContain('blank fields: 1 required, 1 optional')
  })

  it('ghi thành công ⇒ hiện cảnh báo ghi hai lần', async () => {
    sendMessage = async () =>
      successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickPreview(wrapper)

    expect(wrapper.text()).toContain(
      'The manifest was created on the site and saved as a draft (暂存).',
    )
    expect(wrapper.find('.double-write').text()).toContain(
      'Running it again would create a second manifest.',
    )
  })

  it('bill tạo được nhưng lưu chưa xong ⇒ KHÔNG nói "đã lưu"', async () => {
    sendMessage = async () => successResult({ billCreated: true, written: false })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickPreview(wrapper)

    expect(wrapper.text()).toContain(
      'The manifest bill was created on the site, but saving it did not finish.',
    )
    expect(wrapper.text()).not.toContain('saved as a draft (暂存)')
  })

  it('preview: header mở sẵn, dòng hàng và container đóng; field trống hiện (blank)', async () => {
    sendMessage = async () =>
      successResult({
        preview: {
          header: { bill_nbr: 'ONEYSHAGT1569600', pay_way_id: '' },
          cargo: [{ piece_num: 10, e_cargo_nam: 'STEEL COIL' }],
          containers: [{ cntr_no: 'ABCU1234567' }],
        },
        cargoRows: 1,
        containerRows: 1,
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickPreview(wrapper)

    const details = wrapper.findAll('details')
    expect(details).toHaveLength(3)
    // Header mở sẵn, hai khối dòng đóng.
    expect(details[0]?.attributes('open')).toBeDefined()
    expect(details[1]?.attributes('open')).toBeUndefined()
    expect(details[2]?.attributes('open')).toBeUndefined()

    // Nhãn lấy từ map viết HOA, key payload thì chữ thường.
    expect(details[0]?.text()).toContain('提单号')
    expect(details[0]?.text()).toContain('ONEYSHAGT1569600')
    // Field trống hiện `(blank)`.
    expect(details[0]?.text()).toContain('(blank)')
    expect(details[1]?.text()).toContain('包装件数')
  })

  it('kết quả lỗi ⇒ hiện đúng message của lần chạy', async () => {
    sendMessage = async () =>
      successResult({
        ok: false,
        message: 'No manifest was found for this bill of lading number.',
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickPreview(wrapper)

    expect(wrapper.find('.error').text()).toBe(
      'No manifest was found for this bill of lading number.',
    )
  })

  it('còn field bắt buộc bị trống ⇒ hiện cảnh báo và liệt kê field kèm note', async () => {
    sendMessage = async () =>
      successResult({
        blocked: true,
        message:
          '1 field(s) required by the site are not provided by the API — they are listed in the report and must be filled in by hand on the site.',
        items: [
          {
            scope: 'header',
            prop: 'PAY_WAY_ID',
            label: '付款方式',
            status: 'warn',
            required: true,
            note: 'The API does not provide the payment method.',
          },
        ],
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickPreview(wrapper)

    const blocked = wrapper.find('.blocked')
    expect(blocked.exists()).toBe(true)
    expect(blocked.text()).toContain('required by the site are not provided by the API')

    const panel = wrapper.find('.blocking')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('付款方式')
    expect(panel.text()).toContain('PAY_WAY_ID')
    expect(wrapper.find('.blocking-note').text()).toBe(
      'The API does not provide the payment method.',
    )
  })
})

describe('popup — đọc setting thất bại', () => {
  it('storage.get lỗi ⇒ nút create TẮT, preview vẫn chạy, lỗi ở khe riêng', async () => {
    // Opt-in ĐÃ lưu là `true` (đây là sự thật trong storage) nhưng lần đọc
    // hỏng ⇒ popup KHÔNG biết điều đó ⇒ KHÔNG được phép ghi lên site.
    store.createOnSite = true
    storageGet = async () => {
      throw new Error('storage disabled')
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      // Control phải ẨN — không được hiện ra một checkbox "tắt" bịa đặt.
      expect(checkbox(wrapper).exists()).toBe(false)
      // Lỗi đọc phải nằm ở khe lỗi của setting, không phải khe lỗi chạy.
      expect(wrapper.find('.settings-error').text()).toBe('Could not read the settings.')
      expect(wrapper.find('.error').exists()).toBe(false)

      // Nút create phải TẮT — không có cách nào ghi lên site.
      expect(isDisabled(wrapper, 'Create draft on site')).toBe(true)

      // Preview vẫn chạy được.
      await wrapper.find('input[type="text"]').setValue('BL123')
      await clickPreview(wrapper)

      const message = sentMessages.find((m) => m.type === MSG_CREATE_MANIFEST)
      expect(message).toBeDefined()
      expect(message?.allowWrite).toBe(false)
      // Lỗi của setting vẫn còn nguyên sau lần chạy.
      expect(wrapper.find('.settings-error').exists()).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('popup — checkbox create-on-site chỉ hiện SAU khi đọc setting xong', () => {
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

    resolveGet?.({ ...DEFAULT_SETTINGS, createOnSite: true })
    await flushPromises()

    // Setting đã lưu là `true` ⇒ phải hiện ĐÃ TICK, không phải unchecked.
    expect(checkbox(wrapper).exists()).toBe(true)
    expect(isChecked(wrapper)).toBe(true)
  })

  it('setting đổi từ nơi khác ⇒ checkbox cập nhật ngay', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    expect(isChecked(wrapper)).toBe(false)
    expect(isDisabled(wrapper, 'Create draft on site')).toBe(true)

    // Trang options bật opt-in ⇒ storage đổi ⇒ popup phải thấy ngay.
    store.createOnSite = true
    emitStorageChange({ createOnSite: { newValue: true } })
    await flushPromises()

    expect(isChecked(wrapper)).toBe(true)
    expect(isDisabled(wrapper, 'Create draft on site')).toBe(false)
  })
})

describe('popup — lưu setting thất bại', () => {
  it('lưu lỗi ⇒ rollback checkbox về giá trị đã lưu thật và báo lỗi', async () => {
    store.createOnSite = false
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
    // Trường hợp ngược của test trên: nếu bỏ `savedCreateOnSite` thì rollback
    // sẽ về `false` ⇒ test này bắt được.
    store.createOnSite = true
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
    store.createOnSite = false

    const wrapper = mount(PopupApp)
    await flushPromises()

    await checkbox(wrapper).setValue(true)
    await flushPromises()

    expect(store.createOnSite).toBe(true)
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
    expect(store.createOnSite).toBe(true)
    expect(isChecked(wrapper)).toBe(true)
  })
})

describe('popup — nút Open page', () => {
  it('không có tab active ⇒ tạo tab mới với MANIFEST_URL', async () => {
    activeTabId = undefined

    const wrapper = mount(PopupApp)
    await flushPromises()

    await buttonByText(wrapper, 'Open page').trigger('click')
    await flushPromises()

    expect(createdTabs).toEqual([MANIFEST_URL])
    expect(tabUpdates).toEqual([])
    expect(tabReloads).toEqual([])
  })

  it('tab active ở trang KHÁC ⇒ điều hướng tab đó, KHÔNG tạo tab mới', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await buttonByText(wrapper, 'Open page').trigger('click')
    await flushPromises()

    // Tab active (id = 1 trong stub) phải bị đổi URL sang trang khai 预配舱单.
    expect(tabUpdates).toEqual([{ tabId: 1, url: MANIFEST_URL }])
    // KHÔNG được mở thêm tab mới — người dùng chọn điều hướng tab hiện tại.
    expect(createdTabs).toEqual([])
    // Tab KHÔNG đang ở trang khai báo ⇒ không reload.
    expect(tabReloads).toEqual([])
  })

  it('tab ĐANG ở trang khai báo ⇒ tải lại tab, KHÔNG điều hướng', async () => {
    activeTabUrl = MANIFEST_URL
    const wrapper = mount(PopupApp)
    await flushPromises()

    await buttonByText(wrapper, 'Open page').trigger('click')
    await flushPromises()

    // Đã ở đúng trang ⇒ reload để thấy dữ liệu mới, KHÔNG điều hướng lại.
    expect(tabReloads).toEqual([1])
    expect(tabUpdates).toEqual([])
    expect(createdTabs).toEqual([])
  })
})
