<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { billNoAsWritten } from '../core/api'
import { DeadlineError, withDeadline } from '../core/http'
import { fetchTokenByLogin, LoginTokenError } from '../core/login-token'
import { readLoginCredentialsResult } from '../core/login-credentials'
import {
  readSettingsResult,
  saveSettings,
  subscribeSettingsChanges,
} from '../core/options'
import {
  MSG_CREATE_MANIFEST,
  type CreateRequest,
  type CreateResult,
} from '../core/protocol'
import {
  MANIFEST_ROUTE,
  MANIFEST_URL,
  SITE_HOME_URL,
  SITE_ORIGIN,
  routeOfHash,
} from '../core/site-url'
import './styles.css'

// Deadline for the manifest run
const RUN_DEADLINE_MS = 300_000

// Deadline for the page of the site to load.
//
// It is NOT the deadline of the run: the page is a BACKGROUND tab the
// operator is not looking at ⇒ the popup must not wait for it forever.
const TAB_READY_DEADLINE_MS = 20_000

// How many times the message is sent to the tab before the run gives up.
const SEND_ATTEMPTS = 10

// The pause between two attempts of the send.
const SEND_RETRY_MS = 300

const blNo = ref('')
const createOnSite = ref(false)
// The "get the token by logging in" setting - the run logs in to the site
// instead of using the cookie of the site.
const loginToken = ref(false)
// Running a manifest run - lock the button to prevent sending two messages at the same time
const busy = ref(false)
const runError = ref('')
// Error when saving the setting - separate, does not overwrite the error of the run
const settingsError = ref('')
const result = ref<CreateResult | null>(null)
const settingsLoaded = ref(false)
// The value of createOnSite that was saved - used to rollback when saving fails
const savedCreateOnSite = ref(false)
// The value of loginToken that was saved - used to rollback when saving fails
const savedLoginToken = ref(false)
// Saving the create-on-site setting - lock the control to prevent two writes at the same time
const saving = ref(false)
// Whether the LAST run used the login mode - it decides the extra line of the
// outcome and the sentence of a transport error.
const runLoginMode = ref(false)

// The bill number of the last run that created the current report
const resultInputBlNo = ref('')

// Whether the current report belongs to a different bill than the one in the input
const resultStale = computed(() => {
  if (result.value === null) return false
  if (runError.value !== '') return false
  if (busy.value) return true
  const typed = billNoAsWritten(blNo.value)
  if (typed === '' || resultInputBlNo.value === '') return false
  return typed !== resultInputBlNo.value
})

// Message for the stale result
const staleMessage = computed(() => {
  if (!resultStale.value) return ''
  if (busy.value) return 'Showing the previous result — a new run is in progress.'
  return 'Showing the previous result — it belongs to a different bill of lading number.'
})

type OutcomeKind = 'error' | 'warning' | 'success'

interface Outcome {
  kind: OutcomeKind // The kind of the outcome
  main: string // The headline - the one sentence that says what happened
  lines: string[] // The extra lines under the headline
  note?: string // The last line - separated and bolder (the closing warning)
}

// Headline when the run failed but the result carries no message
const FALLBACK_ERROR = 'Something went wrong while running the manifest.'

// Headline when required fields are blank but the result carries no message
const FALLBACK_BLOCKED =
  'Some fields the site requires are not provided by the API — fill them in by hand on the site.'

// The headline of a successful run - the draft is saved on the site
const DRAFT_SAVED = 'The manifest was created on the site and saved as a draft (暂存).'

// The closing warning - do NOT create a second manifest for the same bill
const NO_SECOND_MANIFEST =
  'A draft was created on the site for this bill of lading number. Do not create another manifest for this bill number.'

// The extra line of the login mode - it shows whenever the draft was written
// (NO page was refreshed in that mode ⇒ the operator has to open the manifest
// page by hand to see the new draft).
const OPEN_MANIFEST_PAGE =
  'Open the manifest declaration page (预配舱单) to see the new draft.'

// The lines about the bill on the site - the same for every outcome
function billLines(res: CreateResult): string[] {
  const lines: string[] = []
  if (res.billNo !== undefined && res.billNo !== '') lines.push(`Bill number: ${res.billNo}`)
  return lines
}

