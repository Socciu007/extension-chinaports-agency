import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig(({ command }) => ({
  plugins: [vue(), crx({ manifest })],
  // `npm run dev` (chế độ serve của crxjs) ghi manifest + service-worker-loader
  // vào `build.outDir` — tức là CÙNG thư mục với production build. Nếu để
  // chung, dev server sẽ ghi đè bản build production, và loader sinh ra sẽ là:
  //
  //     import 'http://localhost:<port>/src/background/index.ts';
  //
  // Service worker của MV3 bắt buộc cùng origin với extension ⇒ Chrome chặn
  // import cross-origin này ⇒ "Service worker registration failed. Status
  // code: 3" (hoặc lỗi CORS khi chạy dev server).
  //
  // Tách thư mục cho hai chế độ dùng song song:
  //   `dist/`      = production build (`npm run build`) — load unpacked để test
  //                  thật trên site, không cần dev server.
  //   `.crx/dev/`  = dev server (`npm run dev`) — cần companion extension
  //                  "CRXJS" cài trong Chrome để HMR hoạt động.
  build: { outDir: command === 'serve' ? '.crx/dev' : 'dist' },
  server: { port: 5174, strictPort: true },
}))
