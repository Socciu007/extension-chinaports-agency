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
  type ReportItem,
} from '../core/protocol'
import { blockingFields } from '../core/report'
import { MANIFEST_ROUTE, MANIFEST_URL, routeOfHash } from '../core/site-url'
import './styles.css'

// Origin of the manifest declaration page.
const MANIFEST_ORIGIN = new URL(MANIFEST_URL).origin

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

/**
 * Số bill mà lần chạy CUỐI tạo ra report đang hiện.
 *
 * Đây là SỐ BILL CỦA OPERATOR (số ô nhập, đã trim + upper-case, giữ hậu tố
 * piece) — KHÔNG phải `result.billNo` (mã bill do SITE cấp, xem
 * `manifest-run.ts`). Hai thứ tên gần giống nhau nhưng nghĩa khác hẳn: so
 * sán nhầm thì MỌI report bị coi là của bill khác.
 *
 * Rỗng = chưa có lần chạy nào ⇒ chưa có report nào để gán nhầm.
 */
const resultInputBlNo = ref('')

/**
 * Report đang hiện có thuộc về bill KHÁC với bill trong ô nhập không?
 *
 * Đây là chỗ operator gán nhầm DỄ NHẤT: sau khi tạo bill A, report của A
 * vẫn nằm trên màn hình lúc operator đang gõ bill B — không có dấu hiệu thì
 * "đã tạo manifest" bị đọc là của B.
 *
 * - Đang chạy ⇒ report đang hiện là của lần chạy TRƯỚC.
 * - Ô nhập rỗng ⇒ không có bill nào để gán nhầm ⇒ KHÔNG cũ: lần chạy bị
 *   chặn vì ô rỗng phải để lại kết quả cũ như kết quả hiện hành.
 * - Ô nhập gõ bill KHÁC bill của report ⇒ report là của bill khác.
 */
const resultStale = computed(() => {
  if (result.value === null) return false
  // Đang chạy ⇒ report đang hiện là của lần chạy TRƯỚC.
  if (busy.value) return true
  const typed = billNoAsWritten(blNo.value)
  // Ô nhập rỗng ⇒ không có bill nào để gán nhầm ⇒ không cũ.
  if (typed === '' || resultInputBlNo.value === '') return false
  return typed !== resultInputBlNo.value
})

/**
 * Câu của dấu hiệu "report này không thuộc về bill đang gõ".
 *
 * Có HAI lý do ⇒ hai câu khác nhau, và câu nào cũng phải ĐÚNG trong trạng
 * thái của nó: banner không được nói "đang chạy" sau khi lần chạy đã hỏng.
 */
const staleMessage = computed(() => {
  if (!resultStale.value) return ''
  if (busy.value) return 'Showing the previous result — a new run is in progress.'
  return 'Showing the previous result — it belongs to a different bill of lading number.'
})

const items = computed<ReportItem[]>(() => result.value?.items ?? [])

/** Số dòng hàng / container mà lần chạy báo. */
const cargoRowCount = computed(() => result.value?.cargoRows ?? 0)
const containerRowCount = computed(() => result.value?.containerRows ?? 0)

/** Field site BẮT BUỘC mà API không cung cấp ⇒ operator phải điền tay. */
const blocking = computed(() => blockingFields(items.value))

/**
 * Operator đã opt-in "Create the manifest on the site" chưa.
 *
 * Dùng GIÁ TRỊ ĐÃ LƯU (`savedCreateOnSite`), KHÔNG dùng checkbox
 * (`createOnSite`): content script kiểm tra setting ĐÃ LƯU, nên nếu nút bật
 * theo checkbox thì operator có thể bấm "create" trước khi lần lưu kịp
 * xong ⇒ content script từ chối mà popup không hiện được lý do.
 *
 * Phải có cả `settingsLoaded` (đọc setting hỏng ⇒ ta KHÔNG biết ý chí của
 * operator ⇒ không được cho ghi).
 */
const createOptIn = computed(() => settingsLoaded.value && savedCreateOnSite.value === true)

