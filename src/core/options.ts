import { DEFAULT_API_BASE } from './api'
import { DEFAULT_SITE_API_BASE } from './site-api'

export interface ExtensionSettings {
  /** endpoint lấy dữ liệu manifest từ dadaex */
  apiBase: string
  /** base path của API dict của chính site */
  siteApiBase: string
  /** có tạo manifest TRÊN SITE hay không (mặc định: KHÔNG) */
  createOnSite: boolean
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBase: DEFAULT_API_BASE,
  siteApiBase: DEFAULT_SITE_API_BASE,
  createOnSite: false,
}

/**
 * Key CŨ của setting — thời DOM: "sau khi điền form thì tự bấm 确定".
 *
 * Setting đã được đổi tên thành `createOnSite` (tạo manifest TRÊN SITE), nhưng
 * người dùng đời cũ đã bật opt-in thì KHÔNG được mất lựa chọn đó trong im lặng
 * ⇒ khi đọc, key legacy này được dùng làm fallback.
 */
const LEGACY_AUTO_SUBMIT_KEY = 'autoSubmit'

/** Object thô của storage: đúng những key người dùng đã lưu. */
type RawStoredSettings = Record<string, unknown>

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.sync
}

/**
 * Base rỗng ⇒ coi như chưa cấu hình ⇒ dùng mặc định.
 *
 * Không có bước này thì `apiBase: ''` sẽ tạo URL tương đối (`?blNo=…`) và
 * lỗi thành "HTTP error" khó hiểu.
 */
function withDefaults(stored: Partial<ExtensionSettings>): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    apiBase: stored.apiBase?.trim() || DEFAULT_SETTINGS.apiBase,
    siteApiBase: stored.siteApiBase?.trim() || DEFAULT_SETTINGS.siteApiBase,
    // `createOnSite` phải là boolean THẬT: storage có thể bị sửa tay, và UI
    // rollback về giá trị đã lưu ⇒ giá trị đó phải đúng kiểu.
    createOnSite: stored.createOnSite === true,
  }
}

/**
 * Tính giá trị của `createOnSite` từ object THÔ của storage.
 *
 * Quy tắc, theo thứ tự:
 * - Có key `createOnSite` ⇒ người dùng ĐÃ chọn trong UI mới ⇒ thắng, kể cả khi
 *   giá trị là `false`. Lựa chọn tường minh KHÔNG được bất kỳ key nào khác
 *   lật ngược — kể cả key legacy.
 * - Chỉ khi `createOnSite` VẮNG MẶT thì key legacy `autoSubmit === true` mới
 *   bật nó lên (opt-in cũ không được mất trong im lặng).
 *
 * Ép kiểu nghiêm: chỉ boolean `true` mới là `true` (storage có thể bị sửa tay).
 *
 * `undefined` = "chưa có lựa chọn nào" ⇒ `withDefaults` dùng mặc định.
 */
function resolveCreateOnSite(raw: RawStoredSettings): boolean | undefined {
  // Có key `createOnSite` ⇒ người dùng ĐÃ chọn trong UI mới ⇒ thắng, kể cả khi
  // giá trị là `false`.
  if ('createOnSite' in raw) return raw.createOnSite === true
  // Chỉ khi `createOnSite` VẮNG MẶT thì key legacy `autoSubmit === true` mới
  // bật nó lên (opt-in cũ không được mất trong im lặng).
  if (raw[LEGACY_AUTO_SUBMIT_KEY] === true) return true
  return undefined
}

/**
 * Lấy phần setting ĐÃ LƯU ra khỏi object thô của storage.
 *
 * Chỉ nhận key có đúng kiểu: storage có thể bị sửa tay ⇒ `apiBase` không phải
 * chuỗi thì bỏ qua (để `withDefaults` dùng mặc định), thay vì để `.trim()`
 * ném lỗi.
 */
function toStoredSettings(raw: RawStoredSettings): Partial<ExtensionSettings> {
  const stored: Partial<ExtensionSettings> = {}
  if (typeof raw.apiBase === 'string') stored.apiBase = raw.apiBase
  if (typeof raw.siteApiBase === 'string') stored.siteApiBase = raw.siteApiBase
  const createOnSite = resolveCreateOnSite(raw)
  if (createOnSite !== undefined) stored.createOnSite = createOnSite
  return stored
}