/**
 * The lines of an outcome that wrote a draft.
 *
 * The bill number, plus - in login mode only - the pointer to the manifest
 * page: in that mode no page was refreshed, so the operator would not know
 * where the new draft is.
 *
 * The rule is the DRAFT, NOT the outcome: the pointer shows in EVERY outcome
 * where the draft was written - the green success AND the yellow "blocked"
 * one (there the operator has to go to the page anyway to fill in the
 * required fields by hand). Do NOT narrow it down to the success outcome.
 */
function draftLines(res: CreateResult): string[] {
  const lines = billLines(res)
  if (runLoginMode.value && res.written) lines.push(OPEN_MANIFEST_PAGE)
  return lines
}

const runOutcome = computed<Outcome | null>(() => {
  // Transport error / deadline / empty input ⇒ red.
  if (runError.value !== '') {
    return { kind: 'error', main: runError.value, lines: [] }
  }
  const res = result.value
  // No run yet ⇒ no message.
  if (res === null) return null
  // A malformed answer (not a result at all) ⇒ the popup must still say
  // something instead of rendering nothing.
  if (res === undefined) {
    return { kind: 'error', main: FALLBACK_ERROR, lines: [] }
  }

  // The run failed ⇒ red. The message of the run ALWAYS exists (expired
  // token on the site, site rejection, API error, …) ⇒ never stay silent.
  //
  // A bill that was created but NOT saved also arrives here as a failure ⇒
  // the message of the core says so ("The manifest bill was created on the
  // site. The extension never deletes bills on its own — …").
  if (!res.ok) {
    const main = (res.message ?? '').trim()
    return {
      kind: 'error',
      main: main === '' ? FALLBACK_ERROR : main,
      lines: billLines(res),
      note: res.billCreated ? NO_SECOND_MANIFEST : undefined,
    }
  }

  // Required fields are still blank ⇒ yellow.
  if (res.blocked) {
    const main = (res.message ?? '').trim()
    const lines: string[] = []
    if (res.written) lines.push(DRAFT_SAVED)
    lines.push(...draftLines(res))
    return {
      kind: 'warning',
      main: main === '' ? FALLBACK_BLOCKED : main,
      lines,
      note: res.written ? NO_SECOND_MANIFEST : undefined,
    }
  }

  // Everything is done ⇒ green.
  if (res.written) {
    return {
      kind: 'success',
      main: DRAFT_SAVED,
      lines: draftLines(res),
      note: NO_SECOND_MANIFEST,
    }
  }

  return {
    kind: 'warning',
    main: 'The run finished but nothing was saved on the site.',
    lines: billLines(res),
  }
})

// Whether the operator has opted in to create the manifest on the site
const createOptIn = computed(() => settingsLoaded.value && savedCreateOnSite.value === true)

// Whether the operator has opted in to the login mode (the token comes from
// a login instead of the cookie of the site)
const loginTokenOptIn = computed(() => settingsLoaded.value && savedLoginToken.value === true)

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

/**
 * The tab was closed while the run was waiting for it.
 *
 * The login can take up to 45 s ⇒ the operator may well close the tab
 * meanwhile ⇒ the run opens a NEW tab instead of dying.
 */
class TabGoneError extends Error {
  constructor(tabId: number) {
    super(`the tab ${tabId} is gone`)
    this.name = 'TabGoneError'
  }
}

/**
 * The page of the site did not finish loading in time.
 *
 * It is NOT the deadline of the manifest run ⇒ the operator must not be sent
 * to the manifest form when the page simply never loaded.
 */
class TabNotReadyError extends Error {
  constructor(tabId: number) {
    super(`the tab ${tabId} did not load in time`)
    this.name = 'TabNotReadyError'
  }
}

/**
 * The message could not be sent to the page.
 *
 * In the login mode the login has ALREADY succeeded by then ⇒ a failed send
 * means "the page could not be reached", never "the credentials are wrong".
 */
class SendFailedError extends Error {
  /** The rejection of Chrome behind this error. */
  readonly reason: unknown

  constructor(reason: unknown) {
    super('the message could not be sent to the tab')
    this.name = 'SendFailedError'
    this.reason = reason
  }
}

// The rejection of Chrome when the tab has no listener - the content script
// is not in the tab yet.
const NO_RECEIVER_PATTERN = /Receiving end does not exist|Could not establish connection/i

// The rejection of Chrome when the tab was closed.
const TAB_GONE_PATTERN = /No tab with id/i