const counts = computed(() => {
  let required = 0
  let optional = 0
  for (const item of items.value) {
    if (item.required === true) required += 1
    else optional += 1
  }
  return { required, optional }
})

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

  // Lần chạy thật sự BẮT ĐẦU ⇒ `busy` = true ⇒ `resultStale` tự động đánh
  // dấu report đang hiện là của lần chạy TRƯỚC. Lần chạy bị chặn vì ô nhập
  // rỗng thì `busy` không bao giờ lên true ⇒ kết quả cũ vẫn là kết quả
  // hiện hành (không có lần chạy nào mới để gán nhầm).
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
    // Kết quả cũ chỉ bị thay khi kết quả MỚI đã về.
    result.value = res
    // Log the steps of the run — FOR READING LATER ONLY, never shown in the
    // popup: the popup reports only the final outcome (error / warning /
    // success). `steps` stays in the result, so a failed run can still be
    // traced from the console.
    console.info('[manifest-autofill] manifest run steps', res.steps)
    // Số bill của lần chạy này (giữ hậu tố piece) — để biết report đang
    // hiện thuộc về số bill nào (`resultInputBlNo`).
    const billKey = billNoAsWritten(value)
    resultInputBlNo.value = billKey
  } catch (e) {
    // Chi tiết kỹ thuật (vd "The message port closed before a response was
    // received.") chỉ nằm ở console — người dùng chỉ thấy câu ngắn.
    console.error('[manifest-autofill] popup could not run the manifest', e)
    runError.value =
      e instanceof DeadlineError
        ? 'The manifest run is taking longer than expected. It may still be running on the page — check the manifest form before trying again.'
        : 'Could not reach the page. Open the manifest declaration page, reload it, and try again.'
  } finally {
    busy.value = false
  }
}

/**
 * URL của tab có trỏ ĐÚNG vào trang khai 预配舱单 không?
 *
 * Luật lấy route nằm trong `routeOfHash` (`src/core/site-url.ts`) — CHUNG với
 * content script (`src/content/index.ts`) để hai bên không thể lệch nhau về
 * "trang khai 预配舱单" là gì. Trước đây popup so tiền tố nên nhận nhầm route
 * `…maintenanceOfManifestDataExtra`, reload xong content script vẫn từ chối ⇒
 * operator không thoát ra được khỏi vòng lặp.
 *
 * So KHỚP CHÍNH XÁC (`===`), không so tiền tố: route của site là tiền tố của
 * một route khác có thật (`…maintenanceOfManifestDataExtra`).
 *
 * Origin cũng phải khớp: content script chỉ chạy trên origin của site ⇒ tab
 * ở origin khác KHÔNG phải trang khai, dù route có giống.
 */
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

