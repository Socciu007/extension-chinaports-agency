<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { billNoAsWritten } from '../core/api'
import { DeadlineError, withDeadline } from '../core/http'
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
import { MANIFEST_ROUTE, MANIFEST_URL, routeOfHash } from '../core/site-url'
import './styles.css'

// Origin of the manifest declaration page.
const MANIFEST_ORIGIN = new URL(MANIFEST_URL).origin

// Deadline for the manifest run
const RUN_DEADLINE_MS = 300_000

const blNo = ref('')
const createOnSite = ref(false)
// Running a manifest run - lock the button to prevent sending two messages at the same time
const busy = ref(false)
const runError = ref('')
// Error when saving the setting - separate, does not overwrite the error of the run
const settingsError = ref('')
const result = ref<CreateResult | null>(null)
const settingsLoaded = ref(false)
// The value of createOnSite that was saved - used to rollback when saving fails
const savedCreateOnSite = ref(false)
// Saving the create-on-site setting - lock the control to prevent two writes at the same time
const saving = ref(false)

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

// The lines about the bill on the site - the same for every outcome
function billLines(res: CreateResult): string[] {
  const lines: string[] = []
  if (res.written) lines.push('Refresh the manifest list on the site to see the new draft.')
  if (res.billNo !== undefined && res.billNo !== '') lines.push(`Bill number: ${res.billNo}`)
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
      // The bill EXISTS on the site ⇒ the operator must not create a second
      // manifest for the same bill of lading number.
      note: res.billCreated ? NO_SECOND_MANIFEST : undefined,
    }
  }

  // Required fields are still blank ⇒ yellow.
  if (res.blocked) {
    const main = (res.message ?? '').trim()
    const lines: string[] = []
    if (res.written) lines.push(DRAFT_SAVED)
    lines.push(...billLines(res))
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
      lines: billLines(res),
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

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
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

  busy.value = true
  try {
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
    const billKey = billNoAsWritten(value)
    resultInputBlNo.value = billKey
  } catch (e) {
    console.error('[manifest-autofill] popup could not run the manifest', e)
    runError.value =
      e instanceof DeadlineError
        ? 'The manifest run is taking longer than expected. It may still be running on the page — check the manifest form before trying again.'
        : 'Could not reach the page. Open the manifest declaration page, reload it, and try again.'
  } finally {
    busy.value = false
  }
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
  if (parsed.origin !== MANIFEST_ORIGIN) return false
  return routeOfHash(parsed.hash) === MANIFEST_ROUTE
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
        :disabled="busy || !createOptIn"
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

    <p v-if="settingsError" class="settings-error">{{ settingsError }}</p>

    <!--
      Result is stale - the current result is not for the bill number entered by the operator
    -->
    <p v-if="resultStale" class="hint stale-result">
      {{ staleMessage }}
    </p>

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
