/**
 * Content script — nhận yêu cầu tạo manifest từ popup và điều khiển API của site.
 *
 * MAIN ROUTE: API.
 *
 *  popup → `MSG_CREATE_MANIFEST` → `runManifest` (read manifest from API outside → read site dicts → build payload → (optional) write to site).
 *
 * `runManifest` does not reject ⇒ any error becomes `CreateResult` with `ok: false` + `message` in English.
 */
import { normalizeBlNo } from '../core/api'
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
    preview: { header: {}, cargo: [], containers: [] },
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
 * Key lưu tập số bill đã tạo trong tab này (trong `sessionStorage`).
 *
 * Có namespace để không đụng dữ liệu của site trên cùng origin.
 */
const CREATED_BILL_NOS_KEY = 'manifest-autofill:created-bill-nos'

/**
 * Tập số bill đã tạo trên site — bộ nhớ TRONG RAM của content script.
 *
 * Lưu thêm vào `sessionStorage` (xem `rememberCreatedBillNo`) ⇒ chốt còn
 * đúng sau khi operator reload trang. Bộ nhớ trong RAM giữ chốt hoạt động
 * ngay cả khi `sessionStorage` bị chặn.
 */
const createdBillNos = new Set<string>()

/**
 * Đọc tập số bill đã tạo — hợp nhất bộ nhớ trong RAM với `sessionStorage`.
 *
 * `sessionStorage` là nơi duy nhất sống sót qua lần reload trang, nên nó
 * mới là nguồn sự thật; bộ nhớ trong RAM chỉ bổ sung cho lúc nó bị chặn.
 */
function loadCreatedBillNos(): Set<string> {
  const billNos = new Set<string>(createdBillNos)
  try {
    const raw = sessionStorage.getItem(CREATED_BILL_NOS_KEY)
    if (!raw) return billNos
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return billNos
    for (const value of parsed) {
      if (typeof value === 'string' && value !== '') billNos.add(value)
    }
  } catch {
    // `sessionStorage` bị chặn (policy riêng tư, sandbox) ⇒ dùng bộ nhớ RAM.
  }
  return billNos
}

/**
 * Ghi nhớ một số bill ĐÃ có manifest trên site.
 *
 * Ghi khi site ĐÃ XÁC NHẬN tạo bill (`billCreated`), KHÔNG chỉ khi lưu xong
 * (`written`): nếu bước gắn dòng hàng hỏng, site vẫn còn bill đó ⇒ chạy lại
 * sẽ tạo bill THỨ HAI cho cùng một số bill.
 *
 * Số bill rỗng KHÔNG được ghi — không có số bill thì không chặn được gì.
 */
function rememberCreatedBillNo(blNo: string): void {
  if (blNo === '') return
  createdBillNos.add(blNo)
  try {
    sessionStorage.setItem(CREATED_BILL_NOS_KEY, JSON.stringify([...loadCreatedBillNos()]))
  } catch {
    // Không ghi được thì chốt vẫn còn trong RAM của content script.
    console.warn('[manifest-autofill] could not persist the created bill number', blNo)
  }
}

/**
 * Run manifest according to the request from the popup.
**/
async function handleCreate(request: CreateRequest): Promise<CreateResult> {
  // If not on the manifest page, return an error.
  if (!isManifestPage()) {
    return errorResult(
      'Open the manifest page (#/exportBusinessOperations/maintenanceOfManifestData) and try again.',
    )
  }

  const allowWrite = request.allowWrite === true
  const blNo = normalizeBlNo(request.blNo)

  // Site ĐÃ có manifest cho số bill này trong tab này ⇒ từ chối, KHÔNG chạy
  // gì thêm. Chặn TRƯỚC mọi lần gọi mạng.
  if (allowWrite && loadCreatedBillNos().has(blNo)) {
    return errorResult(
      'A manifest was already created on the site for this bill of lading number. Check the site and finish that manifest by hand — the extension does not create a second manifest for the same bill.',
    )
  }

  const settings = await readSettings()

  // Chốt ghi lên site: popup KHÔNG phải nguồn sự thật — setting ĐÃ LƯU mới
  // là. `readSettings()` trả `DEFAULT_SETTINGS` khi đọc hỏng ⇒ `createOnSite`
  // = `false` ⇒ fail closed.
  if (allowWrite && settings.createOnSite !== true) {
    return errorResult(
      'Creating the manifest on the site is turned off in the extension settings.',
    )
  }

  const apiBase = request.apiBase ?? settings.apiBase
  const siteApiBase = request.siteApiBase ?? settings.siteApiBase

  const result = await runManifest({
    blNo: request.blNo,
    allowWrite,
    apiBase,
    siteApiBase,
    // KHÔNG chụp cookie lúc bắt đầu: site có thể xoay token giữa hai lần
    // gọi ⇒ đọc lại `document.cookie` ở MỖI request (mặc định của
    // `sendSiteJson`) mới dùng đúng token mới nhất.
  })

  // Site ĐÃ xác nhận có bill ⇒ ghi nhớ, kể cả khi bước lưu chưa xong.
  if (result.billCreated === true) rememberCreatedBillNo(blNo)

  return result
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string } | undefined)?.type
  if (type !== MSG_CREATE_MANIFEST) return false

  // Message sai hình dạng ⇒ từ chối NGAY, trước mọi lần gọi mạng.
  //
  // Kiểm TRƯỚC chốt "đang chạy": message hỏng thì lý do đúng là "request
  // không hợp lệ", không phải "đang có lần chạy" — báo sai lý do khiến
  // operator tưởng phải chờ một lần chạy không hề tồn tại.
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
      // Chi tiết kỹ thuật chỉ nằm ở console; người dùng chỉ thấy câu ngắn.
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
      // Tab đã điều hướng đi ⇒ port đã đóng ⇒ không còn ai nghe.
      console.debug('[manifest-autofill] sendResponse failed — the tab probably navigated away', e)
    }
  })
  return true
})

console.debug('[manifest-autofill] content script ready')