async function openPage(): Promise<void> {
  const tabId = await activeTabId()
  if (tabId === undefined) {
    await chrome.tabs.create({ url: MANIFEST_URL })
    return
  }
  const tab = await chrome.tabs.get(tabId)

  if (isManifestUrl(tab.url)) {
    // Đã ở đúng trang ⇒ CHỈ đưa tab lên trước. KHÔNG reload.
    //
    // "Open page" là hành động ĐIỀU HƯỚNG, mà điều hướng không được xoá
    // trạng thái trang: reload sẽ xoá sạch những gì operator đã gõ trên form
    // manifest — mà đó đúng là việc operator phải làm TAY sau khi extension
    // tạo nháp. Nút này cũng là thứ operator bấm giữa lúc đang điền.
    //
    // Reload trước đây có mục đích khác: lấy content script MỚI sau khi
    // extension được reload. Trường hợp đó đã có đường thoát riêng: lần chạy
    // báo "Could not reach the page … reload it …" ⇒ operator reload trang
    // khai báo rồi thử lại.
    await chrome.tabs.update(tabId, { url: MANIFEST_URL, active: true })
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
 * draft on site" chỉ bật khi opt-in đã LƯU, và content script tự kiểm tra
 * lại setting ĐÃ LƯU trước khi ghi.
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
      // Đọc LẠI storage thay vì tin `outcome.settings`: giá trị đó là kết quả
      // của PATCH, không phải kết quả của một lần đọc ⇒ nó không biết ai
      // ghi sau mình. Đọc lại là cách duy nhất chắc chắn "ai ghi cuối cùng thì
      // thắng" — kể cả khi có thay đổi tới trong lúc đang lưu.
      await refreshFromStorage()
      return
    }
    // Lưu thất bại ⇒ báo lỗi NGAY, rồi ĐỌC LẠI storage.
    //
    // Sự kiện storage đến LÚC đang lưu đã bị `if (saving.value) return` bỏ qua
    // ⇒ không có đường nào bù lại nếu không đọc lại ở đây.
    //
    // Báo lỗi TRƯỚC khi đọc lại: lần đọc có thể treo ⇒ nếu chờ nó xong mới
    // báo thì operator thấy một checkbox bị khoá mà KHÔNG thấy lỗi nào, và
    // `saving` kẹt vĩnh viễn ⇒ lần lưu hỏng không bao giờ được báo.
    settingsError.value = outcome.error
    const read = await refreshFromStorage()
    // Đưa checkbox về giá trị ĐÃ XÁC NHẬN (sau lần đọc lại ⇒ đúng với
    // storage) và BÁO cho người dùng. Không được im lặng mất setting.
    //
    // Lần đọc lại XOÁ `settingsError` khi thành công ⇒ phải báo lại lỗi lưu
    // sau khi đọc xong. Lần đọc HỎNG thì phải báo CẢ HAI lỗi: mỗi lỗi là
    // một nguyên nhân khác nhau, và lỗi này không được giấu lỗi kia.
    createOnSite.value = savedCreateOnSite.value
    settingsError.value = read.ok ? outcome.error : `${outcome.error} ${read.error}`
  } finally {
    saving.value = false
  }
}

/**
 * Số thứ tự của lần đọc setting đang bay.
 *
 * `chrome.storage.sync.get` trả về một ẢNH CHỤP, và ảnh chụp có thể tới
 * SAU một sự kiện `onChanged` đã báo giá trị mới hơn. Số thứ tự tăng dần
 * ⇒ chỉ lần đọc MỚI NHẤT được ghi vào state ⇒ ảnh chụp cũ KHÔNG BAO GIỜ
 * ghi đè giá trị mới.
 */
let refreshSeq = 0

/**
 * Kết quả của một lần đọc lại — lần đọc có XÁC NHẬN được trạng thái hay không.
 *
 * Người gọi cần biết để không báo "một lỗi" khi thực ra có HAI lỗi (lưu hỏng
 * + đọc hỏng): mỗi lỗi là một nguyên nhân khác nhau mà operator phải thấy.
 */
interface RefreshOutcome {
  /** lần đọc có xác nhận được trạng thái trong storage hay không */
  ok: boolean
  /** lỗi của lần đọc (rỗng khi đọc thành công) */
  error: string
}

/**
 * Đọc lại setting từ storage và đồng bộ MỌI state của popup theo sự thật đó.
 *
 * Popup phải HƯỚNG VỀ storage thay vì giữ một bản sao riêng: lần đọc đầu
 * có thể đến muộn hơn một thay đổi đã xảy ra, và một thay đổi đến giữa lúc
 * đang lưu sẽ bị bỏ qua. Đọc lại sau mỗi lần lưu là cách duy nhất chắc chắn
 * ai ghi cuối cùng thì thắng.
 *
 * TRẢ VỀ để người gọi biết state đang hiển thị là đã xác nhận hay chưa.
 */
