<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CARGO_LABELS, CONTAINER_LABELS, HEADER_LABELS } from '../core/field-meta'
import { DeadlineError, withDeadline } from '../core/http'
import {
  readSettingsResult,
  saveSettings,
  subscribeSettingsChanges,
  type SettingsChange,
} from '../core/options'
import {
  MSG_CREATE_MANIFEST,
  type CreateRequest,
  type CreateResult,
  type ReportItem,
} from '../core/protocol'
import { blockingFields } from '../core/report'
import { MANIFEST_URL } from '../core/site-url'
import './styles.css'

/**
 * Hạn chờ trong popup.
 *
 * PHẢI dài hơn hạn của lần chạy (`DEFAULT_DEADLINE_MS` = 4 phút trong
 * `manifest-run.ts`) ⇒ lỗi hết hạn của lần chạy tới được người dùng TRƯỚC,
 * thay vì popup báo chung chung "hết giờ" và giấu mất nguyên nhân thật.
 *
 * Vẫn KHÔNG vô hạn: `chrome.tabs.sendMessage` có thể không bao giờ trả lời,
 * và nếu không có hạn thì nút kẹt vĩnh viễn.
 */
const RUN_DEADLINE_MS = 300_000

const blNo = ref('')
const createOnSite = ref(false)
/** Đang chạy một lần run — khóa nút để không gửi hai message cùng lúc. */
const busy = ref(false)
/** Hành động đang chạy — để đổi nhãn của ĐÚNG nút đang bấm. */
const runningAction = ref<'preview' | 'create' | null>(null)
/** Lỗi của lần chạy (vận chuyển, hết hạn, hoặc `message` của kết quả). */
const runError = ref('')
/** Lỗi khi lưu setting — RIÊNG, không đè lên lỗi của lần chạy. */
const settingsError = ref('')
const result = ref<CreateResult | null>(null)
/**
 * Đã đọc xong setting chưa — trước lúc đó KHÔNG hiện control của createOnSite.
 *
 * Lý do: nếu hiện control trước khi đọc xong thì (a) một setting đã lưu là
 * `true` sẽ hiện ra là CHƯA tick trong suốt lúc đọc ⇒ người dùng tưởng
 * create-on-site đang tắt trong khi thực tế nó vẫn bật; và (b) nếu người dùng
 * tick sớm thì lần đọc trả về sau sẽ ĐÈ LÊN lựa chọn của họ. Giấu control
 * cho tới khi đọc xong ⇒ không cần cờ "userTouched" nào cả.
 *
 * Lần đọc HỎNG cũng giữ cờ này ở `false`: lúc đó ta không biết setting là
 * gì, nên không được hiện ra một control "tắt" bịa đặt.
 */
const settingsLoaded = ref(false)
/** Giá trị createOnSite đã lưu THẬT — dùng để rollback khi lưu thất bại. */
const savedCreateOnSite = ref(false)
/** Đang lưu setting create-on-site — khoá control để không có 2 lần ghi chồng nhau. */
const saving = ref(false)

const items = computed<ReportItem[]>(() => result.value?.items ?? [])

/** Các bước của lần chạy — để operator thấy run tới đâu. */
const steps = computed<string[]>(() => result.value?.steps ?? [])

/** Số dòng hàng / container mà lần chạy báo. */
const cargoRowCount = computed(() => result.value?.cargoRows ?? 0)
const containerRowCount = computed(() => result.value?.containerRows ?? 0)

/** Field site BẮT BUỘC mà API không cung cấp ⇒ operator phải điền tay. */
const blocking = computed(() => blockingFields(items.value))

/**
 * Operator đã opt-in "Create the manifest on the site" chưa.
 *
 * Phải có cả `settingsLoaded` (đọc setting hỏng ⇒ ta KHÔNG biết ý chí của
 * operator ⇒ không được cho ghi) lẫn checkbox đang tick.
 */
const createOptIn = computed(() => settingsLoaded.value && createOnSite.value === true)

const counts = computed(() => {
  let required = 0
  let optional = 0
  for (const item of items.value) {
    if (item.required === true) required += 1
    else optional += 1
  }
  return { required, optional }
})

