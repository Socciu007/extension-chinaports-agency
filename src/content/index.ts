/**
 * Content script — nhận yêu cầu tạo manifest từ popup và điều khiển API của site.
 *
 * MAIN ROUTE: API.
 *
 *  popup → `MSG_CREATE_MANIFEST` → `runManifest` (read manifest from API outside → look up the site dictionaries → build payload → write to site).
 *
 * `runManifest` does not reject ⇒ any error becomes `CreateResult` with `ok: false` + `message` in English.
 */
import { billNoAsWritten } from '../core/api'
import { runManifest } from '../core/manifest-run'
import { readSettings } from '../core/options'
import {
  MSG_CREATE_MANIFEST,
  type CreateRequest,
  type CreateResult,
} from '../core/protocol'
import { MANIFEST_ROUTE, routeOfHash } from '../core/site-url'

/**
 * Trang hiện tại có ĐÚNG là trang khai 预配舱单 không?
 *
 * So KHỚP CHÍNH XÁC, không dùng `includes`: route của site là tiền tố của
 * route khác (`…maintenanceOfManifestDataExtra`) ⇒ `includes` sẽ nhận nhầm
 * trang đó và extension điền manifest vào một trang không có form.
 *
 * Luật lấy route nằm trong `routeOfHash` (`src/core/site-url.ts`) — dùng
 * CHUNG với popup để hai bên không thể lệch nhau về "trang khai 预配舱单" là
 * gì (lệch nhau thì popup reload một tab mà content script từ chối ⇒
 * operator mắc vòng lặp).
 */
function isManifestPage(): boolean {
  return routeOfHash(location.hash) === MANIFEST_ROUTE
}

/**
 * Message có đúng hình dạng của một lệnh tạo manifest không?
 *
 * Cast (`message as CreateRequest`) chỉ là lời hứa của TypeScript, không có
 * kiểm lúc chạy ⇒ message thiếu `blNo` sẽ đi thẳng vào `runManifest` với số
 * bill rỗng rồi gọi API của site. Vì vậy phải kiểm TRƯỚC mọi lần gọi mạng.
 */
function isCreateRequest(message: unknown): message is CreateRequest {
  if (typeof message !== 'object' || message === null) return false
  const blNo = (message as { blNo?: unknown }).blNo
  return typeof blNo === 'string' && blNo.trim() !== ''
}

/**
 * Handle error result.
 */
function errorResult(message: string): CreateResult {
  return {
    ok: false,
    blocked: false,
    steps: [],
    items: [],
    cargoRows: 0,
    containerRows: 0,
    billCreated: false,
    written: false,
    message,
  }
}

/** Running manifest — used to prevent running multiple manifests at the same time. */
let inFlight: Promise<CreateResult> | null = null

/**
 * Key lưu tập số bill đã tạo — đường DỰ PHÒNG (trong `sessionStorage`).
 *
 * Có namespace để không đụng dữ liệu của site trên cùng origin.
 */
const CREATED_BILL_NOS_KEY = 'manifest-autofill:created-bill-nos'

/**
 * Tiền tố key của chốt trong `chrome.storage.local` — MỘT key cho MỘT số bill.
 *
 * Vì sao KHÔNG gom tất cả số bill vào MỘT record: hai tab ghi cùng lúc sẽ
 * phải đọc-cộng-rồi-ghi ⇒ entry của nhau có thể bị mất. Mỗi số bill một key
 * ⇒ hai tab ghi SONG SONG không đụng entry của nhau.
 *
 * Số bill trong key là số ĐÃ GHI LÊN SITE (giữ hậu tố piece) — đúng bằng
 * thứ mà chốt kiểm, KHÔNG chuẩn hoá lần nữa.
 */
const CREATED_BILL_NO_PREFIX = 'manifest-autofill:created-bill-no:'

/**
 * Tập số bill đã tạo trên site — bộ nhớ TRONG RAM của content script.
 *
 * CHỈ là đường DỰ PHÒNG cuối: RAM thuộc RIÊNG tab này ⇒ không chặn được
 * tab khác. Chốt THẬT nằm ở `chrome.storage.local` (xem `loadCreatedBillNos`).
 */
const createdBillNos = new Set<string>()

/**
 * Area `chrome.storage.local` — nơi chốt PHẢI nằm để chung cho mọi tab.
 *
 * `sessionStorage` và bộ nhớ RAM đều thuộc RIÊNG một tab ⇒ chốt ở đó KHÔNG
 * chặn được trường hợp operator mở trang khai báo ở tab THỨ HAI (hoặc đóng
 * tab đầu rồi mở lại) và chạy lại đúng số bill đó — lúc đó site sẽ có bill
 * THỨ HAI cho cùng một số bill.
 *
 * `chrome.storage.local` thì CHUNG cho mọi tab của extension trong cùng một
 * profile, và sống sót qua lần đóng tab.
 *
 * KHÔNG có background service worker (extension cố tình không có) ⇒ content
 * script tự đọc/ghi trực tiếp, không cần trung gian.
 *
 * Trả `undefined` khi không dùng được (policy chặn, hoặc test không stub) ⇒
 * người gọi rơi về `sessionStorage` + bộ nhớ RAM.
 */
function localStorageArea(): chrome.storage.LocalStorageArea | undefined {
  if (typeof chrome === 'undefined') return undefined
  const local = chrome.storage?.local
  if (!local || typeof local.get !== 'function') return undefined
  return local
}

/**
 * Đọc tập số bill đã tạo trong `sessionStorage` — đường DỰ PHÒNG.
 *
 * `sessionStorage` bị chặn (policy riêng tư, sandbox) ⇒ không có gì để đọc.
 */