/**
 * Is the error the "there is no receiver in the tab" rejection of Chrome?
 */
function isNoReceiverError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e)
  return NO_RECEIVER_PATTERN.test(message)
}

/**
 * Is the error the "the tab is gone" rejection of Chrome?
 */
function isTabGoneError(e: unknown): boolean {
  if (e instanceof TabGoneError) return true
  const message = e instanceof Error ? e.message : String(e)
  return TAB_GONE_PATTERN.test(message)
}

/** A pause. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * Run the manifest — the only action of the extension.
 * Write to the site (create bill + attach cargo + save as draft)
 */
async function run(): Promise<void> {
  if (busy.value) return
  if (!createOptIn.value) return

  runError.value = ''
  const value = blNo.value.trim()
  if (!value) {
    runError.value = 'Enter a bill of lading number first.'
    return
  }

  // The mode of THIS run - it decides the extra line of the outcome and the
  // sentence of a transport error.
  runLoginMode.value = loginTokenOptIn.value

  busy.value = true
  try {
    if (runLoginMode.value) {
      await runInLoginMode(value)
    } else {
      await runInNormalMode(value)
    }
  } catch (e) {
    console.error('[manifest-autofill] popup could not run the manifest', e)
    runError.value = describeRunError(e)
  } finally {
    busy.value = false
  }
}

/**
 * The normal mode — the run happens on the active tab.
 *
 * The request carries EXACTLY `type` + `blNo`: the flags of the login mode
 * are added only when the login mode is on.
 */
async function runInNormalMode(value: string): Promise<void> {
  const tabId = await activeTabId()
  if (tabId === undefined) throw new Error('no active tab')
  const request: CreateRequest = {
    type: MSG_CREATE_MANIFEST,
    blNo: value,
  }
  const res = (await withDeadline(
    chrome.tabs.sendMessage(tabId, request),
    RUN_DEADLINE_MS,
    'The manifest run',
  )) as CreateResult
  takeResult(res, value)
  // Refresh the page
  await chrome.tabs.update(tabId, { active: true })

  const wait = waitForTabComplete(tabId)
  await chrome.tabs.reload(tabId)
  await wait
}

/**
 * The login mode — the run gets the token by logging in to the site.
 *
 * The manifest page is NOT needed: the content script is injected on every
 * page of the site, so any page of the site can run the manifest.
 */
async function runInLoginMode(value: string): Promise<void> {
  // The login details of the operator - the popup is the only place that may
  // read them (they live in `chrome.storage.local`).
  const details = await readLoginCredentialsResult()
  if (!details.ok) {
    // The details cannot be read ⇒ NOTHING is sent to any tab.
    runError.value = details.error
    return
  }

  // The token - the login flow says what went wrong, in English.
  const token = await fetchTokenByLogin({ credentials: details.credentials })

  const request: CreateRequest = {
    type: MSG_CREATE_MANIFEST,
    blNo: value,
    loginMode: true,
    token,
  }
  const res = (await withDeadline(
    sendInLoginMode(request),
    RUN_DEADLINE_MS,
    'The manifest run',
  )) as CreateResult
  takeResult(res, value)
  // NOTHING else happens in this mode: no tab is activated and no tab is
  // reloaded — activating another tab closes the popup (the operator loses
  // the result) and reloading the page of the operator can destroy what they
  // were typing.
}

/**
 * Send the message to the tab that runs the manifest in the login mode.
 *
 * The tab may VANISH while the login runs (the login can take up to 45 s) ⇒ a
 * NEW tab is opened then. The fallback happens EXACTLY once: a second
 * vanished tab is a real failure.
 */
async function sendInLoginMode(request: CreateRequest): Promise<unknown> {
  const tabId = await loginModeTabId()
  try {
    await ensureTabReady(tabId)
    return await sendToTab(tabId, request)
  } catch (e) {
    if (!isTabGoneError(e)) throw e
    // The tab is gone ⇒ open a NEW tab and try ONCE more.
    const newTabId = await createLoginTabId()
    await ensureTabReady(newTabId)
    return await sendToTab(newTabId, request)
  }
}

