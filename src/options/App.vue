<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import {
  DEFAULT_SETTINGS,
  readSettingsResult,
  saveSettings,
  subscribeSettingsChanges,
  type ExtensionSettings,
  type SettingsChange,
} from '../core/options'
import './styles.css'

const apiBase = ref('')
const siteApiBase = ref('')
const autoSubmit = ref(false)

/**
 * Ảnh chụp giá trị ĐÃ LƯU — cơ sở để biết người dùng đã sửa gì.
 *
 * CHỈ những key khác với ảnh chụp này mới được ghi. Lý do: trang này có thể
 * mở lâu hơn một chỗ khác ghi storage (ví dụ popup bật auto-submit) ⇒ ghi cả
 * bộ setting sẽ XOÁ opt-in của người dùng trong im lặng, trong khi trang vẫn
 * hiện "Saved.".
 */
const loaded = ref<ExtensionSettings | null>(null)
/**
 * Đã đọc xong setting chưa — chưa đọc xong thì form KHÔNG được hiện ra.
 *
 * Lý do giống popup: một form đang hiện là "đại diện trung thực" cho setting
 * đã lưu thì mọi giá trị hiện trong đó phải LÀ giá trị đã lưu. Trước lúc đọc
 * xong ta chưa biết `apiBase`/`siteApiBase` của người dùng là gì ⇒ hiện form
 * ra (kể cả bằng giá trị mặc định) là NÓI DỐI, và nếu người dùng bấm Save
 * ngay thì ta ghi đè base tuỳ chỉnh của chính họ bằng giá trị mặc định.
 *
 * Lần đọc HỎNG cũng giữ cờ này ở `false`: lúc đó ta không biết setting là
 * gì ⇒ không được điền form, không được cho bấm Save, chỉ được báo lỗi.
 */
const settingsLoaded = ref(false)
/** Đang đọc setting (lần đầu, hoặc lần bấm Retry). */
const loading = ref(true)
/** Lỗi khi ĐỌC setting — RIÊNG, không đè lên lỗi lúc lưu. */
const loadError = ref('')
/** Lỗi khi LƯU setting — RIÊNG. */
const saveError = ref('')
/** Lỗi kiểm tra `apiBase` — hiện tại chỗ, cạnh ô nhập. */
const apiBaseError = ref('')
/** Badge trạng thái sau lần lưu (rỗng = không có badge). */
const status = ref('')
/** Đang lưu — khoá nút Save để không có hai lần ghi chồng nhau. */
const saving = ref(false)

/** Timer xoá badge trạng thái — phải dọn khi unmount. */
let statusTimer: ReturnType<typeof setTimeout> | undefined
/** Huỷ đăng ký `storage.onChanged` — phải gọi khi unmount. */
let unsubscribe: (() => void) | undefined

function clearStatusTimer(): void {
  if (statusTimer === undefined) return
  clearTimeout(statusTimer)
  statusTimer = undefined
}

/** Báo trạng thái rồi tự xoá sau 2s. */
function showStatus(message: string): void {
  clearStatusTimer()
  status.value = message
  statusTimer = setTimeout(() => {
    status.value = ''
    statusTimer = undefined
  }, 2000)
}

/** Xoá badge trạng thái (kèm timer của nó). */
function clearStatus(): void {
  clearStatusTimer()
  status.value = ''
}

// Badge phải tắt ngay khi người dùng sửa ô — trang không được nói "Saved."
// trong khi form đang chứa thay đổi CHƯA lưu.
watch([apiBase, siteApiBase, autoSubmit], clearStatus)

/**
 * Gán một key của `ExtensionSettings` mà vẫn giữ đúng kiểu của key đó.
 *
 * Cần hàm riêng vì `target[key] = value` với `key` là union thì TypeScript
 * không đòi kiểm tra kiểu chéo giữa các key.
 */
function assignSetting<K extends keyof ExtensionSettings>(
  target: ExtensionSettings,
  key: K,
  value: ExtensionSettings[K],
): void {
  target[key] = value
}

