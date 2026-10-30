import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Manifest Autofill',
  description: 'Autofill (manifest) data on China Ports from the dadaex API.',
  version: pkg.version.split('-')[0] ?? '0.0.0',
  version_name: pkg.version,
  icons: {
    48: 'logo.png',
  },
  action: {
    default_icon: {
      48: 'logo.png',
    },
    default_popup: 'src/popup/index.html',
  },
  options_page: 'src/options/index.html',
  // KHÔNG khai báo `background.service_worker` — extension không có tác vụ
  // chạy nền (popup gửi `MSG_CREATE_MANIFEST` thẳng cho content script, cả hai
  // đều đọc `chrome.storage.sync` trực tiếp).
  //
  // Quan trọng: bản production vì vậy KHÔNG sinh `service-worker-loader.js`
  // ⇒ Chrome không phải đăng ký service worker nào.
  // Xem spec §13 và comment trong `vite.config.ts`.
  content_scripts: [
    {
      matches: ['https://www.chinaports-agency.com:8870/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  host_permissions: [
    'https://www.chinaports-agency.com:8870/*',
    'https://www.dadaex.cn/*',
  ],
  permissions: ['storage', 'activeTab'],
})