/**
 * Send the message to the tab - retry while the tab has no receiver.
 *
 * The content script is injected at `document_idle` and Chrome picks that
 * moment itself ⇒ the message can arrive BEFORE the content script is in the
 * tab. Chrome then rejects the send with "Could not establish connection" ⇒
 * the message is sent again a moment later. Every OTHER error (a tab that was
 * closed, for instance) is NOT retried.
 *
 * EVERY failure of the send is wrapped in a `SendFailedError`: in the login
 * mode the login has already succeeded ⇒ a failed send means "the page could
 * not be reached", never "the credentials are wrong". A tab that was CLOSED is
 * not wrapped - the caller has to open a new tab for it.
 */
async function sendToTab(tabId: number, request: CreateRequest): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, request)
    } catch (e) {
      // The tab was closed ⇒ the caller opens a new one.
      if (isTabGoneError(e)) throw e
      if (!isNoReceiverError(e)) throw new SendFailedError(e)
      lastError = e
      if (attempt < SEND_ATTEMPTS) await sleep(SEND_RETRY_MS)
    }
  }
  // The tab never got a receiver ⇒ the LAST error says it.
  throw new SendFailedError(lastError)
}

/**
 * The tab that runs the manifest in the login mode.
 *
 * The active tab when it is a page of the site; otherwise a NEW tab on the
 * site — the manifest page is not needed in this mode. The new tab is opened
 * in the BACKGROUND so that the popup stays open.
 */
async function loginModeTabId(): Promise<number> {
  const tabId = await activeTabId()
  if (tabId !== undefined) {
    let tabUrl: string | undefined
    try {
      const tab = await chrome.tabs.get(tabId)
      tabUrl = tab.url
    } catch (e) {
      // The tab was closed ⇒ it is "otherwise" ⇒ a NEW tab is opened.
      if (!isTabGoneError(e)) throw e
    }
    // The route does NOT matter - every page of the site runs the manifest.
    if (isSiteUrl(tabUrl)) return tabId
  }
  return createLoginTabId()
}

/**
 * A NEW tab of the site for the login mode - opened in the BACKGROUND so that
 * the popup stays open.
 */
async function createLoginTabId(): Promise<number> {
  const created = await chrome.tabs.create({ url: SITE_HOME_URL, active: false })
  const createdId = created?.id
  if (createdId === undefined) throw new Error('no tab to run the manifest')
  return createdId
}

/**
 * Wait until the tab is ready to receive a message - or until it is closed.
 *
 * The tab may ALREADY be loaded (its status says so) or it may still be
 * loading (the `onUpdated` event with `status === 'complete'` says so).
 *
 * A tab that is CLOSED never fires `complete` ⇒ the wait would only end at
 * the deadline and the operator would be sent to a page that is not open any
 * more ⇒ the removal is watched too.
 *
 * BOTH listeners are removed when the wait ends - a leaked `onRemoved`
 * listener would fire for every later tab the operator closes.
 */
function waitForTabReady(tabId: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // The wait ends ONCE - the deadline may fire after an event already
    // settled it.
    let settled = false
    const cleanup = (): void => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.tabs.onRemoved.removeListener(onRemoved)
    }
    const onUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ): void => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const onRemoved = (removedTabId: number): void => {
      if (removedTabId !== tabId) return
      if (settled) return
      settled = true
      cleanup()
      reject(new TabGoneError(removedTabId))
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.onRemoved.addListener(onRemoved)
    // The status was checked BEFORE the listeners were registered ⇒ the
    // `complete` event can be MISSED in between (the page finishes loading
    // during that one round trip) ⇒ ask once more, now that the listeners
    // are in place. The event is not the only source of truth.
    void chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') onUpdated(tabId, { status: 'complete' })
      },
      (e: unknown) => {
        // The tab was closed BEFORE the removal event could reach us ⇒ it is
        // gone, not merely slow.
        if (isTabGoneError(e)) onRemoved(tabId)
      },
    )
    // The deadline of the PAGE LOAD - it is NOT the deadline of the run.
    withDeadline(
      new Promise<never>(() => {
        // It never settles: only the events above can end the wait.
      }),
      TAB_READY_DEADLINE_MS,
      'The site page load',
    ).catch((e: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(e instanceof DeadlineError ? new TabNotReadyError(tabId) : e)
    })
  })
}

/**
 * Wait until the tab is ready to receive a message.
 *
 * The tab may ALREADY be loaded (its status says so) or it may still be
 * loading (the `onUpdated` event with `status === 'complete'` says so). The
 * wait has its OWN deadline: the page is a background tab the operator is
 * not looking at ⇒ the popup must not wait for it forever.
 */
