// @vitest-environment node
// `manifest.config.ts` import `defineManifest` từ `@crxjs/vite-plugin` ⇒ kéo theo
// `vite` ⇒ `esbuild`. esbuild kiểm tra invariant ngay lúc nạp module
// (`new TextEncoder().encode('') instanceof Uint8Array`); dưới jsdom, `Uint8Array`
// thuộc realm của jsdom còn `TextEncoder` thuộc realm của Node ⇒ invariant sai
// ⇒ esbuild ném lỗi khi import. Environment `node` tránh được chuyện đó.
import { describe, it, expect } from 'vitest'
import manifest from '../manifest.config'

describe('manifest của extension', () => {
  it('KHÔNG khai báo background service worker', () => {
    // Lý do: bản production vì vậy KHÔNG sinh `service-worker-loader.js` ⇒
    // Chrome không phải đăng ký service worker nào. Nếu có, loader sẽ import
    // cross-origin (`http://localhost:<port>/@crx/client-worker`) mà MV3 bắt
    // buộc service worker cùng origin với extension ⇒ Chrome từ chối
    // ("Service worker registration failed. Status code: 3").
    expect(manifest).not.toHaveProperty('background')
  })

  it('vẫn khai báo content script cho site 预配舱单', () => {
    expect(manifest).toHaveProperty(
      'content_scripts.0.matches',
      expect.arrayContaining(['https://www.chinaports-agency.com:8870/*']),
    )
  })
})
