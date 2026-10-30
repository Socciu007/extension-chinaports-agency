/**
 * Content script — fill manifest.
 *
 * MAIN ROUTE: API.
 *
 *  popup → `MSG_CREATE_MANIFEST` → `runManifest` (read manifest from API outside → read site dicts → build payload → (optional) write to site).
 *
 * `runManifest` does not reject ⇒ any error becomes `CreateResult` with `ok: false` + `message` in English.
 */
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
 * Run manifest according to the request from the popup.
**/
async function handleCreate(request: CreateRequest): Promise<CreateResult> {
  // If not on the manifest page, return an error.
  if (!isManifestPage()) {
    return errorResult(
      'Open the manifest page (#/exportBusinessOperations/maintenanceOfManifestData) and try again.',
    )
  }

  const settings = await readSettings()
  console.log('settings', settings)
  console.log('request', request)
  const apiBase = request.apiBase ?? settings.apiBase
  const siteApiBase = request.siteApiBase ?? settings.siteApiBase
  const allowWrite = request.allowWrite === true


  return runManifest({
    blNo: request.blNo ?? '',
    allowWrite,
    apiBase,
    siteApiBase,
    cookieString: document.cookie,
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string } | undefined)?.type
  console.log('type', type)
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
