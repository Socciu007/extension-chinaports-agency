/**
 * Content script — fill manifest.
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
import { MANIFEST_ROUTE } from '../core/site-url'

function isManifestPage(): boolean {
  return location.hash.includes(MANIFEST_ROUTE)
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
  const blNo = normalizeBlNo(request.blNo ?? '')

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
    blNo: request.blNo ?? '',
    allowWrite,
    apiBase,
    siteApiBase,
    cookieString: document.cookie,
  })

  // Site ĐÃ xác nhận có bill ⇒ ghi nhớ, kể cả khi bước lưu chưa xong.
  if (result.billCreated === true) rememberCreatedBillNo(blNo)

  return result
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string } | undefined)?.type
  if (type !== MSG_CREATE_MANIFEST) return false

  // Prevent running multiple manifests at the same time.
  if (inFlight) {
    sendResponse(
      errorResult('A manifest run is already in progress — wait for it to finish.'),
    )
    return false
  }

  const run: Promise<CreateResult> = handleCreate(message as CreateRequest)
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
    } catch {
      // Tab đã điều hướng đi ⇒ port đã đóng ⇒ không còn ai nghe.
    }
  })
  return true
})

console.debug('[manifest-autofill] content script ready')

/*
 * ===========================================================================
 * ĐƯỜNG DOM — ĐÃ COMMENT LẠI, GIỮ LẠI ĐỂ ĐỌC (task này KHÔNG xoá)
 *
 * API là đường CHÍNH (xem phần đầu file). Đường DOM — bấm nút 新增舱单信息
 * trên form rồi điền từng field, xác minh lại giá trị — không còn được gọi;
 * nó chỉ còn là đường DỰ PHÒNG.
 *
 * Task 6 sẽ XOÁ HẲN các module của đường DOM:
 *
 *   - `src/core/fill.ts`
 *   - `src/core/site.ts`
 *   - `src/core/select.ts`
 *   - `src/core/table.ts`
 *   - `src/core/dom.ts`
 *   - `src/core/wait.ts`
 *   - nửa DOM của `src/core/mapping.ts`
 *
 * Giữ nguyên logic cũ ở đây để còn đọc được — xoá thì mất mạch. Khi Task 6
 * xoá các module trên thì xoá luôn khối comment này.
 *
 * Import ở trên KHÔNG còn dùng cho đường DOM (`fillManifest`,
 * `loadSiteDicts`, `createMappingContext`, `describeSiteError`,
 * `MappingContext`, `ManifestData`) — chúng bị bỏ khỏi phần code đang chạy
 * để không còn import chết.
 * ===========================================================================
 */

// import {
//   describeApiError,
//   fetchManifest,
//   ManifestApiError,
//   normalizeBlNo,
// } from '../core/api'
// import { fillManifest } from '../core/fill'
// import { MSG_FILL, type FillRequest, type FillResult } from '../core/protocol'
// import {
//   createMappingContext,
//   describeSiteError,
//   loadSiteDicts,
// } from '../core/site-api'
// import type { MappingContext } from '../core/mapping'
// import type { ManifestData } from '../core/types'

// function emptyResult(message: string): FillResult {
//   return { ok: false, message, items: [], cargoRows: 0, containerRows: 0 }
// }

// async function handleFill(request: FillRequest): Promise<FillResult> {
//   if (!isManifestPage()) {
//     return emptyResult(
//       'Open the 预配舱单申报平台 page (#/exportBusinessOperations/maintenanceOfManifestData) and try again.',
//     )
//   }

//   const settings = await readSettings()
//   const apiBase = request.apiBase ?? settings.apiBase
//   const blNo = normalizeBlNo(request.blNo ?? '')

//   if (!blNo) return emptyResult('Enter a bill of lading number first.')

//   let data: ManifestData
//   try {
//     data = await fetchManifest(blNo, { baseUrl: apiBase })
//   } catch (e) {
//     if (e instanceof ManifestApiError && e.kind === 'not_found') {
//       return emptyResult(`No manifest was found for bill of lading number ${blNo}.`)
//     }
//     // Lỗi phải map theo `kind` — không bao giờ lộ `error.message` cho người dùng.
//     return emptyResult(`Could not fetch the manifest data: ${describeApiError(e)}`)
//   }

//   let ctx: MappingContext
//   try {
//     const dicts = await loadSiteDicts({ baseUrl: settings.siteApiBase })
//     ctx = createMappingContext(dicts)
//   } catch (e) {
//     return emptyResult(`Could not read the site dictionaries: ${describeSiteError(e)}`)
//   }

//   const report = await fillManifest({
//     root: document,
//     data,
//     ctx,
//     autoSubmit: request.autoSubmit ?? settings.autoSubmit,
//     log: (message) => console.debug('[manifest-autofill]', message),
//   })

//   return {
//     ok: report.ok,
//     message: report.message,
//     items: report.items,
//     cargoRows: report.cargoRows,
//     containerRows: report.containerRows,
//   }
// }

// chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
//   const type = (message as { type?: string } | undefined)?.type
//   if (type === MSG_FILL) {
//     // Chống chạy chồng: hai lần điền cùng lúc sẽ bấm 新增舱单信息 hai lần và
//     // ghi đè lên nhau ⇒ sinh dòng hàng TRÙNG trong manifest thật.
//     if (inFlight) {
//       sendResponse(emptyResult('A fill is already running — wait for it to finish.'))
//       return false
//     }

//     const run: Promise<FillResult> = handleFill(message as FillRequest)
//       .catch((e: unknown) => {
//         // Chi tiết kỹ thuật chỉ nằm ở console; người dùng chỉ thấy câu ngắn.
//         console.error('[manifest-autofill] unexpected error', e)
//         return emptyResult('Something went wrong while filling the manifest.')
//       })
//       .finally(() => {
//         inFlight = null
//       })

//     inFlight = run
//     void run.then((result) => {
//       try {
//         sendResponse(result)
//       } catch {
//         // Tab đã điều hướng đi ⇒ port đã đóng ⇒ không còn ai nghe.
//       }
//     })
//     return true
//   }

//   return false
// })
