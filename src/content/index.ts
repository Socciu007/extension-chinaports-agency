import {
  describeApiError,
  fetchManifest,
  ManifestApiError,
  normalizeBlNo,
} from '../core/api'
import { fillManifest } from '../core/fill'
import { readSettings } from '../core/options'
import {
  MSG_FILL,
  type FillRequest,
  type FillResult,
} from '../core/protocol'
import {
  createMappingContext,
  describeSiteError,
  loadSiteDicts,
} from '../core/site-api'
import type { MappingContext } from '../core/mapping'
import { MANIFEST_ROUTE } from '../core/site-url'
import type { ManifestData } from '../core/types'

function isManifestPage(): boolean {
  return location.hash.includes(MANIFEST_ROUTE)
}

function emptyResult(message: string): FillResult {
  return { ok: false, message, items: [], cargoRows: 0, containerRows: 0 }
}

/** Lần điền đang chạy — dùng để chặn hai lần điền chồng nhau. */
let inFlight: Promise<FillResult> | null = null

async function handleFill(request: FillRequest): Promise<FillResult> {
  if (!isManifestPage()) {
    return emptyResult(
      'Open the 预配舱单申报平台 page (#/exportBusinessOperations/maintenanceOfManifestData) and try again.',
    )
  }

  const settings = await readSettings()
  const apiBase = request.apiBase ?? settings.apiBase
  const blNo = normalizeBlNo(request.blNo ?? '')

  if (!blNo) return emptyResult('Enter a bill of lading number first.')

  let data: ManifestData
  try {
    data = await fetchManifest(blNo, { baseUrl: apiBase })
  } catch (e) {
    if (e instanceof ManifestApiError && e.kind === 'not_found') {
      return emptyResult(`No manifest was found for bill of lading number ${blNo}.`)
    }
    // Lỗi phải map theo `kind` — không bao giờ lộ `error.message` cho người dùng.
    return emptyResult(`Could not fetch the manifest data: ${describeApiError(e)}`)
  }

  let ctx: MappingContext
  try {
    const dicts = await loadSiteDicts({ baseUrl: settings.siteApiBase })
    ctx = createMappingContext(dicts)
  } catch (e) {
    return emptyResult(`Could not read the site dictionaries: ${describeSiteError(e)}`)
  }

  const report = await fillManifest({
    root: document,
    data,
    ctx,
    autoSubmit: request.autoSubmit ?? settings.autoSubmit,
    log: (message) => console.debug('[manifest-autofill]', message),
  })

  return {
    ok: report.ok,
    message: report.message,
    items: report.items,
    cargoRows: report.cargoRows,
    containerRows: report.containerRows,
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string } | undefined)?.type

  if (type === MSG_FILL) {
    // Chống chạy chồng: hai lần điền cùng lúc sẽ bấm 新增舱单信息 hai lần và
    // ghi đè lên nhau ⇒ sinh dòng hàng TRÙNG trong manifest thật.
    if (inFlight) {
      sendResponse(emptyResult('A fill is already running — wait for it to finish.'))
      return false
    }

    const run: Promise<FillResult> = handleFill(message as FillRequest)
      .catch((e: unknown) => {
        // Chi tiết kỹ thuật chỉ nằm ở console; người dùng chỉ thấy câu ngắn.
        console.error('[manifest-autofill] unexpected error', e)
        return emptyResult('Something went wrong while filling the manifest.')
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
  }

  return false
})

console.debug('[manifest-autofill] content script ready')