function readSessionBillNos(): Set<string> {
  const billNos = new Set<string>()
  try {
    const raw = sessionStorage.getItem(CREATED_BILL_NOS_KEY)
    if (!raw) return billNos
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return billNos
    for (const value of parsed) {
      if (typeof value === 'string' && value !== '') billNos.add(value)
    }
  } catch {
    // `sessionStorage` bị chặn ⇒ không có gì để đọc.
  }
  return billNos
}

/**
 * Đọc tập số bill đã có manifest trên site.
 *
 * Nguồn chính: `chrome.storage.local` — CHUNG cho mọi tab. Đọc `get(null)`
 * (toàn bộ store) rồi chỉ giữ các key có tiền tố của extension.
 *
 * KHÔNG hợp nhất bộ nhớ RAM ở đây: store CHUNG là nguồn SỰ THẬT, và nếu
 * hợp nhất RAM thì đường thoát "xoá storage rồi chạy lại" (nói trong message
 * từ chối) sẽ KHÔNG ăn trong tab đang mở ⇒ lời nói dối.
 *
 * KHÔNG có `chrome.storage.local` (bị policy chặn) hoặc đọc lỗi ⇒ rơi về
 * `sessionStorage` + bộ nhớ RAM, đúng như trước đây. Không bao giờ ném lỗi:
 * thiếu chốt thì đáng lẽ phải chạy tiếp, chứ không phải báo lỗi.
 */
async function loadCreatedBillNos(): Promise<Set<string>> {
  const local = localStorageArea()
  if (local) {
    try {
      const raw = (await local.get(null)) as Record<string, unknown>
      const billNos = new Set<string>()
      for (const key of Object.keys(raw)) {
        if (!key.startsWith(CREATED_BILL_NO_PREFIX)) continue
        const blNo = key.slice(CREATED_BILL_NO_PREFIX.length)
        if (blNo !== '') billNos.add(blNo)
      }
      return billNos
    } catch (e) {
      // Storage bị chặn / lỗi ⇒ rơi xuống `sessionStorage` + RAM.
      console.warn('[manifest-autofill] could not read the created bill numbers', e)
    }
  }
  const billNos = new Set<string>(createdBillNos)
  for (const blNo of readSessionBillNos()) billNos.add(blNo)
  return billNos
}

// Remember a bill that has been created on the site.
async function rememberCreatedBillNo(blNo: string): Promise<void> {
  if (blNo === '') return
  createdBillNos.add(blNo)
  const local = localStorageArea()
  if (local) {
    try {
      await local.set({ [CREATED_BILL_NO_PREFIX + blNo]: Date.now() })
      return
    } catch (e) {
      console.warn('[manifest-autofill] could not persist the created bill number', blNo, e)
    }
  }
  const billNos = readSessionBillNos()
  billNos.add(blNo)
  try {
    sessionStorage.setItem(CREATED_BILL_NOS_KEY, JSON.stringify([...billNos]))
  } catch {
    console.warn('[manifest-autofill] could not persist the created bill number', blNo)
  }
}

// Run manifest according to the request from the popup.
async function handleCreate(request: CreateRequest): Promise<CreateResult> {
  // If not on the manifest page, return an error.
  if (!isManifestPage()) {
    return errorResult(
      'Open the manifest page (#/exportBusinessOperations/maintenanceOfManifestData) and try again.',
    )
  }

  // Check if the bill has already been created on the site.
  const billKey = billNoAsWritten(request.blNo)
  if ((await loadCreatedBillNos()).has(billKey)) {
    return errorResult(
      'A manifest was already created on the site for this bill of lading number. Check the site and finish that manifest by hand — the extension does not create a second manifest for the same bill. If the site no longer has that manifest, clear the storage of the Manifest Autofill extension for this browser and run again.',
    )
  }

  // Check if the create on site setting is enabled.
  const settings = await readSettings()
  if (settings.createOnSite !== true) {
    return errorResult(
      'Creating the manifest on the site is turned off in the extension settings.',
    )
  }

  const apiBase = request.apiBase ?? settings.apiBase
  const siteApiBase = request.siteApiBase ?? settings.siteApiBase

  const result = await runManifest({
    blNo: request.blNo,
    apiBase,
    siteApiBase,
    // KHÔNG chụp cookie lúc bắt đầu: site có thể xoay token giữa hai lần
    // gọi ⇒ đọc lại `document.cookie` ở MỖI request (mặc định của
    // `sendSiteJson`) mới dùng đúng token mới nhất.
  })

  if (result.billCreated === true) await rememberCreatedBillNo(billKey)

  return result
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string } | undefined)?.type
  if (type !== MSG_CREATE_MANIFEST) return false
  console.log('Input from popup:', message)

  // Check input from popup
  if (!isCreateRequest(message)) {
    sendResponse(
      errorResult(
        'The extension received an invalid request — reload the manifest page and try again.',
      ),
    )
    return false
  }

  // Prevent running multiple manifests at the same time.
  if (inFlight) {
    sendResponse(
      errorResult('A manifest run is already in progress — wait for it to finish.'),
    )
    return false
  }

  const run: Promise<CreateResult> = handleCreate(message)
    .catch((e: unknown) => {
      console.error('[manifest-autofill] unexpected error', e)
      return errorResult('Something went wrong while running the manifest.')
    })
    .finally(() => {
      inFlight = null
    })

  inFlight = run
  void run.then((result) => {
    try {
      sendResponse(result)
    } catch (e) {
      console.debug('[manifest-autofill] sendResponse failed — the tab probably navigated away', e)
    }
  })
  return true
})

console.debug('[manifest-autofill] content script ready')