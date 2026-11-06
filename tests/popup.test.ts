import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PopupApp from '../src/popup/App.vue'
import { MSG_CREATE_MANIFEST } from '../src/core/protocol'
import { DEFAULT_SETTINGS } from '../src/core/options'
import { MANIFEST_URL, SITE_HOME_URL } from '../src/core/site-url'
import { LOGIN_CREDENTIALS_KEY } from '../src/core/login-credentials'

/**
 * Test tầng WIRING của popup — không chỉ test primitive (`saveSettings`,
 * `withDeadline`) mà test chính component `src/popup/App.vue`.
 *
 * Stub `chrome` giống hệt pattern của `tests/options.test.ts`: store trong
 * memory + `vi.stubGlobal`.
 */

const store: Record<string, unknown> = {}
/** The store of `chrome.storage.local` — the login details live there. */
const localStore: Record<string, unknown> = {}

type StorageGet = (
  defaults?: Record<string, unknown> | null,
) => Promise<Record<string, unknown>>
type StorageSet = (values: Record<string, unknown>) => Promise<void>
type LocalGet = (key: string) => Promise<Record<string, unknown>>
type LocalSet = (values: Record<string, unknown>) => Promise<void>
type SentMessage = { type: string; [key: string]: unknown }
type SendMessage = (message: SentMessage) => Promise<unknown>
type StorageListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void
type TabChangeInfo = { status?: string }
type TabUpdatedListener = (tabId: number, changeInfo: TabChangeInfo) => void
type TabRemovedInfo = { windowId: number; isWindowClosing: boolean }
type TabRemovedListener = (tabId: number, removeInfo: TabRemovedInfo) => void

let storageGet: StorageGet
let storageSet: StorageSet
let localGet: LocalGet
let localSet: LocalSet
let sendMessage: SendMessage
/** Ghi lại type của mọi message đã gửi đi — để assert "KHÔNG được gửi". */
let sentTypes: string[]
/** Ghi lại TOÀN BỘ message đã gửi đi — để assert payload (vd `blNo`). */
let sentMessages: SentMessage[]
/** The id of the tab that received a message — to assert WHICH tab got it. */
let sentTabIds: number[]
/** Ghi lại mọi lần ĐIỀU HƯỚNG tab — để assert tab nào bị đổi URL. */
let tabUpdates: { tabId: number; url?: string; active?: boolean }[]
/** Ghi lại mọi lần TẠO tab mới — để assert không mở tab mới. */
let createdTabs: (string | undefined)[]
/** The details of a created tab — its id, its URL and its `active` flag. */
let createdTabRecords: { id: number; url?: string; active?: boolean }[]
/** Ghi lại mọi lần TẢI LẠI tab — để assert tab đang ở trang khai báo được reload. */
let tabReloads: number[]
/** URL của tab active trong stub — đổi được để test cả nhánh "đã ở trang khai báo". */
let activeTabUrl: string
/** Id của tab active — `undefined` ⇒ KHÔNG có tab active nào. */
let activeTabId: number | undefined
/** Listener của `chrome.storage.onChanged` — để test đổi setting từ nơi khác. */
let storageListeners: StorageListener[]
/** The listeners of `chrome.tabs.onUpdated` — the "the tab is loaded" event. */
let tabUpdatedListeners: TabUpdatedListener[]
/** The listeners of `chrome.tabs.onRemoved` — the "the tab was closed" event. */
let tabRemovedListeners: TabRemovedListener[]
/** The state of the tabs the stub knows (id → tab). */
const tabStates = new Map<number, { id: number; url?: string; status: string }>()
/** The id of the next created tab. */
let nextTabId: number
/** The status of a NEWLY created tab — the real browser says `'loading'`. */
let createdTabStatus: string
/** The ids of the tabs that are GONE (closed) — `chrome.tabs.get` rejects. */
let goneTabIds: Set<number>
/** How many sends are rejected with the "no receiver" rejection of Chrome. */
let noReceiverCount: number
/** Called every time the stub answers `chrome.tabs.get` — a test may use it. */
let onTabGet: ((tabId: number) => void) | undefined

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  for (const key of Object.keys(localStore)) delete localStore[key]
  tabStates.clear()
  sentTypes = []
  sentMessages = []
  sentTabIds = []
  tabUpdates = []
  createdTabs = []
  createdTabRecords = []
  tabReloads = []
  storageListeners = []
  tabUpdatedListeners = []
  tabRemovedListeners = []
  nextTabId = 100
  createdTabStatus = 'loading'
  goneTabIds = new Set()
  noReceiverCount = 0
  onTabGet = undefined
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
  localGet = async (key) => (key in localStore ? { [key]: localStore[key] } : {})
  localSet = async (values) => {
    Object.assign(localStore, values)
  }
  sendMessage = async () => successResult()

  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: (defaults?: Record<string, unknown> | null) => storageGet(defaults),
        set: (values: Record<string, unknown>) => storageSet(values),
      },
      local: {
        get: (key: string) => localGet(key),
        set: (values: Record<string, unknown>) => localSet(values),
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
      get: async (tabId: number) => {
        onTabGet?.(tabId)
        // The real browser rejects when the tab was closed.
        if (goneTabIds.has(tabId)) throw new Error(`No tab with id: ${tabId}.`)
        const known = tabStates.get(tabId)
        if (known) return known
        return { id: tabId, url: activeTabUrl, status: 'complete' }
      },
      reload: async (tabId: number) => {
        tabReloads.push(tabId)
        // The real browser reports "the tab is loaded" after a reload.
        markTabComplete(tabId)
        return undefined
      },
      sendMessage: (tabId: number, message: SentMessage) => {
        sentTabIds.push(tabId)
        sentTypes.push(message.type)
        // Copy chứ không giữ tham chiếu — để assert không bị ảnh hưởng nếu
        // sau này ai đó sửa lại object message đã gửi.
        sentMessages.push({ ...message })
        // The real browser rejects when the tab has NO listener (the content
        // script is not in it yet).
        if (noReceiverCount > 0) {
          noReceiverCount -= 1
          return Promise.reject(
            new Error('Could not establish connection. Receiving end does not exist.'),
          )
        }
        return sendMessage(message)
      },
      create: async (props: { url?: string; active?: boolean }) => {
        createdTabs.push(props.url)
        const id = nextTabId
        nextTabId += 1
        createdTabRecords.push({ id, url: props.url, active: props.active })
        const tab = { id, url: props.url, status: createdTabStatus }
        tabStates.set(id, tab)
        return tab
      },
      update: async (tabId: number, props: { url?: string; active?: boolean }) => {
        tabUpdates.push({ tabId, url: props.url, active: props.active })
        // The real browser reports "the tab is loaded" after a NAVIGATION —
        // bringing a tab to the front does NOT reload the page.
        if (props.url !== undefined) markTabComplete(tabId)
        return undefined
      },
      onUpdated: {
        addListener: (fn: TabUpdatedListener) => {
          tabUpdatedListeners.push(fn)
        },
        removeListener: (fn: TabUpdatedListener) => {
          tabUpdatedListeners = tabUpdatedListeners.filter((listener) => listener !== fn)
        },
      },
      onRemoved: {
        addListener: (fn: TabRemovedListener) => {
          tabRemovedListeners.push(fn)
        },
        removeListener: (fn: TabRemovedListener) => {
          tabRemovedListeners = tabRemovedListeners.filter((listener) => listener !== fn)
        },
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Tell the stub that the tab is loaded — the `onUpdated` event of the browser.
 */
function markTabComplete(tabId: number): void {
  const tab = tabStates.get(tabId)
  if (tab) tab.status = 'complete'
  for (const listener of [...tabUpdatedListeners]) listener(tabId, { status: 'complete' })
}

/**
 * Flush the pending promises — works with the real timers AND with the fake
 * ones (the fake `setTimeout` would make `flushPromises` wait forever).
 */
async function flushPending(): Promise<void> {
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0)
    return
  }
  await flushPromises()
}

