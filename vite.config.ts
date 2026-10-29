import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig(({ command }) => ({
  // `liveReload: false` ⇒ service worker của crxjs không bao giờ gọi
  // `chrome.runtime.reload()` ⇒ Chrome không báo "This extension reloaded
  // itself too frequently". File vẫn được build lại khi có thay đổi.
  plugins: [vue(), crx({ manifest, liveReload: false })],
  build: { outDir: command === 'serve' ? '.crx/dev' : 'dist' },
  server: {
    port: 5173,
    strictPort: true,
    cors: {
      origin: [
        /^chrome-extension:\/\//,
      ],
    },
  },
}))