/**
 * Kết quả đọc setting — KHÔNG ném lỗi, và nói rõ đọc CÓ thành công hay không.
 *
 * Phân biệt "chưa lưu gì" với "đọc hỏng" là điều kiện tiên quyết: `false` là
 * một giá trị HỢP LỆ của `createOnSite`, nên nếu lần đọc hỏng bị đóng băng thành
 * `false` thì opt-in đã lưu sẽ bị ghi đè trong im lặng.
 */
export type ReadSettingsResult =
  | { ok: true; settings: ExtensionSettings }
  | { ok: false; error: string }

/**
 * Đọc setting và BÁO CÁO thất bại thay vì nuốt.
 *
 * Đây là biến thể "nói thật" của `readSettings`: tầng UI cần biết mình đã
 * thực sự đọc được gì để không đưa ra một giá trị bịa ra.
 */
export async function readSettingsResult(): Promise<ReadSettingsResult> {
  if (!hasChromeStorage()) return { ok: true, settings: { ...DEFAULT_SETTINGS } }
  try {
    // `get(null)` ⇒ CHỈ key người dùng thật sự đã lưu ⇒ phân biệt được
    // "chưa có lựa chọn nào" với "đã chọn `false`" (và thấy được key legacy).
    const raw = (await chrome.storage.sync.get(null)) as RawStoredSettings
    return { ok: true, settings: withDefaults(toStoredSettings(raw)) }
  } catch (e) {
    // Storage bị chặn (policy) hoặc lỗi quota. Vẫn cảnh báo ra console: không
    // có dấu vết thì không ai hiểu vì sao extension lại không đọc được setting.
    console.warn('[manifest-autofill] could not read settings', e)
    return { ok: false, error: 'Could not read the settings.' }
  }
}

/**
 * Đọc setting, lỗi thì dùng mặc định — KHÔNG ném.
 *
 * Content script dùng hàm này: lỗi ở đó chỉ được báo qua giá trị mặc định,
 * vì hỏng cả lần điền dữ liệu còn tệ hơn việc điền bằng base API mặc định.
 * Tầng UI dùng `readSettingsResult` để phân biệt được hai trường hợp.
 */
export async function readSettings(): Promise<ExtensionSettings> {
  const outcome = await readSettingsResult()
  return outcome.ok ? outcome.settings : { ...DEFAULT_SETTINGS }
}

/**
 * Chuẩn hoá patch trước khi ghi.
 *
 * Quy tắc ép kiểu CHỈ nằm trong `withDefaults` — hàm này chỉ chọn ra những
 * key có thật trong patch (để không đụng key khác) rồi lấy giá trị đã chuẩn
 * hoá của chúng.
 *
 * Danh sách key lấy từ `DEFAULT_SETTINGS` ⇒ exhaustive BẰNG CẤU TRÚC: thêm
 * setting mới vào interface thì không thể quên thêm vào đây. Nếu liệt kê tay,
 * một setting mới sẽ bị BỎ QUA khi ghi — không lỗi, `saveSettings` vẫn báo
 * thành công ⇒ mất setting trong im lặng.
 */
function normalizePatch(patch: Partial<ExtensionSettings>): Partial<ExtensionSettings> {
  const normalized = withDefaults(patch)
  const out: Partial<ExtensionSettings> = {}
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ExtensionSettings)[]) {
    if (patch[key] === undefined) continue
    assign(out, key, normalized[key])
  }
  return out
}

/**
 * Gán một key của `ExtensionSettings` mà vẫn giữ đúng kiểu của chính key đó.
 *
 * Cần hàm riêng vì `out[key] = value` với `key` là union thì TypeScript không
 * đòi kiểm tra kiểu chéo giữa các key — `ExtensionSettings[K]` là đủ.
 */
function assign<K extends keyof ExtensionSettings>(
  out: Partial<ExtensionSettings>,
  key: K,
  value: ExtensionSettings[K],
): void {
  out[key] = value
}

/**
 * Lưu setting mới.
 *
 * Lỗi của `chrome.storage.sync.set` CỐ TÌNH ném ra (không nuốt như
 * `readSettings`): đây là hành động người dùng chủ động làm, mất thì phải báo
 * — còn `readSettings` nằm trên đường điền dữ liệu nên lỗi ở đó chỉ được báo
 * qua giá trị mặc định.
 */
