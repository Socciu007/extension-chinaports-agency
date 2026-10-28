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

export async function readSettings(): Promise<ExtensionSettings> {
  if (!hasChromeStorage()) return { ...DEFAULT_SETTINGS }
  const stored = (await chrome.storage.sync.get(DEFAULT_SETTINGS)) as Partial<ExtensionSettings>
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function writeSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const next = { ...(await readSettings()), ...patch }
  if (hasChromeStorage()) await chrome.storage.sync.set(next)
  return next
}
