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
import {
  DEFAULT_LOGIN_CREDENTIALS,
} from '../core/login-credentials'
import './styles.css'

const apiBase = ref('')
const siteApiBase = ref('')

/**
 * Ảnh chụp giá trị ĐÃ LƯU — cơ sở để biết người dùng đã sửa gì.
 *
 * CHỈ những key khác với ảnh chụp này mới được ghi. Lý do: trang này có thể
 * mở lâu hơn một chỗ khác ghi storage (ví dụ popup bật chế độ đăng nhập) ⇒
 * ghi cả bộ setting sẽ XOÁ lựa chọn của người dùng trong im lặng, trong khi
 * trang vẫn hiện "Saved.".
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
watch([apiBase, siteApiBase], clearStatus)

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
    loaded.value = outcome.settings
    settingsLoaded.value = true
  } finally {
    loading.value = false
  }
}

/**
 * Storage đổi từ nơi khác (ví dụ popup ghi `loginToken`).
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

    if (Object.keys(patch).length === 0) {
      // Form đã khớp storage ⇒ không có gì để ghi ⇒ không được ghi cho có.
      showStatus('Nothing to save.')
      return
    }

    // The values that were REALLY written - captured BEFORE the await, so the
    // badge can be checked against them afterwards.
    const written = {
      apiBase: nextApiBase,
      siteApiBase: nextSiteApiBase,
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

    // The operator may have typed while the write was in flight ⇒ the badge
    // must not say "Saved." for a value that was NOT stored.
    if (
      apiBase.value.trim() !== written.apiBase ||
      siteApiBase.value.trim() !== written.siteApiBase
    ) {
      saveError.value = 'The settings changed while they were being saved. Press Save again.'
      return
    }

    showStatus('Saved.')
  } finally {
    saving.value = false
  }
}

/*
 * The login details - the section BELOW the settings form.
 *
 * The details live in `chrome.storage.local` and NEVER in `chrome.storage.sync`:
 * a synced password leaves the machine (it is uploaded to the Google account
 * of the operator and copied to every other machine of theirs).
 *
 * The section is INDEPENDENT of the settings form: its own state, its own save
 * button, its own status and its own error. Saving the settings must not
 * write the credentials and saving the credentials must not write the
 * settings.
 */

/** The account of the site. */
const siteUsername = ref('')
/** The password of the site. */
const sitePassword = ref('')
/** The user of the captcha service (超級鹰 / chaojiying). */
const ocrUser = ref('')
/** The password of the captcha service. */
const ocrPassword = ref('')
/** The software ID of the captcha service. */
const ocrSoftwareId = ref('')

/**
 * The details have been read - only then the form may be shown.
 *
 * The same rule as the settings form: a form that pretends to be the stored
 * value is worse than no form at all. A failed read ⇒ the error and NO form.
 */
const loginLoaded = ref(false)
/** The details are being read (the first time, or after a Retry). */
const loginLoading = ref(true)
/** The error of READING the details - its own, it does not overwrite the save error. */
const loginLoadError = ref('')
/** The error of SAVING the details - its own. */
const loginSaveError = ref('')
/** The badge of the login section (empty = no badge). */
const loginStatus = ref('')
/** The details are being written - the save button is locked meanwhile. */
const loginSaving = ref(false)

/** Timer that removes the badge of the login section - cleaned on unmount. */
let loginStatusTimer: ReturnType<typeof setTimeout> | undefined

function clearLoginStatusTimer(): void {
  if (loginStatusTimer === undefined) return
  clearTimeout(loginStatusTimer)
  loginStatusTimer = undefined
}

/** Show the badge of the login section, then remove it after 2s. */
function showLoginStatus(message: string): void {
  clearLoginStatusTimer()
  loginStatus.value = message
  loginStatusTimer = setTimeout(() => {
    loginStatus.value = ''
    loginStatusTimer = undefined
  }, 2000)
}

/** Remove the badge of the login section (with its timer). */
function clearLoginStatus(): void {
  clearLoginStatusTimer()
  loginStatus.value = ''
}

// The badge must go away as soon as the operator edits a field - the page
// must not say "Saved." while the form holds a change that is NOT saved.
watch(
  [siteUsername, sitePassword, ocrUser, ocrPassword, ocrSoftwareId],
  clearLoginStatus,
)


onMounted(async () => {
  unsubscribe = subscribeSettingsChanges(applyExternalChange)
  await load()
})

onUnmounted(() => {
  clearStatusTimer()
  clearLoginStatusTimer()
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
    </div>

    <p class="actions">
      <button type="button" class="primary" :disabled="!settingsLoaded || saving" @click="save">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
      <span v-if="status" class="status">{{ status }}</span>
    </p>

    <p v-if="saveError" class="error save-error">{{ saveError }}</p>

    <!--
      The login details - an INDEPENDENT section: its own state, its own save
      button, its own status and its own error. The credentials are written to
      `chrome.storage.local` and NEVER to the synced storage.
    -->
    <section class="login-section">
      <h2>Login details</h2>
      <p class="hint">
        The account of the site and the account of the captcha service (超級鹰). They are used
        only when "Get the token by logging in" is ticked in the popup. The details stay in this
        browser - they are never synced to your Google account - and they are sent nowhere except
        the site itself and the captcha service.
      </p>

      <p v-if="loginLoadError" class="login-load-error">{{ loginLoadError }}</p>
      <button
        v-if="loginLoadError"
        type="button"
        class="login-retry"
        :disabled="loginLoading"
        @click=""
      >
        Retry
      </button>
      <p v-else-if="loginLoading" class="hint">Loading the login details…</p>

      <!-- The form is only shown when the read worked - see `loginLoaded`. -->
      <div v-if="loginLoaded">
        <label for="site-username">Site account</label>
        <input
          id="site-username"
          v-model="siteUsername"
          type="text"
          autocomplete="off"
          spellcheck="false"
        />

        <label for="site-password">Site password</label>
        <input
          id="site-password"
          v-model="sitePassword"
          type="password"
          autocomplete="off"
        />

        <label for="ocr-user">Captcha service user</label>
        <input
          id="ocr-user"
          v-model="ocrUser"
          type="text"
          autocomplete="off"
          spellcheck="false"
        />

        <label for="ocr-password">Captcha service password</label>
        <input
          id="ocr-password"
          v-model="ocrPassword"
          type="password"
          autocomplete="off"
        />

        <label for="ocr-software-id">Captcha service software ID</label>
        <input
          id="ocr-software-id"
          v-model="ocrSoftwareId"
          type="text"
          autocomplete="off"
          spellcheck="false"
        />

        <p class="actions">
          <button
            type="button"
            class="login-save"
            :disabled="loginSaving"
            @click=""
          >
            {{ loginSaving ? 'Saving…' : 'Save login details' }}
          </button>
          <span v-if="loginStatus" class="login-status">{{ loginStatus }}</span>
        </p>

        <p v-if="loginSaveError" class="login-error">{{ loginSaveError }}</p>
      </div>
    </section>
  </div>
</template>