/** Mỗi icon ứng với đúng một trạng thái — không trùng lẫn. */
function icon(item: ReportItem): string {
  if (item.status === 'ok') return '✅'
  if (item.status === 'warn') return '⚠️'
  if (item.status === 'error') return '❌'
  return '⏭'
}

/** Một dòng của bảng preview — field (có nhãn) + giá trị đã hiển thị. */
interface PreviewRow {
  /** số thứ tự của dòng hàng / container (chỉ có với hai loại đó) */
  row?: number
  /** key của payload (chữ thường) */
  field: string
  /** nhãn hiển thị của field */
  label: string
  /** giá trị đã hiển thị — `(blank)` nếu field trống */
  value: string
}

/**
 * Nhãn của một key payload.
 *
 * `HEADER_LABELS`/`CARGO_LABELS`/`CONTAINER_LABELS` được key theo TÊN FIELD
 * VIẾT HOA, còn key của payload thì CHỮ THƯỜNG ⇒ phải uppercase trước khi
 * tra. Không có nhãn ⇒ hiện luôn chính key đó.
 */
function labelFor(scope: 'header' | 'cargo' | 'container', key: string): string {
  const prop = key.toUpperCase()
  if (scope === 'header') return HEADER_LABELS[prop] ?? key
  if (scope === 'cargo') return CARGO_LABELS[prop] ?? key
  return CONTAINER_LABELS[prop] ?? key
}

/**
 * Giá trị để hiển thị — field trống hiện `(blank)`.
 *
 * Quy tắc "trống" GIỐNG HỆT `isBlankValue` của `manifest-run.ts` (chuỗi
 * rỗng sau trim, `null`/`undefined`, số `0`) ⇒ preview KHÔNG trái với report
 * (report liệt kê đúng những field đã hiện `(blank)` ở đây).
 */
function displayValue(value: unknown): string {
  if (value === undefined || value === null) return '(blank)'
  if (typeof value === 'string') return value.trim() === '' ? '(blank)' : value
  if (typeof value === 'number') return value === 0 ? '(blank)' : String(value)
  if (typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value) ?? '(blank)'
  } catch {
    return String(value)
  }
}

const headerRows = computed<PreviewRow[]>(() => {
  const header = result.value?.preview?.header ?? {}
  return Object.entries(header).map(([key, value]) => ({
    field: key,
    label: labelFor('header', key),
    value: displayValue(value),
  }))
})

const cargoRows = computed<PreviewRow[]>(() =>
  (result.value?.preview?.cargo ?? []).flatMap((row, index) =>
    Object.entries(row).map(([key, value]) => ({
      row: index + 1,
      field: key,
      label: labelFor('cargo', key),
      value: displayValue(value),
    })),
  ),
)

const containerRows = computed<PreviewRow[]>(() =>
  (result.value?.preview?.containers ?? []).flatMap((row, index) =>
    Object.entries(row).map(([key, value]) => ({
      row: index + 1,
      field: key,
      label: labelFor('container', key),
      value: displayValue(value),
    })),
  ),
)

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

/**
 * Chạy manifest.
 *
 * `allowWrite` = `false` ⇒ CHỈ preview (không POST nào lên site);
 * `allowWrite` = `true` ⇒ ghi lên site (tạo bill + gắn hàng + lưu nháp).
 *
 * `allowWrite` chỉ được là `true` khi hành động là "create" VÀ operator đã
 * opt-in — nếu không thì lần chạy bị bỏ qua, không gửi message nào.
 */
