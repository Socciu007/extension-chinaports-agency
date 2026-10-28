<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DeadlineError, withDeadline } from '../core/http'
import { readSettings, writeSettings } from '../core/options'
import {
  MSG_FILL,
  MSG_GET_BL_NO,
  type FillResult,
  type GetBlNoResult,
  type ReportItem,
} from '../core/protocol'
import { blockingFields, describeIncompleteFill } from '../core/report'
import { MANIFEST_URL } from '../core/site-url'
import './styles.css'

/**
 * Hạn chờ trong popup.
 *
 * Lâu hơn mọi lần điền hợp lệ (API 15s + dict 15s + điền từng dòng hàng trên
 * site), nhưng KHÔNG vô hạn: `chrome.tabs.sendMessage` có thể không bao giờ
 * trả lời, và nếu không có hạn thì nút "Fill data" kẹt vĩnh viễn.
 */
const FILL_DEADLINE_MS = 300_000

const blNo = ref('')
const autoSubmit = ref(false)
const busy = ref(false)
const error = ref('')
const result = ref<FillResult | null>(null)

const items = computed<ReportItem[]>(() => result.value?.items ?? [])

/** Field site BẮT BUỘC mà lần điền này không điền được ⇒ chặn việc submit. */
const blocking = computed(() => blockingFields(items.value))

const counts = computed(() => {
  const acc = { ok: 0, skip: 0, warn: 0, error: 0 }
  for (const item of items.value) acc[item.status] += 1
  return acc
})

/** Mỗi icon ứng với đúng một trạng thái — không trùng lẫn. */
function icon(item: ReportItem): string {
  if (item.status === 'ok') return '✅'
  if (item.status === 'warn') return '⚠️'
  if (item.status === 'error') return '❌'
  return '⏭'
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

async function takeBlNoFromPage(): Promise<void> {
  error.value = ''
  try {
    const tabId = await activeTabId()
    if (tabId === undefined) throw new Error('no active tab')
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: MSG_GET_BL_NO,
    })) as GetBlNoResult
    if (res?.blNo) {
      blNo.value = res.blNo
    } else {
      error.value = 'No bill of lading number found on the current page.'
    }
  } catch {
    error.value = 'Open the manifest declaration page and try again.'
  }
}

async function runFill(): Promise<void> {
  // Nút bị disable khi `busy`, nhưng phím Enter trên ô nhập KHÔNG bị disable
  // ⇒ phải chặn ở đây, nếu không sẽ có hai lần điền chạy chồng nhau.
  if (busy.value) return

  error.value = ''
  result.value = null
  const value = blNo.value.trim()
  if (!value) {
    error.value = 'Enter a bill of lading number first.'
    return
  }

  busy.value = true
  try {
    const tabId = await activeTabId()
    if (tabId === undefined) throw new Error('no active tab')
    const res = (await withDeadline(
      chrome.tabs.sendMessage(tabId, {
        type: MSG_FILL,
        blNo: value,
        autoSubmit: autoSubmit.value,
      }),
      FILL_DEADLINE_MS,
      'The manifest fill',
    )) as FillResult
    result.value = res
    if (!res?.ok) {
      // `res.message` chỉ có khi content script dừng sớm; nếu không thì phải
      // tự dựng câu từ danh sách field bị chặn.
      error.value = describeIncompleteFill(res?.items ?? [], res?.message)
    }
  } catch (e) {
    error.value =
      e instanceof DeadlineError
        ? 'The fill is taking longer than expected. It may still be running on the page — check the manifest form before trying again.'
        : 'Could not reach the page. Open the manifest declaration page and try again.'
  } finally {
    busy.value = false
  }
}

async function openPage(): Promise<void> {
  await chrome.tabs.create({ url: MANIFEST_URL })
}

async function onToggleAutoSubmit(): Promise<void> {
  await writeSettings({ autoSubmit: autoSubmit.value })
}

onMounted(async () => {
  const settings = await readSettings()
  autoSubmit.value = settings.autoSubmit
})
</script>

<template>
  <div class="popup">
    <div class="row">
      <input
        v-model="blNo"
        type="text"
        placeholder="Bill of lading number (提单号)"
        @keyup.enter="runFill"
      />
      <button
        type="button"
        title="Read the bill of lading number entered on the page"
        @click="takeBlNoFromPage"
      >
        Read from page
      </button>
    </div>

    <div class="row">
      <button type="button" class="primary" :disabled="busy" @click="runFill">
        {{ busy ? 'Filling…' : 'Fill data' }}
      </button>
      <button type="button" @click="openPage">Open page</button>
      <label>
        <input v-model="autoSubmit" type="checkbox" @change="onToggleAutoSubmit" />
        Auto-click 确定 after filling
      </label>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="blocking.length" class="blocking">
      <p class="blocking-title">
        The site requires these fields, but the API has no data for them — fill them in by hand:
      </p>
      <ul>
        <li v-for="field in blocking" :key="`${field.scope}-${field.row ?? 0}-${field.prop}`">
          <span class="blocking-label">{{ field.label }}</span>
          <span class="blocking-prop">{{ field.prop }}</span>
        </li>
      </ul>
    </div>

    <div v-if="result" class="summary">
      ✅ {{ counts.ok }} · ⚠️ {{ counts.warn }} · ⏭ {{ counts.skip }} · ❌ {{ counts.error }} ·
      cargo: {{ result.cargoRows }} · containers: {{ result.containerRows }}
    </div>

    <table v-if="items.length">
      <thead>
        <tr>
          <th></th>
          <th>Field</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in items"
          :key="`${item.scope}-${item.row ?? 0}-${item.prop}`"
          :class="{ required: item.required === true }"
        >
          <td>{{ icon(item) }}</td>
          <td>{{ item.label }}</td>
          <td class="note">{{ item.note ?? '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