/**
 * `apiBase` phải là URL TUYỆT ĐỐI khi không rỗng.
 *
 * Lý do: base tương đối tạo ra URL tương đối ⇒ lỗi chỉ hiện ra lúc điền dữ
 * liệu thành "HTTP error" khó hiểu (xem `src/core/api.ts`).
 *
 * `siteApiBase` KHÔNG dùng check này: nó là đường dẫn trên chính site
 * (`/api/booking/exportManifestDataMaintain`) nên giá trị tương đối là hợp lệ.
 */
function isAbsoluteHttpUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const outcome = await readSettingsResult()
    if (!outcome.ok) {
      // Đọc hỏng ⇒ KHÔNG biết setting đã lưu là gì ⇒ KHÔNG điền form bằng
      // giá trị mặc định (`readSettings` nuốt lỗi rồi trả về mặc định — dùng
      // nó ở đây sẽ khiến lần Save sau ghi đè base tuỳ chỉnh của người dùng).
      loadError.value = outcome.error
      settingsLoaded.value = false
      loaded.value = null
      return
    }
    apiBase.value = outcome.settings.apiBase
    siteApiBase.value = outcome.settings.siteApiBase
    autoSubmit.value = outcome.settings.autoSubmit
    loaded.value = outcome.settings
    settingsLoaded.value = true
  } finally {
    loading.value = false
  }
}

/**
 * Storage đổi từ nơi khác (ví dụ popup ghi `autoSubmit`).
 *
 * Quy tắc: ô nào người dùng CHƯA sửa (giá trị trong form == ảnh chụp) thì
 * đồng bộ cả form lẫn ảnh chụp; ô nào người dùng ĐÃ sửa thì CHỈ cập nhật
 * ảnh chụp — TUYỆT ĐỐI không ghi đè chỉnh sửa đang dở.
 */
function applyExternalChange(changes: SettingsChange): void {
  const snapshot = loaded.value
  if (!snapshot) return

  const newApiBase = changes.apiBase
  if (newApiBase !== undefined) {
    if (apiBase.value === snapshot.apiBase) apiBase.value = newApiBase
    assignSetting(snapshot, 'apiBase', newApiBase)
  }
  const newSiteApiBase = changes.siteApiBase
  if (newSiteApiBase !== undefined) {
    if (siteApiBase.value === snapshot.siteApiBase) siteApiBase.value = newSiteApiBase
    assignSetting(snapshot, 'siteApiBase', newSiteApiBase)
  }
  const newAutoSubmit = changes.autoSubmit
  if (newAutoSubmit !== undefined) {
    if (autoSubmit.value === snapshot.autoSubmit) autoSubmit.value = newAutoSubmit
    assignSetting(snapshot, 'autoSubmit', newAutoSubmit)
  }
}