export async function writeSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  if (!hasChromeStorage()) {
    // Không có storage ⇒ KHÔNG ghi được gì ⇒ phải báo thất bại.
    //
    // Báo "thành công" ở đây là mất setting trong im lặng: tầng UI sẽ hiện
    // "Saved." dù không có byte nào được ghi đi.
    throw new Error('chrome.storage.sync is not available')
  }
  const next = withDefaults({ ...(await readSettings()), ...patch })
  // CHỈ ghi những key có trong patch.
  //
  // Nếu ghi toàn bộ settings, một lần đọc lỗi (storage bị chặn / quota)
  // khiến `next` mang giá trị MẶC ĐỊNH cho apiBase/siteApiBase ⇒ ghi đè
  // luôn base API tuỳ chỉnh của người dùng. Ghi patch ⇒ không đụng tới
  // key nào khác.
  await chrome.storage.sync.set(normalizePatch(patch))
  return next
}

/**
 * Kết quả lưu setting — KHÔNG ném lỗi.
 *
 * `writeSettings` cố tình ném (xem JSDoc của nó): mất setting do người dùng
 * chủ động thì phải báo. Tầng UI cần một biến thể trả về kết quả để tự
 * quyết định hiển thị và có rollback hay không.
 */
export type SaveSettingsResult =
  | { ok: true; settings: ExtensionSettings }
  | { ok: false; error: string }

/**
 * Lưu setting mà KHÔNG ném lỗi — cho tầng UI.
 *
 * Chi tiết kỹ thuật nằm ở console; người dùng chỉ thấy câu tiếng Anh.
 */
export async function saveSettings(
  patch: Partial<ExtensionSettings>,
): Promise<SaveSettingsResult> {
  try {
    return { ok: true, settings: await writeSettings(patch) }
  } catch (e) {
    console.error('[manifest-autofill] could not save settings', e)
    return { ok: false, error: 'Could not save the settings. Please try again.' }
  }
}

/** Thay đổi của setting từ nơi khác (ví dụ popup ghi `createOnSite`). */
export interface SettingsChange {
  apiBase?: string
  siteApiBase?: string
  createOnSite?: boolean
}

/**
 * Nghe `chrome.storage.onChanged` (area `sync`) và báo giá trị HIỆU LỰC.
 *
 * Tầng UI KHÔNG được tự đụng `chrome.storage` ⇒ việc đăng ký listener nằm ở
 * đây. Giá trị báo ra đã qua `withDefaults` nên khớp với một lần đọc: base
 * rỗng ⇒ mặc định, `createOnSite` không phải boolean ⇒ false.
 *
 * Trả về hàm HUỶ đăng ký — component phải gọi nó khi unmount, nếu không
 * listener sẽ giữ closure của component đã rời khỏi DOM.
 */
export function subscribeSettingsChanges(
  onChange: (changes: SettingsChange) => void,
): () => void {
  if (!hasChromeStorage()) return () => {}
  const onChanged = chrome.storage.onChanged
  // Test stub có thể chỉ có `get`/`set` ⇒ không có API event thì bỏ qua.
  if (typeof onChanged?.addListener !== 'function') return () => {}

  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ): void => {
    // Chỉ `sync` mới là storage mà extension dùng.
    if (areaName !== 'sync') return

    const stored: Partial<ExtensionSettings> = {}
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ExtensionSettings)[]) {
      if (!(key in changes)) continue
      const raw = changes[key]?.newValue
      // Giá trị thiếu (key bị xoá) hoặc sai kiểu ⇒ để `withDefaults` quyết
      // định: base rỗng ⇒ mặc định, `createOnSite` không phải boolean ⇒ false.
      if (typeof raw === 'string' || typeof raw === 'boolean') {
        assign(stored, key, raw as ExtensionSettings[typeof key])
      }
    }
    const effective = withDefaults(stored)

    const updated: SettingsChange = {}
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ExtensionSettings)[]) {
      if (!(key in changes)) continue
      assign(updated, key, effective[key])
    }
    if (Object.keys(updated).length === 0) return
    onChange(updated)
  }

  onChanged.addListener(listener)
  return () => {
    onChanged.removeListener?.(listener)
  }
}
