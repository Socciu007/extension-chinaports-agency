<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { DEFAULT_SETTINGS, readSettingsResult, saveSettings } from '../core/options'
import './styles.css'

const apiBase = ref('')
const siteApiBase = ref('')
const autoSubmit = ref(false)

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
/** Lỗi khi ĐỌC setting — RIÊNG, không đè lên lỗi lúc lưu. */
const loadError = ref('')
/** Lỗi khi LƯU setting — RIÊNG. */
const saveError = ref('')
/** Vừa lưu thành công. */
const saved = ref(false)
/** Đang lưu — khoá nút Save để không có hai lần ghi chồng nhau. */
const saving = ref(false)

/**
 * Timer xoá thông báo "Saved.".
 *
 * Phải dọn khi unmount: timer còn sống sẽ giữ closure của component đã rời
 * khỏi DOM (và trong test sẽ rò ra ngoài).
 */
let savedTimer: ReturnType<typeof setTimeout> | undefined

function clearSavedTimer(): void {
  if (savedTimer === undefined) return
  clearTimeout(savedTimer)
  savedTimer = undefined
}

async function load(): Promise<void> {
  loadError.value = ''
  const outcome = await readSettingsResult()
  if (!outcome.ok) {
    // Đọc hỏng ⇒ KHÔNG biết setting đã lưu là gì ⇒ KHÔNG điền form bằng
    // giá trị mặc định (`readSettings` nuốt lỗi rồi trả về mặc định — dùng
    // nó ở đây sẽ khiến lần Save sau ghi đè base tuỳ chỉnh của người dùng).
    loadError.value = outcome.error
    settingsLoaded.value = false
    return
  }
  apiBase.value = outcome.settings.apiBase
  siteApiBase.value = outcome.settings.siteApiBase
  autoSubmit.value = outcome.settings.autoSubmit
  settingsLoaded.value = true
}

async function save(): Promise<void> {
  // Chưa đọc xong ⇒ KHÔNG được ghi: ta không biết setting đã lưu là gì.
  if (!settingsLoaded.value || saving.value) return

  saving.value = true
  saveError.value = ''
  saved.value = false
  try {
    const outcome = await saveSettings({
      apiBase: apiBase.value.trim(),
      siteApiBase: siteApiBase.value.trim(),
      autoSubmit: autoSubmit.value,
    })
    if (!outcome.ok) {
      // KHÔNG báo "Saved." khi ghi hỏng — thông báo đó phải CÓ NGHĨA là
      // "đã lưu được". Im lặng ở đây là mất setting trong im lặng.
      saveError.value = outcome.error
      return
    }
    // CỐ TÌNH KHÔNG copy `outcome.settings` ngược lại form: giữ đúng thứ
    // người dùng vừa gõ. `outcome.settings` là kết quả merge (base rỗng đã
    // bị điền mặc định) ⇒ copy nó làm form lệch với những gì người dùng
    // vừa nhìn và vừa gõ.
    saved.value = true
    clearSavedTimer()
    savedTimer = setTimeout(() => {
      saved.value = false
      savedTimer = undefined
    }, 2000)
  } finally {
    saving.value = false
  }
}

onMounted(load)

onUnmounted(() => {
  clearSavedTimer()
})
</script>

<template>
  <div class="options">
    <h1>Manifest Autofill — Options</h1>

    <p v-if="loadError" class="error load-error">{{ loadError }}</p>
    <p v-else-if="!settingsLoaded" class="hint">Loading the settings…</p>

    <!-- Chỉ hiện form khi đã đọc xong setting — xem giải thích của `settingsLoaded`. -->
    <div v-if="settingsLoaded">
      <label for="api-base">Manifest data API</label>
      <input id="api-base" v-model="apiBase" type="text" />
      <p id="api-base-hint" class="hint">
        The dadaex endpoint. The bill of lading number is appended as the <code>?blNo=</code> query
        string; a trailing piece suffix such as <code>P1</code> is stripped automatically. Leaving
        this blank stores the default (<code>{{ DEFAULT_SETTINGS.apiBase }}</code>) — it does not
        clear the base.
      </p>

      <label for="site-api-base">Site dictionary API</label>
      <input id="site-api-base" v-model="siteApiBase" type="text" />
      <p id="site-api-base-hint" class="hint">
        Used to fetch the 承运人代码, 交货条款, port, container type and size lists. Leaving this blank
        stores the default (<code>{{ DEFAULT_SETTINGS.siteApiBase }}</code>, a path on the site
        itself) — it does not clear the base.
      </p>

      <label>
        <input v-model="autoSubmit" type="checkbox" />
        Automatically click 确定 on the header form after filling
      </label>
      <p class="hint">
        Off by default. When enabled, the extension saves the 舱单 record exactly as a manual entry
        would. The extension never disseminates on its own (上传船代 / send).
      </p>
    </div>

    <p>
      <button type="button" class="primary" :disabled="!settingsLoaded || saving" @click="save">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
      <span v-if="saved" class="status">Saved.</span>
    </p>

    <p v-if="saveError" class="error save-error">{{ saveError }}</p>
  </div>
</template>