/**
 * The tab that was created finishes loading — the `onUpdated` event.
 *
 * A NEW tab of the site starts with the status `loading` (like the real
 * browser) ⇒ the popup waits for it before it sends the message ⇒ a test
 * that creates a tab must drive the load itself.
 */
async function completeCreatedTab(index = 0): Promise<void> {
  await flushPending()
  const id = createdTabRecords[index]?.id
  if (id === undefined) throw new Error('no tab was created')
  markTabComplete(id)
  await flushPending()
}

/**
 * The tab is closed — the `onRemoved` event of the browser.
 *
 * A closed tab never fires `complete` ⇒ the popup must notice the closure.
 */
function removeTab(tabId: number): void {
  goneTabIds.add(tabId)
  tabStates.delete(tabId)
  for (const listener of [...tabRemovedListeners]) {
    listener(tabId, { windowId: -1, isWindowClosing: false })
  }
}

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

/**
 * The tick box of the login mode.
 *
 * It is the ONLY tick box of the popup: the "create the manifest on the site"
 * opt-in is GONE (the extension always creates the manifest on the site).
 */
function loginTokenCheckbox(wrapper: ReturnType<typeof mount>) {
  const box = wrapper.find('input[type="checkbox"]')
  if (!box.exists()) throw new Error('could not find the login token checkbox')
  return box
}

