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
/** Ghi lại TOÀN BỘ message đã gửi đi — để assert payload (vd `blNo`). */
let sentMessages: SentMessage[]
/** Ghi lại mọi lần ĐIỀU HƯỚNG tab — để assert tab nào bị đổi URL. */
let tabUpdates: { tabId: number; url?: string; active?: boolean }[]
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
    // Trình duyệt thật BÁO thay đổi sau khi ghi ⇒ stub phải làm vậy, nếu
    // không nhánh "thay đổi tới trong lúc đang lưu" không bao giờ chạy.
    const changes: Record<string, { newValue?: unknown }> = {}
    for (const [key, value] of Object.entries(values)) changes[key] = { newValue: value }
    emitStorageChange(changes)
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
      update: async (tabId: number, props: { url?: string; active?: boolean }) => {
        tabUpdates.push({ tabId, url: props.url, active: props.active })
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

/**
 * Bấm nút "Create draft on site" — hành động DUY NHẤT của extension.
 *
 * Test phải bật opt-in TRƯỚC khi mount (`store.createOnSite = true`), nếu
 * không nút bị disable và KHÔNG gửi message nào.
 */
async function clickCreate(wrapper: ReturnType<typeof mount>): Promise<void> {
  await buttonByText(wrapper, 'Create draft on site').trigger('click')
  await flushPromises()
}

describe('popup — chạy manifest qua API', () => {
  it('ô trống ⇒ báo lỗi và KHÔNG gửi message nào', async () => {
    // Opt-in ĐÃ bật ⇒ lần chạy thật sự bắt đầu rồi bị chặn vì ô nhập rỗng.
    store.createOnSite = true

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').trigger('keyup.enter')
    await flushPromises()

    expect(wrapper.find('.message-error').text()).toBe('Enter a bill of lading number first.')
    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(0)
  })

  it('Enter ⇒ gửi đúng MỘT message, type MSG_CREATE_MANIFEST', async () => {
    store.createOnSite = true

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await wrapper.find('input[type="text"]').trigger('keyup.enter')
    await flushPromises()

    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(1)
  })

  it('bấm hai lần liên tiếp ⇒ chỉ gửi MỘT message (khoá busy)', async () => {
    store.createOnSite = true
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
    const button = buttonByText(wrapper, 'Create draft on site')
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

  it('nút đang chạy ⇒ mang class `busy` (con trỏ "đang xử lý")', async () => {
    store.createOnSite = true
    let resolveSend: ((value: unknown) => void) | undefined
    sendMessage = async () =>
      new Promise((resolve) => {
        resolveSend = resolve
      })

    const wrapper = mount(PopupApp)
    await flushPromises()
    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')

    const button = buttonByText(wrapper, 'Create draft on site')
    expect(button.classes()).not.toContain('busy')

    await button.trigger('click')
    await flushPromises()

    expect(button.classes()).toContain('busy')

    resolveSend?.(successResult())
    await flushPromises()

    expect(button.classes()).not.toContain('busy')
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

  it('"Create draft on site" ĐÃ tick ⇒ message KHÔNG mang cờ nào, chỉ có `blNo`', async () => {
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
    expect(message?.blNo).toBe('ONEYSHAGT1569600')
    // KHÔNG còn cờ "chỉ đọc" ⇒ request chỉ có `type` + `blNo`.
    expect(Object.keys(message ?? {}).sort()).toEqual(['blNo', 'type'])
  })

  it('Enter khi CHƯA bật opt-in ⇒ KHÔNG gửi message nào', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await wrapper.find('input[type="text"]').trigger('keyup.enter')
    await flushPromises()

    // Enter y hệt nút đang bị disable ⇒ không làm gì cả.
    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(0)
  })

  it('Enter khi ĐÃ bật opt-in ⇒ gửi đúng MỘT message', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await checkbox(wrapper).setValue(true)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await wrapper.find('input[type="text"]').trigger('keyup.enter')
    await flushPromises()

    const message = sentMessages.find((m) => m.type === MSG_CREATE_MANIFEST)
    expect(message).toBeDefined()
    expect(message?.blNo).toBe('ONEYSHAGT1569600')
  })
})

describe('popup — lỗi vận chuyển', () => {
  it('sendMessage lỗi ⇒ báo lỗi cho operator và ghi chi tiết ra console', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    sendMessage = async () => {
      throw new Error('The message port closed before a response was received.')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      await wrapper.find('input[type="text"]').setValue('BL123')
      await clickCreate(wrapper)

      expect(wrapper.find('.message-error').text()).toBe(
        'Could not reach the page. Open the manifest declaration page, reload it, and try again.',
      )
      // Chi tiết kỹ thuật phải nằm ở console — không bị nuốt.
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('popup — hiện kết quả của lần chạy', () => {
  it('kết quả thành công ⇒ hiện ĐÚNG MỘT thông báo MÀU XANH, KHÔNG hiện các bước', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
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
        cargoRows: 1,
        containerRows: 1,
        billNo: 'BILL-1',
        billCreated: true,
        written: true,
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    // The steps of the run are NOT shown in the popup — the popup reports
    // only the final outcome (error / warning / success). The steps stay in
    // the result so they can be read back from the console.
    expect(wrapper.find('.steps').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Fetched the manifest data')
    expect(wrapper.text()).not.toContain('Created the manifest bill on the site')

    // EXACTLY ONE message — and it is GREEN.
    expect(wrapper.findAll('.message')).toHaveLength(1)
    const message = wrapper.find('.message')
    expect(message.classes()).toContain('message-success')
    expect(wrapper.find('.message-error').exists()).toBe(false)
    expect(wrapper.find('.message-warning').exists()).toBe(false)

    // The bill number the site assigned + the reminder to reload the manifest list.
    expect(message.text()).toContain(
      'The manifest was created on the site and saved as a draft (暂存).',
    )
    expect(message.text()).toContain('Bill number: BILL-1')
    expect(message.text()).toContain(
      'Refresh the manifest list on the site to see the new draft.',
    )

    // The "do not create another manifest for this bill" warning is the last line.
    expect(wrapper.find('.message-note').text()).toContain(
      'Do not create another manifest for this bill number.',
    )

    // No blank-field counts any more, no field list any more.
    expect(wrapper.find('.summary').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('cargo:')
    expect(wrapper.text()).not.toContain('blank fields')
    expect(wrapper.text()).not.toContain('PAY_WAY_ID')
    expect(wrapper.text()).not.toContain('付款方式')
    expect(wrapper.text()).not.toContain('The API does not provide the payment method.')
  })

  it('kết quả có report field + bill đã tạo ⇒ KHÔNG còn bảng "Field"/"Note" lẫn dòng bằng chứng', async () => {
    // Opt-in is already ON, so the "Create draft on site" button runs.
    store.createOnSite = true
    // The result carries BOTH a report field (`items`) AND `billCreated` — the
    // two things that were removed from the popup, so they must not come back.
    sendMessage = async () =>
      successResult({
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
        cargoRows: 1,
        containerRows: 1,
        billNo: 'BILL-1',
        billCreated: true,
        written: true,
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    // The report table (the "Field" / "Note" columns) is gone.
    expect(wrapper.find('table.table').exists()).toBe(false)
    // The "bill already created on the site" evidence line is gone.
    expect(wrapper.find('.bill-created').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('A manifest bill was already created on the site')
    // The list of REQUIRED fields is gone too — no field name leaks into the
    // single message.
    expect(wrapper.find('.blocking').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('PAY_WAY_ID')
    expect(wrapper.text()).not.toContain('付款方式')
    expect(wrapper.text()).not.toContain('The API does not provide the payment method.')
  })

  it('các bước KHÔNG hiện trên popup ⇒ nhưng vẫn được log ra console', async () => {
    // The step list is gone from the popup, so the steps must NOT vanish from
    // the product: they stay in the result and are logged to the console.
    // Without this test, deleting the log line would silently drop them
    // everywhere — the popup shows them and the console does not.
    store.createOnSite = true
    const steps = ['Fetched the manifest data', 'Created the manifest bill on the site']
    sendMessage = async () => successResult({ steps })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
      await clickCreate(wrapper)

      expect(infoSpy).toHaveBeenCalledWith('[manifest-autofill] manifest run steps', steps)
    } finally {
      infoSpy.mockRestore()
    }
  })

  it('ghi thành công ⇒ hiện cảnh báo ghi hai lần', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    sendMessage = async () =>
      successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    expect(wrapper.text()).toContain(
      'The manifest was created on the site and saved as a draft (暂存).',
    )
    expect(wrapper.find('.message-note').text()).toContain(
      'Do not create another manifest for this bill number.',
    )
  })

  it('ghi thành công ⇒ báo operator phải tải lại danh sách manifest trên site', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    // Danh sách manifest trên site là SPA ⇒ bill vừa tạo qua API KHÔNG có
    // trong danh sách cho tới khi trang được tải lại. Nút "Open page" KHÔNG
    // reload nữa ⇒ phải nói rõ điều đó.
    sendMessage = async () => successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    const message = wrapper.find('.message-success')
    expect(message.exists()).toBe(true)
    expect(message.text()).toContain(
      'The manifest was created on the site and saved as a draft (暂存).',
    )
    expect(message.text()).toContain(
      'Refresh the manifest list on the site to see the new draft.',
    )
  })

  it('bill tạo được nhưng lưu chưa xong ⇒ báo MÀU ĐỎ, KHÔNG nói "đã lưu"', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    // The core reports a failed save as a FAILED run (ok: false) whose message
    // says the bill WAS created on the site — that is the shape the popup sees.
    sendMessage = async () =>
      successResult({
        ok: false,
        billCreated: true,
        written: false,
        billNo: 'BILL-1',
        message:
          'The site rejected the request. Please try again in a moment. The manifest bill was created on the site. The extension never deletes bills on its own — please finish this manifest by hand on the site.',
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    // The run failed ⇒ RED, and the message of the run says the bill exists.
    expect(wrapper.findAll('.message')).toHaveLength(1)
    expect(wrapper.find('.message-error').exists()).toBe(true)
    expect(wrapper.find('.message-success').exists()).toBe(false)
    expect(wrapper.find('.message-warning').exists()).toBe(false)
    expect(wrapper.text()).toContain('The manifest bill was created on the site.')
    // The bill number stays visible — the operator needs it to find the draft.
    expect(wrapper.text()).toContain('Bill number: BILL-1')
    // The bill EXISTS on the site ⇒ the operator must not create a second one.
    expect(wrapper.find('.message-note').text()).toContain(
      'Do not create another manifest for this bill number.',
    )
    expect(wrapper.text()).not.toContain('saved as a draft (暂存)')
  })

  it('kết quả lỗi ⇒ hiện đúng message của lần chạy, MÀU ĐỎ', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    sendMessage = async () =>
      successResult({
        ok: false,
        message: 'No manifest was found for this bill of lading number.',
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    expect(wrapper.findAll('.message')).toHaveLength(1)
    expect(wrapper.find('.message-error').text()).toBe(
      'No manifest was found for this bill of lading number.',
    )
  })

  it('lỗi token/session hết hạn trên site ⇒ vẫn hiện MỘT thông báo MÀU ĐỎ', async () => {
    // The expired token/session is an error of the RESULT (it rides in
    // `result.message`) ⇒ the popup must not stay silent, and must not show
    // a second message block.
    store.createOnSite = true
    const expired =
      "Your session on the site has expired — log in to the site and try again. If you are still signed in, the site's token cookie may be HttpOnly, which the extension cannot read."
    sendMessage = async () => successResult({ ok: false, message: expired })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    expect(wrapper.findAll('.message')).toHaveLength(1)
    const message = wrapper.find('.message-error')
    expect(message.exists()).toBe(true)
    expect(message.text()).toBe(expired)
  })

  it('kết quả lỗi KHÔNG có message ⇒ vẫn hiện MỘT thông báo MÀU ĐỎ', async () => {
    // No message ⇒ the popup must not be left empty ⇒ use the fallback sentence.
    store.createOnSite = true
    sendMessage = async () => successResult({ ok: false })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    expect(wrapper.findAll('.message')).toHaveLength(1)
    const message = wrapper.find('.message-error')
    expect(message.exists()).toBe(true)
    expect(message.text().trim()).toBe('Something went wrong while running the manifest.')
  })

  it('kết quả "ok" mà KHÔNG có gì được lưu ⇒ vẫn báo, KHÔNG im lặng', async () => {
    // The core never reaches this state (it reports `ok` only after the draft
    // is saved) — but the popup must NEVER stay silent after a run.
    store.createOnSite = true
    sendMessage = async () => successResult()

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    expect(wrapper.findAll('.message')).toHaveLength(1)
    expect(wrapper.find('.message-warning').exists()).toBe(true)
    expect(wrapper.find('.message-main').text()).toBe(
      'The run finished but nothing was saved on the site.',
    )
  })

  it('field bắt buộc bị trống ⇒ KHÔNG hiện trên popup, nhưng vẫn được log ra console', async () => {
    // The field list has been removed from the popup ⇒ it must still be
    // reachable somewhere, or "which field is blank" vanishes from the product.
    store.createOnSite = true
    sendMessage = async () =>
      successResult({
        blocked: true,
        message:
          '1 field(s) required by the site are not provided by the API — fill them in by hand on the site.',
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
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      await wrapper.find('input[type="text"]').setValue('BL123')
      await clickCreate(wrapper)

      expect(infoSpy).toHaveBeenCalledWith(
        '[manifest-autofill] fields the site requires',
        ['付款方式 (PAY_WAY_ID) — The API does not provide the payment method.'],
      )
    } finally {
      infoSpy.mockRestore()
    }
  })

  it('còn field bắt buộc bị trống ⇒ báo MÀU VÀNG, KHÔNG liệt kê field', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    sendMessage = async () =>
      successResult({
        blocked: true,
        message:
          '1 field(s) required by the site are not provided by the API — fill them in by hand on the site.',
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
    await clickCreate(wrapper)

    // EXACTLY ONE message, YELLOW.
    expect(wrapper.findAll('.message')).toHaveLength(1)
    expect(wrapper.find('.message-warning').exists()).toBe(true)
    expect(wrapper.find('.message-error').exists()).toBe(false)
    expect(wrapper.find('.message-success').exists()).toBe(false)
    expect(wrapper.find('.message-main').text()).toContain(
      'required by the site are not provided by the API',
    )

    // The list of REQUIRED fields has been removed from the popup.
    expect(wrapper.find('.blocking').exists()).toBe(false)
    expect(wrapper.find('.blocking-note').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('PAY_WAY_ID')
    expect(wrapper.text()).not.toContain('付款方式')
    expect(wrapper.text()).not.toContain('The API does not provide the payment method.')
  })

  it('còn field bắt buộc bị trống nhưng ĐÃ ghi xong ⇒ vẫn thấy số bill và câu "đã lưu"', async () => {
    // A required field is still blank ⇒ YELLOW, but the bill WAS written ⇒
    // the bill number and the "saved as a draft" sentence must NOT be lost.
    store.createOnSite = true
    sendMessage = async () =>
      successResult({
        blocked: true,
        message:
          '1 field(s) required by the site are not provided by the API — fill them in by hand on the site.',
        billCreated: true,
        written: true,
        billNo: 'BILL-1',
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    expect(wrapper.findAll('.message')).toHaveLength(1)
    expect(wrapper.find('.message-warning').exists()).toBe(true)
    const message = wrapper.find('.message')
    expect(message.text()).toContain(
      'The manifest was created on the site and saved as a draft (暂存).',
    )
    expect(message.text()).toContain('Bill number: BILL-1')
  })
})

describe('popup — đọc setting thất bại', () => {
  it('storage.get lỗi ⇒ nút create TẮT, KHÔNG gửi message nào, lỗi ở khe riêng', async () => {
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
      // Cảnh báo "opt-in đang tắt" cũng KHÔNG được hiện — ta không biết
      // opt-in là gì thì không được khẳng định là nó đang tắt.
      expect(wrapper.find('.hint').exists()).toBe(false)
      // Lỗi đọc phải nằm ở khe lỗi của setting, không phải khe lỗi chạy.
      expect(wrapper.find('.settings-error').text()).toBe('Could not read the settings.')
      expect(wrapper.find('.message').exists()).toBe(false)

      // Nút create phải TẮT — không có cách nào ghi lên site.
      expect(isDisabled(wrapper, 'Create draft on site')).toBe(true)

      // Enter cũng KHÔNG chạy được — y hệt nút đang bị disable.
      await wrapper.find('input[type="text"]').setValue('BL123')
      await wrapper.find('input[type="text"]').trigger('keyup.enter')
      await flushPromises()

      expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(0)
      // Lỗi của setting vẫn còn nguyên.
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

  it('đọc được setting và opt-in ĐANG TẮT ⇒ hiện cảnh báo "đang tắt"', async () => {
    store.createOnSite = false

    const wrapper = mount(PopupApp)
    await flushPromises()

    const hint = wrapper.find('.hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('Creating a draft on the site is off')
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

  it('lưu THẤT BẠI mà nơi khác đã đổi setting trong lúc đang lưu ⇒ popup theo storage', async () => {
    // Opt-in tắt lúc đầu.
    store.createOnSite = false

    // Lần ghi của popup THẤT BẠI — và đúng lúc đó nơi khác BẬT opt-in.
    // Sự kiện của nơi khác tới lúc đang lưu ⇒ bị bỏ qua ⇒ lần đọc lại ở
    // nhánh thất bại là đường bù DUY NHẤT.
    storageSet = async () => {
      store.createOnSite = true
      emitStorageChange({ createOnSite: { newValue: true } })
      throw new Error('storage disabled')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      await checkbox(wrapper).setValue(true)
      await flushPromises()

      // Lỗi lưu vẫn được báo cho operator.
      expect(wrapper.find('.settings-error').text()).toBe(
        'Could not save the settings. Please try again.',
      )
      // Nhưng trạng thái phải khớp với STORAGE (đang BẬT) — không phải giá
      // trị cũ đã lưu (đang TẮT) ⇒ nếu không, popup nói "tắt" trong khi
      // storage nói "bật" ⇒ nút create bị khoá oan.
      expect(isChecked(wrapper)).toBe(true)
      expect(isDisabled(wrapper, 'Create draft on site')).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('lưu lỗi VÀ lần đọc bù cũng lỗi ⇒ báo CẢ HAI lỗi, không lỗi nào giấu lỗi nào', async () => {
    // Opt-in đã lưu là `false` ⇒ đây là giá trị ĐÃ XÁC NHẬN của popup.
    store.createOnSite = false
    storageSet = async () => {
      throw new Error('storage disabled')
    }
    // Lần đọc ĐẦU (lúc mount) thành công ⇒ control hiện và có giá trị đã
    // xác nhận; mọi lần đọc SAU đó hỏng ⇒ lần đọc bù hỏng theo.
    let getCalls = 0
    storageGet = async () => {
      getCalls += 1
      if (getCalls === 1) return { ...store }
      throw new Error('storage disabled')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      expect(checkbox(wrapper).exists()).toBe(true)
      expect(isChecked(wrapper)).toBe(false)

      await checkbox(wrapper).setValue(true)
      await flushPromises()

      // HAI nguyên nhân khác nhau (lưu hỏng + đọc hỏng) ⇒ operator phải thấy
      // CẢ HAI: lỗi đọc không được bị lỗi lưu giấu mất (và ngược lại).
      const error = wrapper.find('.settings-error').text()
      expect(error).toContain('Could not save the settings. Please try again.')
      expect(error).toContain('Could not read the settings.')
      // Checkbox về giá trị ĐÃ XÁC NHẬN (fail-closed) — không giữ tick của
      // lựa chọn chưa lưu được, và không bịa ra một trạng thái lưu mà ta
      // không xác nhận được.
      expect(isChecked(wrapper)).toBe(false)
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('lưu THẤT BẠI khi operator BỎ TICK opt-in, nơi khác cũng TẮT trong lúc đang lưu ⇒ popup theo storage và VẪN báo lỗi', async () => {
    // KHÔNG phải máy dò lỗi: bản code CŨ cũng đi theo storage ở kịch bản này
    // ⇒ đây là CHỐT HỘ (regression guard) cho bất biến "lưu hỏng ⇒ popup vẫn
    // theo storage VÀ vẫn báo lỗi cho operator".
    //
    // Gương của test ngay trên: opt-in đang BẬT, operator bỏ tick, lần ghi
    // của popup hỏng, và đúng lúc đó nơi khác TẮT opt-in.
    store.createOnSite = true

    // Lần ghi của popup THẤT BẠI — và đúng lúc đó nơi khác TẮT opt-in.
    // Sự kiện của nơi khác tới lúc đang lưu ⇒ bị bỏ qua ⇒ lần đọc lại ở
    // nhánh thất bại là đường bù DUY NHẤT.
    storageSet = async () => {
      store.createOnSite = false
      emitStorageChange({ createOnSite: { newValue: false } })
      throw new Error('storage disabled')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      // Opt-in đang BẬT ⇒ checkbox tick.
      expect(isChecked(wrapper)).toBe(true)

      // Operator muốn TẮT opt-in.
      await checkbox(wrapper).setValue(false)
      await flushPromises()

      // Storage đang TẮT ⇒ popup phải theo storage: không tick, nút create
      // khoá (không được hứa "đã bật" khi storage đang tắt).
      expect(isChecked(wrapper)).toBe(false)
      expect(isDisabled(wrapper, 'Create draft on site')).toBe(true)
      // Lỗi lưu VẪN phải được báo — lần đọc bù xoá `settingsError` nên nhánh
      // thất bại phải báo lại sau khi đọc xong.
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
    expect(wrapper.find('.message').exists()).toBe(false)
  })
})

describe('popup — ảnh chụp CŨ không được ghi đè giá trị mới', () => {
  it('thay đổi tới trong lúc đang đọc ⇒ ảnh chụp cũ bị bỏ qua', async () => {
    // Storage lúc đầu: opt-in ĐANG BẬT.
    store.createOnSite = true

    // Lần đọc ĐẦU (lúc mount) treo ⇒ test tự resolve sau, với một ẢNH CHỤP
    // CŨ (`true`). Những lần đọc sau trả ngay.
    let firstResolve: ((values: Record<string, unknown>) => void) | undefined
    let getCalls = 0
    storageGet = () => {
      getCalls += 1
      if (getCalls === 1) {
        return new Promise((resolve) => {
          firstResolve = resolve
        })
      }
      return Promise.resolve({ ...store })
    }

    const wrapper = mount(PopupApp)
    await flushPromises()

    // Lần đọc đầu chưa xong ⇒ chưa có control.
    expect(checkbox(wrapper).exists()).toBe(false)

    // Nơi khác tắt opt-in rồi báo thay đổi ⇒ popup đọc lại và thấy `false`.
    store.createOnSite = false
    emitStorageChange({ createOnSite: { newValue: false } })
    await flushPromises()

    expect(isChecked(wrapper)).toBe(false)
    expect(isDisabled(wrapper, 'Create draft on site')).toBe(true)

    // Lần đọc đầu vừa về — nhưng nó là ẢNH CHỤP CŨ (`true`) ⇒ KHÔNG được
    // ghi đè giá trị mới (`false`).
    firstResolve?.({ createOnSite: true })
    await flushPromises()

    expect(isChecked(wrapper)).toBe(false)
    expect(isDisabled(wrapper, 'Create draft on site')).toBe(true)
  })
})

describe('popup — kết quả của lần chạy TRƯỚC được đánh dấu là cũ', () => {
  it('lần chạy đang bay ⇒ có dòng "đang hiện kết quả cũ"', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    sendMessage = async () => successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    // Kết quả đầu tiên đang hiện, chưa có gì cũ.
    expect(wrapper.find('.message-success').exists()).toBe(true)
    expect(wrapper.find('.stale-result').exists()).toBe(false)

    // Lần chạy thứ hai treo ⇒ kết quả CŨ vẫn còn trên màn hình nhưng phải
    // được đánh dấu là cũ, nếu không operator tưởng đó là kết quả của số bill
    // vừa gõ.
    let resolveSend: ((value: unknown) => void) | undefined
    sendMessage = async () =>
      new Promise((resolve) => {
        resolveSend = resolve
      })
    await clickCreate(wrapper)

    expect(wrapper.find('.stale-result').exists()).toBe(true)
    expect(wrapper.find('.stale-result').text()).toBe(
      'Showing the previous result — a new run is in progress.',
    )
    expect(wrapper.find('.message-success').exists()).toBe(true)

    resolveSend?.(successResult())
    await flushPromises()

    // Kết quả mới đã về ⇒ hết cờ cũ.
    expect(wrapper.find('.stale-result').exists()).toBe(false)
  })

  it('lần chạy bị chặn vì ô nhập rỗng ⇒ kết quả cũ KHÔNG bị đánh dấu là cũ', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    sendMessage = async () => successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    await wrapper.find('input[type="text"]').setValue('')
    await wrapper.find('input[type="text"]').trigger('keyup.enter')
    await flushPromises()

    // Không có lần chạy nào mới ⇒ kết quả đang hiện vẫn là kết quả HIỆN HÀNH.
    //
    // Assert trên NỘI DUNG, không assert trên class: class đổi tên thì assert
    // theo class vẫn xanh (⇒ test hỏng mà không báo), còn assert theo câu
    // thì bắt được cả trường hợp banner không bao giờ hiện.
    expect(wrapper.text()).not.toContain('Showing the previous result')
    // The run was blocked because the input is empty ⇒ the popup shows the
    // RED error, and that is the ONLY message (the old result is not shown
    // with it).
    expect(wrapper.findAll('.message')).toHaveLength(1)
    expect(wrapper.find('.message-error').text()).toBe('Enter a bill of lading number first.')
  })

  it('gõ bill KHÁC bill của report đang hiện ⇒ banner báo report thuộc bill KHÁC', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    sendMessage = async () => successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    // Report của bill A đang hiện, ô nhập cũng là A ⇒ chưa có gì cũ.
    expect(wrapper.text()).not.toContain('Showing the previous result')

    // Operator gõ bill B ⇒ report trên màn hình là của A, không phải của B.
    // Đây là lúc operator DỄ ĐỌC NHẦM nhất ("đã tạo manifest" của B?)
    // ⇒ phải có dấu hiệu.
    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569601')
    await flushPromises()

    expect(wrapper.find('.stale-result').exists()).toBe(true)
    expect(wrapper.find('.stale-result').text()).toBe(
      'Showing the previous result — it belongs to a different bill of lading number.',
    )
  })

  it('lần chạy HỎNG ⇒ banner KHÔNG nói "đang có lần chạy"', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    sendMessage = async () => successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    // Lần chạy sau HỎNG: content script không còn đó.
    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569601')
    sendMessage = async () => {
      throw new Error('The message port closed before a response was received.')
    }
    await clickCreate(wrapper)

    // Lần chạy đã hỏng ⇒ KHÔNG được nói "đang có lần chạy" (nút đã hết
    // trạng thái busy) — operator không được đứng đợi một lần chạy đã chết.
    expect(wrapper.text()).not.toContain('a new run is in progress')
    // The message on screen is the ERROR of the run that just failed, NOT the
    // previous result ⇒ the "previous result" banner must be gone (saying
    // "previous result" would be a lie — nothing of it is on screen).
    expect(wrapper.find('.stale-result').exists()).toBe(false)
    expect(wrapper.findAll('.message')).toHaveLength(1)
    expect(wrapper.find('.message-error').text()).toBe(
      'Could not reach the page. Open the manifest declaration page, reload it, and try again.',
    )
  })

  it('lần chạy THÀNH CÔNG cho bill KHÁC ⇒ banner biến mất', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    sendMessage = async () => successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    // Lần chạy đầu cho bill A.
    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    // Lần chạy sau cho bill B, THÀNH CÔNG ⇒ report trên màn hình là của B
    // ⇒ KHÔNG được gắn nhãn "của bill khác".
    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569601')
    sendMessage = async () => successResult({ billCreated: true, written: true, billNo: 'BILL-2' })
    await clickCreate(wrapper)

    expect(wrapper.find('.stale-result').exists()).toBe(false)
    expect(wrapper.text()).toContain('Bill number: BILL-2')
  })

  it('lần chạy trả về KẾT QUẢ LỖI cho bill KHÁC ⇒ banner biến mất', async () => {
    // Opt-in ĐÃ bật ⇒ nút "Create draft on site" chạy được.
    store.createOnSite = true
    sendMessage = async () => successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    // Lần chạy đầu cho bill A.
    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    // Lần chạy sau cho bill B, site TỪ CHỐI ⇒ report MỚI (lỗi của B) thay
    // thế report cũ ⇒ report đang hiện là của B ⇒ không gắn nhãn "bill khác".
    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569601')
    sendMessage = async () =>
      successResult({
        ok: false,
        message: 'No manifest was found for this bill of lading number.',
      })
    await clickCreate(wrapper)

    expect(wrapper.find('.stale-result').exists()).toBe(false)
    expect(wrapper.find('.message-error').text()).toBe(
      'No manifest was found for this bill of lading number.',
    )
  })
})

describe('popup — hội tụ về storage sau khi lưu', () => {
  it('thay đổi tới TỪ NGOÀI trong lúc đang lưu ⇒ popup theo giá trị CUỐI CÙNG trong storage', async () => {
    // Opt-in tắt lúc đầu.
    store.createOnSite = false

    // Trong lúc popup đang lưu thì nơi khác ghi đè ⇒ giá trị CUỐI CÙNG
    // trong storage là `false` (ai ghi cuối cùng thì thắng).
    storageSet = async (values) => {
      Object.assign(store, values)
      Object.assign(store, { createOnSite: false })
      emitStorageChange({ createOnSite: { newValue: values.createOnSite } })
      emitStorageChange({ createOnSite: { newValue: false } })
    }

    const wrapper = mount(PopupApp)
    await flushPromises()

    await checkbox(wrapper).setValue(true)
    await flushPromises()

    expect(store.createOnSite).toBe(false)
    // Popup KHÔNG được tin giá trị trả về của lần ghi (vẫn là `true`) — nó
    // phải đọc lại storage ⇒ thấy `false` ⇒ không tick. Nếu tin giá trị
    // patch thì popup và storage LỆCH nhau ⇒ content script từ chối ghi mà
    // operator không hiểu vì sao.
    expect(isChecked(wrapper)).toBe(false)
    expect(wrapper.find('.settings-error').exists()).toBe(false)
  })
})

describe('popup — hội tụ về giá trị ĐÃ LƯU trong storage', () => {
  it('sự kiện mang giá trị KHÁC storage ⇒ popup vẫn theo storage', async () => {
    // Storage đang bật opt-in.
    store.createOnSite = true

    const wrapper = mount(PopupApp)
    await flushPromises()

    expect(isChecked(wrapper)).toBe(true)

    // Sự kiện mang giá trị CŨ. Popup KHÔNG được dùng giá trị của sự kiện
    // (nó tính từ CHỈ những key đổi ⇒ không biết fallback của key legacy) —
    // popup phải ĐỌC LẠI storage ⇒ thấy `true` ⇒ vẫn tick.
    emitStorageChange({ createOnSite: { newValue: false } })
    await flushPromises()

    expect(isChecked(wrapper)).toBe(true)
    expect(isDisabled(wrapper, 'Create draft on site')).toBe(false)
  })

  it('sự kiện của nơi khác tới GIỮA lúc đang lưu ⇒ checkbox KHÔNG bị tự bỏ tick', async () => {
    // Opt-in tắt lúc đầu.
    store.createOnSite = false

    // Lần ghi của popup TREO ⇒ `saving` còn `true` ⇒ popup đang lưu.
    let resolveSet: (() => void) | undefined
    storageSet = (values) =>
      new Promise((resolve) => {
        resolveSet = () => {
          Object.assign(store, values)
          const changes: Record<string, { newValue?: unknown }> = {}
          for (const [key, value] of Object.entries(values)) changes[key] = { newValue: value }
          emitStorageChange(changes)
          resolve(undefined)
        }
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await checkbox(wrapper).setValue(true)
    await flushPromises()

    expect(isChecked(wrapper)).toBe(true)

    // Nơi khác đổi một setting KHÁC, đúng lúc popup đang lưu. Lúc này
    // storage CHƯA có giá trị mới ⇒ nếu popup đọc lại storage thì nó thấy
    // `createOnSite: false` ⇒ checkbox bị tự bỏ tick ⇒ mất lựa chọn của
    // operator (dù lần ghi của popup sắp ghi đúng giá trị đó).
    emitStorageChange({ apiBase: { newValue: 'https://other.test/' } })
    await flushPromises()

    expect(isChecked(wrapper)).toBe(true)

    // Lần ghi của popup đến ⇒ giá trị cuối cùng trong storage là `true`.
    resolveSet?.()
    await flushPromises()

    expect(store.createOnSite).toBe(true)
    expect(isChecked(wrapper)).toBe(true)
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

  it('tick xong mà lần lưu CHƯA xong ⇒ nút create vẫn TẮT', async () => {
    // Lần lưu treo ⇒ setting chưa vào storage.
    let resolveSet: (() => void) | undefined
    storageSet = async (values) => {
      await new Promise<void>((resolve) => {
        resolveSet = resolve
      })
      Object.assign(store, values)
    }

    const wrapper = mount(PopupApp)
    await flushPromises()

    await checkbox(wrapper).setValue(true)
    await flushPromises()

    // Checkbox đã tick, nhưng setting CHƯA lưu xong ⇒ nút create phải TẮT.
    // Nếu bật, operator bấm là content script từ chối (nó kiểm tra setting
    // ĐÃ LƯU) mà popup không hiện được lý do.
    expect(isChecked(wrapper)).toBe(true)
    expect(isDisabled(wrapper, 'Create draft on site')).toBe(true)

    resolveSet?.()
    await flushPromises()

    // Lần lưu xong ⇒ nút create bật.
    expect(isDisabled(wrapper, 'Create draft on site')).toBe(false)
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
    expect(tabUpdates).toEqual([{ tabId: 1, url: MANIFEST_URL, active: true }])
    // KHÔNG được mở thêm tab mới — người dùng chọn điều hướng tab hiện tại.
    expect(createdTabs).toEqual([])
    // Tab KHÔNG đang ở trang khai báo ⇒ không reload.
    expect(tabReloads).toEqual([])
  })

  it('tab ĐANG ở trang khai báo ⇒ đưa tab lên trước, KHÔNG reload, KHÔNG điều hướng', async () => {
    activeTabUrl = MANIFEST_URL
    const wrapper = mount(PopupApp)
    await flushPromises()

    await buttonByText(wrapper, 'Open page').trigger('click')
    await flushPromises()

    // "Open page" là hành động ĐIỀU HƯỚNG ⇒ không được xoá trạng thái
    // trang: reload sẽ xoá sạch những gì operator đã gõ trên form manifest
    // (mà chính operator phải điền tay sau khi extension tạo nháp).
    expect(tabReloads).toEqual([])
    // Đã ở đúng trang ⇒ chỉ đưa tab lên trước, KHÔNG đổi URL.
    expect(tabUpdates).toEqual([{ tabId: 1, url: undefined, active: true }])
    expect(createdTabs).toEqual([])
  })

  it('tab ở route ANH EM (…maintenanceOfManifestDataExtra) ⇒ điều hướng, KHÔNG reload', async () => {
    // Route của site là TIỀN TỐ của route này ⇒ so tiền tố sẽ nhận nhầm:
    // reload xong content script vẫn từ chối ⇒ operator mắc vòng lặp
    // không thoát ra được. Đây là chốt hộ cho đúng lỗi đó.
    activeTabUrl =
      'https://www.chinaports-agency.com:8870/#/exportBusinessOperations/maintenanceOfManifestDataExtra'
    const wrapper = mount(PopupApp)
    await flushPromises()

    await buttonByText(wrapper, 'Open page').trigger('click')
    await flushPromises()

    // KHÔNG phải trang khai báo ⇒ phải điều hướng tab, KHÔNG reload.
    expect(tabUpdates).toEqual([{ tabId: 1, url: MANIFEST_URL, active: true }])
    expect(tabReloads).toEqual([])
    expect(createdTabs).toEqual([])
  })

  it('tab cùng origin nhưng route KHÁC ⇒ điều hướng, KHÔNG reload', async () => {
    // Cùng origin nhưng route khác ⇒ KHÔNG phải trang khai báo — cái quyết
    // định là ROUTE, không phải origin.
    activeTabUrl = 'https://www.chinaports-agency.com:8870/#/someOtherRoute'
    const wrapper = mount(PopupApp)
    await flushPromises()

    await buttonByText(wrapper, 'Open page').trigger('click')
    await flushPromises()

    expect(tabUpdates).toEqual([{ tabId: 1, url: MANIFEST_URL, active: true }])
    expect(tabReloads).toEqual([])
    expect(createdTabs).toEqual([])
  })
})