async function save(): Promise<void> {
  // Chưa đọc xong ⇒ KHÔNG được ghi: ta không biết setting đã lưu là gì.
  if (!settingsLoaded.value || saving.value) return

  saving.value = true
  saveError.value = ''
  apiBaseError.value = ''
  clearStatus()
  try {
    const nextApiBase = apiBase.value.trim()
    const nextSiteApiBase = siteApiBase.value.trim()

    if (nextApiBase !== '' && !isAbsoluteHttpUrl(nextApiBase)) {
      // Không ghi gì cả — báo lỗi tại chỗ để người dùng sửa lại.
      apiBaseError.value =
        'The manifest data API must be a full URL, for example https://example.com/api.'
      return
    }

    const snapshot = loaded.value
    if (!snapshot) return

    // CHỈ ghi những key người dùng ĐÃ sửa. Ghi cả bộ setting sẽ xoá những
    // thay đổi mà nơi khác (popup, tab khác) vừa lưu.
    const patch: Partial<ExtensionSettings> = {}
    if (nextApiBase !== snapshot.apiBase) patch.apiBase = nextApiBase
    if (nextSiteApiBase !== snapshot.siteApiBase) patch.siteApiBase = nextSiteApiBase
    if (autoSubmit.value !== snapshot.autoSubmit) patch.autoSubmit = autoSubmit.value

    if (Object.keys(patch).length === 0) {
      // Form đã khớp storage ⇒ không có gì để ghi ⇒ không được ghi cho có.
      showStatus('Nothing to save.')
      return
    }

    const outcome = await saveSettings(patch)
    if (!outcome.ok) {
      // KHÔNG báo "Saved." khi ghi hỏng — thông báo đó phải CÓ NGHĨA là
      // "đã lưu được". Im lặng ở đây là mất setting trong im lặng.
      saveError.value = outcome.error
      return
    }

    // Cập nhật ảnh chụp theo giá trị ĐÃ LƯU THẬT ⇒ lần Save sau không gửi
    // lại patch cũ.
    //
    // KHÔNG copy `outcome.settings` vào ô nhập: giữ đúng thứ người dùng vừa
    // gõ (ví dụ base rỗng vẫn hiện trống, dù storage đã lưu giá trị mặc định).
    for (const key of Object.keys(patch) as (keyof ExtensionSettings)[]) {
      assignSetting(snapshot, key, outcome.settings[key])
    }

    showStatus('Saved.')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  unsubscribe = subscribeSettingsChanges(applyExternalChange)
  await load()
})

onUnmounted(() => {
  clearStatusTimer()
  unsubscribe?.()
})
</script>

<template>
  <div class="options">
    <h1>Manifest Autofill — Options</h1>

    <p v-if="loadError" class="error load-error">{{ loadError }}</p>
    <button
      v-if="loadError"
      type="button"
      class="retry"
      :disabled="loading"
      @click="load"
    >
      Retry
    </button>
    <p v-else-if="loading" class="hint">Loading the settings…</p>

    <!-- Chỉ hiện form khi đã đọc xong setting — xem giải thích của `settingsLoaded`. -->
    <div v-if="settingsLoaded">
      <label for="api-base">Manifest data API</label>
      <input
        id="api-base"
        v-model="apiBase"
        type="text"
        spellcheck="false"
        :aria-invalid="apiBaseError ? 'true' : undefined"
        :aria-describedby="apiBaseError ? 'api-base-hint api-base-error' : 'api-base-hint'"
      />
      <p id="api-base-hint" class="hint">
        The dadaex endpoint. The bill of lading number is appended as the <code>?blNo=</code> query
        string; a trailing piece suffix such as <code>P1</code> is stripped automatically. Leaving
        this blank replaces the current base with the default
        (<code>{{ DEFAULT_SETTINGS.apiBase }}</code>); a custom base is not kept.
      </p>
      <p v-if="apiBaseError" id="api-base-error" class="error field-error">
        {{ apiBaseError }}
      </p>

      <label for="site-api-base">Site dictionary API</label>
      <input
        id="site-api-base"
        v-model="siteApiBase"
        type="text"
        spellcheck="false"
        aria-describedby="site-api-base-hint"
      />
      <p id="site-api-base-hint" class="hint">
        Used to fetch the 承运人代码, 交货条款, port, container type and size lists. Leaving this
        blank replaces the current base with the default
        (<code>{{ DEFAULT_SETTINGS.siteApiBase }}</code>, a path on the site itself); a custom base is
        not kept.
      </p>

      <label>
        <input v-model="autoSubmit" type="checkbox" />
        Automatically click 确定 on the header form after filling
      </label>
      <p class="hint">
        Off by default. When enabled, the extension saves the 舱单 record exactly as a manual entry
        would. The change is applied when you press Save. The extension never disseminates on its
        own (上传船代 / send).
      </p>
    </div>

    <p class="actions">
      <button type="button" class="primary" :disabled="!settingsLoaded || saving" @click="save">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
      <span v-if="status" class="status">{{ status }}</span>
    </p>

    <p v-if="saveError" class="error save-error">{{ saveError }}</p>
  </div>
</template>