async function ensureTabReady(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab
  try {
    tab = await chrome.tabs.get(tabId)
  } catch (e) {
    // The tab was closed ⇒ the caller opens a new one.
    if (isTabGoneError(e)) throw new TabGoneError(tabId)
    throw e
  }
  if (tab.status === 'complete') return
  await waitForTabReady(tabId)
}

/**
 * Take the result of the run — the popup shows it, the console keeps the
 * details.
 */
function takeResult(res: CreateResult, value: string): void {
  result.value = res
  console.info('[manifest-autofill] manifest run steps', res.steps)
  const required = Array.isArray(res.items)
    ? res.items.filter((item) => item.required === true)
    : []
  if (required.length > 0) {
    console.info(
      '[manifest-autofill] fields the site requires',
      required.map((item) => {
        const row = item.row === undefined ? '' : ` (row ${item.row})`
        const note = item.note === undefined || item.note === '' ? '' : ` — ${item.note}`
        return `${item.label} (${item.prop})${row}${note}`
      }),
    )
  }
  resultInputBlNo.value = billNoAsWritten(value)
}

/**
 * The sentence of a failed run.
 *
 * The message of a `LoginTokenError` IS the diagnosis of the login flow ⇒
 * it is shown as it is. A deadline gets the same sentence in both modes.
 */
function describeRunError(e: unknown): string {
  if (e instanceof DeadlineError) {
    return 'The manifest run is taking longer than expected. It may still be running on the page — check the manifest form before trying again.'
  }
  if (e instanceof LoginTokenError) return e.message
  if (e instanceof TabNotReadyError) {
    return 'The site page did not load in time. Check the page on the site and try again.'
  }
  // The message could not be sent to the page. Only the login mode wraps the
  // send failures this way ⇒ in the login mode the login has already
  // succeeded and the credentials are fine ⇒ the operator has to reload the
  // page, not to check the login details.
  if (e instanceof SendFailedError) {
    return 'Could not reach the site page. Reload the page on the site and try again.'
  }
  // The tab was closed - twice: the first one is replaced by a new tab, the
  // second one is a real failure. It is still not the credentials.
  if (e instanceof TabGoneError) {
    return 'Could not reach the site page. Reload the page on the site and try again.'
  }
  if (runLoginMode.value) {
    return 'Could not run the manifest. Check the login details in the extension options and try again.'
  }
  return 'Could not reach the page. Open the manifest declaration page, reload it, and try again.'
}

// Check if the tab is on the manifest page
function isManifestUrl(url: string | undefined): boolean {
  if (url === undefined) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.origin !== SITE_ORIGIN) return false
  return routeOfHash(parsed.hash) === MANIFEST_ROUTE
}

/**
 * Check if the tab is on ANY page of the site.
 *
 * The login mode does not need the manifest page - the content script is
 * injected on every page of the site, so the route does NOT matter here.
 */
function isSiteUrl(url: string | undefined): boolean {
  if (url === undefined) return false
  try {
    return new URL(url).origin === SITE_ORIGIN
  } catch {
    return false
  }
}

// Wait for the tab to complete
function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise(resolve => {
    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (
        updatedTabId === tabId &&
        changeInfo.status === 'complete'
      ) {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }

    chrome.tabs.onUpdated.addListener(listener)
  })
}

// Open the manifest page
async function openPage(): Promise<void> {
  const tabId = await activeTabId()

  if (tabId === undefined) {
    await chrome.tabs.create({ url: MANIFEST_URL })
    return
  }

  const tab = await chrome.tabs.get(tabId)

  if (isManifestUrl(tab.url)) {
    await chrome.tabs.update(tabId, { active: true })

    const wait = waitForTabComplete(tabId)
    await chrome.tabs.reload(tabId)
    await wait

    return
  }

  const wait = waitForTabComplete(tabId)

  await chrome.tabs.update(tabId, {
    url: MANIFEST_URL,
    active: true,
  })

  await wait
}

