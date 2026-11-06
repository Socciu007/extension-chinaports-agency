import { billNoAsWritten } from '../core/api'
import { runManifest } from '../core/manifest-run'
import { readSettings } from '../core/options'
import {
  MSG_CREATE_MANIFEST,
  type CreateRequest,
  type CreateResult,
} from '../core/protocol'
import { MANIFEST_ROUTE, routeOfHash } from '../core/site-url'

// Whether the current page is the manifest page
function isManifestPage(): boolean {
  return routeOfHash(location.hash) === MANIFEST_ROUTE
}

// Whether the message is a create request
function isCreateRequest(message: unknown): message is CreateRequest {
  if (typeof message !== 'object' || message === null) return false
  const blNo = (message as { blNo?: unknown }).blNo
  return typeof blNo === 'string' && blNo.trim() !== ''
}

// Handle error result
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

// Used to prevent running multiple manifests at the same time
let inFlight: Promise<CreateResult> | null = null

// Key for the created bill numbers
const CREATED_BILL_NOS_KEY = 'manifest-autofill:created-bill-nos'

// Prefix for the created bill numbers
const CREATED_BILL_NO_PREFIX = 'manifest-autofill:created-bill-no:'

// The created bill numbers
const createdBillNos = new Set<string>()

// The local storage area
function localStorageArea(): chrome.storage.LocalStorageArea | undefined {
  if (typeof chrome === 'undefined') return undefined
  const local = chrome.storage?.local
  if (!local || typeof local.get !== 'function') return undefined
  return local
}

// Read the created bill numbers from session storage
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

// Load the created bill numbers from the local storage
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
  console.log('handleCreate', request)
  // The "get the token by logging in" mode does NOT need the manifest page:
  // the run only talks to the site's API, it does not touch the page.
  //
  // The flag is honoured ONLY when it is exactly `true` — a truthy
  // non-boolean (a string, a number, an object) must NOT enable login mode.
  const loginMode = request.loginMode === true
  if (!loginMode && !isManifestPage()) {
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

  // The extension ALWAYS creates the manifest on the site (as a draft).
  // The settings are still read here: they carry the API bases.
  const settings = await readSettings()

  const apiBase = request.apiBase ?? settings.apiBase
  const siteApiBase = request.siteApiBase ?? settings.siteApiBase

  // The token goes to the API ONLY when it is a non-empty string. The message
  // comes from the popup and is NOT trusted ⇒ a malformed token (a number, an
  // object, an array) must NEVER reach the `Authorization` header.
  const rawToken: unknown = request.token
  const token = typeof rawToken === 'string' && rawToken !== '' ? rawToken : undefined

  const result = await runManifest({
    blNo: request.blNo,
    apiBase,
    siteApiBase,
    token,
  })

  if (result.billCreated === true) await rememberCreatedBillNo(billKey)

  return result
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string } | undefined)?.type
  if (type !== MSG_CREATE_MANIFEST) return false
  // The message can carry the login token — a session credential that
  // authorises writing manifests on the site ⇒ log ONLY the safe fields.
  const blNo = (message as { blNo?: string }).blNo
  console.log('Input from popup:', { type, blNo })

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