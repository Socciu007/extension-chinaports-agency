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
  MSG_GET_BL_NO,
  MSG_PING,
  type FillRequest,
  type FillResult,
  type GetBlNoResult,
} from '../core/protocol'
import {
  createMappingContext,
  describeSiteError,
  loadSiteDicts,
} from '../core/site-api'
import type { MappingContext } from '../core/mapping'
import type { ManifestData } from '../core/types'

const MANIFEST_HASH = '/exportBusinessOperations/maintenanceOfManifestData'

function isManifestPage(): boolean {
  return location.hash.includes(MANIFEST_HASH)
}

/** Đọc 提单号 đang hiển thị trên trang (dùng để lấy sẵn cho ô nhập ở popup). */
function readBlNoFromPage(): string {
  const input = document.querySelector<HTMLInputElement>('input[id$="-BILL_NBR"]')
  return input?.value?.trim() ?? ''
}

function emptyResult(message: string): FillResult {
  return { ok: false, message, items: [], cargoRows: 0, containerRows: 0 }
}

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

  if (type === MSG_PING) {
    const result: GetBlNoResult = { ok: true, blNo: readBlNoFromPage() }
    sendResponse(result)
    return false
  }

  if (type === MSG_GET_BL_NO) {
    const result: GetBlNoResult = { ok: true, blNo: readBlNoFromPage() }
    sendResponse(result)
    return false
  }

  if (type === MSG_FILL) {
    void handleFill(message as FillRequest)
      .then(sendResponse)
      .catch((e: unknown) => {
        // Chi tiết kỹ thuật chỉ nằm ở console; người dùng chỉ thấy câu ngắn.
        console.error('[manifest-autofill] unexpected error', e)
        sendResponse(emptyResult('Something went wrong while filling the manifest.'))
      })
    return true
  }

  return false
})

console.debug('[manifest-autofill] content script ready')
