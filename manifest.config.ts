import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Manifest Autofill — 预配舱单',
  description:
    'Autofill 预配舱单 (manifest) data on China Ports from the dadaex API.',
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
  background: {
    service_worker: 'src/background/index.ts',
  },
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
