<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DeadlineError, withDeadline } from '../core/http'
import { readSettingsResult, saveSettings } from '../core/options'
import {
  MSG_FILL,
  type FillRequest,
  type FillResult,
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
/** Lỗi khi làm việc với trang (đọc 提单号, điền form). */
const pageError = ref('')
/** Lỗi khi lưu setting — RIÊNG, không đè lên lỗi của lần điền. */
const settingsError = ref('')
const result = ref<FillResult | null>(null)
/**
 * Đã đọc xong setting chưa — trước lúc đó KHÔNG hiện control của autoSubmit.
 *
 * Lý do: nếu hiện control trước khi đọc xong thì (a) một setting đã lưu là
 * `true` sẽ hiện ra là CHƯA tick trong suốt lúc đọc ⇒ người dùng tưởng
 * auto-submit đang tắt trong khi thực tế nó vẫn bật; và (b) nếu người dùng
 * tick sớm thì lần đọc trả về sau sẽ ĐÈ LÊN lựa chọn của họ. Giấu control
 * cho tới khi đọc xong ⇒ không cần cờ "userTouched" nào cả.
 *
 * Lần đọc HỎNG cũng giữ cờ này ở `false`: lúc đó ta không biết setting là
 * gì, nên không được hiện ra một control "tắt" bịa đặt.
 */
const settingsLoaded = ref(false)
/** Giá trị autoSubmit đã lưu THẬT — dùng để rollback khi lưu thất bại. */
const savedAutoSubmit = ref(false)
/** Đang lưu setting auto-submit — khoá control để không có 2 lần ghi chồng nhau. */
const saving = ref(false)

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

async function runFill(): Promise<void> {
  // Nút bị disable khi `busy`, nhưng phím Enter trên ô nhập KHÔNG bị disable
  // ⇒ phải chặn ở đây, nếu không sẽ có hai lần điền chạy chồng nhau.
  if (busy.value) return

  pageError.value = ''
  result.value = null
  const value = blNo.value.trim()
  if (!value) {
    pageError.value = 'Enter a bill of lading number first.'
    return
  }

  busy.value = true
  try {
    const tabId = await activeTabId()
    if (tabId === undefined) throw new Error('no active tab')
    const request: FillRequest = { type: MSG_FILL, blNo: value }
    // CHỈ gửi `autoSubmit` khi đã đọc xong setting.
    //
    // Gửi `false` placeholder sẽ bị content script dùng (vì
    // `request.autoSubmit ?? settings.autoSubmit` coi `false` là CÓ giá trị)
    // ⇒ opt-in đã lưu bị bỏ qua trong im lặng. Bỏ trống key ⇒ content script
    // tự đọc setting đã lưu.
    if (settingsLoaded.value) request.autoSubmit = autoSubmit.value

    const res = (await withDeadline(
      chrome.tabs.sendMessage(tabId, request),
      FILL_DEADLINE_MS,
      'The manifest fill',
    )) as FillResult
    result.value = res
    if (!res?.ok) {
      // `res.message` chỉ có khi content script dừng sớm; nếu không thì phải
      // tự dựng câu từ danh sách field bị chặn.
      pageError.value = describeIncompleteFill(res?.items ?? [], res?.message)
    }
  } catch (e) {
    pageError.value =
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
  // Đang lưu ⇒ bỏ qua lần click này và đưa checkbox về giá trị đã lưu thật.
  //
  // Checkbox đã bị disable trong lúc lưu, nhưng DOM chưa kịp render lần
  // disable đó nếu người dùng double-click rất nhanh ⇒ vẫn cần chặn ở đây.
  if (saving.value) {
    autoSubmit.value = savedAutoSubmit.value
    return
  }
  const next = autoSubmit.value
  saving.value = true
  try {
    const outcome = await saveSettings({ autoSubmit: next })
    if (outcome.ok) {
      // `outcome.settings.autoSubmit` là giá trị store thực sự giữ sau khi
      // ép kiểu ⇒ uy tín hơn `next`.
      savedAutoSubmit.value = outcome.settings.autoSubmit
      // Đồng bộ control với giá trị ĐÃ LƯU. Bình thường thì bằng `next` nên
      // không đổi gì; nhưng khi một lần tick bị bỏ qua (guard ở trên) thì
      // đây là chỗ duy nhất đưa control về đúng giá trị trong storage —
      // nếu không, UI và storage sẽ lệch nhau.
      autoSubmit.value = outcome.settings.autoSubmit
      settingsError.value = ''
      return
    }
    // Lưu thất bại ⇒ đưa checkbox về giá trị đã lưu thật và BÁO cho người
    // dùng. Không được im lặng mất setting.
    autoSubmit.value = savedAutoSubmit.value
    settingsError.value = outcome.error
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  const outcome = await readSettingsResult()
  if (!outcome.ok) {
    // Đọc hỏng ⇒ KHÔNG được coi là "setting = false".
    //
    // Content script coi `false` là CÓ giá trị (`request.autoSubmit ??
    // settings.autoSubmit`) ⇒ gửi `false` đi là đè lên opt-in đã lưu trong
    // im lặng. Giữ control ẩn + báo lỗi; payload lúc điền sẽ không kèm
    // `autoSubmit` ⇒ content script tự đọc setting (lần đọc MỚI của nó).
    settingsError.value = outcome.error
    return
  }
  autoSubmit.value = outcome.settings.autoSubmit
  savedAutoSubmit.value = outcome.settings.autoSubmit
  settingsLoaded.value = true
  settingsError.value = ''
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
    </div>

    <div class="row">
      <button type="button" class="primary" :disabled="busy" @click="runFill">
        {{ busy ? 'Filling…' : 'Fill data' }}
      </button>
      <button type="button" @click="openPage">Open page</button>
      <label v-if="settingsLoaded">
        <input
          v-model="autoSubmit"
          type="checkbox"
          :disabled="saving"
          @change="onToggleAutoSubmit"
        />
        Auto-click 确定 after filling
      </label>
    </div>

    <p v-if="settingsError" class="settings-error">{{ settingsError }}</p>
    <p v-if="pageError" class="error">{{ pageError }}</p>

    <div v-if="blocking.length" class="blocking">
      <p class="blocking-title">
        The site requires these fields, but they could not be filled in — see the note under each one:
      </p>
      <ul>
        <li v-for="field in blocking" :key="`${field.scope}-${field.row ?? 0}-${field.prop}`">
          <span class="blocking-label">{{ field.label }}</span>
          <span class="blocking-prop">{{ field.prop }}</span>
          <span v-if="field.note" class="blocking-note">{{ field.note }}</span>
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