// Toggle the create on site setting
async function onToggleCreateOnSite(): Promise<void> {
  if (saving.value) {
    createOnSite.value = savedCreateOnSite.value
    return
  }
  const next = createOnSite.value
  saving.value = true
  try {
    const outcome = await saveSettings({ createOnSite: next })
    if (outcome.ok) {
      await refreshFromStorage()
      return
    }
    settingsError.value = outcome.error
    const read = await refreshFromStorage()
    createOnSite.value = savedCreateOnSite.value
    settingsError.value = read.ok ? outcome.error : `${outcome.error} ${read.error}`
  } finally {
    saving.value = false
  }
}

// Toggle the "get the token by logging in" setting
async function onToggleLoginToken(): Promise<void> {
  if (saving.value) {
    loginToken.value = savedLoginToken.value
    return
  }
  const next = loginToken.value
  saving.value = true
  try {
    const outcome = await saveSettings({ loginToken: next })
    if (outcome.ok) {
      await refreshFromStorage()
      return
    }
    settingsError.value = outcome.error
    const read = await refreshFromStorage()
    loginToken.value = savedLoginToken.value
    settingsError.value = read.ok ? outcome.error : `${outcome.error} ${read.error}`
  } finally {
    saving.value = false
  }
}

// Sequence number for the storage read
let refreshSeq = 0

interface RefreshOutcome {
  ok: boolean // Whether the read was successful
  error: string // Error of the read (empty when successful)
}

// Read the settings from storage and update all the state of the popup
async function refreshFromStorage(): Promise<RefreshOutcome> {
  const seq = ++refreshSeq
  const outcome = await readSettingsResult()
  if (seq !== refreshSeq) return { ok: true, error: '' }
  if (!outcome.ok) {
    settingsError.value = outcome.error
    return { ok: false, error: outcome.error }
  }
  createOnSite.value = outcome.settings.createOnSite
  savedCreateOnSite.value = outcome.settings.createOnSite
  loginToken.value = outcome.settings.loginToken
  savedLoginToken.value = outcome.settings.loginToken
  settingsLoaded.value = true
  settingsError.value = ''
  return { ok: true, error: '' }
}

// Unsubscribe from the storage changes
let unsubscribe: (() => void) | undefined

onMounted(async () => {
  unsubscribe = subscribeSettingsChanges(() => {
    if (saving.value) return
    void refreshFromStorage()
  })
  await refreshFromStorage()
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>

<template>
  <div class="popup">
    <div class="row">
      <input
        v-model="blNo"
        type="text"
        placeholder="Bill of lading number (提单号)"
        @keyup.enter="run()"
      />
    </div>

    <div class="row">
      <button
        type="button"
        class="primary"
        :class="{ busy }"
        :disabled="busy || saving || !createOptIn"
        @click="run()"
      >
        {{ busy ? 'Running…' : 'Create draft on site' }}
      </button>
      <button type="button" @click="openPage">Open page</button>
    </div>

    <div v-if="settingsLoaded" class="row">
      <label>
        <input
          v-model="createOnSite"
          type="checkbox"
          :disabled="saving"
          @change="onToggleCreateOnSite"
        />
        Create the manifest on the site
      </label>
    </div>

    <p v-if="settingsLoaded && !createOptIn" class="hint">
      Creating a draft on the site is off until you tick "Create the manifest on the site".
    </p>

    <div v-if="settingsLoaded" class="row">
      <label>
        <input
          v-model="loginToken"
          type="checkbox"
          :disabled="saving"
          @change="onToggleLoginToken"
        />
        Get the token by logging in
      </label>
    </div>

    <p v-if="settingsLoaded && loginTokenOptIn" class="hint">
      The extension logs in to the site and uses the token it gets back. The manifest page does not have to be open.
    </p>

    <p v-if="settingsError" class="settings-error">{{ settingsError }}</p>

    <!--
      Result is stale - the current result is not for the bill number entered by the operator
    -->
    <!-- <p v-if="resultStale" class="hint stale-result">
      {{ staleMessage }}
    </p> -->

    <!--
      The ONE message of the last run — red for an error, yellow for a
      warning, green for a success. The popup does not list the blank fields
      and does not count anything: it says what happened, nothing more.
    -->
    <div v-if="runOutcome" class="message" :class="`message-${runOutcome.kind}`">
      <p class="message-main">{{ runOutcome.main }}</p>
      <p v-for="(line, index) in runOutcome.lines" :key="index" class="message-line">
        {{ line }}
      </p>
      <p v-if="runOutcome.note" class="message-note">{{ runOutcome.note }}</p>
    </div>
  </div>
</template>