async function run(allowWrite: boolean): Promise<void> {
  if (busy.value) return
  if (allowWrite && !createOptIn.value) return

  runError.value = ''
  result.value = null
  const value = blNo.value.trim()
  if (!value) {
    runError.value = 'Enter a bill of lading number first.'
    return
  }

  busy.value = true
  runningAction.value = allowWrite ? 'create' : 'preview'
  try {
    const tabId = await activeTabId()
    if (tabId === undefined) throw new Error('no active tab')
    // `allowWrite` LUÔN là boolean — không bao giờ `undefined`, không bao giờ
    // là chuỗi ⇒ content script kiểm tra `=== true` một cách chắc chắn.
    const request: CreateRequest = {
      type: MSG_CREATE_MANIFEST,
      blNo: value,
      allowWrite,
    }
    const res = (await withDeadline(
      chrome.tabs.sendMessage(tabId, request),
      RUN_DEADLINE_MS,
      'The manifest run',
    )) as CreateResult
    result.value = res
  } catch (e) {
    // Chi tiết kỹ thuật (vd "The message port closed before a response was
    // received.") chỉ nằm ở console — người dùng chỉ thấy câu ngắn.
    console.error('[manifest-autofill] popup could not run the manifest', e)
    runError.value =
      e instanceof DeadlineError
        ? 'The manifest run is taking longer than expected. It may still be running on the page — check the manifest form before trying again.'
        : 'Could not reach the page. Open the manifest declaration page and try again.'
  } finally {
    busy.value = false
    runningAction.value = null
  }
}

async function openPage(): Promise<void> {
  const tabId = await activeTabId()
  if (tabId === undefined) {
    await chrome.tabs.create({ url: MANIFEST_URL })
    return
  }
  const tab = await chrome.tabs.get(tabId)

  if (tab.url?.startsWith(MANIFEST_URL)) {
    await chrome.tabs.reload(tabId)
  } else {
    await chrome.tabs.update(tabId, {
      url: MANIFEST_URL,
      active: true,
    })
  }
}

/**
 * Bật/tắt opt-in create-on-site.
 *
 * Checkbox này là opt-in DUY NHẤT cho hành động ghi lên site: nút "Create
 * draft on site" chỉ bật khi nó đang tick, và chính popup gửi `allowWrite`.
 */
async function onToggleCreateOnSite(): Promise<void> {
  // Đang lưu ⇒ bỏ qua lần click này và đưa checkbox về giá trị đã lưu thật.
  //
  // Checkbox đã bị disable trong lúc lưu, nhưng DOM chưa kịp render lần
  // disable đó nếu người dùng double-click rất nhanh ⇒ vẫn cần chặn ở đây.
  if (saving.value) {
    createOnSite.value = savedCreateOnSite.value
    return
  }
  const next = createOnSite.value
  saving.value = true
  try {
    const outcome = await saveSettings({ createOnSite: next })
    if (outcome.ok) {
      // `outcome.settings.createOnSite` là giá trị store thực sự giữ sau khi
      // ép kiểu ⇒ uy tín hơn `next`.
      savedCreateOnSite.value = outcome.settings.createOnSite
      // Đồng bộ control với giá trị ĐÃ LƯU. Bình thường thì bằng `next` nên
      // không đổi gì; nhưng khi một lần tick bị bỏ qua (guard ở trên) thì
      // đây là chỗ duy nhất đưa control về đúng giá trị trong storage —
      // nếu không, UI và storage sẽ lệch nhau.
      createOnSite.value = outcome.settings.createOnSite
      settingsError.value = ''
      return
    }
    // Lưu thất bại ⇒ đưa checkbox về giá trị đã lưu thật và BÁO cho người
    // dùng. Không được im lặng mất setting.
    createOnSite.value = savedCreateOnSite.value
    settingsError.value = outcome.error
  } finally {
    saving.value = false
  }
}

/**
 * Setting đổi từ nơi khác (trang options) ⇒ cập nhật control ngay.
 *
 * KHÔNG đụng vào trạng thái lưu của popup (`saving`): lần lưu đang chạy là
 * ý chí của operator, trạng thái đó phải giữ nguyên. Giá trị đã lưu mới
 * (`savedCreateOnSite`) thì cập nhật theo — đó là sự thật mới nhất trong
 * storage, và rollback phải dựa vào nó.
 */
function applyExternalChange(changes: SettingsChange): void {
  const next = changes.createOnSite
  if (next === undefined) return
  if (saving.value) return
  createOnSite.value = next
  savedCreateOnSite.value = next
}

/** Huỷ đăng ký `storage.onChanged` — phải gọi khi unmount. */
let unsubscribe: (() => void) | undefined