/** Is the tick box of the login mode ticked? */
function isLoginTokenChecked(wrapper: ReturnType<typeof mount>): boolean {
  return (loginTokenCheckbox(wrapper).element as HTMLInputElement).checked
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
  const el = loginTokenCheckbox(wrapper).element as HTMLInputElement
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
 * The button never waits for an opt-in any more: the extension always creates
 * the manifest on the site.
 */
async function clickCreate(wrapper: ReturnType<typeof mount>): Promise<void> {
  await buttonByText(wrapper, 'Create draft on site').trigger('click')
  await flushPromises()
}

describe('popup — chạy manifest qua API', () => {
  it('ô trống ⇒ báo lỗi và KHÔNG gửi message nào', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').trigger('keyup.enter')
    await flushPromises()

    expect(wrapper.find('.message-error').text()).toBe('Enter a bill of lading number first.')
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

  it('message KHÔNG mang cờ nào, chỉ có `blNo`', async () => {
    const wrapper = mount(PopupApp)
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

  it('Enter ⇒ gửi đúng MỘT message', async () => {
    const wrapper = mount(PopupApp)
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
  it('storage.get lỗi ⇒ lỗi ở khe riêng, KHÔNG lẫn vào khe lỗi chạy', async () => {
    // The opt-in is GONE ⇒ a failed read of the settings cannot stop the run
    // (the content script reads the settings on its own). The error must
    // still reach the operator in its OWN slot.
    storageGet = async () => {
      throw new Error('storage disabled')
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      // Lỗi đọc phải nằm ở khe lỗi của setting, không phải khe lỗi chạy.
      expect(wrapper.find('.settings-error').text()).toBe('Could not read the settings.')
      expect(wrapper.find('.message').exists()).toBe(false)

      // Lỗi của setting vẫn còn nguyên.
      expect(wrapper.find('.settings-error').exists()).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('popup — ô tick chế độ đăng nhập chỉ hiện SAU khi đọc setting xong', () => {
  it('setting đọc chưa xong ⇒ chưa có ô tick', async () => {
    // Giữ promise `get` treo ⇒ `onMounted` chưa xong.
    let resolveGet: ((values: Record<string, unknown>) => void) | undefined
    storageGet = () =>
      new Promise((resolve) => {
        resolveGet = resolve
      })

    const wrapper = mount(PopupApp)
    await flushPromises()

    // Control chưa có ⇒ không thể tick sớm (không đè lên lựa chọn của user).
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)

    resolveGet?.({ ...DEFAULT_SETTINGS })
    await flushPromises()

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true)
  })

  it('setting đổi từ nơi khác ⇒ ô tick cập nhật ngay', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    expect(isLoginTokenChecked(wrapper)).toBe(false)

    // Trang options bật chế độ đăng nhập ⇒ storage đổi ⇒ popup phải thấy ngay.
    store.loginToken = true
    emitStorageChange({ loginToken: { newValue: true } })
    await flushPromises()

    expect(isLoginTokenChecked(wrapper)).toBe(true)
  })
})

describe('popup — lưu setting thất bại', () => {
  it('lưu THẤT BẠI mà nơi khác đã đổi setting trong lúc đang lưu ⇒ popup theo storage', async () => {
    // Chế độ đăng nhập tắt lúc đầu.
    store.loginToken = false

    // Lần ghi của popup THẤT BẠI — và đúng lúc đó nơi khác BẬT chế độ đăng
    // nhập. Sự kiện của nơi khác tới lúc đang lưu ⇒ bị bỏ qua ⇒ lần đọc lại ở
    // nhánh thất bại là đường bù DUY NHẤT.
    storageSet = async () => {
      store.loginToken = true
      emitStorageChange({ loginToken: { newValue: true } })
      throw new Error('storage disabled')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      await loginTokenCheckbox(wrapper).setValue(true)
      await flushPromises()

      // Lỗi lưu vẫn được báo cho operator.
      expect(wrapper.find('.settings-error').text()).toBe(
        'Could not save the settings. Please try again.',
      )
      // Nhưng trạng thái phải khớp với STORAGE (đang BẬT) — không phải giá
      // trị cũ đã lưu (đang TẮT) ⇒ nếu không, popup nói "tắt" trong khi
      // storage nói "bật" ⇒ lần chạy đi sai chế độ.
      expect(isLoginTokenChecked(wrapper)).toBe(true)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('lưu lỗi VÀ lần đọc bù cũng lỗi ⇒ báo CẢ HAI lỗi, không lỗi nào giấu lỗi nào', async () => {
    // Chế độ đăng nhập đã lưu là `false` ⇒ đây là giá trị ĐÃ XÁC NHẬN của
    // popup.
    store.loginToken = false
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

      expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true)
      expect(isLoginTokenChecked(wrapper)).toBe(false)

      await loginTokenCheckbox(wrapper).setValue(true)
      await flushPromises()

      // HAI nguyên nhân khác nhau (lưu hỏng + đọc hỏng) ⇒ operator phải thấy
      // CẢ HAI: lỗi đọc không được bị lỗi lưu giấu mất (và ngược lại).
      const error = wrapper.find('.settings-error').text()
      expect(error).toContain('Could not save the settings. Please try again.')
      expect(error).toContain('Could not read the settings.')
      // Ô tick về giá trị ĐÃ XÁC NHẬN (fail-closed) — không giữ tick của
      // lựa chọn chưa lưu được, và không bịa ra một trạng thái lưu mà ta
      // không xác nhận được.
      expect(isLoginTokenChecked(wrapper)).toBe(false)
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('lưu THẤT BẠI khi operator BỎ TICK, nơi khác cũng TẮT trong lúc đang lưu ⇒ popup theo storage và VẪN báo lỗi', async () => {
    // KHÔNG phải máy dò lỗi: bản code CŨ cũng đi theo storage ở kịch bản này
    // ⇒ đây là CHỐT HỘ (regression guard) cho bất biến "lưu hỏng ⇒ popup vẫn
    // theo storage VÀ vẫn báo lỗi cho operator".
    //
    // Gương của test ngay trên: chế độ đăng nhập đang BẬT, operator bỏ tick,
    // lần ghi của popup hỏng, và đúng lúc đó nơi khác TẮT.
    store.loginToken = true

    // Lần ghi của popup THẤT BẠI — và đúng lúc đó nơi khác TẮT.
    // Sự kiện của nơi khác tới lúc đang lưu ⇒ bị bỏ qua ⇒ lần đọc lại ở
    // nhánh thất bại là đường bù DUY NHẤT.
    storageSet = async () => {
      store.loginToken = false
      emitStorageChange({ loginToken: { newValue: false } })
      throw new Error('storage disabled')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      // Chế độ đăng nhập đang BẬT ⇒ ô tick.
      expect(isLoginTokenChecked(wrapper)).toBe(true)

      // Operator muốn TẮT chế độ đăng nhập.
      await loginTokenCheckbox(wrapper).setValue(false)
      await flushPromises()

      // Storage đang TẮT ⇒ popup phải theo storage: không tick (không được
      // hứa "đã bật" khi storage đang tắt).
      expect(isLoginTokenChecked(wrapper)).toBe(false)
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
  it('lưu được ⇒ ô tick giữ nguyên ticked và không báo lỗi', async () => {
    store.loginToken = false

    const wrapper = mount(PopupApp)
    await flushPromises()

    await loginTokenCheckbox(wrapper).setValue(true)
    await flushPromises()

    expect(store.loginToken).toBe(true)
    expect(isLoginTokenChecked(wrapper)).toBe(true)
    expect(wrapper.find('.settings-error').exists()).toBe(false)
    expect(wrapper.find('.message').exists()).toBe(false)
  })
})

describe('popup — ảnh chụp CŨ không được ghi đè giá trị mới', () => {
  it('thay đổi tới trong lúc đang đọc ⇒ ảnh chụp cũ bị bỏ qua', async () => {
    // Storage lúc đầu: chế độ đăng nhập ĐANG BẬT.
    store.loginToken = true

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
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)

    // Nơi khác tắt chế độ đăng nhập rồi báo thay đổi ⇒ popup đọc lại và thấy
    // `false`.
    store.loginToken = false
    emitStorageChange({ loginToken: { newValue: false } })
    await flushPromises()

    expect(isLoginTokenChecked(wrapper)).toBe(false)

    // Lần đọc đầu vừa về — nhưng nó là ẢNH CHỤP CŨ (`true`) ⇒ KHÔNG được
    // ghi đè giá trị mới (`false`).
    firstResolve?.({ loginToken: true })
    await flushPromises()

    expect(isLoginTokenChecked(wrapper)).toBe(false)
  })
})

describe('popup — kết quả của lần chạy TRƯỚC được đánh dấu là cũ', () => {
  it('lần chạy đang bay ⇒ có dòng "đang hiện kết quả cũ"', async () => {
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
    // Chế độ đăng nhập tắt lúc đầu.
    store.loginToken = false

    // Trong lúc popup đang lưu thì nơi khác ghi đè ⇒ giá trị CUỐI CÙNG
    // trong storage là `false` (ai ghi cuối cùng thì thắng).
    storageSet = async (values) => {
      Object.assign(store, values)
      Object.assign(store, { loginToken: false })
      emitStorageChange({ loginToken: { newValue: values.loginToken } })
      emitStorageChange({ loginToken: { newValue: false } })
    }

    const wrapper = mount(PopupApp)
    await flushPromises()

    await loginTokenCheckbox(wrapper).setValue(true)
    await flushPromises()

    expect(store.loginToken).toBe(false)
    // Popup KHÔNG được tin giá trị trả về của lần ghi (vẫn là `true`) — nó
    // phải đọc lại storage ⇒ thấy `false` ⇒ không tick. Nếu tin giá trị
    // patch thì popup và storage LỆCH nhau ⇒ lần chạy đi sai chế độ.
    expect(isLoginTokenChecked(wrapper)).toBe(false)
    expect(wrapper.find('.settings-error').exists()).toBe(false)
  })
})

describe('popup — hội tụ về giá trị ĐÃ LƯU trong storage', () => {
  it('sự kiện mang giá trị KHÁC storage ⇒ popup vẫn theo storage', async () => {
    // Storage đang bật chế độ đăng nhập.
    store.loginToken = true

    const wrapper = mount(PopupApp)
    await flushPromises()

    expect(isLoginTokenChecked(wrapper)).toBe(true)

    // Sự kiện mang giá trị CŨ. Popup KHÔNG được dùng giá trị của sự kiện
    // (nó tính từ CHỈ những key đổi) — popup phải ĐỌC LẠI storage ⇒ thấy
    // `true` ⇒ vẫn tick.
    emitStorageChange({ loginToken: { newValue: false } })
    await flushPromises()

    expect(isLoginTokenChecked(wrapper)).toBe(true)
  })

  it('sự kiện của nơi khác tới GIỮA lúc đang lưu ⇒ ô tick KHÔNG bị tự bỏ tick', async () => {
    // Chế độ đăng nhập tắt lúc đầu.
    store.loginToken = false

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

    await loginTokenCheckbox(wrapper).setValue(true)
    await flushPromises()

    expect(isLoginTokenChecked(wrapper)).toBe(true)

    // Nơi khác đổi một setting KHÁC, đúng lúc popup đang lưu. Lúc này
    // storage CHƯA có giá trị mới ⇒ nếu popup đọc lại storage thì nó thấy
    // `loginToken: false` ⇒ ô tick bị tự bỏ tick ⇒ mất lựa chọn của
    // operator (dù lần ghi của popup sắp ghi đúng giá trị đó).
    emitStorageChange({ apiBase: { newValue: 'https://other.test/' } })
    await flushPromises()

    expect(isLoginTokenChecked(wrapper)).toBe(true)

    // Lần ghi của popup đến ⇒ giá trị cuối cùng trong storage là `true`.
    resolveSet?.()
    await flushPromises()

    expect(store.loginToken).toBe(true)
    expect(isLoginTokenChecked(wrapper)).toBe(true)
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
    expect(store.loginToken).toBe(true)
    expect(isLoginTokenChecked(wrapper)).toBe(true)
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

// ---------------------------------------------------------------------------
// The login mode — the token comes from a login, the manifest page is NOT needed
// ---------------------------------------------------------------------------

/**
 * The endpoints of the login flow.
 *
 * They are written HERE ON PURPOSE, not imported from `src/core/login-token.ts`:
 * a change of an endpoint in the core must be a DELIBERATE change of the test
 * too — if the test followed the core, it would stop being a check.
 */
/** The endpoint of the site that gives the captcha. */
const SITE_CAPTCHA_URL = 'https://www.chinaports-agency.com:8870/api/captcha/'
/** The endpoint of the captcha service. */
const OCR_SERVICE_URL = 'https://upload.chaojiying.net/Upload/Processing.php'
/** The endpoint of the site that logs in. */
const SITE_LOGIN_URL = 'https://www.chinaports-agency.com:8870/api/login/'

/** The details of the operator — they live in `chrome.storage.local`. */
const LOGIN_CREDENTIALS = {
  siteUsername: 'site-user',
  sitePassword: 'site-pass',
  ocrUser: 'ocr-user',
  ocrPassword: 'ocr-pass',
  ocrSoftwareId: 'soft-id',
}

/** A JSON answer of the fake fetch. */
function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

/**
 * A fake `fetch` of the login flow: the captcha of the site ⇒ the captcha
 * service ⇒ the login of the site.
 *
 * `refuseLogin` makes the site REFUSE the login (its answer is not `2000`).
 */
function fakeLoginFetch(options: { refuseLogin?: boolean } = {}): {
  fetchImpl: typeof fetch
  calls: string[]
} {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (url: string) => {
    const target = String(url)
    calls.push(target)
    if (target === SITE_CAPTCHA_URL) {
      return jsonResponse({
        code: 2000,
        data: { image_base: 'data:image/png;base64,AAABBB', key: 'captcha-key' },
      })
    }
    if (target === OCR_SERVICE_URL) return jsonResponse({ pic_str: '8F2K' })
    if (target === SITE_LOGIN_URL) {
      if (options.refuseLogin === true) {
        return jsonResponse({ code: 5000, msg: 'The captcha or the account is wrong.' })
      }
      return jsonResponse({ code: 2000, data: { token: 'the-token' } })
    }
    throw new Error(`Unexpected URL: ${target}`)
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

/** Turn the login mode on and put the login details in the local storage. */
function enableLoginMode(): void {
  store.loginToken = true
  localStore[LOGIN_CREDENTIALS_KEY] = LOGIN_CREDENTIALS
}

describe('popup — ô tick chế độ đăng nhập', () => {
  it('setting ĐÃ bật ⇒ ô tick hiện và TICK', async () => {
    store.loginToken = true

    const wrapper = mount(PopupApp)
    await flushPromises()

    // The login box is the ONLY tick box of the popup.
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1)
    expect(isLoginTokenChecked(wrapper)).toBe(true)
  })

  it('setting TẮT ⇒ ô tick hiện và KHÔNG tick', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1)
    expect(isLoginTokenChecked(wrapper)).toBe(false)
  })

  it('tick ô ⇒ lưu `loginToken: true`', async () => {
    const wrapper = mount(PopupApp)
    await flushPromises()

    await loginTokenCheckbox(wrapper).setValue(true)
    await flushPromises()

    expect(store.loginToken).toBe(true)
    expect(wrapper.find('.settings-error').exists()).toBe(false)
  })

  it('lưu lỗi ⇒ rollback ô tick về giá trị ĐÃ LƯU và báo lỗi', async () => {
    store.loginToken = false
    storageSet = async () => {
      throw new Error('storage disabled')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      expect(isLoginTokenChecked(wrapper)).toBe(false)

      await loginTokenCheckbox(wrapper).setValue(true)
      await flushPromises()

      // The box must go back to unchecked — it must NOT sit in the "ticked"
      // state while the setting is really not saved.
      expect(isLoginTokenChecked(wrapper)).toBe(false)
      expect(wrapper.find('.settings-error').text()).toBe(
        'Could not save the settings. Please try again.',
      )
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('lưu lỗi mà giá trị ĐÃ LƯU là `true` ⇒ rollback về checked', async () => {
    store.loginToken = true
    storageSet = async () => {
      throw new Error('storage disabled')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      expect(isLoginTokenChecked(wrapper)).toBe(true)

      await loginTokenCheckbox(wrapper).setValue(false)
      await flushPromises()

      expect(isLoginTokenChecked(wrapper)).toBe(true)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('đang lưu setting ⇒ nút Run bị disable (không chạy nhầm chế độ THƯỜNG)', async () => {
    // The Run button works... until a save is in flight. Then the tick box
    // says "login mode" but the setting is NOT in the storage yet ⇒ if the
    // button worked, the run would go in NORMAL mode.
    let resolveSet: (() => void) | undefined
    storageSet = async (values) => {
      await new Promise<void>((resolve) => {
        resolveSet = resolve
      })
      Object.assign(store, values)
    }

    const wrapper = mount(PopupApp)
    await flushPromises()

    expect(isDisabled(wrapper, 'Create draft on site')).toBe(false)

    // The operator ticks the login box ⇒ the save starts and hangs.
    await loginTokenCheckbox(wrapper).setValue(true)
    await flushPromises()

    // The box says "login mode" but the setting is NOT saved yet ⇒ the run
    // must not start (it would go in NORMAL mode).
    expect(isLoginTokenChecked(wrapper)).toBe(true)
    expect(isDisabled(wrapper, 'Create draft on site')).toBe(true)

    resolveSet?.()
    await flushPromises()

    expect(isDisabled(wrapper, 'Create draft on site')).toBe(false)
  })
})

describe('popup — chế độ đăng nhập: lấy token rồi chạy manifest', () => {
  it('có thông tin đăng nhập ⇒ message mang `loginMode` + token, và gọi đủ 3 request', async () => {
    enableLoginMode()
    const { fetchImpl, calls } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
      await clickCreate(wrapper)
      // The new tab of the site must finish loading before the message goes.
      await completeCreatedTab()

      const message = sentMessages.find((m) => m.type === MSG_CREATE_MANIFEST)
      expect(message).toBeDefined()
      expect(message?.loginMode).toBe(true)
      expect(message?.token).toBe('the-token')
      // Captcha of the site ⇒ captcha service ⇒ login of the site.
      expect(calls).toEqual([SITE_CAPTCHA_URL, OCR_SERVICE_URL, SITE_LOGIN_URL])
      // The token is a session secret ⇒ it must NEVER reach the console — not
      // as a string and not hidden inside an Error.
      for (const spy of [infoSpy, errorSpy, warnSpy]) {
        for (const call of spy.mock.calls) {
          const text = JSON.stringify(call.map((a) => (a instanceof Error ? a.message : a)))
          expect(text).not.toContain('the-token')
        }
      }
    } finally {
      infoSpy.mockRestore()
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('CHƯA có thông tin đăng nhập ⇒ báo lỗi trỏ tới options, KHÔNG gửi message', async () => {
    store.loginToken = true
    // The local store is empty ⇒ there are no login details at all.

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    // The sentence is pinned EXACTLY: the diagnosis of the login flow must
    // reach the operator. A looser assertion (the sentence merely CONTAINS
    // "extension options") would also accept the generic fallback ⇒ the
    // diagnosis could be lost without any test going red.
    expect(wrapper.find('.message-error').text()).toBe(
      'Set the login details in the extension options first: the site account, the site password and the captcha service details.',
    )
    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(0)
  })

  it('site TỪ CHỐI đăng nhập ⇒ chẩn đoán của site tới nguyên văn cho operator', async () => {
    // The site answers the login with a code that is not `2000` ⇒ the login
    // flow knows WHY it failed ⇒ that sentence must reach the operator, not
    // the generic "check the login details" one.
    enableLoginMode()
    const { fetchImpl } = fakeLoginFetch({ refuseLogin: true })
    vi.stubGlobal('fetch', fetchImpl)

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    expect(wrapper.find('.message-error').text()).toBe(
      'The site refused the login — the captcha text or the account details may be wrong.',
    )
    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(0)
  })

  it('đọc thông tin đăng nhập lỗi ⇒ báo lỗi trỏ tới options, KHÔNG gửi message', async () => {
    store.loginToken = true
    localGet = async () => {
      throw new Error('storage disabled')
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wrapper = mount(PopupApp)
      await flushPromises()

      await wrapper.find('input[type="text"]').setValue('BL123')
      await clickCreate(wrapper)

      expect(wrapper.find('.message-error').text()).toBe(
        'Could not read the login details from the extension options.',
      )
      expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('tab active KHÔNG ở site ⇒ mở tab MỚI ở nền, message đi vào tab MỚI', async () => {
    enableLoginMode()
    activeTabUrl = 'https://example.test/'
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)
    // The new tab starts with the status `loading` ⇒ the popup waits for it.
    await completeCreatedTab()

    // The manifest page is NOT needed ⇒ the home page of the site is opened.
    expect(createdTabs).toEqual([SITE_HOME_URL])
    // Opened in the BACKGROUND ⇒ the popup stays open (the operator does not
    // lose the result).
    expect(createdTabRecords[0]?.active).toBe(false)
    // The message must go to the NEW tab, not to the active tab.
    expect(sentTabIds).toEqual([createdTabRecords[0]?.id])
  })

  it('tab active ĐÃ ở trên site (route bất kỳ) ⇒ KHÔNG mở tab mới', async () => {
    enableLoginMode()
    activeTabUrl = 'https://www.chinaports-agency.com:8870/#/someOtherRoute'
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    expect(createdTabs).toEqual([])
    expect(sentTabIds).toEqual([1])
  })

  it('KHÔNG kích hoạt tab và KHÔNG reload tab', async () => {
    // Activating another tab closes the popup ⇒ the operator loses the
    // result; reloading the page of the operator can destroy what they were
    // typing.
    enableLoginMode()
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)
    await completeCreatedTab()

    expect(tabUpdates).toEqual([])
    expect(tabReloads).toEqual([])
  })

  it('tab mới CHƯA tải xong ⇒ đợi sự kiện `complete` rồi mới gửi message', async () => {
    enableLoginMode()
    createdTabStatus = 'loading'
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    // The content script is not in the tab yet ⇒ the message is NOT sent.
    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(0)

    markTabComplete(createdTabRecords[0]?.id ?? -1)
    await flushPromises()

    expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(1)
  })

  it('content script CHƯA có trong tab ⇒ message được gửi LẠI cho tới khi có', async () => {
    // The content script is injected at `document_idle` and Chrome picks that
    // moment itself ⇒ the message can arrive BEFORE the listener is there.
    enableLoginMode()
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)
    sendMessage = async () =>
      successResult({ billCreated: true, written: true, billNo: 'BILL-1' })
    // The first two sends find NO receiver.
    noReceiverCount = 2
    // The fake timers: the retry waits 300 ms - the REAL clock would make
    // this test depend on how busy the machine is.
    vi.useFakeTimers()

    try {
      const wrapper = mount(PopupApp)
      await flushPending()

      await wrapper.find('input[type="text"]').setValue('BL123')
      await buttonByText(wrapper, 'Create draft on site').trigger('click')
      await flushPending()
      await completeCreatedTab()

      // The first send found no receiver ⇒ the popup does NOT give up.
      expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(1)
      expect(wrapper.find('.message-error').exists()).toBe(false)

      // The content script arrives ⇒ the message goes through.
      await vi.advanceTimersByTimeAsync(300 * 3)
      await flushPending()

      expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(3)
      expect(wrapper.find('.message-error').exists()).toBe(false)
      expect(wrapper.find('.message-success').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('tab active biến mất ⇒ mở tab MỚI và message đi vào tab mới', async () => {
    // The operator closed the tab while the popup was logging in.
    enableLoginMode()
    activeTabUrl = 'https://www.chinaports-agency.com:8870/#/someOtherRoute'
    goneTabIds.add(1)
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)
    await completeCreatedTab()

    // A vanished tab is "otherwise" ⇒ a NEW tab is opened.
    expect(createdTabs).toEqual([SITE_HOME_URL])
    expect(sentTabIds).toEqual([createdTabRecords[0]?.id])
  })

  it('tab biến mất LÚC CHỜ ⇒ mở tab MỚI và gửi lại vào tab mới', async () => {
    // The tab is closed right AFTER the popup looked at it ⇒ the run must not
    // die, it must open a NEW tab (the fallback happens EXACTLY once).
    enableLoginMode()
    activeTabUrl = 'https://www.chinaports-agency.com:8870/#/someOtherRoute'
    let gets = 0
    onTabGet = (tabId) => {
      if (tabId !== 1) return
      gets += 1
      if (gets === 2) goneTabIds.add(1)
    }
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)
    await completeCreatedTab()

    expect(createdTabs).toEqual([SITE_HOME_URL])
    expect(sentTabIds).toEqual([createdTabRecords[0]?.id])
  })

  it('tab bị ĐÓNG lúc popup chờ ⇒ mở tab MỚI và message đi vào tab mới', async () => {
    // The operator does not want the stray tab and closes it while it is
    // still loading ⇒ a closed tab never fires `complete` ⇒ the popup must
    // notice the closure instead of waiting for the deadline.
    enableLoginMode()
    activeTabUrl = 'https://example.test/'
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    // The first new tab is still loading ⇒ the operator closes it.
    const closedTabId = createdTabRecords[0]?.id ?? -1
    removeTab(closedTabId)
    await flushPromises()

    // The popup opens a NEW tab instead of waiting for the deadline.
    expect(createdTabs).toEqual([SITE_HOME_URL, SITE_HOME_URL])
    expect(wrapper.find('.message-error').exists()).toBe(false)

    // The message goes to the NEW tab.
    await completeCreatedTab(1)

    expect(sentTabIds).toEqual([createdTabRecords[1]?.id])

    // The wait leaves NO listener behind - a later closed tab must not
    // disturb the popup any more.
    expect(tabUpdatedListeners).toHaveLength(0)
    expect(tabRemovedListeners).toHaveLength(0)
  })

  it('tab biến mất HAI LẦN ⇒ báo tải lại trang, KHÔNG báo kiểm tra thông tin đăng nhập', async () => {
    // The operator closes the new tab, the popup opens a second new tab, the
    // operator closes that one too ⇒ this is NOT a problem with the login
    // details.
    enableLoginMode()
    activeTabUrl = 'https://example.test/'
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    // Tab mới thứ nhất bị đóng lúc đang tải ⇒ popup mở tab thứ hai.
    removeTab(createdTabRecords[0]?.id ?? -1)
    await flushPromises()
    expect(createdTabs).toEqual([SITE_HOME_URL, SITE_HOME_URL])

    // The second tab is closed too ⇒ this time it is a real failure.
    removeTab(createdTabRecords[1]?.id ?? -1)
    await flushPromises()

    expect(wrapper.find('.message-error').text()).toBe(
      'Could not reach the site page. Reload the page on the site and try again.',
    )
  })

  it('gửi message lỗi KHÁC (không phải "không có listener") ⇒ báo tải lại trang, KHÔNG báo kiểm tra thông tin đăng nhập', async () => {
    // The content script IS there but the page navigated while the run was in
    // flight ⇒ the credentials are fine ⇒ the operator has to reload the
    // page, not to check the login details.
    enableLoginMode()
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)
    sendMessage = async () => {
      throw new Error('The message port closed before a response was received.')
    }

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)
    await completeCreatedTab()

    expect(wrapper.find('.message-error').text()).toBe(
      'Could not reach the site page. Reload the page on the site and try again.',
    )
  })

  it('tab KHÔNG tải xong ⇒ báo deadline của TRANG, KHÔNG phải deadline của lần chạy', async () => {
    // The page of the site never loads ⇒ the operator must not be sent to the
    // manifest form (that is the deadline of the RUN, a different failure).
    enableLoginMode()
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)
    vi.useFakeTimers()

    try {
      const wrapper = mount(PopupApp)
      await flushPending()

      await wrapper.find('input[type="text"]').setValue('BL123')
      await buttonByText(wrapper, 'Create draft on site').trigger('click')
      await flushPending()

      // The deadline of the page load of the popup is 20 s.
      await vi.advanceTimersByTimeAsync(20_000 + 100)
      await flushPending()

      expect(wrapper.find('.message-error').text()).toBe(
        'The site page did not load in time. Check the page on the site and try again.',
      )

      // The deadline must clean up after itself too - a leaked listener would
      // fire for every later tab the operator closes.
      expect(tabUpdatedListeners).toHaveLength(0)
      expect(tabRemovedListeners).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('trang vừa tải xong LÚC popup đăng listener ⇒ vẫn gửi message, KHÔNG chờ deadline', async () => {
    // The `complete` event can be MISSED: the status is read BEFORE the
    // listener is registered, and the page finishes loading at exactly that
    // moment ⇒ the popup has to ask the status again, it must not wait for
    // the deadline.
    enableLoginMode()
    const siteTabId = 1
    tabStates.set(siteTabId, {
      id: siteTabId,
      url: 'https://www.chinaports-agency.com:8870/#/someOtherRoute',
      status: 'loading',
    })
    let gets = 0
    onTabGet = (tabId) => {
      if (tabId !== siteTabId) return
      gets += 1
      // The THIRD read is the read AFTER the listener was registered ⇒ the
      // page finishes loading exactly then - but NO event is fired.
      if (gets >= 3) {
        const tab = tabStates.get(siteTabId)
        if (tab) tab.status = 'complete'
      }
    }
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)
    vi.useFakeTimers()

    try {
      const wrapper = mount(PopupApp)
      await flushPending()

      await wrapper.find('input[type="text"]').setValue('BL123')
      await buttonByText(wrapper, 'Create draft on site').trigger('click')
      await flushPending()
      await flushPending()
      await flushPending()

      expect(sentTypes.filter((t) => t === MSG_CREATE_MANIFEST)).toHaveLength(1)
      expect(wrapper.find('.message-error').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gửi message thất bại ⇒ báo tải lại trang trên site, KHÔNG báo kiểm tra thông tin đăng nhập', async () => {
    // The tab has no listener (the extension was reloaded and the page was
    // not) ⇒ the most common cause is NOT the login details.
    enableLoginMode()
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)
    // EVERY send finds no receiver.
    noReceiverCount = 100
    vi.useFakeTimers()

    try {
      const wrapper = mount(PopupApp)
      await flushPending()

      await wrapper.find('input[type="text"]').setValue('BL123')
      await buttonByText(wrapper, 'Create draft on site').trigger('click')
      await flushPending()
      await completeCreatedTab()

      // The popup gives up after its attempts (10 tries, 300 ms apart).
      await vi.advanceTimersByTimeAsync(300 * 11)
      await flushPending()

      expect(wrapper.find('.message-error').text()).toBe(
        'Could not reach the site page. Reload the page on the site and try again.',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('ghi thành công ⇒ có dòng chỉ đường tới trang khai báo', async () => {
    // NO page is refreshed in this mode ⇒ the operator has to know that the
    // manifest page is where the new draft is.
    enableLoginMode()
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)
    sendMessage = async () =>
      successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)
    await completeCreatedTab()

    expect(wrapper.text()).toContain(
      'Open the manifest declaration page (预配舱单) to see the new draft.',
    )
  })

  it('ghi xong nhưng còn field bắt buộc bị trống ⇒ VẪN có dòng chỉ đường tới trang khai báo', async () => {
    // The YELLOW outcome (a required field is still blank) but the draft WAS
    // written ⇒ the pointer must stay: in the login mode no page is refreshed
    // and the operator has to go to the manifest page to fill the field.
    enableLoginMode()
    const { fetchImpl } = fakeLoginFetch()
    vi.stubGlobal('fetch', fetchImpl)
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
    await completeCreatedTab()

    expect(wrapper.find('.message-warning').exists()).toBe(true)
    expect(wrapper.text()).toContain(
      'Open the manifest declaration page (预配舱单) to see the new draft.',
    )
  })
})

describe('popup — chế độ THƯỜNG không bị lẫn với chế độ đăng nhập', () => {
  it('chế độ THƯỜNG ⇒ đưa tab lên trước và reload tab', async () => {
    // The normal mode refreshes the page of the operator so that the new
    // draft shows up there - the login mode does NOT do that.
    sendMessage = async () =>
      successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    // The tab is brought to the front ...
    expect(tabUpdates).toEqual([{ tabId: 1, url: undefined, active: true }])
    // ... and reloaded, so the operator sees the new draft.
    expect(tabReloads).toEqual([1])
  })

  it('request chỉ mang `type` + `blNo` — KHÔNG có cờ của chế độ đăng nhập', async () => {

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('ONEYSHAGT1569600')
    await clickCreate(wrapper)

    const message = sentMessages.find((m) => m.type === MSG_CREATE_MANIFEST)
    expect(message).toBeDefined()
    expect(Object.keys(message ?? {}).sort()).toEqual(['blNo', 'type'])
  })

  it('ghi thành công ⇒ KHÔNG có dòng chỉ đường tới trang khai báo', async () => {
    // The normal mode refreshes the manifest page ⇒ the operator already sees
    // the result.
    sendMessage = async () =>
      successResult({ billCreated: true, written: true, billNo: 'BILL-1' })

    const wrapper = mount(PopupApp)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('BL123')
    await clickCreate(wrapper)

    expect(wrapper.text()).not.toContain('Open the manifest declaration page')
  })

  it('ghi xong nhưng còn field bắt buộc bị trống ⇒ KHÔNG có dòng chỉ đường tới trang khai báo', async () => {
    // The mirror of the test above: the same outcome (the draft was written,
    // a required field is still blank) but in NORMAL mode ⇒ no pointer.
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

    expect(wrapper.find('.message-warning').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Open the manifest declaration page')
  })
})
