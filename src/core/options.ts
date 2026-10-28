import { DEFAULT_API_BASE } from './api'
import { DEFAULT_SITE_API_BASE } from './site-api'

export interface ExtensionSettings {
  /** endpoint lấy dữ liệu manifest từ dadaex */
  apiBase: string
  /** base path của API dict của chính site */
  siteApiBase: string
  /** có tự bấm 确定 ở form đầu sau khi điền xong hay không */
  autoSubmit: boolean
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBase: DEFAULT_API_BASE,
  siteApiBase: DEFAULT_SITE_API_BASE,
  autoSubmit: false,
}

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
  }
}

export async function readSettings(): Promise<ExtensionSettings> {
  if (!hasChromeStorage()) return { ...DEFAULT_SETTINGS }
  try {
    const stored = (await chrome.storage.sync.get(DEFAULT_SETTINGS)) as Partial<ExtensionSettings>
    return withDefaults(stored)
  } catch (e) {
    // Storage bị chặn (policy) hoặc lỗi quota ⇒ dùng mặc định thay vì làm
    // hỏng cả lần điền dữ liệu. Vẫn cảnh báo ra console: không có dấu vết thì
    // không ai hiểu vì sao extension lại dùng base API mặc định.
    console.warn('[manifest-autofill] could not read settings, using defaults', e)
    return { ...DEFAULT_SETTINGS }
  }
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
  const next = withDefaults({ ...(await readSettings()), ...patch })
  if (hasChromeStorage()) await chrome.storage.sync.set(next)
  return next
}