onMounted(async () => {
  unsubscribe = subscribeSettingsChanges(applyExternalChange)

  const outcome = await readSettingsResult()
  if (!outcome.ok) {
    // Đọc hỏng ⇒ KHÔNG được coi là "setting = false".
    //
    // Nếu coi như vậy thì opt-in đã lưu (đúng `true` trong storage) bị bỏ
    // qua trong im lặng. Giữ control ẩn + báo lỗi; nút "Create draft on site"
    // cũng ở trạng thái tắt ⇒ không có cách nào ghi lên site khi ta không
    // biết ý chí của operator.
    settingsError.value = outcome.error
    return
  }
  createOnSite.value = outcome.settings.createOnSite
  savedCreateOnSite.value = outcome.settings.createOnSite
  settingsLoaded.value = true
  settingsError.value = ''
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
        @keyup.enter="run(false)"
      />
    </div>

    <div class="row">
      <button type="button" class="primary" :disabled="busy" @click="run(false)">
        {{ runningAction === 'preview' ? 'Running…' : 'Preview data' }}
      </button>
      <button
        type="button"
        class="secondary"
        :disabled="busy || !createOptIn"
        @click="run(true)"
      >
        {{ runningAction === 'create' ? 'Running…' : 'Create draft on site' }}
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

    <p v-if="!createOptIn" class="hint">
      Creating a draft on the site is off until you tick "Create the manifest on the site".
    </p>

    <p v-if="settingsError" class="settings-error">{{ settingsError }}</p>
    <p v-if="runError" class="error">{{ runError }}</p>
    <p v-else-if="result && !result.ok && result.message" class="error run-message">
      {{ result.message }}
    </p>

    <div v-if="result && result.ok && result.blocked && result.message" class="blocked">
      <p class="blocked-message">{{ result.message }}</p>
    </div>

    <div v-if="blocking.length" class="blocking">
      <p class="blocking-title">
        The site requires these fields, but the API did not provide them — see the note under each
        one:
      </p>
      <ul>
        <li v-for="field in blocking" :key="`${field.scope}-${field.row ?? 0}-${field.prop}`">
          <span class="blocking-label">{{ field.label }}</span>
          <span class="blocking-prop">{{ field.prop }}</span>
          <span v-if="field.note" class="blocking-note">{{ field.note }}</span>
        </li>
      </ul>
    </div>

    <ol v-if="steps.length" class="steps">
      <li v-for="(step, index) in steps" :key="index">{{ step }}</li>
    </ol>

    <div
      v-if="result && (result.billCreated || result.written || result.billNo)"
      class="bill-status"
    >
      <p v-if="result.written" class="bill-line">
        The manifest was created on the site and saved as a draft (暂存).
      </p>
      <p v-else-if="result.billCreated" class="bill-line">
        The manifest bill was created on the site, but saving it did not finish.
      </p>
      <p v-if="result.billNo" class="bill-line">Bill number: {{ result.billNo }}</p>
      <p v-if="result.written" class="double-write">
        A draft was created on the site for this bill of lading number. Running it again would
        create a second manifest.
      </p>
    </div>

    <div v-if="result" class="summary">
      cargo: {{ cargoRowCount }} · containers: {{ containerRowCount }} · blank fields: {{
        counts.required
      }}
      required, {{ counts.optional }} optional
    </div>

    <table v-if="items.length" class="table">
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

    <details v-if="result" class="preview" open>
      <summary>Header</summary>
      <table class="table">
        <tbody>
          <tr v-for="row in headerRows" :key="row.field">
            <td class="field">{{ row.label }}</td>
            <td class="value">{{ row.value }}</td>
          </tr>
        </tbody>
      </table>
    </details>

    <details v-if="result" class="preview">
      <summary>Cargo rows ({{ cargoRowCount }})</summary>
      <table class="table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Field</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in cargoRows" :key="`${row.row}-${row.field}-${index}`">
            <td class="row-index">{{ row.row }}</td>
            <td class="field">{{ row.label }}</td>
            <td class="value">{{ row.value }}</td>
          </tr>
        </tbody>
      </table>
    </details>

    <details v-if="result" class="preview">
      <summary>Container rows ({{ containerRowCount }})</summary>
      <table class="table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Field</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in containerRows" :key="`${row.row}-${row.field}-${index}`">
            <td class="row-index">{{ row.row }}</td>
            <td class="field">{{ row.label }}</td>
            <td class="value">{{ row.value }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>