async function refreshFromStorage(): Promise<RefreshOutcome> {
  const seq = ++refreshSeq
  const outcome = await readSettingsResult()
  // Một lần đọc MỚI HƠN đã bắt đầu ⇒ kết quả của lần này đã cũ ⇒ bỏ qua,
  // không được ghi đè giá trị mới hơn. Lần đọc cũ không xác nhận gì ⇒ coi
  // như không có lỗi, và KHÔNG đụng `settingsError` (lần đọc mới hơn mới
  // là người quyết định trạng thái hiển thị).
  if (seq !== refreshSeq) return { ok: true, error: '' }
  if (!outcome.ok) {
    // Đọc hỏng ⇒ KHÔNG được coi là "setting = false".
    //
    // Nếu coi như vậy thì opt-in đã lưu (đúng `true` trong storage) bị bỏ
    // qua trong im lặng. Lần đọc hỏng KHÔNG đụng `settingsLoaded` ⇒ control
    // chỉ ẩn ở lần ĐẦU (chưa biết setting là gì thì không được hiện ra một
    // checkbox "tắt" bịa đặt, và nút create cũng phải tắt); lần đọc hỏng sau
    // đó thì control VẪN hiện, mang giá trị ĐÃ XÁC NHẬN lần trước. Giữ
    // nguyên giá trị đó + báo lỗi ⇒ operator thấy đúng việc ta chưa xác
    // nhận được trạng thái mới, chứ không phải trạng thái vừa đọc được.
    settingsError.value = outcome.error
    return { ok: false, error: outcome.error }
  }
  createOnSite.value = outcome.settings.createOnSite
  savedCreateOnSite.value = outcome.settings.createOnSite
  settingsLoaded.value = true
  settingsError.value = ''
  return { ok: true, error: '' }
}

/** Huỷ đăng ký `storage.onChanged` — phải gọi khi unmount. */
let unsubscribe: (() => void) | undefined

onMounted(async () => {
  // Mọi sự kiện storage ⇒ ĐỌC LẠI, không dùng giá trị mà sự kiện mang.
  //
  // Giá trị của sự kiện được tính từ CHỈ những key đổi ⇒ nó không biết
  // fallback của key legacy (`autoSubmit`) mà một lần đọc đầy đủ biết ⇒
  // dùng nó có thể khiến popup lệch với content script. Đọc lại thì
  // không bao giờ lệch.
  unsubscribe = subscribeSettingsChanges(() => {
    // Đang lưu ⇒ bỏ qua sự kiện này.
    //
    // Lần lưu của popup sắp ghi giá trị mới; một sự kiện của nơi khác đến
    // giữa lúc "đọc xong" và "ghi xong" sẽ làm lần đọc này khôi phục giá
    // trị CŨ ⇒ checkbox bị tự bỏ tick. Bỏ qua KHÔNG mất thông tin: sau khi
    // ghi xong có `await refreshFromStorage()` đọc lại lần cuối, và mọi sự
    // kiện đến sau đó đều không bị bỏ qua.
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
    <p v-if="runError" class="error">{{ runError }}</p>
    <p v-else-if="result && !result.ok && result.message" class="error run-message">
      {{ result.message }}
    </p>

    <!--
      Kết quả đang hiện là của lần chạy TRƯỚC — phải nói rõ, nếu không
      operator tưởng đó là kết quả của số bill vừa gõ. Đặt NGAY TRÊN các
      khối kết quả bên dưới (`.blocked`, `.blocking`, `.bill-status`,
      `.summary`) để nó đọc như một lời cảnh báo cho cả phần bên dưới.
    -->
    <p v-if="resultStale" class="hint stale-result">
      {{ staleMessage }}
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
      <!--
        Danh sách manifest trên site là SPA ⇒ bill vừa tạo qua API KHÔNG có
        trong danh sách cho tới khi trang được tải lại. Nút "Open page" không
        reload nữa (reload sẽ xoá trạng thái form) ⇒ phải nói rõ điều đó.
      -->
      <p v-if="result.written" class="bill-line">
        Refresh the manifest list on the site to see the new draft.
      </p>
      <p v-if="result.billNo" class="bill-line">Bill number: {{ result.billNo }}</p>
      <p v-if="result.written" class="double-write">
        A draft was created on the site for this bill of lading number. Do not create another
        manifest for this bill number.
      </p>
    </div>

    <div v-if="result" class="summary">
      cargo: {{ cargoRowCount }} · containers: {{ containerRowCount }} · blank fields: {{
        counts.required
      }}
      required, {{ counts.optional }} optional
    </div>
  </div>
</template>
