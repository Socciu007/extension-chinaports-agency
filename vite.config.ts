import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig(({ command }) => ({
  plugins: [vue(), crx({ manifest })],
  // `npm run dev` (chế độ serve của crxjs) ghi manifest + asset vào
  // `build.outDir`. Nếu `outDir` của dev trùng với production, dev server sẽ
  // ghi đè bản build production.
  //
  // Tách thư mục cho hai chế độ dùng song song:
  //   `dist/`      = production build (`npm run build`) — load unpacked để test
  //                  thật trên site. ĐÂY là bản dùng để chạy trong Chrome.
  //   `.crx/dev/`  = dev server (`npm run dev`).
  //
  // LƯU Ý: bản dev KHÔNG load được trong Chrome. Ở chế độ serve, crxjs LUÔN tự
  // thêm `background.service_worker` trỏ tới `service-worker-loader.js` — loader
  // đó import cross-origin (`http://localhost:<port>/@vite/env` và
  // `http://localhost:<port>/@crx/client-worker`), mà MV3 bắt buộc service
  // worker cùng origin với extension ⇒ Chrome từ chối đăng ký ⇒ "Service
  // worker registration failed. Status code: 3". Đây là hạn chế của crxjs
  // beta.23, không phải của manifest của ta.
  //
  // ⇒ Muốn test thật trên site: luôn `npm run build` rồi Load unpacked `dist/`.
  build: { outDir: command === 'serve' ? '.crx/dev' : 'dist' },
  server: { port: 5173, strictPort: true },
}))
