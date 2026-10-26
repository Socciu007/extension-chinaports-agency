# Manifest Autofill Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that takes a bill-of-lading number, fetches manifest data from `dadaex.cn`, and fills the 预配舱单 (manifest) form on `chinaports-agency.com:8870` — header form, cargo lines and container lines.

**Architecture:** A Vue 3 popup sends a `manifest-autofill:fill` message to a content script running inside the China Ports SPA. The content script fetches the manifest JSON from `dadaex.cn`, converts it into a declarative list of field plans via a pure mapping module, then drives the page's Element Plus form (native value setter for text, click-to-pick for dropdowns) and reports a per-field result back to the popup. All logic that can be pure lives in `src/core/*` and is unit-tested with Vitest + jsdom.

**Tech Stack:** TypeScript 5.9 (type-check bằng `vue-tsc` 2.2) · Vite 5.4 · `@crxjs/vite-plugin` 2.0.0-beta.23 · Vue 3.5 · Vitest 2 + jsdom 25

> Số phiên bản trên là bản đang resolve trong `package-lock.json` (2026-10-26). `package.json` khai báo range `^` nên các bản patch/minor mới có thể vào bất cứ lúc nào — luôn đọc `package-lock.json` khi cần biết phiên bản chính xác.

**Spec:** `docs/superpowers/specs/2026-10-26-manifest-autofill-extension-design.md`

---

## Bối cảnh bắt buộc cho mọi engineer

Đọc trước khi code. Những dữ kiện dưới đây đã được **kiểm chứng** bằng cách đọc bundle của trang đích — không cần đoán, không cần hỏi lại.

### Trang đích

- URL: `https://www.chinaports-agency.com:8870/#/exportBusinessOperations/maintenanceOfManifestData`
- Tên: 预配舱单申报平台 — là trang **danh sách** có 2 tab (待发送 / 已发送).
- Stack: Vue 3 + Element Plus + fast-crud (`fs-crud`).
- Nút **新增舱单信息** mở một dialog chứa 3 phần: form đầu (36 field) → bảng **货物信息** (cargo) → bảng **集装箱** (container).
- Element Plus gán `id` cho input theo mẫu `${formId}-${prop}` → selector ổn định: `input[id$="-BILL_NBR"]`.
- Bảng container dùng **inline editable** (`table.editable.enabled = true`) → điền thẳng vào ô bảng, không qua dialog.
- Bảng cargo dùng **dialog** 24 field. Nút `新增` bên trong section 货物信息 gọi `setTimeout(..., 400)` rồi mới mở form → phải chờ ≥ 400ms.
- Section 货物信息 nằm trong div `class="CargoInformation"`, section 集装箱 nằm trong div `class="ContainerInformation"`.
- 5 field cảng + 提单签发地 dùng **component tuần biến** của dự án (không phải `el-select` thuần) → adapter phải nhận diện loại control lúc chạy.
- 5 field cảng có phụ thuộc dây chuyền: `signPlace → startPort → dischrgPort → transPort → destPort` → điền đúng thứ tự.

### API của site (dùng để tra dict, dùng chung session)

Prefix: `/api/booking/exportManifestDataMaintain/`
`GET getTrustCode/` · `GET getDrType/` · `GET getPort/` · `GET getCntrCode/` · `GET getPackageCode/`

Gọi từ content script bằng `fetch(url, { credentials: 'include' })` — browser tự gửi cookie `token`; đồng thời extension đọc cookie `token` để gắn header `Authorization: JWT <token>` (phòng khi server chỉ chấp nhận header).

### API dữ liệu

```
GET https://www.dadaex.cn/api/vn/insight/manifest?blNo={blNo}
→ { "status": 1, "messgae": "success", "data": {...} }
→ { "status": 0, "message": "data_not_found", "data": null }
```

- CORS `Access-Control-Allow-Origin: *` → content script gọi trực tiếp được.
- **`blNo` phải bỏ hậu tố piece.** Đã kiểm chứng: `CHN4139065P1` → `data_not_found`; `CHN4139065` → `status:1`. Hậu tố dạng `P\d+$` bị loại bỏ trước khi gọi.
- `status:1` nhưng `data:null` vẫn là lỗi → phải báo rõ, không coi là thành công.

### Enum vai trò `cabContacts.type` (đã chốt)

| `type` | Vai trò | Field form |
|---|---|---|
| `false` (0) | 发货人 | `E_SHIPPER_NAM`, `SHIPPER_*` |
| `true` (1) | 收货人 | `E_CONSIGNEE_NAM`, `CONSIGNEE_*` |
| `2` | 通知人 | `E_NOTIFY_NAM`, `NOTIFY_*` |

### Quy tắc đã chốt

- `firmCode` là mã đăng ký DN (USCI/TIN), **không phải mã AEO** → trường `*_AEO` để trống.
- Field API không có (EMAIL, FAX, 中转港, 提单签发地, 危险品页号/EMS/MFAG) → để trống, báo ⚠️ kèm lý do.
- Không bao giờ tự gọi `send/` hay `upload/`. Nút **确定** cuối cùng ở form đầu do người dùng bấm (tuỳ chọn tự submit mặc định TẮT).
- **Ngôn ngữ giao diện của extension: tiếng Anh.** Chuỗi hiển thị cho người dùng viết bằng tiếng Anh; thuật ngữ tiếng Trung của site (提单号, 预配舱单, 确定, 舱单, 承运人代码, 交货条款, 上传船代) giữ nguyên vì người dùng phải nhận diện được nhãn trên trang. Comment trong code và văn bản của plan vẫn dùng tiếng Việt.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `package.json` | scripts + deps |
| `tsconfig.json` | cấu hình TS dùng chung |
| `vite.config.ts` | build extension (crxjs) |
| `vitest.config.ts` | test config, env jsdom |
| `manifest.config.ts` | **đã có** — sẽ sửa ở Task 2 |
| `public/logo.png` | icon 48×48 |
| `src/core/types.ts` | kiểu dữ liệu thô từ API |
| `src/core/api.ts` | gọi + bóc envelope của API dadaex |
| `src/core/site-api.ts` | gọi 5 endpoint dict của site + chuẩn hoá option |
| `src/core/mapping.ts` | `data` → `FieldPlan[]` cho header / cargo / container |
| `src/core/dom.ts` | tìm field, đặt giá trị text, đọc lại giá trị |
| `src/core/select.ts` | adapter mở dropdown / popper và click option |
| `src/core/table.ts` | đọc cấu trúc bảng inline editable, đặt giá trị vào ô |
| `src/core/wait.ts` | `sleep`, `nextFrame`, `waitFor` |
| `src/core/fill.ts` | điều phối: mở dialog → điền form → thêm dòng bảng → báo cáo |
| `src/core/protocol.ts` | kiểu message popup ↔ content script |
| `src/core/options.ts` | đọc/ghi `chrome.storage.sync` |
| `src/background/index.ts` | service worker (mở trang manifest khi cài mới) |
| `src/content/index.ts` | bootstrap content script + message handler |
| `src/popup/*` | giao diện popup (Vue 3) |
| `src/options/*` | giao diện tuỳ chọn (Vue 3) |
| `scripts/check-manifest.mjs` | kiểm tra mọi path cục bộ trong `dist/manifest.json` đều tồn tại |
| `scripts/fetch-fixture.mjs` | tải fixture JSON thật từ API để test |
| `scripts/dump-manifest-dom.js` | script dán vào DevTools để chốt DOM thật của site |
| `tests/fixtures/manifest-ONEYSHAGT1569600.json` | fixture do script tạo ra |
| `tests/helpers/dom.ts` | dựng DOM giả cho test jsdom |
| `tests/*.test.ts` | unit test |

---

## Task 1: Scaffold dự án + toolchain

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Tạo `package.json`**

```json
{
  "name": "manifest-autofill",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "vue-tsc --noEmit",
    "check-manifest": "node scripts/check-manifest.mjs",
    "verify": "npm run typecheck && npm test && npm run build && npm run check-manifest"
  },
  "dependencies": {
    "vue": "^3.4.38"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "2.0.0-beta.23",
    "@types/chrome": "^0.0.278",
    "@types/node": "^22.7.4",
    "@vitejs/plugin-vue": "^5.1.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.5.4",
    "vite": "^5.2.0",
    "vitest": "^2.1.1",
    "vue-tsc": "^2.1.10"
  }
}
```

> `typecheck` dùng **`vue-tsc`**, không dùng `tsc`: `tsc` không parse được SFC (`.vue`) nên glob `"src/**/*.vue"` trong `tsconfig.json` là vô nghĩa — `tsc --showConfig` không liệt kê file `.vue` nào. `vue-tsc` thực sự đưa SFC vào program và type-check cả `<script setup lang="ts">`. Vì vậy **không** cần file shim `declare module '*.vue'` (shim sẽ che mất type thật của SFC).

- [ ] **Step 2: Tạo `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["chrome", "node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "jsx": "preserve"
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "tests/**/*.ts", "*.ts"]
}
```

- [ ] **Step 3: Tạo `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [vue(), crx({ manifest })],
  server: { port: 5173, strictPort: true },
})
```

- [ ] **Step 4: Tạo `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Các test điền form dùng `await nextFrame()` + polling → cần thời gian hơn mặc định 5s.
    testTimeout: 20000,
  },
})
```

- [ ] **Step 5: Tạo `.gitignore`**

```
node_modules/
dist/
*.local
.DS_Store
*.crx
*.pem
```

> `*.pem` quan trọng hơn `*.crx`: file PEM là **private key** dùng để ký extension — tuyệt đối không được commit lên git.

- [ ] **Step 6: Tạo `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 7: Cài dependency**

Run: `npm install`
Expected: kết thúc không lỗi, tạo `node_modules/` và `package-lock.json`.

- [ ] **Step 8: Chạy test để xác nhận toolchain**

Run: `npm test`
Expected: `1 passed` (file `tests/smoke.test.ts`).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts .gitignore tests/smoke.test.ts
git commit -m "chore: scaffold extension project with vite, vitest and typescript"
```

---

## Task 2: Manifest extension + entry point giả

**Files:**
- Modify: `manifest.config.ts`
- Create: `public/logo.png`
- Create: `src/background/index.ts`
- Create: `src/content/index.ts`
- Create: `src/popup/index.html`
- Create: `src/popup/main.ts`
- Create: `src/popup/App.vue`
- Create: `src/options/index.html`
- Create: `src/options/main.ts`
- Create: `src/options/App.vue`

- [ ] **Step 1: Ghi đè `manifest.config.ts`**

```ts
import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Manifest Autofill — 预配舱单',
  description:
    'Autofill 预配舱单 (manifest) data on China Ports from the dadaex API.',
  // Chrome chỉ chấp nhận version là 1-4 số nguyên ngăn cách bằng dấu chấm.
  // `npm version prerelease` sinh ra "0.1.0-beta.0" khiến extension fail to load.
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
```

> **Lưu ý về `permissions`:**
>
> - **`cookies` — không cần, và không được thêm lại khi chưa có nhu cầu cụ thể.** Lý do thật (bản plan cũ ghi sai là crxjs "không nhận" `permissions: ['cookies']`; thực ra `defineManifest` nhận thoải mái vì `chrome.runtime.ManifestPermissions` có `'cookies'`): extension đọc cookie `token` bằng `document.cookie` qua helper `readCookieToken` (xem mục `src/core/site-api.ts`), **không** dùng `chrome.cookies.get`; còn `fetch(url, { credentials: 'include' })` trong content script thì browser tự động gửi cookie `token` cùng origin. Permission `cookies` cấp quyền đọc **mọi** cookie của site → không đáng để xin.
> - **`tabs` — không cần.** Popup chỉ đọc `tab?.id` từ `chrome.tabs.query({ active: true, currentWindow: true })`; `chrome.tabs.create` không cần permission; `chrome.tabs.sendMessage` được cho phép bởi `host_permissions` đã khai báo. `tabs` là quyền rộng ("đọc lịch sử duyệt web") và extension không cần.
> - **`scripting` — không cần.** Không task nào trong plan dùng `chrome.scripting`.
> - Giữ `storage` (đọc/ghi `chrome.storage.sync`) và `activeTab`.
>
> **Lưu ý về output của crxjs:** crxjs **tự động** chèn `web_accessible_resources` (với `use_dynamic_url: true`) cho chunk của content script, và đặt `background.type: "module"`. Nếu plan từng phải dùng phương án dự phòng (manifest tĩnh do tay viết trong `public/manifest.json` — xem fallback ở cuối Task 2) thì hai trường này **phải được khai báo tay**, nếu không extension sẽ không load.
>
> **Lưu ý về icon:** khai báo `'logo.png'` (đúng convention public dir của Vite) chứ không phải `'public/logo.png'`. Với `'public/logo.png'`, crxjs giữ nguyên đường dẫn và copy thêm một bản vào `dist/public/logo.png`, khiến icon bị emit 2 lần. `npm run check-manifest` sẽ bắt được trường hợp manifest trỏ tới file không tồn tại.

- [ ] **Step 2: Tạo `public/logo.png`**

Chạy 1 lần lệnh sau để tạo icon 48×48 PNG hợp lệ (không dùng text editor):

```bash
node -e "const z=require('zlib'),f=require('fs');const W=48,H=48;const raw=Buffer.alloc((W*3+1)*H);for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;for(let x=0;x<W;x++){const o=y*(W*3+1)+1+x*3;raw[o]=0x1f;raw[o+1]=0x4e;raw[o+2]=0x7a;}}const crcT=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});const crc=b=>{let c=0xffffffff;for(const x of b)c=crcT[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0};const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',z.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);f.writeFileSync('public/logo.png',png);console.log('logo.png',png.length,'bytes')"
```

Expected: in ra `logo.png <n> bytes` với `n` > 0.

- [ ] **Step 3: Tạo `src/background/index.ts`**

```ts
const MANIFEST_URL =
  'https://www.chinaports-agency.com:8870/#/exportBusinessOperations/maintenanceOfManifestData'

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs
      .create({ url: MANIFEST_URL })
      .catch(() => {
        // Người dùng có thể đã đóng cửa sổ — bỏ qua lỗi.
      })
  }
})
```

- [ ] **Step 4: Tạo `src/content/index.ts` (stub tạm)**

```ts
// Task 13 sẽ thay nội dung file này.
console.debug('[manifest-autofill] content script loaded')
```

- [ ] **Step 5: Tạo `src/popup/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Manifest Autofill</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Tạo `src/popup/main.ts`**

```ts
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

- [ ] **Step 7: Tạo `src/popup/App.vue`**

```vue
<script setup lang="ts">
// Task 14 sẽ thay nội dung file này.
</script>

<template>
  <div class="popup">Manifest Autofill</div>
</template>

<style scoped>
.popup {
  width: 320px;
  padding: 12px;
  font: 13px/1.5 system-ui, sans-serif;
}
</style>
```

- [ ] **Step 8: Tạo `src/options/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Manifest Autofill — Options</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 9: Tạo `src/options/main.ts`**

```ts
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

- [ ] **Step 10: Tạo `src/options/App.vue`**

```vue
<script setup lang="ts">
// Task 15 sẽ thay nội dung file này.
</script>

<template>
  <div class="options">Manifest Autofill — Options</div>
</template>

<style scoped>
.options {
  padding: 24px;
  font: 14px/1.6 system-ui, sans-serif;
}
</style>
```

- [ ] **Step 11: Build để xác nhận crxjs hoạt động**

Run: `npm run build`
Expected: build thành công, `dist/` có `manifest.json`, `dist/assets/…`.

- [ ] **Step 12: Kiểm tra manifest đã sinh đúng**

Run: `node -e "const m=require('./dist/manifest.json');console.log(m.manifest_version,m.content_scripts.length,m.host_permissions)"`
Expected: in ra `3 1 [ 'https://www.chinaports-agency.com:8870/*', 'https://www.dadaex.cn/*' ]`.

- [ ] **Step 13: Tạo `scripts/check-manifest.mjs`** (sanity check: mọi path cục bộ trong manifest phải tồn tại trong `dist/`)

Chrome từ chối nạp extension nếu manifest trỏ tới file không tồn tại (ví dụ `Could not load icon 'public/logo.png' specified in 'action'.`), mà `vite build` **không** bắt được lỗi này. Script dưới đây đọc `dist/manifest.json`, gom mọi path cục bộ mà manifest tham chiếu (`icons.*`, `action.default_icon.*`, `action.default_popup`, `options_page`, `background.service_worker`, `content_scripts[].js[]`) và kiểm tra từng file có tồn tại trong `dist/` hay không.

```js
#!/usr/bin/env node
// Kiểm tra rằng mọi đường dẫn cục bộ mà `dist/manifest.json` tham chiếu tới đều tồn tại.
//
// Chrome từ chối nạp extension nếu manifest trỏ tới file không tồn tại
// (ví dụ "Could not load icon 'public/logo.png' specified in 'action'."),
// nhưng `vite build` không bắt được lỗi này — nên cần script này.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const manifestPath = join(distDir, 'manifest.json')

if (!existsSync(manifestPath)) {
  console.error('✗ Không tìm thấy dist/manifest.json — hãy chạy `npm run build` trước.')
  process.exit(1)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  console.error(`✗ Không đọc được dist/manifest.json: ${error.message}`)
  process.exit(1)
}

/** Gom mọi đường dẫn cục bộ mà manifest tham chiếu tới. */
function collectPaths(manifest) {
  const paths = []
  const icons = manifest.icons ?? {}
  for (const size of Object.keys(icons)) {
    paths.push({ label: `icons.${size}`, value: icons[size] })
  }
  const defaultIcon = manifest.action?.default_icon ?? {}
  for (const size of Object.keys(defaultIcon)) {
    paths.push({ label: `action.default_icon.${size}`, value: defaultIcon[size] })
  }
  if (manifest.action?.default_popup) {
    paths.push({ label: 'action.default_popup', value: manifest.action.default_popup })
  }
  if (manifest.options_page) {
    paths.push({ label: 'options_page', value: manifest.options_page })
  }
  if (manifest.options_ui?.page) {
    paths.push({ label: 'options_ui.page', value: manifest.options_ui.page })
  }
  if (manifest.background?.service_worker) {
    paths.push({
      label: 'background.service_worker',
      value: manifest.background.service_worker,
    })
  }
  const contentScripts = manifest.content_scripts ?? []
  for (const [i, script] of contentScripts.entries()) {
    for (const [j, js] of (script.js ?? []).entries()) {
      paths.push({ label: `content_scripts[${i}].js[${j}]`, value: js })
    }
    for (const [j, css] of (script.css ?? []).entries()) {
      paths.push({ label: `content_scripts[${i}].css[${j}]`, value: css })
    }
  }
  return paths
}

const referenced = collectPaths(manifest)
const missing = []

for (const { label, value } of referenced) {
  if (typeof value !== 'string' || value.length === 0) {
    missing.push(`${label} — giá trị không hợp lệ: ${JSON.stringify(value)}`)
    continue
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    // URL ngoài (http:, https:, data:) — không phải file cục bộ.
    continue
  }
  const target = join(distDir, value)
  if (!existsSync(target)) {
    missing.push(`${label} -> ${value} (thiếu file: ${target})`)
  }
}

if (missing.length > 0) {
  console.error(`✗ Manifest trỏ tới ${missing.length} file không tồn tại trong dist/:`)
  for (const entry of missing) {
    console.error(`  - ${entry}`)
  }
  process.exit(1)
}

console.log(`✓ Manifest hợp lệ — ${referenced.length} đường dẫn cục bộ đều tồn tại trong dist/:`)
for (const { label, value } of referenced) {
  console.log(`  - ${label} -> ${value}`)
}
```

Run: `npm run check-manifest`
Expected: in ra `✓ Manifest hợp lệ — 6 đường dẫn cục bộ đều tồn tại trong dist/:` kèm danh sách 6 path, exit code 0.

> **Không** biến bước này thành test của Vitest: `npm test` chạy **trước** `npm run build` trong chuỗi `npm run verify`, nên một test phụ thuộc `dist/` sẽ phụ thuộc thứ tự và chạy lỗi khi `dist/` chưa có.

- [ ] **Step 14: Commit**

```bash
git add manifest.config.ts public/logo.png src/background/index.ts src/content/index.ts src/popup src/options scripts/check-manifest.mjs
git commit -m "feat: add extension manifest, background worker and entry stubs"
```

> **Fallback nếu Step 11 lỗi do crxjs:** báo lại ngay, dừng plan. Không tự sửa — sẽ chuyển sang phương án `public/manifest.json` tĩnh + Vite multi-entry build.

---

## Task 3: `types.ts` + `api.ts` (TDD)

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/api.ts`
- Create: `scripts/fetch-fixture.mjs`
- Create: `tests/api.test.ts`

- [ ] **Step 1: Tạo fixture thật từ API**

Tạo `scripts/fetch-fixture.mjs`:

```js
import { mkdir, writeFile } from 'node:fs/promises'

const blNo = process.argv[2] ?? 'ONEYSHAGT1569600'
const url = `https://www.dadaex.cn/api/vn/insight/manifest?blNo=${encodeURIComponent(blNo)}`

const res = await fetch(url)
if (!res.ok) {
  console.error(`HTTP ${res.status}`)
  process.exit(1)
}
const json = await res.json()
if (!json?.data) {
  console.error(`Không có data cho blNo=${blNo}:`, json)
  process.exit(1)
}

await mkdir('tests/fixtures', { recursive: true })
const path = `tests/fixtures/manifest-${blNo}.json`
await writeFile(path, JSON.stringify(json, null, 2), 'utf8')
console.log('đã ghi', path, '— status:', json.status)
```

Run: `node scripts/fetch-fixture.mjs`
Expected: `đã ghi tests/fixtures/manifest-ONEYSHAGT1569600.json — status: 1`

- [ ] **Step 2: Tạo `src/core/types.ts`**

```ts
export interface PortInfo {
  id?: number
  name?: string
  nameEn?: string
}

export interface ManifestContact {
  id?: number
  /** 0/false = 发货人, 1/true = 收货人, 2 = 通知人 */
  type?: boolean | number
  master?: string | null
  address?: string | null
  firmCode?: string | null
  country?: string | null
  phone?: string | null
  aeo?: string | null
  spName?: string | null
  spType?: string | null
  spContact?: string | null
}

export interface ManifestCargo {
  id?: number
  name?: string | null
  description?: string | null
  cargoType?: boolean
  amount?: string | number | null
  unit?: string | null
  weight?: string | number | null
  volume?: string | number | null
  grossWeight?: string | number | null
  hscode?: string | null
  dangerClass?: string | null
  unNub?: string | null
  dangerCode?: string | null
  dangerPoint?: string | number | null
  packType?: string | null
  packDesc?: string | null
  sign?: string | null
  quarantineCode?: string | null
  quarantineName?: string | null
  exigencyName?: string | null
  exigencyPhone?: string | null
  exigencyEmail?: string | null
  exigencyFax?: string | null
}

export interface ManifestContainer {
  id?: number
  boxNub?: string | null
  sealNUb?: string | null
  /** 箱型: 2 = 20GP … */
  cType?: number | string | null
  /** Kích thước: 0 = 20' … */
  vC?: number | string | null
  /** true = 货主箱 */
  self?: boolean | null
  amount?: string | number | null
  weight?: string | number | null
  volume?: string | number | null
}

export interface ManifestData {
  id?: number
  blNo?: string | null
  shipName?: string | null
  voyage?: string | null
  loadCode?: string | null
  uploadCode?: string | null
  aimPortCode?: string | null
  payType?: boolean | number | null
  transportTerms?: string | null
  loadPortData?: PortInfo | null
  uploadPortData?: PortInfo | null
  aimPortData?: PortInfo | null
  sea_order?: {
    ebNo?: string | null
    sea_order_bind?: { id?: number; supplyId?: number } | null
  } | null
  cabContacts?: ManifestContact[] | null
  cdgoods?: ManifestCargo[] | null
  cdCon?: ManifestContainer[] | null
}
```

- [ ] **Step 3: Viết test fail trước — `tests/api.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  ManifestApiError,
  normalizeBlNo,
  parseEnvelope,
  fetchManifest,
  DEFAULT_API_BASE,
} from '../src/core/api'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'

describe('normalizeBlNo', () => {
  it('bỏ hậu tố piece P1', () => {
    expect(normalizeBlNo('CHN4139065P1')).toBe('CHN4139065')
  })

  it('bỏ hậu tố piece P12', () => {
    expect(normalizeBlNo('ONEYSHAGT1569600P12')).toBe('ONEYSHAGT1569600')
  })

  it('không đụng vào blNo không có hậu tố', () => {
    expect(normalizeBlNo('ONEYSHAGT1569600')).toBe('ONEYSHAGT1569600')
  })

  it('trim và upper-case', () => {
    expect(normalizeBlNo('  chn4139065p1 ')).toBe('CHN4139065')
  })

  it('không bỏ chữ P đứng riêng', () => {
    expect(normalizeBlNo('ABCXP')).toBe('ABCXP')
  })
})

describe('parseEnvelope', () => {
  it('trả về data khi status=1', () => {
    const data = parseEnvelope({ status: 1, messgae: 'success', data: { blNo: 'X' } })
    expect(data.blNo).toBe('X')
  })

  it('ném not_found khi status=0', () => {
    expect(() => parseEnvelope({ status: 0, message: 'data_not_found', data: null })).toThrowError(
      ManifestApiError,
    )
  })

  it('ném not_found khi status=1 nhưng data=null', () => {
    let err: unknown
    try {
      parseEnvelope({ status: 1, messgae: 'success', data: null })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ManifestApiError)
    expect((err as ManifestApiError).kind).toBe('not_found')
  })

  it('ném bad_response khi payload không phải object', () => {
    let err: unknown
    try {
      parseEnvelope('oops')
    } catch (e) {
      err = e
    }
    expect((err as ManifestApiError).kind).toBe('bad_response')
  })
})

describe('fetchManifest', () => {
  it('gọi đúng URL và bóc data', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        status: 200,
        json: async () => fixture,
      } as unknown as Response
    }) as unknown as typeof fetch

    const data = await fetchManifest('ONEYSHAGT1569600', { fetchImpl: fakeFetch })
    expect(calls[0]).toBe(`${DEFAULT_API_BASE}?blNo=ONEYSHAGT1569600`)
    expect(data.blNo).toBe('ONEYSHAGT1569600')
    expect(data.shipName).toBe('CALLAO BRIDGE')
  })

  it('báo lỗi mạng khi fetch throw', async () => {
    const fakeFetch = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    let err: unknown
    try {
      await fetchManifest('X', { fetchImpl: fakeFetch })
    } catch (e) {
      err = e
    }
    expect((err as ManifestApiError).kind).toBe('network')
  })
})
```

- [ ] **Step 4: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/core/api"`.

- [ ] **Step 5: Tạo `src/core/api.ts`**

```ts
import type { ManifestData } from './types'

export const DEFAULT_API_BASE = 'https://www.dadaex.cn/api/vn/insight/manifest'

export type ApiErrorKind = 'not_found' | 'network' | 'bad_response'

export class ManifestApiError extends Error {
  readonly kind: ApiErrorKind

  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.name = 'ManifestApiError'
    this.kind = kind
  }
}

/**
 * blNo trên site có thể kèm hậu tố piece dạng `P1`, `P12`.
 * API của dadaex chỉ nhận mã gốc — đã kiểm chứng:
 * `CHN4139065P1` → data_not_found, `CHN4139065` → status 1.
 */
export function normalizeBlNo(raw: string): string {
  return raw.trim().toUpperCase().replace(/P\d+$/, '')
}

export function parseEnvelope(json: unknown): ManifestData {
  if (typeof json !== 'object' || json === null) {
    throw new ManifestApiError('bad_response', 'Phản hồi API không phải object')
  }
  const env = json as { status?: number; message?: string; data?: unknown }
  if (env.status !== 1) {
    throw new ManifestApiError('not_found', env.message || 'API không trả dữ liệu')
  }
  if (typeof env.data !== 'object' || env.data === null) {
    throw new ManifestApiError('not_found', 'API trả status=1 nhưng data=null')
  }
  return env.data as ManifestData
}

export interface FetchManifestOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export async function fetchManifest(
  blNo: string,
  options: FetchManifestOptions = {},
): Promise<ManifestData> {
  const base = options.baseUrl ?? DEFAULT_API_BASE
  const doFetch = options.fetchImpl ?? fetch
  const url = `${base}?blNo=${encodeURIComponent(blNo)}`

  let res: Response
  try {
    res = await doFetch(url)
  } catch (e) {
    throw new ManifestApiError('network', `Không gọi được API: ${(e as Error).message}`)
  }
  if (!res.ok) {
    throw new ManifestApiError('network', `API trả HTTP ${res.status}`)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ManifestApiError('bad_response', 'Phản hồi API không phải JSON')
  }
  return parseEnvelope(json)
}
```

- [ ] **Step 6: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: tất cả PASS (`tests/api.test.ts` + `tests/smoke.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/api.ts scripts/fetch-fixture.mjs tests/api.test.ts tests/fixtures
git commit -m "feat: add manifest API client with blNo normalization and envelope parsing"
```

---

## Task 4: `wait.ts` (TDD)

**Files:**
- Create: `src/core/wait.ts`
- Create: `tests/wait.test.ts`

- [ ] **Step 1: Viết test fail trước — `tests/wait.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { sleep, nextFrame, waitFor, WaitTimeoutError } from '../src/core/wait'

describe('sleep', () => {
  it('resolve sau khoảng thời gian yêu cầu', async () => {
    const t0 = Date.now()
    await sleep(30)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25)
  })
})

describe('nextFrame', () => {
  it('resolve', async () => {
    await expect(nextFrame()).resolves.toBeUndefined()
  })
})

describe('waitFor', () => {
  it('trả về ngay khi probe có kết quả', async () => {
    expect(await waitFor(() => 'x')).toBe('x')
  })

  it('đợi tới khi probe có kết quả', async () => {
    let n = 0
    const result = await waitFor(
      () => {
        n += 1
        return n >= 3 ? 'ready' : null
      },
      { interval: 10, timeout: 1000 },
    )
    expect(result).toBe('ready')
  })

  it('ném WaitTimeoutError khi hết thời gian', async () => {
    let err: unknown
    try {
      await waitFor(() => null, { interval: 10, timeout: 50, label: 'popup' })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(WaitTimeoutError)
    expect((err as Error).message).toContain('popup')
  })

  it('coi giá trị false là chưa có kết quả', async () => {
    let err: unknown
    try {
      await waitFor(() => false, { interval: 10, timeout: 40 })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(WaitTimeoutError)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/core/wait"`.

- [ ] **Step 3: Tạo `src/core/wait.ts`**

```ts
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(() => resolve(), 16)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export class WaitTimeoutError extends Error {
  constructor(label: string) {
    super(`Timeout sau khi chờ "${label}"`)
    this.name = 'WaitTimeoutError'
  }
}

export interface WaitForOptions {
  timeout?: number
  interval?: number
  label?: string
}

export async function waitFor<T>(
  probe: () => T | null | undefined | false,
  options: WaitForOptions = {},
): Promise<T> {
  const timeout = options.timeout ?? 5000
  const interval = options.interval ?? 100
  const deadline = Date.now() + timeout

  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() >= deadline) {
      throw new WaitTimeoutError(options.label ?? 'waitFor')
    }
    await sleep(interval)
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: tất cả PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/wait.ts tests/wait.test.ts
git commit -m "feat: add wait helpers for async render and element polling"
```

---

## Task 5: `mapping.ts` — form đầu (TDD)

**Files:**
- Create: `src/core/mapping.ts`
- Create: `tests/mapping-header.test.ts`

- [ ] **Step 1: Viết test fail trước — `tests/mapping-header.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { mapHeader, contactRole, type MappingContext } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'

const data = fixture.data as unknown as ManifestData

const ctx: MappingContext = {
  findTrustCode: (id) => (id === 2 ? 'MAEU' : undefined),
  findDrType: (code) => (code === '1' ? 'FOB' : undefined),
  findPort: (code) =>
    code === 'CNSHA'
      ? { label: '上海', value: 'CNSHA' }
      : code === 'IDBLW'
        ? { label: '勿拉湾', value: 'IDBLW' }
        : undefined,
  findCntrType: (raw) => (raw === 2 ? '20GP' : undefined),
  findCntrSize: (raw) => (raw === 0 ? "20'" : undefined),
  portNameField: 'name',
}

const planFor = (plans: { prop: string }[], prop: string) =>
  plans.find((p) => p.prop === prop)

describe('contactRole', () => {
  it('false = 发货人 (0)', () => {
    expect(contactRole({ type: false })).toBe(0)
  })
  it('true = 收货人 (1)', () => {
    expect(contactRole({ type: true })).toBe(1)
  })
  it('2 = 通知人', () => {
    expect(contactRole({ type: 2 })).toBe(2)
  })
  it('số 0/1 cũng hợp lệ', () => {
    expect(contactRole({ type: 0 })).toBe(0)
    expect(contactRole({ type: 1 })).toBe(1)
  })
  it('undefined thì null', () => {
    expect(contactRole({})).toBeNull()
  })
})

describe('mapHeader', () => {
  const plans = mapHeader(data, ctx)

  it('điền 提单号, 船名, 航次', () => {
    expect(planFor(plans, 'BILL_NBR')).toMatchObject({
      status: 'fill',
      value: 'ONEYSHAGT1569600',
    })
    expect(planFor(plans, 'E_SHIP_NAM')).toMatchObject({ status: 'fill', value: 'CALLAO BRIDGE' })
    expect(planFor(plans, 'OUT_VOYAGE_NO')).toMatchObject({ status: 'fill', value: '0294S' })
  })

  it('map 承运人代码 qua supplyId', () => {
    expect(planFor(plans, 'TRUST_COD')).toMatchObject({ status: 'fill', value: 'MAEU' })
  })

  it('báo ⚠️ khi không tìm thấy 承运人', () => {
    const p = mapHeader(data, { ...ctx, findTrustCode: () => undefined }).find(
      (x) => x.prop === 'TRUST_COD',
    )
    expect(p?.status).toBe('skip')
    expect(p?.note).toContain('supplyId')
  })

  it('map 交货条款 qua transportTerms', () => {
    expect(planFor(plans, 'DR_TYPE_STR')).toMatchObject({ status: 'fill', value: 'FOB' })
  })

  it('map 付款方式 từ boolean payType', () => {
    expect(planFor(plans, 'PAY_WAY_ID')).toMatchObject({ status: 'fill', value: '0' })
  })

  it('map 装货港 sang START_PORT_NAM và verify START_PORT_COD', () => {
    expect(planFor(plans, 'START_PORT_NAM')).toMatchObject({ status: 'fill', value: '上海' })
    expect(planFor(plans, 'START_PORT_NAM')?.verify?.prop).toBe('START_PORT_COD')
  })

  it('map 卸货港 sang DISCHRG_PORT_NAM', () => {
    expect(planFor(plans, 'DISCHRG_PORT_NAM')).toMatchObject({ status: 'fill', value: '勿拉湾' })
  })

  it('map 交货地 sang DEST_PORT_NAM', () => {
    expect(planFor(plans, 'DEST_PORT_NAM')).toMatchObject({ status: 'fill', value: '勿拉湾' })
  })

  it('để trống 中转港 khi API không có', () => {
    expect(planFor(plans, 'TRANS_PORT_NAM')?.status).toBe('skip')
  })

  it('map 发货人 từ contact type=0', () => {
    expect(planFor(plans, 'E_SHIPPER_NAM')).toMatchObject({
      status: 'fill',
      value: 'SHANGHAI JUNYI TRADE & DEVELOPMENT CO.,LTD.',
    })
    expect(planFor(plans, 'SHIPPER_COUNTRY_COD')).toMatchObject({ status: 'fill', value: 'CN' })
  })

  it('map 收货人 từ contact type=1', () => {
    expect(planFor(plans, 'E_CONSIGNEE_NAM')).toMatchObject({
      status: 'fill',
      value: 'PT KARYA BINA NUSANTARA',
    })
  })

  it('map 通知人 từ contact type=2', () => {
    expect(planFor(plans, 'E_NOTIFY_NAM')).toMatchObject({
      status: 'fill',
      value: 'PT KARYA BINA NUSANTARA',
    })
  })

  it('để trống AEO vì firmCode không phải mã AEO', () => {
    const aeo = planFor(plans, 'SHIPPER_AEO')
    expect(aeo?.status).toBe('skip')
    expect(aeo?.note).toContain('AEO')
  })

  it('để trống EMAIL và FAX', () => {
    expect(planFor(plans, 'SHIPPER_EM_STR')?.status).toBe('skip')
    expect(planFor(plans, 'CONSIGNEE_FX_STR')?.status).toBe('skip')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/core/mapping"`.

- [ ] **Step 3: Tạo `src/core/mapping.ts`**

```ts
import type {
  ManifestCargo,
  ManifestContainer,
  ManifestContact,
  ManifestData,
} from './types'

export type PlanStatus = 'fill' | 'skip'

export interface FieldPlan {
  /** prop của field trong form (khớp với id `...-${prop}` của Element Plus) */
  prop: string
  /** nhãn tiếng Việt để hiển thị trong báo cáo */
  label: string
  status: PlanStatus
  /** giá trị cần điền (chỉ có khi status = 'fill') */
  value?: string
  /** lý do bỏ qua */
  note?: string
  /** sau khi điền prop này thì đọc lại verifyProp, rỗng thì báo cảnh báo */
  verify?: { prop: string; note: string }
  /** nhãn tiếng Trung của cột, dùng khi điền bảng inline */
  columnLabel?: string
}

export interface MappingContext {
  findTrustCode(supplyId?: number): string | undefined
  findDrType(code?: string): string | undefined
  findPort(code?: string): { label: string; value: string } | undefined
  findCntrType(raw?: number | string | null): string | undefined
  findCntrSize(raw?: number | string | null): string | undefined
  portNameField: 'name' | 'nameEn'
}

export type ContactRole = 0 | 1 | 2

export function contactRole(contact: ManifestContact): ContactRole | null {
  const t = contact.type
  if (t === true) return 1
  if (t === false) return 0
  if (t === 2) return 2
  if (t === 1) return 1
  if (t === 0) return 0
  return null
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

function text(value: unknown): string {
  return isBlank(value) ? '' : String(value).trim()
}

const PARTY_GROUPS = [
  { role: 0 as const, nameProp: 'E_SHIPPER_NAM', prefix: 'SHIPPER', label: '发货人' },
  { role: 1 as const, nameProp: 'E_CONSIGNEE_NAM', prefix: 'CONSIGNEE', label: '收货人' },
  { role: 2 as const, nameProp: 'E_NOTIFY_NAM', prefix: 'NOTIFY', label: '通知人' },
]

export function mapHeader(data: ManifestData, ctx: MappingContext): FieldPlan[] {
  const plans: FieldPlan[] = []

  const push = (prop: string, label: string, value: unknown, note?: string) => {
    const v = text(value)
    if (v === '') {
      plans.push({ prop, label, status: 'skip', note: note ?? 'API không có dữ liệu cho field này' })
    } else {
      plans.push({ prop, label, status: 'fill', value: v })
    }
  }

  push('BILL_NBR', '提单号', data.blNo)
  push('E_SHIP_NAM', '船名', data.shipName)
  push('OUT_VOYAGE_NO', '航次', data.voyage)

  const supplyId = data.sea_order?.sea_order_bind?.supplyId
  const trustCode = ctx.findTrustCode(supplyId)
  plans.push({
    prop: 'TRUST_COD',
    label: '承运人代码',
    status: trustCode ? 'fill' : 'skip',
    value: trustCode ?? undefined,
    note: trustCode
      ? undefined
      : `Không tìm thấy 承运人 cho supplyId=${supplyId ?? 'null'} trong getTrustCode()`,
  })

  const drType = ctx.findDrType(data.transportTerms ?? undefined)
  plans.push({
    prop: 'DR_TYPE_STR',
    label: '交货条款',
    status: drType ? 'fill' : 'skip',
    value: drType ?? undefined,
    note: drType
      ? undefined
      : `Không tìm thấy 交货条款 cho mã "${data.transportTerms ?? ''}" trong getDrType()`,
  })

  const payType = data.payType
  plans.push({
    prop: 'PAY_WAY_ID',
    label: '付款方式',
    status: payType === null || payType === undefined ? 'skip' : 'fill',
    value: payType === null || payType === undefined ? undefined : payType ? '1' : '0',
    note: payType === null || payType === undefined ? 'API không có payType' : undefined,
  })

  const portGroups = [
    {
      nameProp: 'START_PORT_NAM',
      codeProp: 'START_PORT_COD',
      code: data.loadCode,
      info: data.loadPortData,
      label: '收货地（装货港）',
    },
    {
      nameProp: 'DISCHRG_PORT_NAM',
      codeProp: 'DISCHRG_PORT_COD',
      code: data.uploadCode,
      info: data.uploadPortData,
      label: '卸货港',
    },
    {
      nameProp: 'DEST_PORT_NAM',
      codeProp: 'DEST_PORT_COD',
      code: data.aimPortCode,
      info: data.aimPortData,
      label: '交货地',
    },
  ]

  for (const group of portGroups) {
    const found = ctx.findPort(group.code ?? undefined)
    if (!found) {
      plans.push({
        prop: group.nameProp,
        label: group.label,
        status: 'skip',
        note: `Không tìm thấy cảng cho mã "${group.code ?? ''}" trong getPort()`,
      })
      continue
    }
    plans.push({
      prop: group.nameProp,
      label: group.label,
      status: 'fill',
      value: found.label,
      verify: { prop: group.codeProp, note: `Mã cảng ${group.codeProp} chưa được set` },
    })
  }

  plans.push({
    prop: 'TRANS_PORT_NAM',
    label: '中转港',
    status: 'skip',
    note: 'API không có dữ liệu 中转港',
  })
  plans.push({
    prop: 'SIGN_PLACE_STR',
    label: '提单签发地/代码',
    status: 'skip',
    note: 'API không có dữ liệu 提单签发地',
  })

  const contacts = data.cabContacts ?? []
  for (const group of PARTY_GROUPS) {
    const contact = contacts.find((c) => contactRole(c) === group.role)
    push(group.nameProp, `${group.label}名称`, contact?.master)
    push(`${group.prefix}_ADD_STR`, `${group.label}地址`, contact?.address)
    push(`${group.prefix}_COUNTRY_COD`, `${group.label}国家代码`, contact?.country)
    push(`${group.prefix}_TE_STR`, `${group.label}电话`, contact?.phone)
    push(`${group.prefix}_EM_STR`, `${group.label}EMAIL`, undefined, 'API không có email')
    push(`${group.prefix}_FX_STR`, `${group.label}传真`, undefined, 'API không có fax')
    push(
      `${group.prefix}_AEO`,
      `${group.label}AEO代码`,
      contact?.aeo,
      'firmCode là mã đăng ký doanh nghiệp (USCI/TIN), không phải mã AEO nên để trống',
    )
  }

  return plans
}
```

> `ManifestContact` trong `types.ts` không có `email`/`fax` — API không cung cấp hai trường này, nên hai field tương ứng luôn để trống.

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: tất cả PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/core/mapping.ts tests/mapping-header.test.ts
git commit -m "feat: map manifest data to header form field plans"
```

---

## Task 6: `mapping.ts` — cargo + container (TDD)

**Files:**
- Modify: `src/core/mapping.ts`
- Create: `tests/mapping-rows.test.ts`

- [ ] **Step 1: Viết test fail trước — `tests/mapping-rows.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  mapCargo,
  mapContainer,
  deriveCargoKind,
  type MappingContext,
} from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'

const data = fixture.data as unknown as ManifestData
const cargo = data.cdgoods![0]!
const con = data.cdCon![0]!

const ctx: MappingContext = {
  findTrustCode: () => undefined,
  findDrType: () => undefined,
  findPort: () => undefined,
  findCntrType: (raw) => (String(raw) === '2' ? '20GP' : undefined),
  findCntrSize: (raw) => (String(raw) === '0' ? "20'" : undefined),
  portNameField: 'name',
}

const planFor = (plans: { prop: string }[], prop: string) => plans.find((p) => p.prop === prop)

describe('deriveCargoKind', () => {
  it('S khi không có gì đặc biệt', () => {
    expect(deriveCargoKind({})).toBe('S')
  })
  it('D khi có dangerClass', () => {
    expect(deriveCargoKind({ dangerClass: '2.1' })).toBe('D')
  })
  it('R khi có quarantineName', () => {
    expect(deriveCargoKind({ quarantineName: '冷藏' })).toBe('R')
  })
  it('G khi có cả hai', () => {
    expect(deriveCargoKind({ dangerClass: '2.1', quarantineName: '冷藏' })).toBe('G')
  })
})

describe('mapCargo', () => {
  const plans = mapCargo(cargo)

  it('điền 货物标识 mặc định S', () => {
    expect(planFor(plans, 'CARGO_KIND_COD')).toMatchObject({ status: 'fill', value: 'S' })
  })
  it('điền 包装件数 từ amount', () => {
    expect(planFor(plans, 'PIECE_NUM')).toMatchObject({ status: 'fill', value: '114.000' })
  })
  it('điền 毛重 từ weight', () => {
    expect(planFor(plans, 'GWEIGHT_TON')).toMatchObject({ status: 'fill', value: '22400.000' })
  })
  it('điền 体积 từ volume', () => {
    expect(planFor(plans, 'GVOL_NUM')).toMatchObject({ status: 'fill', value: '60.130' })
  })
  it('điền 包装类型 từ unit', () => {
    expect(planFor(plans, 'PACKAGE_STR')).toMatchObject({ status: 'fill', value: 'PACKAGES' })
  })
  it('trim 货物描述', () => {
    expect(planFor(plans, 'E_CARGO_NAM')).toMatchObject({
      status: 'fill',
      value: 'SILENT DIESEL GENERATOR',
    })
  })
  it('để trống field không có trong API', () => {
    expect(planFor(plans, 'DANG_EMS_NO')?.status).toBe('skip')
    expect(planFor(plans, 'TEMP_ID')?.status).toBe('skip')
  })
  it('có đủ 24 field', () => {
    expect(plans).toHaveLength(24)
  })
})

describe('mapContainer', () => {
  const plans = mapContainer(con, ctx)

  it('điền 箱号', () => {
    expect(planFor(plans, 'CNTR_NO')).toMatchObject({ status: 'fill', value: 'ONEU1437898' })
  })
  it('điền 铅封号', () => {
    expect(planFor(plans, 'SEAL_NO')).toMatchObject({ status: 'fill', value: 'CN28731BH' })
  })
  it('map 箱型 qua dict', () => {
    expect(planFor(plans, 'CNTR_TYPE_COD')).toMatchObject({ status: 'fill', value: '20GP' })
  })
  it('map 尺寸 qua dict', () => {
    expect(planFor(plans, 'CNTR_SIZE_COD')).toMatchObject({ status: 'fill', value: "20'" })
  })
  it('map 货主箱标志 thành 0/1', () => {
    expect(planFor(plans, 'SOC_ID')).toMatchObject({ status: 'fill', value: '0' })
  })
  it('để trống 箱状态', () => {
    expect(planFor(plans, 'CNTR_EF_ID')?.status).toBe('skip')
  })
  it('có nhãn cột tiếng Trung để định vị ô bảng', () => {
    expect(planFor(plans, 'CNTR_NO')?.columnLabel).toBe('箱号')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `deriveCargoKind` / `mapCargo` / `mapContainer` chưa tồn tại.

- [ ] **Step 3: Thêm vào cuối `src/core/mapping.ts`**

```ts
export function deriveCargoKind(goods: ManifestCargo): 'S' | 'D' | 'R' | 'G' {
  const danger = !isBlank(goods.dangerClass) || !isBlank(goods.unNub)
  const cold = !isBlank(goods.quarantineName) || !isBlank(goods.quarantineCode)
  if (danger && cold) return 'G'
  if (danger) return 'D'
  if (cold) return 'R'
  return 'S'
}

export function mapCargo(goods: ManifestCargo): FieldPlan[] {
  const plans: FieldPlan[] = []

  const push = (prop: string, label: string, value: unknown, note?: string) => {
    const v = text(value)
    if (v === '') {
      plans.push({ prop, label, status: 'skip', note: note ?? 'API không có dữ liệu cho field này' })
    } else {
      plans.push({ prop, label, status: 'fill', value: v })
    }
  }

  push('CARGO_KIND_COD', '货物标识', deriveCargoKind(goods))
  push('CARGO_HS_COD', 'HS编码', goods.hscode)
  push('PACKAGE_STR', '包装类型/代码', goods.unit ?? goods.packDesc)
  push('PACKAGE_COD', '包装类型代码', goods.packType)
  push('PIECE_NUM', '包装件数', goods.amount)
  push('GWEIGHT_TON', '货物毛重（公斤）', goods.weight)
  push('GVOL_NUM', '货物体积（m³）', goods.volume)
  push('NWEIGHT_TON', '货物净重（公斤）', goods.grossWeight)
  push('MARK_STR', '唛头', goods.sign)
  push('E_CARGO_NAM', '货物描述', goods.name)
  push('DANG_CLASS_NAM', '危险品类别', goods.dangerClass)
  push('DANG_UN_NO', '危险品联合国编号', goods.unNub)
  push('DANG_LABLE_STR', '危险品标签', goods.dangerCode)
  push('DANG_FLASH_POINT', '危险货物闪点（摄氏）', goods.dangerPoint)
  push('DANG_PAGE_NO', '危险品页号', undefined)
  push('DANG_EMS_NO', '船运危险品应急措施号', undefined)
  push('DANG_MFAG_NO', '医疗急救指南号', undefined)
  push('DANG_CONTACTSTR', '应急联系', undefined)
  push('DANGER_CONTACT_NAM', '危险品联系人姓名', goods.exigencyName)
  push('DANGER_TE_STR', '危险品联系人电话', goods.exigencyPhone)
  push('DANGER_EM_STR', '危险品联系人邮箱', goods.exigencyEmail)
  push('DANGER_FX_STR', '危险品联系人传真', goods.exigencyFax)
  push('TEMP_ID', '温度计量单位', undefined)
  push('SET_TEMP_NUM', '设置温度', undefined)

  return plans
}

export function mapContainer(
  container: ManifestContainer,
  ctx: MappingContext,
): FieldPlan[] {
  const plans: FieldPlan[] = []

  const push = (prop: string, label: string, columnLabel: string, value: unknown, note?: string) => {
    const v = text(value)
    if (v === '') {
      plans.push({
        prop,
        label,
        status: 'skip',
        note: note ?? 'API không có dữ liệu cho field này',
        columnLabel,
      })
    } else {
      plans.push({ prop, label, status: 'fill', value: v, columnLabel })
    }
  }

  push('CNTR_NO', '箱号', '箱号', container.boxNub)
  push(
    'CNTR_SIZE_COD',
    '尺寸',
    '尺寸',
    ctx.findCntrSize(container.vC ?? undefined),
    `Không tìm thấy 尺寸 cho mã "${container.vC ?? ''}" trong getCntrCode()`,
  )
  push(
    'CNTR_TYPE_COD',
    '箱型',
    '箱型',
    ctx.findCntrType(container.cType ?? undefined),
    `Không tìm thấy 箱型 cho mã "${container.cType ?? ''}" trong getCntrCode()`,
  )
  push('CNTR_EF_ID', '箱状态', '箱状态', undefined)
  push('SEAL_NO', '铅封号', '铅封号', container.sealNUb)
  push('PIECE_NUM', '货物件数', '货物件数', container.amount)
  push('WEIGH_TON', '箱内货重（公斤）', '箱内货重（公斤）', container.weight)
  push('VOLUME_NUM', '箱内体积', '箱内体积', container.volume)
  push(
    'SOC_ID',
    '货主箱标志',
    '货主箱标志',
    container.self === null || container.self === undefined ? undefined : container.self ? '1' : '0',
  )

  return plans
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: tất cả PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/core/mapping.ts tests/mapping-rows.test.ts
git commit -m "feat: map cargo and container rows to field plans"
```

---

## Task 7: `dom.ts` — tìm field + đặt giá trị text (TDD)

**Files:**
- Create: `src/core/dom.ts`
- Create: `tests/dom-text.test.ts`

- [ ] **Step 1: Viết test fail trước — `tests/dom-text.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { findField, setTextValue, readFieldValue, setFieldValue } from '../src/core/dom'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('findField', () => {
  it('tìm theo id kết thúc bằng prop', () => {
    document.body.innerHTML = '<input id="el-id-abc-BILL_NBR" />'
    expect(findField(document, 'BILL_NBR')?.id).toBe('el-id-abc-BILL_NBR')
  })

  it('tìm textarea', () => {
    document.body.innerHTML = '<textarea id="el-id-abc-MARK_STR"></textarea>'
    expect(findField(document, 'MARK_STR')?.tagName).toBe('TEXTAREA')
  })

  it('tìm theo name khi không có id', () => {
    document.body.innerHTML = '<input name="PIECE_NUM" />'
    expect(findField(document, 'PIECE_NUM')?.getAttribute('name')).toBe('PIECE_NUM')
  })

  it('tìm theo label for', () => {
    document.body.innerHTML =
      '<label for="el-id-zz-OUT_VOYAGE_NO">航次</label><input id="el-id-zz-OUT_VOYAGE_NO" />'
    expect(findField(document, 'OUT_VOYAGE_NO')?.id).toBe('el-id-zz-OUT_VOYAGE_NO')
  })

  it('trả null khi không có field', () => {
    expect(findField(document, 'KHONG_CO')).toBeNull()
  })
})

describe('setTextValue', () => {
  it('set value và bắn input/change/blur', () => {
    document.body.innerHTML = '<input id="el-id-a-BILL_NBR" />'
    const el = document.getElementById('el-id-a-BILL_NBR') as HTMLInputElement
    const seen: string[] = []
    el.addEventListener('input', () => seen.push('input'))
    el.addEventListener('change', () => seen.push('change'))
    el.addEventListener('blur', () => seen.push('blur'))

    setTextValue(el, 'ABC123')

    expect(el.value).toBe('ABC123')
    expect(seen).toEqual(['input', 'change', 'blur'])
  })

  it('gán được giá trị rỗng', () => {
    document.body.innerHTML = '<input id="el-id-a-BILL_NBR" />'
    const el = document.getElementById('el-id-a-BILL_NBR') as HTMLInputElement
    el.value = 'cũ'
    setTextValue(el, '')
    expect(el.value).toBe('')
  })
})

describe('readFieldValue', () => {
  it('đọc value của input', () => {
    document.body.innerHTML = '<input id="el-id-a-BILL_NBR" value="XYZ" />'
    expect(readFieldValue(document, 'BILL_NBR')).toBe('XYZ')
  })
  it('trả chuỗi rỗng khi không có field', () => {
    expect(readFieldValue(document, 'KHONG_CO')).toBe('')
  })
})

describe('setFieldValue với text input', () => {
  it('điền được qua adapter chung', async () => {
    document.body.innerHTML = '<input id="el-id-a-BILL_NBR" />'
    const result = await setFieldValue(document, 'BILL_NBR', 'FOO')
    expect(result.ok).toBe(true)
    expect(result.strategy).toBe('text')
    expect(readFieldValue(document, 'BILL_NBR')).toBe('FOO')
  })

  it('báo lỗi khi không tìm thấy field', async () => {
    const result = await setFieldValue(document, 'KHONG_CO', 'FOO')
    expect(result.ok).toBe(false)
    expect(result.strategy).toBe('none')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/core/dom"`.

- [ ] **Step 3: Tạo `src/core/select.ts` (stub — Task 8 sẽ thay bằng bản thật)**

```ts
import type { SetResult } from './dom'

export async function pickFromSelect(
  _scope: HTMLElement,
  _value: string,
  _timeout?: number,
): Promise<SetResult> {
  return { ok: false, strategy: 'select', reason: 'chưa implement' }
}

export async function pickFromPopper(
  _scope: HTMLElement,
  _value: string,
  _timeout?: number,
): Promise<SetResult> {
  return { ok: false, strategy: 'select', reason: 'chưa implement' }
}
```

> `SetResult` nằm ở `dom.ts` và `dom.ts` import từ `select.ts` → import chéo kiểu type là OK vì `import type` bị xoá lúc biên dịch.

- [ ] **Step 4: Tạo `src/core/dom.ts`**

```ts
import { nextFrame, sleep, waitFor } from './wait'
import { pickFromPopper, pickFromSelect } from './select'

export interface SetResult {
  ok: boolean
  strategy: 'text' | 'select' | 'none'
  reason?: string
}

export function findField(root: ParentNode, prop: string): HTMLElement | null {
  const byId = root.querySelector<HTMLElement>(
    `input[id$="-${prop}"], textarea[id$="-${prop}"]`,
  )
  if (byId) return byId

  const byName = root.querySelector<HTMLElement>(`[name="${prop}"]`)
  if (byName) return byName

  const label = root.querySelector<HTMLLabelElement>(`label[for$="-${prop}"]`)
  if (label) {
    const id = label.getAttribute('for')
    if (id) {
      const el = document.getElementById(id)
      if (el) return el
    }
  }

  return null
}

export function setTextValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  if (!desc?.set) {
    throw new Error('Không tìm thấy native setter cho value')
  }
  desc.set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
}

export function readFieldValue(root: ParentNode, prop: string): string {
  const el = findField(root, prop)
  if (!el) return ''
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value
  return (el.textContent ?? '').trim()
}

export async function setFieldValue(
  root: ParentNode,
  prop: string,
  value: string,
  options: { timeout?: number } = {},
): Promise<SetResult> {
  const el = findField(root, prop)
  if (!el) {
    return { ok: false, strategy: 'none', reason: 'Không tìm thấy field trên trang' }
  }

  const scope = (el.closest('.el-form-item') as HTMLElement | null) ?? el.parentElement ?? null
  if (scope?.querySelector('.el-select')) {
    return pickFromSelect(scope, value, options.timeout)
  }

  if (el instanceof HTMLInputElement && el.readOnly) {
    return pickFromPopper(scope ?? el, value, options.timeout)
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setTextValue(el, value)
    return { ok: true, strategy: 'text' }
  }

  return { ok: false, strategy: 'none', reason: 'Field không phải input/textarea/select' }
}

export { nextFrame, sleep, waitFor }
```

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: `tests/dom-text.test.ts` PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/dom.ts tests/dom-text.test.ts
git commit -m "feat: add field lookup and Vue-safe text value setter"
```

---

## Task 8: `select.ts` — adapter chọn option (TDD)

**Files:**
- Modify: `src/core/select.ts`
- Create: `tests/select.test.ts`

- [ ] **Step 1: Viết test fail trước — `tests/select.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { pickFromSelect, pickFromPopper, findOptionIn } from '../src/core/select'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('findOptionIn', () => {
  it('khớp chính xác trước', () => {
    document.body.innerHTML = `
      <div class="el-popper">
        <li class="el-select-dropdown__item">上海</li>
        <li class="el-select-dropdown__item">上海虹桥</li>
      </div>`
    const popper = document.querySelector('.el-popper')!
    expect(findOptionIn(popper, '上海')?.textContent?.trim()).toBe('上海')
  })

  it('khớp chứa khi không có khớp chính xác', () => {
    document.body.innerHTML = `
      <div class="el-popper">
        <li class="el-select-dropdown__item">上海虹桥</li>
      </div>`
    const popper = document.querySelector('.el-popper')!
    expect(findOptionIn(popper, '上海')?.textContent?.trim()).toBe('上海虹桥')
  })

  it('trả null khi không có option nào khớp', () => {
    document.body.innerHTML = '<div class="el-popper"><li>北京</li></div>'
    const popper = document.querySelector('.el-popper')!
    expect(findOptionIn(popper, '上海')).toBeNull()
  })
})

describe('pickFromSelect', () => {
  it('mở dropdown và click option khớp', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input id="el-id-a-TRUST_COD" readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown">
        <div class="el-select-dropdown__item">MAEU</div>
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 1000)

    expect(result.ok).toBe(true)
    expect(result.strategy).toBe('select')
  })

  it('báo lỗi khi không có option khớp', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input id="el-id-a-TRUST_COD" readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown">
        <div class="el-select-dropdown__item">MAEU</div>
      </div>`

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'KHONG_CO', 300)

    expect(result.ok).toBe(false)
    expect(result.strategy).toBe('select')
    expect(result.reason).toContain('KHONG_CO')
  })
})

describe('pickFromPopper', () => {
  it('gõ vào ô filter rồi click option', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="el-id-a-START_PORT_NAM" readonly />
      </div>
      <div class="el-popper">
        <input class="filter-input" />
        <div role="option">上海</div>
        <div role="option">宁波</div>
      </div>`

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '宁波', 1000)

    expect(result.ok).toBe(true)
  })

  it('báo lỗi khi popper không xuất hiện', async () => {
    document.body.innerHTML = `
      <div class="el-form-item"><input id="el-id-a-START_PORT_NAM" readonly /></div>`

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '上海', 200)

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('上海')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `findOptionIn` chưa được export.

- [ ] **Step 3: Thay nội dung `src/core/select.ts`**

```ts
import { nextFrame, sleep, waitFor } from './wait'
import type { SetResult } from './dom'

const OPTION_SELECTORS = [
  '.el-select-dropdown__item',
  '.el-cascader-node',
  '[role="option"]',
  '.el-popper li',
].join(',')

function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 || el.offsetParent !== null
}

/** Tìm option khớp `value` bên trong `container`. Ưu tiên khớp chính xác. */
export function findOptionIn(container: ParentNode, value: string): HTMLElement | null {
  const all = Array.from(container.querySelectorAll<HTMLElement>(OPTION_SELECTORS))
  const visible = all.filter(isVisible)
  const pool = visible.length > 0 ? visible : all
  const needle = value.trim()

  const exact = pool.find((el) => (el.textContent ?? '').trim() === needle)
  if (exact) return exact

  return pool.find((el) => (el.textContent ?? '').trim().includes(needle)) ?? null
}

function mouseClick(el: Element): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function findVisiblePopper(): HTMLElement | null {
  const poppers = Array.from(document.querySelectorAll<HTMLElement>('.el-popper, .el-select-dropdown'))
  const visible = poppers.filter(isVisible)
  if (visible.length > 0) return visible[visible.length - 1]!
  return poppers[poppers.length - 1] ?? null
}

/** Mở dropdown `el-select` rồi click option khớp. */
export async function pickFromSelect(
  scope: HTMLElement,
  value: string,
  timeout = 5000,
): Promise<SetResult> {
  const select = scope.querySelector<HTMLElement>('.el-select') ?? scope
  const trigger =
    select.querySelector<HTMLElement>('.el-select__wrapper') ??
    select.querySelector<HTMLElement>('input') ??
    select

  mouseClick(trigger)

  try {
    const option = await waitFor(() => findOptionIn(document, value), {
      timeout,
      interval: 100,
      label: `option "${value}"`,
    })
    mouseClick(option)
    await nextFrame()
    return { ok: true, strategy: 'select' }
  } catch (e) {
    return {
      ok: false,
      strategy: 'select',
      reason: `Không tìm thấy option "${value}": ${(e as Error).message}`,
    }
  }
}

/** Mở popper tự dựng (component cảng của site), gõ lọc nếu có ô filter, rồi click option. */
export async function pickFromPopper(
  scope: HTMLElement,
  value: string,
  timeout = 5000,
): Promise<SetResult> {
  const trigger = scope.querySelector<HTMLElement>('input') ?? scope
  mouseClick(trigger)

  try {
    const popper = await waitFor(findVisiblePopper, {
      timeout,
      interval: 100,
      label: `popper cho "${value}"`,
    })

    const filter = popper.querySelector<HTMLInputElement>('input')
    if (filter) {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      desc?.set?.call(filter, value)
      filter.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(300)
    }

    const option = await waitFor(() => findOptionIn(popper, value), {
      timeout,
      interval: 100,
      label: `option "${value}" trong popper`,
    })
    mouseClick(option)
    await nextFrame()
    return { ok: true, strategy: 'select' }
  } catch (e) {
    return {
      ok: false,
      strategy: 'select',
      reason: `Không chọn được "${value}": ${(e as Error).message}`,
    }
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: `tests/select.test.ts` PASS.

> Trong jsdom mọi phần tử đều "visible" theo `getClientRects()` rỗng + `offsetParent` null → `isVisible` trả false cho tất cả, nên `findOptionIn` dùng fallback `pool = all`. Đây là hành vi mong muốn cho test.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/core/select.ts tests/select.test.ts
git commit -m "feat: add dropdown adapters for el-select and custom poppers"
```

---

## Task 9: `fill.ts` — mở dialog + điền form đầu (TDD)

**Files:**
- Create: `src/core/fill.ts`
- Create: `tests/fill-header.test.ts`
- Create: `tests/helpers/dom.ts`

- [ ] **Step 1: Tạo helper DOM test — `tests/helpers/dom.ts`**

```ts
export function buildHeaderForm(): void {
  const items: Array<[string, string, string?]> = [
    ['BILL_NBR', '提单号', 'input'],
    ['E_SHIP_NAM', '船名', 'input'],
    ['OUT_VOYAGE_NO', '航次', 'input'],
    ['TRUST_COD', '承运人代码', 'select'],
    ['PAY_WAY_ID', '付款方式', 'select'],
    ['DR_TYPE_STR', '交货条款', 'select'],
    ['START_PORT_NAM', '收货地（装货港）', 'input'],
    ['START_PORT_COD', '收货地代码', 'input'],
    ['DISCHRG_PORT_NAM', '卸货港', 'input'],
    ['DEST_PORT_NAM', '交货地', 'input'],
    ['E_SHIPPER_NAM', '发货人名称', 'input'],
    ['SHIPPER_ADD_STR', '发货人地址', 'input'],
    ['SHIPPER_COUNTRY_COD', '国家代码', 'input'],
    ['SHIPPER_TE_STR', '电话', 'input'],
    ['E_CONSIGNEE_NAM', '收货人名称', 'input'],
    ['E_NOTIFY_NAM', '通知人名称', 'input'],
  ]

  const html = items
    .map(([prop, label, kind]) => {
      const control =
        kind === 'select'
          ? `<div class="el-select"><div class="el-select__wrapper"><input id="el-id-x-${prop}" readonly /></div></div>`
          : `<input id="el-id-x-${prop}" />`
      return `<div class="el-form-item EntryOfManifestInformation">
        <label class="el-form-item__label" for="el-id-x-${prop}">${label}</label>
        ${control}
      </div>`
    })
    .join('')

  document.body.innerHTML = `
    <button class="el-button">新增舱单信息</button>
    <div class="el-dialog" style="display: block;">
      <div class="el-dialog__body">
        <div class="el-form">${html}</div>
      </div>
      <div class="el-dialog__footer">
        <button class="el-button">取消</button>
        <button class="el-button el-button--primary">确定</button>
      </div>
    </div>
    <div class="el-select-dropdown">
      <div class="el-select-dropdown__item">MAEU</div>
      <div class="el-select-dropdown__item">FOB</div>
      <div class="el-select-dropdown__item">0</div>
      <div class="el-select-dropdown__item">1</div>
      <div class="el-select-dropdown__item">上海</div>
    </div>`
}
```

- [ ] **Step 2: Viết test fail trước — `tests/fill-header.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { fillHeader, fillManifest } from '../src/core/fill'
import { mapHeader, type MappingContext } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'
import { buildHeaderForm } from './helpers/dom'

const data = fixture.data as unknown as ManifestData

const ctx: MappingContext = {
  findTrustCode: () => 'MAEU',
  findDrType: () => 'FOB',
  findPort: (code) =>
    code === 'CNSHA'
      ? { label: '上海', value: 'CNSHA' }
      : code === 'IDBLW'
        ? { label: '勿拉湾', value: 'IDBLW' }
        : undefined,
  findCntrType: () => undefined,
  findCntrSize: () => undefined,
  portNameField: 'name',
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('fillHeader', () => {
  it('điền được các field text', async () => {
    buildHeaderForm()
    const report = await fillHeader(document, mapHeader(data, ctx))

    const bill = report.items.find((i) => i.prop === 'BILL_NBR')
    expect(bill?.status).toBe('ok')
    expect(
      (document.getElementById('el-id-x-BILL_NBR') as HTMLInputElement).value,
    ).toBe('ONEYSHAGT1569600')
  })

  it('điền được select bằng cách click option', async () => {
    buildHeaderForm()
    const report = await fillHeader(document, mapHeader(data, ctx))
    const trust = reportItem(report, 'TRUST_COD')
    expect(trust?.status).toBe('ok')
  })

  it('báo skip cho field không có dữ liệu', async () => {
    buildHeaderForm()
    const report = await fillHeader(document, mapHeader(data, ctx))
    const aeo = report.items.find((i) => i.prop === 'SHIPPER_AEO')
    expect(aeo?.status).toBe('skip')
  })
})

describe('fillManifest', () => {
  it('báo lỗi khi không thấy nút 新增舱单信息', async () => {
    document.body.innerHTML = '<div></div>'
    const report = await fillManifest({ data, ctx, root: document })
    expect(report.ok).toBe(false)
    expect(report.message).toContain('新增舱单信息')
  })

  it('mở dialog và điền form đầu', async () => {
    buildHeaderForm()
    const report = await fillManifest({ data, ctx, root: document })
    expect(report.ok).toBe(true)
    expect(
      (document.getElementById('el-id-x-E_SHIP_NAM') as HTMLInputElement).value,
    ).toBe('CALLAO BRIDGE')
  })
})

function reportItem(report: { items: Array<{ prop: string; status: string }> }, prop: string) {
  return report.items.find((i) => i.prop === prop)
}
```

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/core/fill"`.

- [ ] **Step 4: Tạo `src/core/fill.ts`**

```ts
import { nextFrame, sleep, waitFor } from './wait'
import { readFieldValue, setFieldValue } from './dom'
import { mapHeader, type FieldPlan, type MappingContext } from './mapping'
import type { ManifestData } from './types'

export type FillStatus = 'ok' | 'skip' | 'error'

export interface FillItem {
  scope: 'header' | 'cargo' | 'container'
  prop: string
  label: string
  status: FillStatus
  note?: string
}

export interface FillReport {
  items: FillItem[]
  cargoRows: number
  containerRows: number
  ok: boolean
  message?: string
}

export interface FillOptions {
  root: ParentNode
  data: ManifestData
  ctx: MappingContext
  autoSubmit?: boolean
  log?: (message: string) => void
}

export function findButtonByText(text: string, root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, .el-button'))
  const exact = buttons.find((b) => (b.textContent ?? '').trim() === text)
  if (exact) return exact
  return buttons.find((b) => (b.textContent ?? '').trim().includes(text)) ?? null
}

export async function fillHeader(
  root: ParentNode,
  plans: FieldPlan[],
): Promise<{ items: FillItem[] }> {
  const items: FillItem[] = []

  for (const plan of plans) {
    if (plan.status === 'skip') {
      items.push({
        scope: 'header',
        prop: plan.prop,
        label: plan.label,
        status: 'skip',
        note: plan.note,
      })
      continue
    }

    const result = await setFieldValue(root, plan.prop, plan.value ?? '')
    if (!result.ok) {
      items.push({
        scope: 'header',
        prop: plan.prop,
        label: plan.label,
        status: 'error',
        note: result.reason,
      })
      await nextFrame()
      continue
    }

    if (plan.verify) {
      const actual = readFieldValue(root, plan.verify.prop)
      if (!actual) {
        items.push({
          scope: 'header',
          prop: plan.prop,
          label: plan.label,
          status: 'ok',
          note: plan.verify.note,
        })
        await nextFrame()
        continue
      }
    }

    items.push({ scope: 'header', prop: plan.prop, label: plan.label, status: 'ok' })
    await nextFrame()
  }

  return { items }
}

export async function fillManifest(options: FillOptions): Promise<FillReport> {
  const { root, data, ctx } = options
  const log = options.log ?? (() => {})

  const addButton = findButtonByText('新增舱单信息', root)
  if (!addButton) {
    return {
      items: [],
      cargoRows: 0,
      containerRows: 0,
      ok: false,
      message:
        'Không thấy nút "新增舱单信息" — hãy mở trang 预配舱单申报平台 và chọn tab 待发送.',
    }
  }

  addButton.click()

  const dialog = await waitFor(
    () => root.querySelector<HTMLElement>('.el-dialog'),
    { timeout: 5000, interval: 100, label: 'dialog 新增舱单信息' },
  ).catch(() => null)

  if (!dialog) {
    return {
      items: [],
      cargoRows: 0,
      containerRows: 0,
      ok: false,
      message: 'Dialog "新增舱单信息" không mở trong 5 giây.',
    }
  }

  log('Đang điền thông tin舱单…')
  const header = await fillHeader(dialog, mapHeader(data, ctx))

  return {
    items: header.items,
    cargoRows: 0,
    containerRows: 0,
    ok: true,
  }
}
```

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: `tests/fill-header.test.ts` PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 7: Commit**

```bash
git add src/core/fill.ts tests/fill-header.test.ts tests/helpers/dom.ts
git commit -m "feat: fill manifest header form and open the manifest dialog"
```

---

## Task 10: `fill.ts` — điền dòng hàng (cargo) (TDD)

**Files:**
- Modify: `src/core/fill.ts`
- Modify: `tests/helpers/dom.ts`
- Create: `tests/fill-cargo.test.ts`

- [ ] **Step 1: Bổ sung DOM test cho dialog hàng — thêm vào `tests/helpers/dom.ts`**

```ts
export const CARGO_PROPS = [
  'CARGO_KIND_COD',
  'CARGO_HS_COD',
  'PACKAGE_STR',
  'PACKAGE_COD',
  'PIECE_NUM',
  'GWEIGHT_TON',
  'GVOL_NUM',
  'NWEIGHT_TON',
  'MARK_STR',
  'E_CARGO_NAM',
  'DANG_CLASS_NAM',
  'DANG_UN_NO',
  'DANG_LABLE_STR',
  'DANG_FLASH_POINT',
  'DANG_PAGE_NO',
  'DANG_EMS_NO',
  'DANG_MFAG_NO',
  'DANG_CONTACTSTR',
  'DANGER_CONTACT_NAM',
  'DANGER_TE_STR',
  'DANGER_EM_STR',
  'DANGER_FX_STR',
  'TEMP_ID',
  'SET_TEMP_NUM',
]

export const CONTAINER_COLUMNS = [
  '箱号',
  '尺寸',
  '箱型',
  '箱状态',
  '铅封号',
  '货物件数',
  '箱内货重（公斤）',
  '箱内体积',
  '货主箱标志',
]

/** Dialog hàng (24 field) + section 货物信息 bên trong dialog đầu. */
export function buildCargoDialog(): void {
  const fields = CARGO_PROPS.map(
    (prop) =>
      `<div class="el-form-item"><label class="el-form-item__label" for="el-id-c-${prop}">${prop}</label>
        <input id="el-id-c-${prop}" /></div>`,
  ).join('')

  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="el-dialog" style="display: block;">
      <div class="el-dialog__body">
        <div class="el-form">${fields}</div>
      </div>
      <div class="el-dialog__footer">
        <button class="el-button">取消</button>
        <button class="el-button el-button--primary">确定</button>
      </div>
    </div>`,
  )
}

/** Section 货物信息 trong dialog đầu, nút 新增 sẽ mở dialog hàng. */
export function buildCargoSection(): void {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="CargoInformation">
      <div class="fs-crud-title">货物信息</div>
      <button class="el-button">新增</button>
    </div>`,
  )
}
```

- [ ] **Step 2: Viết test fail trước — `tests/fill-cargo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { fillCargoRows, findAddButtonBySectionTitle } from '../src/core/fill'
import { mapCargo } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'
import { buildCargoDialog, buildCargoSection } from './helpers/dom'

const data = fixture.data as unknown as ManifestData
const goods = data.cdgoods![0]!

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('findAddButtonBySectionTitle', () => {
  it('tìm nút 新增 trong section 货物信息', () => {
    buildCargoSection()
    const btn = findAddButtonBySectionTitle(document, '货物信息')
    expect(btn?.textContent?.trim()).toBe('新增')
  })

  it('trả null khi không có section', () => {
    document.body.innerHTML = '<div>không có gì</div>'
    expect(findAddButtonBySectionTitle(document, '货物信息')).toBeNull()
  })
})

describe('fillCargoRows', () => {
  it('mở dialog hàng, điền 24 field và bấm 确定', async () => {
    buildCargoSection()
    buildCargoDialog()

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(1)
    expect(
      (document.getElementById('el-id-c-E_CARGO_NAM') as HTMLInputElement).value,
    ).toBe('SILENT DIESEL GENERATOR')
    expect(
      (document.getElementById('el-id-c-CARGO_KIND_COD') as HTMLInputElement).value,
    ).toBe('S')
  })

  it('ghi nhận lỗi khi không tìm thấy nút 新增', async () => {
    document.body.innerHTML = '<div></div>'
    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(0)
    expect(result.items.some((i) => i.status === 'error')).toBe(true)
  })

  it('bỏ qua field không có dữ liệu', async () => {
    buildCargoSection()
    buildCargoDialog()

    const result = await fillCargoRows(document, [goods])
    const dang = result.items.find((i) => i.prop === 'DANG_EMS_NO')

    expect(dang?.status).toBe('skip')
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `findAddButtonBySectionTitle` / `fillCargoRows` chưa được export.

- [ ] **Step 4: Thêm helper tìm section + nút 新增 vào `src/core/fill.ts`**

Thay khối import ở đầu `src/core/fill.ts` bằng:

```ts
import { nextFrame, sleep, waitFor } from './wait'
import { readFieldValue, setFieldValue } from './dom'
import { mapCargo, mapHeader, type FieldPlan, type MappingContext } from './mapping'
import type { ManifestCargo, ManifestData } from './types'
```

Thêm các hàm sau (đặt sau `findButtonByText`):

```ts
/** Tìm phần tử chứa đúng tiêu đề section (phần tử sâu nhất). */
function findTitleElement(scope: ParentNode, title: string): HTMLElement | null {
  const needle = title.trim()
  const matches = Array.from(scope.querySelectorAll<HTMLElement>('*')).filter((el) => {
    const text = (el.textContent ?? '').trim()
    return text === needle || text.startsWith(needle)
  })
  if (matches.length === 0) return null
  return matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) ?? null
}

function findAddButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('button, .el-button')).filter((b) => {
    const text = (b.textContent ?? '').trim()
    return text === '新增' || text.endsWith('新增')
  })
}

/**
 * Tìm nút "新增" nằm trong section có tiêu đề `title` (ví dụ 货物信息).
 * Đi từ phần tử tiêu đề lên từng cấp cha; ở mỗi cấp lấy các nút 新增
 * chưa nằm trong section con sâu hơn đã chứa tiêu đề.
 */
export function findAddButtonBySectionTitle(
  scope: ParentNode,
  title: string,
): HTMLElement | null {
  const titleEl = findTitleElement(scope, title)
  if (!titleEl) return null

  let container: HTMLElement = titleEl
  let inner: HTMLElement | null = null

  for (let depth = 0; depth < 12; depth++) {
    const candidates = findAddButtons(container).filter((b) => !inner || !inner.contains(b))
    if (candidates.length > 0) return candidates[0]!
    inner = container
    const parent = container.parentElement
    if (!parent) break
    container = parent
  }

  return null
}

/** Tìm dialog có chứa field `prop` (dùng để phân biệt dialog hàng với dialog đầu). */
export function findDialogWithField(root: ParentNode, prop: string): HTMLElement | null {
  const dialogs = Array.from(root.querySelectorAll<HTMLElement>('.el-dialog'))
  for (let i = dialogs.length - 1; i >= 0; i--) {
    const dialog = dialogs[i]!
    if (dialog.querySelector(`input[id$="-${prop}"], textarea[id$="-${prop}"]`)) return dialog
  }
  return null
}
```

- [ ] **Step 5: Tách `fillHeader` thành `fillPlans` có tham số scope**

Thay thế hàm `fillHeader` trong `src/core/fill.ts` bằng:

```ts
export type FillScope = 'header' | 'cargo' | 'container'

export async function fillPlans(
  root: ParentNode,
  plans: FieldPlan[],
  scope: FillScope = 'header',
): Promise<{ items: FillItem[] }> {
  const items: FillItem[] = []

  for (const plan of plans) {
    if (plan.status === 'skip') {
      items.push({
        scope,
        prop: plan.prop,
        label: plan.label,
        status: 'skip',
        note: plan.note,
      })
      await nextFrame()
      continue
    }

    const result = await setFieldValue(root, plan.prop, plan.value ?? '')
    if (!result.ok) {
      items.push({
        scope,
        prop: plan.prop,
        label: plan.label,
        status: 'error',
        note: result.reason,
      })
      await nextFrame()
      continue
    }

    if (plan.verify) {
      const actual = readFieldValue(root, plan.verify.prop)
      if (!actual) {
        items.push({
          scope,
          prop: plan.prop,
          label: plan.label,
          status: 'ok',
          note: plan.verify.note,
        })
        await nextFrame()
        continue
      }
    }

    items.push({ scope, prop: plan.prop, label: plan.label, status: 'ok' })
    await nextFrame()
  }

  return { items }
}

export async function fillHeader(root: ParentNode, plans: FieldPlan[]) {
  return fillPlans(root, plans, 'header')
}
```

> `FillItem.scope` đã khai báo là `'header' | 'cargo' | 'container'` — giữ nguyên, khớp với `FillScope` mới.

- [ ] **Step 6: Thêm `fillCargoRows` vào `src/core/fill.ts`**

```ts
/** Thời gian chờ tối thiểu sau khi bấm 新增 của section hàng (site dùng setTimeout 400ms). */
const CARGO_DIALOG_DELAY_MS = 600

export async function fillCargoRows(
  scope: ParentNode,
  goodsList: ManifestCargo[],
  options: { log?: (message: string) => void } = {},
): Promise<{ items: FillItem[]; rows: number }> {
  const log = options.log ?? (() => {})
  const items: FillItem[] = []
  let rows = 0

  for (const [index, goods] of goodsList.entries()) {
    const label = `Hàng ${index + 1}/${goodsList.length}`

    const addButton = findAddButtonBySectionTitle(scope, '货物信息')
    if (!addButton) {
      items.push({
        scope: 'cargo',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'Không tìm thấy nút "新增" trong section 货物信息',
      })
      continue
    }

    addButton.click()
    await sleep(CARGO_DIALOG_DELAY_MS)

    const dialog = await waitFor(() => findDialogWithField(document, 'E_CARGO_NAM'), {
      timeout: 5000,
      interval: 100,
      label: `dialog hàng ${index + 1}`,
    }).catch(() => null)

    if (!dialog) {
      items.push({
        scope: 'cargo',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'Dialog hàng không mở trong 5 giây',
      })
      continue
    }

    log(`Đang điền ${label}…`)
    const filled = await fillPlans(dialog, mapCargo(goods), 'cargo')
    items.push(...filled.items)

    const confirm = findButtonByText('确定', dialog)
    if (confirm) {
      confirm.click()
      await sleep(CARGO_DIALOG_DELAY_MS)
    } else {
      items.push({
        scope: 'cargo',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'Không tìm thấy nút "确定" trong dialog hàng',
      })
    }

    rows += 1
  }

  return { items, rows }
}
```

- [ ] **Step 7: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: `tests/fill-cargo.test.ts` PASS, `tests/fill-header.test.ts` vẫn PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 9: Commit**

```bash
git add src/core/fill.ts tests/helpers/dom.ts tests/fill-cargo.test.ts
git commit -m "feat: fill cargo rows through the goods dialog"
```

---

## Task 11: `fill.ts` + `table.ts` — điền dòng container (TDD)

**Files:**
- Create: `src/core/table.ts`
- Modify: `src/core/fill.ts`
- Modify: `tests/helpers/dom.ts`
- Create: `tests/fill-container.test.ts`

- [ ] **Step 1: Bổ sung DOM test cho bảng container — thêm vào `tests/helpers/dom.ts`**

```ts
/** Bảng container inline editable + section 箱信息. */
export function buildContainerSection(): void {
  const header = CONTAINER_COLUMNS.map((c) => `<th>${c}</th>`).join('')
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="ContainerInformation">
      <div class="fs-crud-title">箱信息</div>
      <button class="el-button" id="add-container">新增</button>
      <div class="el-table">
        <div class="el-table__header-wrapper">
          <div class="el-table__header">
            <table><thead><tr>${header}</tr></thead></table>
          </div>
        </div>
        <div class="el-table__body-wrapper">
          <div class="el-table__body">
            <table><tbody></tbody></table>
          </div>
        </div>
      </div>
    </div>`,
  )
}

/** Gắn sự kiện giả lập fast-crud: bấm 新增 → thêm một dòng trống vào tbody. */
export function simulateAddRow(buttonSelector = '#add-container'): void {
  const button = document.querySelector(buttonSelector) as HTMLElement
  button.addEventListener('click', () => {
    const tbody = document.querySelector('.el-table__body tbody')!
    const tr = document.createElement('tr')
    tr.innerHTML = CONTAINER_COLUMNS.map(() => '<td><input /></td>').join('')
    tbody.appendChild(tr)
  })
}
```

- [ ] **Step 2: Viết test fail trước — `tests/fill-container.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { fillContainerRows } from '../src/core/fill'
import { readTableHandles, findColumnIndex } from '../src/core/table'
import { mapContainer, type MappingContext } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'
import { buildContainerSection, simulateAddRow, CONTAINER_COLUMNS } from './helpers/dom'

const data = fixture.data as unknown as ManifestData
const container = data.cdCon![0]!

const ctx: MappingContext = {
  findTrustCode: () => undefined,
  findDrType: () => undefined,
  findPort: () => undefined,
  findCntrType: (raw) => (String(raw) === '2' ? '20GP' : undefined),
  findCntrSize: (raw) => (String(raw) === '0' ? "20'" : undefined),
  portNameField: 'name',
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('readTableHandles / findColumnIndex', () => {
  it('đọc được 9 cột header', () => {
    buildContainerSection()
    const table = document.querySelector('.el-table') as HTMLElement
    const handles = readTableHandles(table)
    expect(handles.headerCells).toHaveLength(9)
  })

  it('tìm đúng index của cột 箱号', () => {
    buildContainerSection()
    const table = document.querySelector('.el-table') as HTMLElement
    const handles = readTableHandles(table)
    expect(findColumnIndex(handles.headerCells, '箱号')).toBe(0)
    expect(findColumnIndex(handles.headerCells, '铅封号')).toBe(CONTAINER_COLUMNS.indexOf('铅封号'))
  })
})

describe('fillContainerRows', () => {
  it('thêm dòng và điền các ô trong bảng', async () => {
    buildContainerSection()
    simulateAddRow()

    const result = await fillContainerRows(document, [container], ctx)

    expect(result.rows).toBe(1)
    const tbody = document.querySelector('.el-table__body tbody')!
    const cells = tbody.querySelectorAll('td')
    expect((cells[0]!.querySelector('input') as HTMLInputElement).value).toBe('ONEU1437898')
    expect((cells[4]!.querySelector('input') as HTMLInputElement).value).toBe('CN28731BH')
  })

  it('báo lỗi khi không thấy bảng container', async () => {
    document.body.innerHTML = '<div></div>'
    const result = await fillContainerRows(document, [container], ctx)
    expect(result.rows).toBe(0)
    expect(result.items.some((i) => i.status === 'error')).toBe(true)
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/core/table"`.

- [ ] **Step 4: Tạo `src/core/table.ts`**

```ts
import { setTextValue } from './dom'
import { pickFromPopper, pickFromSelect } from './select'

export interface TableHandles {
  table: HTMLElement
  headerCells: HTMLElement[]
  bodyRows: HTMLElement[]
}

/** Đọc cấu trúc bảng (hỗ trợ cả `<table>` thật lẫn `el-table` của Element Plus). */
export function readTableHandles(table: HTMLElement): TableHandles {
  const headerCells = Array.from(
    table.querySelectorAll<HTMLElement>('thead th, .el-table__header th'),
  )
  const bodyRows = Array.from(
    table.querySelectorAll<HTMLElement>('tbody tr, .el-table__row'),
  ).filter((row) => !row.closest('thead'))
  return { table, headerCells, bodyRows }
}

/** Tìm chỉ số cột theo nhãn tiếng Trung; ưu tiên khớp chính xác. */
export function findColumnIndex(headerCells: HTMLElement[], columnLabel: string): number {
  const needle = columnLabel.trim()
  const exact = headerCells.findIndex((th) => (th.textContent ?? '').trim() === needle)
  if (exact >= 0) return exact
  return headerCells.findIndex((th) => (th.textContent ?? '').trim().includes(needle))
}

/** Lấy ô tương ứng với chỉ số cột trong một dòng. */
export function getCell(row: HTMLElement, columnIndex: number): HTMLElement | null {
  const cells = Array.from(row.querySelectorAll<HTMLElement>('td, th'))
  return cells[columnIndex] ?? null
}

/** Đặt giá trị cho một ô trong bảng inline editable. */
export async function setCellValue(
  cell: HTMLElement,
  value: string,
  timeout = 5000,
): Promise<{ ok: boolean; reason?: string }> {
  const input = cell.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  if (!input) return { ok: false, reason: 'Ô bảng không có input' }

  if (cell.querySelector('.el-select')) {
    const result = await pickFromSelect(cell, value, timeout)
    return { ok: result.ok, reason: result.reason }
  }

  if (input.readOnly) {
    const result = await pickFromPopper(cell, value, timeout)
    return { ok: result.ok, reason: result.reason }
  }

  setTextValue(input, value)
  return { ok: true }
}
```

- [ ] **Step 5: Thêm `fillContainerRows` vào `src/core/fill.ts`**

Thêm import:

```ts
import { findColumnIndex, getCell, readTableHandles, setCellValue } from './table'
```

Thay khối import của `mapping` ở đầu `src/core/fill.ts` bằng:

```ts
import { mapCargo, mapContainer, mapHeader, type FieldPlan, type MappingContext } from './mapping'
```

Thay khối import của `types` ở đầu `src/core/fill.ts` bằng:

```ts
import type { ManifestCargo, ManifestContainer, ManifestData } from './types'
```

Thêm hàm:

```ts
const CONTAINER_SECTION_TITLES = ['箱信息', '集装箱信息', '集装箱']

/** Tìm bảng container trong scope (ưu tiên bảng nằm trong section container). */
function findContainerTable(scope: ParentNode): HTMLElement | null {
  const tables = Array.from(scope.querySelectorAll<HTMLElement>('.el-table, table'))
  for (const title of CONTAINER_SECTION_TITLES) {
    const titleEl = findTitleElement(scope, title)
    if (!titleEl) continue
    let node: HTMLElement | null = titleEl
    for (let depth = 0; depth < 12 && node; depth++) {
      const table = node.querySelector<HTMLElement>('.el-table, table')
      if (table) return table
      node = node.parentElement
    }
  }
  return tables[0] ?? null
}

export async function fillContainerRows(
  scope: ParentNode,
  containers: ManifestContainer[],
  ctx: MappingContext,
  options: { log?: (message: string) => void } = {},
): Promise<{ items: FillItem[]; rows: number }> {
  const log = options.log ?? (() => {})
  const items: FillItem[] = []
  let rows = 0

  const table = findContainerTable(scope)
  if (!table) {
    items.push({
      scope: 'container',
      prop: 'TABLE',
      label: '集装箱表',
      status: 'error',
      note: 'Không tìm thấy bảng container (.el-table)',
    })
    return { items, rows }
  }

  const addButton =
    CONTAINER_SECTION_TITLES.map((title) => findAddButtonBySectionTitle(scope, title)).find(
      (button) => button !== null,
    ) ?? null

  const handles = readTableHandles(table)

  for (const [index, container] of containers.entries()) {
    const label = `Container ${index + 1}/${containers.length}`
    const plans = mapContainer(container, ctx)

    if (!addButton) {
      items.push({
        scope: 'container',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'Không tìm thấy nút thêm dòng của bảng container',
      })
      continue
    }

    const before = readTableHandles(table).bodyRows.length
    addButton.click()

    const grown = await waitFor(
      () => readTableHandles(table).bodyRows.length > before,
      { timeout: 5000, interval: 100, label: `dòng container ${index + 1}` },
    ).catch(() => false)

    if (!grown) {
      items.push({
        scope: 'container',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'Bảng container không thêm được dòng trong 5 giây',
      })
      continue
    }

    const rowsNow = readTableHandles(table).bodyRows
    const row = rowsNow[rowsNow.length - 1]!
    log(`Đang điền ${label}…`)

    for (const plan of plans) {
      if (plan.status === 'skip') {
        items.push({
          scope: 'container',
          prop: plan.prop,
          label: plan.label,
          status: 'skip',
          note: plan.note,
        })
        continue
      }

      const columnLabel = plan.columnLabel ?? plan.label
      const columnIndex = findColumnIndex(handles.headerCells, columnLabel)
      if (columnIndex < 0) {
        items.push({
          scope: 'container',
          prop: plan.prop,
          label: plan.label,
          status: 'error',
          note: `Không tìm thấy cột "${columnLabel}" trong bảng`,
        })
        continue
      }

      const cell = getCell(row, columnIndex)
      if (!cell) {
        items.push({
          scope: 'container',
          prop: plan.prop,
          label: plan.label,
          status: 'error',
          note: `Không tìm thấy ô của cột "${columnLabel}"`,
        })
        continue
      }

      const result = await setCellValue(cell, plan.value ?? '')
      items.push({
        scope: 'container',
        prop: plan.prop,
        label: plan.label,
        status: result.ok ? 'ok' : 'error',
        note: result.reason,
      })
      await nextFrame()
    }

    rows += 1
  }

  return { items, rows }
}
```

- [ ] **Step 6: Nối `fillManifest` — gọi cả cargo và container**

Thay thế hàm `fillManifest` trong `src/core/fill.ts` bằng:

```ts
export async function fillManifest(options: FillOptions): Promise<FillReport> {
  const { root, data, ctx } = options
  const log = options.log ?? (() => {})

  const addButton = findButtonByText('新增舱单信息', root)
  if (!addButton) {
    return {
      items: [],
      cargoRows: 0,
      containerRows: 0,
      ok: false,
      message:
        'Không thấy nút "新增舱单信息" — hãy mở trang 预配舱单申报平台 và chọn tab 待发送.',
    }
  }

  addButton.click()

  const dialog = await waitFor(() => root.querySelector<HTMLElement>('.el-dialog'), {
    timeout: 5000,
    interval: 100,
    label: 'dialog 新增舱单信息',
  }).catch(() => null)

  if (!dialog) {
    return {
      items: [],
      cargoRows: 0,
      containerRows: 0,
      ok: false,
      message: 'Dialog "新增舱单信息" không mở trong 5 giây.',
    }
  }

  log('Đang điền thông tin舱单…')
  const header = await fillPlans(dialog, mapHeader(data, ctx), 'header')

  const cargo = await fillCargoRows(dialog, data.cdgoods ?? [], { log })
  const container = await fillContainerRows(dialog, data.cdCon ?? [], ctx, { log })

  if (options.autoSubmit) {
    const confirm = findButtonByText('确定', dialog)
    if (confirm) {
      log('Đang bấm 确定 ở form đầu…')
      confirm.click()
      await sleep(800)
    }
  }

  return {
    items: [...header.items, ...cargo.items, ...container.items],
    cargoRows: cargo.rows,
    containerRows: container.rows,
    ok: true,
  }
}
```

- [ ] **Step 7: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: tất cả PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 9: Commit**

```bash
git add src/core/table.ts src/core/fill.ts tests/helpers/dom.ts tests/fill-container.test.ts
git commit -m "feat: fill container rows in the inline editable table"
```

---

## Task 12: `site-api.ts` — tra dict của chính site (TDD)

**Files:**
- Create: `src/core/site-api.ts`
- Create: `tests/site-api.test.ts`

> API của site trả về các shape khác nhau (`[{code,name}]`, `{value,label}`, `{data:[…]}`,
> `{cntr_type:[…],cntr_size:[…]}`) — normalizer dưới đây chấp nhận tất cả các biến thể.
> Shape thật sẽ được xác nhận ở Task 16 (bước kiểm thử thủ công).

- [ ] **Step 1: Viết test fail trước — `tests/site-api.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  normalizeDictOptions,
  pickArray,
  createMappingContext,
  readCookieToken,
  loadSiteDicts,
  DEFAULT_SITE_API_BASE,
} from '../src/core/site-api'

describe('normalizeDictOptions', () => {
  it('đọc mảng {code, name}', () => {
    const options = normalizeDictOptions([{ code: 'MAEU', name: '马士基' }])
    expect(options[0]).toMatchObject({ code: 'MAEU', name: '马士基' })
  })

  it('đọc mảng {value, label}', () => {
    const options = normalizeDictOptions([{ value: 'FOB', label: 'FOB' }])
    expect(options[0]).toMatchObject({ code: 'FOB', name: 'FOB' })
  })

  it('bọc payload {data: [...]}', () => {
    const options = normalizeDictOptions({ data: [{ code: 'CNSHA', name: '上海' }] })
    expect(options[0]).toMatchObject({ code: 'CNSHA', name: '上海' })
  })

  it('giữ nameEn khi có', () => {
    const options = normalizeDictOptions([{ code: 'CNSHA', name: '上海', nameEn: 'Shanghai' }])
    expect(options[0]?.nameEn).toBe('Shanghai')
  })

  it('bỏ qua phần tử không có mã', () => {
    expect(normalizeDictOptions([{ note: 'x' }])).toHaveLength(0)
  })
})

describe('pickArray', () => {
  it('lấy mảng lồng theo key', () => {
    const payload = { cntr_type: [{ code: '2', name: '20GP' }], cntr_size: [] }
    expect(pickArray(payload, ['cntr_type', 'cntrType'])).toHaveLength(1)
  })

  it('lấy mảng data khi không có key yêu cầu', () => {
    expect(pickArray({ data: [1, 2] }, ['cntr_type'])).toHaveLength(2)
  })
})

describe('readCookieToken', () => {
  it('đọc cookie token', () => {
    expect(readCookieToken('a=1; token=abc.def; b=2')).toBe('abc.def')
  })

  it('trả undefined khi không có', () => {
    expect(readCookieToken('a=1')).toBeUndefined()
  })
})

describe('createMappingContext', () => {
  const dicts = {
    trustCodes: normalizeDictOptions([{ id: 2, code: 'MAEU', name: '马士基' }]),
    drTypes: normalizeDictOptions([{ code: '1', name: 'FOB' }]),
    ports: normalizeDictOptions([{ code: 'CNSHA', name: '上海', nameEn: 'Shanghai' }]),
    cntrTypes: normalizeDictOptions([{ id: 2, code: '20GP', name: '20GP' }]),
    cntrSizes: normalizeDictOptions([{ id: 0, code: "20'", name: "20'" }]),
    packageCodes: normalizeDictOptions([{ code: 'PACKAGES', name: 'PACKAGES' }]),
  }

  it('tìm 承运人 theo supplyId', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findTrustCode(2)).toBe('MAEU')
  })

  it('tìm 交货条款 theo mã', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findDrType('1')).toBe('FOB')
  })

  it('tìm cảng theo mã', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findPort('CNSHA')).toEqual({ label: '上海', value: 'CNSHA' })
  })

  it('dùng nameEn khi cấu hình portNameField = nameEn', () => {
    const ctx = createMappingContext(dicts, 'nameEn')
    expect(ctx.findPort('CNSHA')?.label).toBe('Shanghai')
  })

  it('tìm 箱型 và 尺寸 theo mã số', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findCntrType(2)).toBe('20GP')
    expect(ctx.findCntrSize(0)).toBe("20'")
  })

  it('trả undefined khi không tìm thấy', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findPort('ZZZZZ')).toBeUndefined()
  })
})

describe('loadSiteDicts', () => {
  it('gọi đúng 5 endpoint và gom dict', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      const body = url.includes('getTrustCode')
        ? [{ id: 2, code: 'MAEU', name: '马士基' }]
        : url.includes('getDrType')
          ? [{ code: '1', name: 'FOB' }]
          : url.includes('getPort')
            ? [{ code: 'CNSHA', name: '上海' }]
            : url.includes('getCntrCode')
              ? {
                  cntr_type: [{ id: 2, code: '20GP', name: '20GP' }],
                  cntr_size: [{ id: 0, code: "20'", name: "20'" }],
                }
              : [{ code: 'PACKAGES', name: 'PACKAGES' }]
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    }) as unknown as typeof fetch

    const dicts = await loadSiteDicts({
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })

    expect(calls).toHaveLength(5)
    expect(calls).toContain('/api/test/getTrustCode/')
    expect(calls).toContain('/api/test/getCntrCode/')
    expect(dicts.trustCodes[0]?.code).toBe('MAEU')
    expect(dicts.drTypes[0]?.name).toBe('FOB')
    expect(dicts.ports[0]?.name).toBe('上海')
    expect(dicts.cntrTypes[0]?.name).toBe('20GP')
    expect(dicts.cntrSizes[0]?.name).toBe("20'")
  })
})

describe('DEFAULT_SITE_API_BASE', () => {
  it('trỏ đúng base của site', () => {
    expect(DEFAULT_SITE_API_BASE).toBe('/api/booking/exportManifestDataMaintain')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/core/site-api"`.

- [ ] **Step 3: Tạo `src/core/site-api.ts`**

```ts
import type { MappingContext } from './mapping'

export const DEFAULT_SITE_API_BASE = '/api/booking/exportManifestDataMaintain'

export interface DictOption {
  /** mã dùng để đối chiếu (UN/LOCODE, mã cảng, mã 箱型…) */
  code: string
  /** nhãn hiển thị trong dropdown của site */
  name: string
  nameEn?: string
  /** id trong DB của site (dùng cho 承运人 / 箱型 / 尺寸) */
  id?: string
  /** bản gốc, để đối chiếu theo key khác nếu cần */
  raw: Record<string, unknown>
}

const CODE_KEYS = ['code', 'unCode', 'portCode', 'value', 'key', 'dictCode', 'itemCode']
const NAME_KEYS = ['name', 'label', 'text', 'dictName', 'itemName', 'cnName', 'portName']
const NAME_EN_KEYS = ['nameEn', 'enName', 'englishName', 'portNameEn']

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

/** Tìm mảng đầu tiên trong payload (hỗ trợ `{data:[…]}`, `{list:[…]}`, …). */
export function asArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (typeof payload !== 'object' || payload === null) return []

  const source = payload as Record<string, unknown>
  for (const key of ['data', 'list', 'rows', 'records', 'result', 'items']) {
    const value = source[key]
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') {
      const nested = asArray(value)
      if (nested.length > 0) return nested
    }
  }
  return []
}

/** Lấy mảng theo key cụ thể; nếu không có thì lùi về `asArray`. */
export function pickArray(payload: unknown, keys: string[]): unknown[] {
  if (typeof payload === 'object' && payload !== null) {
    const source = payload as Record<string, unknown>
    for (const key of keys) {
      if (Array.isArray(source[key])) return source[key] as unknown[]
    }
    for (const key of keys) {
      const value = source[key]
      if (value && typeof value === 'object') {
        const nested = asArray(value)
        if (nested.length > 0) return nested
      }
    }
  }
  return asArray(payload)
}

export function normalizeDictOptions(payload: unknown): DictOption[] {
  const result: DictOption[] = []

  for (const entry of asArray(payload)) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>

    const code =
      pickString(raw, CODE_KEYS) ?? pickString(raw, ['id'])
    if (code === undefined) continue

    const name = pickString(raw, NAME_KEYS) ?? code
    const nameEn = pickString(raw, NAME_EN_KEYS)
    const id = pickString(raw, ['id'])

    result.push({ code, name, nameEn, id, raw })
  }

  return result
}

export interface SiteDicts {
  trustCodes: DictOption[]
  drTypes: DictOption[]
  ports: DictOption[]
  cntrTypes: DictOption[]
  cntrSizes: DictOption[]
  packageCodes: DictOption[]
}

/** Đọc cookie `token` của site (JWT gửi qua header `Authorization: JWT <token>`). */
export function readCookieToken(cookieString: string): string | undefined {
  for (const part of cookieString.split(';')) {
    const [name, ...rest] = part.split('=')
    if (name?.trim() === 'token') {
      const value = rest.join('=').trim()
      return value === '' ? undefined : value
    }
  }
  return undefined
}

export interface SiteFetchOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  cookieString?: string
}

async function fetchSiteJson(
  path: string,
  options: SiteFetchOptions = {},
): Promise<unknown> {
  const base = options.baseUrl ?? DEFAULT_SITE_API_BASE
  const doFetch = options.fetchImpl ?? fetch
  const token = readCookieToken(options.cookieString ?? document.cookie)

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `JWT ${token}`

  const res = await doFetch(`${base}/${path}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    throw new Error(`Site API ${path} trả HTTP ${res.status}`)
  }
  return res.json()
}

export async function loadSiteDicts(
  options: SiteFetchOptions = {},
): Promise<SiteDicts> {
  const [trustRaw, drRaw, portRaw, cntrRaw, packageRaw] = await Promise.all([
    fetchSiteJson('getTrustCode/', options),
    fetchSiteJson('getDrType/', options),
    fetchSiteJson('getPort/', options),
    fetchSiteJson('getCntrCode/', options),
    fetchSiteJson('getPackageCode/', options),
  ])

  return {
    trustCodes: normalizeDictOptions(trustRaw),
    drTypes: normalizeDictOptions(drRaw),
    ports: normalizeDictOptions(portRaw),
    cntrTypes: normalizeDictOptions(pickArray(cntrRaw, ['cntr_type', 'cntrType', 'type'])),
    cntrSizes: normalizeDictOptions(pickArray(cntrRaw, ['cntr_size', 'cntrSize', 'size'])),
    packageCodes: normalizeDictOptions(packageRaw),
  }
}

export function createMappingContext(
  dicts: SiteDicts,
  portNameField: 'name' | 'nameEn' = 'name',
): MappingContext {
  return {
    findTrustCode(supplyId) {
      if (supplyId === undefined) return undefined
      const hit = dicts.trustCodes.find(
        (o) => o.id === String(supplyId) || o.code === String(supplyId),
      )
      return hit?.code
    },

    findDrType(code) {
      if (!code) return undefined
      const hit = dicts.drTypes.find((o) => o.code === code || o.id === code)
      return hit?.name
    },

    findPort(code) {
      if (!code) return undefined
      const hit = dicts.ports.find(
        (o) =>
          o.code === code ||
          o.id === code ||
          pickString(o.raw, ['unCode', 'portCode', 'code']) === code,
      )
      if (!hit) return undefined
      const label = portNameField === 'nameEn' ? (hit.nameEn ?? hit.name) : hit.name
      return { label, value: hit.code }
    },

    findCntrType(raw) {
      if (raw === undefined || raw === null) return undefined
      const key = String(raw)
      const hit = dicts.cntrTypes.find((o) => o.id === key || o.code === key)
      return hit?.name
    },

    findCntrSize(raw) {
      if (raw === undefined || raw === null) return undefined
      const key = String(raw)
      const hit = dicts.cntrSizes.find((o) => o.id === key || o.code === key)
      return hit?.name
    },

    portNameField,
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: `tests/site-api.test.ts` PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/core/site-api.ts tests/site-api.test.ts
git commit -m "feat: load site dictionaries and build the mapping context"
```

---

## Task 13: `protocol.ts` + `options.ts` + content script (TDD)

**Files:**
- Create: `src/core/protocol.ts`
- Create: `src/core/options.ts`
- Modify: `src/content/index.ts`
- Create: `tests/options.test.ts`

- [ ] **Step 1: Tạo `src/core/protocol.ts`**

```ts
export const MSG_FILL = 'manifest-autofill:fill'
export const MSG_PING = 'manifest-autofill:ping'
export const MSG_GET_BL_NO = 'manifest-autofill:get-bl-no'

export type FillScope = 'header' | 'cargo' | 'container'
export type ReportStatus = 'ok' | 'skip' | 'error'

export interface ReportItem {
  scope: FillScope
  prop: string
  label: string
  status: ReportStatus
  note?: string
}

export interface FillRequest {
  type: typeof MSG_FILL
  blNo: string
  autoSubmit?: boolean
  apiBase?: string
  portNameField?: 'name' | 'nameEn'
}

export interface FillResult {
  ok: boolean
  message?: string
  items: ReportItem[]
  cargoRows: number
  containerRows: number
}

export interface GetBlNoResult {
  ok: boolean
  blNo?: string
}
```

- [ ] **Step 2: Tạo `src/core/options.ts`**

```ts
import { DEFAULT_API_BASE } from './api'

export interface ExtensionSettings {
  /** endpoint lấy dữ liệu manifest từ dadaex */
  apiBase: string
  /** base path của API dict của chính site */
  siteApiBase: string
  /** hiển thị tên cảng bằng tiếng Trung (name) hay tiếng Anh (nameEn) */
  portNameField: 'name' | 'nameEn'
  /** có tự bấm 确定 ở form đầu sau khi điền xong hay không */
  autoSubmit: boolean
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBase: DEFAULT_API_BASE,
  siteApiBase: '/api/booking/exportManifestDataMaintain',
  portNameField: 'name',
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
```

- [ ] **Step 3: Viết test fail trước — `tests/options.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readSettings, writeSettings, DEFAULT_SETTINGS } from '../src/core/options'

const store: Record<string, unknown> = {}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...store }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values)
        },
      },
    },
  })
})

describe('readSettings', () => {
  it('trả về mặc định khi chưa lưu gì', async () => {
    const settings = await readSettings()
    expect(settings.apiBase).toBe(DEFAULT_SETTINGS.apiBase)
    expect(settings.autoSubmit).toBe(false)
  })
})

describe('writeSettings', () => {
  it('lưu và đọc lại được', async () => {
    await writeSettings({ portNameField: 'nameEn' })
    const settings = await readSettings()
    expect(settings.portNameField).toBe('nameEn')
  })

  it('không ghi đè các setting khác', async () => {
    await writeSettings({ autoSubmit: true })
    await writeSettings({ portNameField: 'nameEn' })
    const settings = await readSettings()
    expect(settings.autoSubmit).toBe(true)
    expect(settings.portNameField).toBe('nameEn')
  })
})
```

- [ ] **Step 4: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/core/options"`.

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: `tests/options.test.ts` PASS.

- [ ] **Step 6: Viết `src/content/index.ts`**

Ghi đè toàn bộ file:

```ts
import { fetchManifest, ManifestApiError, normalizeBlNo } from '../core/api'
import { fillManifest } from '../core/fill'
import { readSettings } from '../core/options'
import {
  MSG_FILL,
  MSG_GET_BL_NO,
  MSG_PING,
  type FillRequest,
  type FillResult,
  type GetBlNoResult,
} from '../core/protocol'
import { createMappingContext, loadSiteDicts } from '../core/site-api'
import type { MappingContext } from '../core/mapping'
import type { ManifestData } from '../core/types'

const MANIFEST_HASH = '/exportBusinessOperations/maintenanceOfManifestData'

function isManifestPage(): boolean {
  return location.hash.includes(MANIFEST_HASH)
}

/** Đọc 提单号 đang hiển thị trên trang (dùng để lấy sẵn cho ô nhập ở popup). */
function readBlNoFromPage(): string {
  const input = document.querySelector<HTMLInputElement>('input[id$="-BILL_NBR"]')
  return input?.value?.trim() ?? ''
}

function emptyResult(message: string): FillResult {
  return { ok: false, message, items: [], cargoRows: 0, containerRows: 0 }
}

async function handleFill(request: FillRequest): Promise<FillResult> {
  if (!isManifestPage()) {
    return emptyResult(
      'Hãy mở trang 预配舱单申报平台 (#/exportBusinessOperations/maintenanceOfManifestData) rồi thử lại.',
    )
  }

  const settings = await readSettings()
  const apiBase = request.apiBase ?? settings.apiBase
  const blNo = normalizeBlNo(request.blNo ?? '')

  if (!blNo) return emptyResult('Thiếu 提单号.')

  let data: ManifestData
  try {
    data = await fetchManifest(blNo, { baseUrl: apiBase })
  } catch (e) {
    if (e instanceof ManifestApiError && e.kind === 'not_found') {
      return emptyResult(
        `Không tìm thấy manifest cho blNo ${blNo} (đã thử cả dạng có/không hậu tố P).`,
      )
    }
    return emptyResult(`Lỗi gọi API: ${(e as Error).message}`)
  }

  let ctx: MappingContext
  try {
    const dicts = await loadSiteDicts({ baseUrl: settings.siteApiBase })
    ctx = createMappingContext(dicts, request.portNameField ?? settings.portNameField)
  } catch (e) {
    return emptyResult(`Không đọc được dict của site: ${(e as Error).message}`)
  }

  const report = await fillManifest({
    root: document,
    data,
    ctx,
    autoSubmit: request.autoSubmit ?? settings.autoSubmit,
    log: (message) => console.debug('[manifest-autofill]', message),
  })

  return {
    ok: report.ok,
    message: report.message,
    items: report.items,
    cargoRows: report.cargoRows,
    containerRows: report.containerRows,
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: string } | undefined)?.type

  if (type === MSG_PING) {
    const result: GetBlNoResult = { ok: true, blNo: readBlNoFromPage() }
    sendResponse(result)
    return false
  }

  if (type === MSG_GET_BL_NO) {
    const result: GetBlNoResult = { ok: true, blNo: readBlNoFromPage() }
    sendResponse(result)
    return false
  }

  if (type === MSG_FILL) {
    void handleFill(message as FillRequest)
      .then(sendResponse)
      .catch((e: unknown) => sendResponse(emptyResult(`Lỗi không lường trước: ${String(e)}`)))
    return true
  }

  return false
})

console.debug('[manifest-autofill] content script ready')
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 8: Commit**

```bash
git add src/core/protocol.ts src/core/options.ts src/content/index.ts tests/options.test.ts
git commit -m "feat: wire the content script to the manifest API and site dictionaries"
```

---

## Task 14: Popup — giao diện nhập 提单号 + báo cáo

**Files:**
- Modify: `src/popup/App.vue`
- Create: `src/popup/styles.css`

- [ ] **Step 1: Tạo `src/popup/styles.css`**

```css
:root {
  color-scheme: light;
}

body {
  margin: 0;
  font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #1f2328;
  background: #fff;
}

.popup {
  width: 360px;
  padding: 12px;
  box-sizing: border-box;
}

.row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.row + .row {
  margin-top: 8px;
}

input[type='text'] {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font: inherit;
}

button {
  padding: 6px 10px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #f6f8fa;
  font: inherit;
  cursor: pointer;
}

button.primary {
  background: #1f883d;
  border-color: #1f883d;
  color: #fff;
}

button:disabled {
  opacity: 0.6;
  cursor: progress;
}

.error {
  margin-top: 8px;
  padding: 8px;
  border-radius: 6px;
  background: #ffebe9;
  color: #82071e;
  white-space: pre-wrap;
}

.summary {
  margin-top: 8px;
  color: #57606a;
}

table {
  width: 100%;
  margin-top: 8px;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  padding: 4px 6px;
  border-bottom: 1px solid #eaeef2;
  text-align: left;
  vertical-align: top;
}

td.note {
  color: #57606a;
  max-width: 150px;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 2: Ghi đè `src/popup/App.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { readSettings, writeSettings } from '../core/options'
import {
  MSG_FILL,
  MSG_GET_BL_NO,
  type FillResult,
  type GetBlNoResult,
  type ReportItem,
} from '../core/protocol'
import './styles.css'

const MANIFEST_URL =
  'https://www.chinaports-agency.com:8870/#/exportBusinessOperations/maintenanceOfManifestData'

const blNo = ref('')
const autoSubmit = ref(false)
const busy = ref(false)
const error = ref('')
const result = ref<FillResult | null>(null)

const items = computed<ReportItem[]>(() => result.value?.items ?? [])

const counts = computed(() => {
  const acc = { ok: 0, skip: 0, error: 0 }
  for (const item of items.value) acc[item.status] += 1
  return acc
})

function icon(item: ReportItem): string {
  if (item.status === 'ok') return '✅'
  if (item.status === 'error') return '❌'
  return item.note ? '⚠️' : '⏭'
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

async function takeBlNoFromPage(): Promise<void> {
  error.value = ''
  try {
    const tabId = await activeTabId()
    if (tabId === undefined) throw new Error('no active tab')
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: MSG_GET_BL_NO,
    })) as GetBlNoResult
    if (res?.blNo) {
      blNo.value = res.blNo
    } else {
      error.value = 'No bill of lading number found on the current page.'
    }
  } catch {
    error.value = 'Open the manifest declaration page and try again.'
  }
}

async function runFill(): Promise<void> {
  error.value = ''
  result.value = null
  const value = blNo.value.trim()
  if (!value) {
    error.value = 'Enter a bill of lading number first.'
    return
  }

  busy.value = true
  try {
    const tabId = await activeTabId()
    if (tabId === undefined) throw new Error('no active tab')
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: MSG_FILL,
      blNo: value,
      autoSubmit: autoSubmit.value,
    })) as FillResult
    result.value = res
    if (!res?.ok) error.value = res?.message ?? 'Could not fill the manifest data.'
  } catch {
    error.value =
      'Could not reach the page. Open the manifest declaration page and try again.'
  } finally {
    busy.value = false
  }
}

async function openPage(): Promise<void> {
  await chrome.tabs.create({ url: MANIFEST_URL })
}

async function onToggleAutoSubmit(): Promise<void> {
  await writeSettings({ autoSubmit: autoSubmit.value })
}

onMounted(async () => {
  const settings = await readSettings()
  autoSubmit.value = settings.autoSubmit
})
</script>

<template>
  <div class="popup">
    <div class="row">
      <input
        v-model="blNo"
        type="text"
        placeholder="Bill of lading number (提单号)"
        @keyup.enter="runFill"
      />
      <button type="button" title="Read the bill of lading number entered on the page" @click="takeBlNoFromPage">
        Read from page
      </button>
    </div>

    <div class="row">
      <button type="button" class="primary" :disabled="busy" @click="runFill">
        {{ busy ? 'Filling…' : 'Fill data' }}
      </button>
      <button type="button" @click="openPage">Open page</button>
      <label>
        <input v-model="autoSubmit" type="checkbox" @change="onToggleAutoSubmit" />
        Auto-click 确定
      </label>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="result" class="summary">
      ✅ {{ counts.ok }} · ⚠️ {{ counts.skip }} · ❌ {{ counts.error }} · cargo:
      {{ result.cargoRows }} · containers: {{ result.containerRows }}
    </div>

    <table v-if="items.length">
      <thead>
        <tr>
          <th></th>
          <th>Field</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="`${item.scope}-${item.prop}`">
          <td>{{ icon(item) }}</td>
          <td>{{ item.label }}</td>
          <td class="note">{{ item.note ?? '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build thành công.

- [ ] **Step 5: Commit**

```bash
git add src/popup/App.vue src/popup/styles.css
git commit -m "feat: add popup UI for blNo input and fill report"
```

---

## Task 15: Options — cấu hình API base + tên cảng + tự submit

**Files:**
- Modify: `src/options/App.vue`
- Create: `src/options/styles.css`

- [ ] **Step 1: Tạo `src/options/styles.css`**

```css
body {
  margin: 0;
  font: 14px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #1f2328;
  background: #fff;
}

.options {
  max-width: 640px;
  padding: 24px;
}

label {
  display: block;
  margin: 14px 0 4px;
  font-weight: 600;
}

input[type='text'],
select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font: inherit;
  box-sizing: border-box;
}

.hint {
  margin: 4px 0 0;
  color: #57606a;
  font-size: 12px;
}

.status {
  margin-top: 16px;
  color: #1f883d;
}

button {
  padding: 6px 12px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #f6f8fa;
  font: inherit;
  cursor: pointer;
}

button.primary {
  background: #1f883d;
  border-color: #1f883d;
  color: #fff;
}
```

- [ ] **Step 2: Ghi đè `src/options/App.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { readSettings, writeSettings, type ExtensionSettings } from '../core/options'
import './styles.css'

const apiBase = ref('')
const siteApiBase = ref('')
const portNameField = ref<'name' | 'nameEn'>('name')
const autoSubmit = ref(false)
const saved = ref(false)

async function load(): Promise<void> {
  const settings: ExtensionSettings = await readSettings()
  apiBase.value = settings.apiBase
  siteApiBase.value = settings.siteApiBase
  portNameField.value = settings.portNameField
  autoSubmit.value = settings.autoSubmit
}

async function save(): Promise<void> {
  await writeSettings({
    apiBase: apiBase.value.trim(),
    siteApiBase: siteApiBase.value.trim(),
    portNameField: portNameField.value,
    autoSubmit: autoSubmit.value,
  })
  saved.value = true
  setTimeout(() => {
    saved.value = false
  }, 2000)
}

onMounted(load)
</script>

<template>
  <div class="options">
    <h1>Manifest Autofill — Options</h1>

    <label for="api-base">Manifest data API</label>
    <input id="api-base" v-model="apiBase" type="text" />
    <p class="hint">
      The dadaex endpoint. The bill of lading number is appended as the <code>?blNo=</code> query
      string; a trailing piece suffix such as <code>P1</code> is stripped automatically.
    </p>

    <label for="site-api-base">Site dictionary API</label>
    <input id="site-api-base" v-model="siteApiBase" type="text" />
    <p class="hint">
      Used to fetch the 承运人代码, 交货条款, port, container type and size lists. Leave blank to
      use the defaults.
    </p>

    <label for="port-name">Port name to display</label>
    <select id="port-name" v-model="portNameField">
      <option value="name">Chinese (上海)</option>
      <option value="nameEn">English (Shanghai)</option>
    </select>
    <p class="hint">Match the labels shown in the port dropdown on the page.</p>

    <label>
      <input v-model="autoSubmit" type="checkbox" />
      Automatically click 确定 on the header form after filling
    </label>
    <p class="hint">
      Off by default. When enabled, the extension saves the 舱单 record exactly as a manual entry
      would. The extension never disseminates on its own (上传船代 / send).
    </p>

    <p>
      <button type="button" class="primary" @click="save">Save</button>
      <span v-if="saved" class="status">Saved.</span>
    </p>
  </div>
</template>
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: không lỗi.

- [ ] **Step 4: Commit**

```bash
git add src/options/App.vue src/options/styles.css
git commit -m "feat: add options page for API base, port label and auto-submit"
```

---

## Task 16: Build, nạp extension và kiểm thử thủ công trên site thật

**Files:**
- Create: `scripts/dump-manifest-dom.js`
- Modify: `docs/superpowers/specs/2026-10-26-manifest-autofill-extension-design.md` (ghi kết quả xác minh)

- [ ] **Step 1: Tạo script dump DOM — `scripts/dump-manifest-dom.js`**

Dán script này vào DevTools Console của trang manifest (sau khi đã bấm **新增舱单信息**),
để chốt cấu trúc thật của component cảng và của dialog hàng:

```js
;(function dumpManifestDom() {
  const dialogs = Array.from(document.querySelectorAll('.el-dialog'))
  const payload = dialogs.map((dialog) => ({
    title: dialog.querySelector('.el-dialog__title')?.textContent?.trim() ?? '(không tiêu đề)',
    items: Array.from(dialog.querySelectorAll('.el-form-item')).map((item) => {
      const input = item.querySelector('input, textarea')
      return {
        label: item.querySelector('.el-form-item__label')?.textContent?.trim() ?? '',
        id: input?.id ?? null,
        name: input?.getAttribute('name') ?? null,
        readonly: input?.readOnly ?? false,
        hasSelect: Boolean(item.querySelector('.el-select')),
        hasCascader: Boolean(item.querySelector('.el-cascader')),
        html: item.innerHTML.slice(0, 300),
      }
    }),
  }))
  console.log('=== MANIFEST DIALOG DUMP ===')
  console.log(JSON.stringify(payload, null, 2))
  return payload
})()
```

Sau đó bấm vào ô **收货地（装货港）** để mở popper, rồi chạy tiếp:

```js
;(function dumpPortPopper() {
  const poppers = Array.from(document.querySelectorAll('.el-popper'))
  console.log('=== PORT POPPER DUMP ===')
  console.log(JSON.stringify(poppers.map((p) => p.outerHTML.slice(0, 2500)), null, 2))
  return poppers.length
})()
```

Lưu cả hai kết quả vào file `docs/superpowers/specs/2026-10-26-dom-dump.md` (kèm ảnh chụp màn hình).

- [ ] **Step 2: Build lần cuối**

Run: `npm run build`
Expected: build thành công, `dist/` có `manifest.json`.

- [ ] **Step 3: Kiểm tra manifest sinh ra**

Run:
```bash
node -e "const m=require('./dist/manifest.json');console.log(JSON.stringify({v:m.manifest_version,cs:m.content_scripts.map(c=>c.matches),hp:m.host_permissions,opts:m.options_page},null,2))"
```
Expected:
```json
{
  "v": 3,
  "cs": [["https://www.chinaports-agency.com:8870/*"]],
  "hp": ["https://www.chinaports-agency.com:8870/*", "https://www.dadaex.cn/*"],
  "opts": "src/options/index.html"
}
```

- [ ] **Step 4: Nạp extension**

1. Mở `chrome://extensions`
2. Bật **Developer mode**
3. **Load unpacked** → chọn thư mục `dist/`
4. Mở trang `https://www.chinaports-agency.com:8870/#/login` → đăng nhập → vào
   `#/exportBusinessOperations/maintenanceOfManifestData` → tab **待发送**

- [ ] **Step 5: Kiểm thử thủ công theo checklist**

| # | Bước | Kết quả mong đợi |
|---|---|---|
| 1 | Bấm icon extension → **Read from page** | Ô nhập lấy được 提单号 đang hiển thị |
| 2 | Nhập `ONEYSHAGT1569600` → **Fill data** | Báo cáo hiện ra, không có lỗi đỏ |
| 3 | Đối chiếu form đầu | 提单号, 船名, 航次, 承运人代码, 交货条款, 付款方式, 3 cảng, 3 nhóm liên hệ đều đúng |
| 4 | Đối chiếu bảng hàng | Đủ số dòng `cdgoods`, 24 field trong dialog hàng đúng giá trị |
| 5 | Đối chiếu bảng container | Đủ số dòng `cdCon`, 9 cột đúng giá trị |
| 6 | Bấm **确定** ở form đầu | Bản ghi xuất hiện trong danh sách |
| 7 | Bật **Auto-click 确定** rồi chạy lại | Extension tự bấm 确定, bản ghi vẫn tạo đúng |
| 8 | Kiểm tra cookie `token` của site có phải `HttpOnly` không | Ghi lại kết quả — xem ghi chú bên dưới |

> **Bước 8 — kiểm tra `HttpOnly` của cookie `token`.** Chưa xác định được nếu chưa đăng nhập thật (request ẩn danh tới site không trả về `Set-Cookie` nào cả), nên phải kiểm tra thủ công sau khi đăng nhập:
>
> - DevTools → tab **Application** → **Cookies** → `https://www.chinaports-agency.com:8870` → cột **HttpOnly** của cookie `token`.
> - Hoặc chạy trong Console trang đã đăng nhập: `document.cookie` — nếu **không** thấy `token` trong kết quả thì cookie đó là `HttpOnly`.
>
> **Vì sao quan trọng:** `readCookieToken` đọc `document.cookie`, nên nếu `token` là `HttpOnly` thì `document.cookie` không thấy nó và fallback gắn header `Authorization: JWT <token>` **không khả dụng**. Cơ chế chính (`fetch(url, { credentials: 'include' })` — browser tự gửi cookie `token` cùng origin) vẫn hoạt động dù cookie có `HttpOnly` hay không, nên đây chỉ là kiểm tra **tính khả dụng của fallback**, không phải blocker. Nếu kết quả là `HttpOnly`, bỏ qua nhánh header `Authorization` và dựa vào `credentials: 'include'` (xem lại `src/core/site-api.ts` → `fetchSiteJson`).

- [ ] **Step 6: Xử lý field không điền được**

Với mọi field báo ⚠️ hoặc ❌ trong báo cáo, mở DevTools Console trên trang và chạy:

```js
document.querySelector('input[id$="-PROP_THỰC_TẾ"]')?.outerHTML
```

(với `PROP_THỰC_TẾ` là prop bị lỗi) rồi sửa selector trong `src/core/dom.ts` cho khớp, chạy lại
`npm run build` và nạp lại extension. Nếu popper của component cảng khác §5.3, sửa
`src/core/select.ts` (`findOptionIn` / `pickFromPopper`).

- [ ] **Step 7: Ghi lại kết quả xác minh vào spec**

Thêm mục vào cuối `docs/superpowers/specs/2026-10-26-manifest-autofill-extension-design.md`:

```markdown
## 12. Kết quả xác minh trên site thật (2026-10-26)

- DOM dump của dialog 新增舱单信息: `docs/superpowers/specs/2026-10-26-dom-dump.md`
- Selector cảng dùng thực tế: `<ghi lại selector đã dùng>`
- Shape thật của API dict: `<ghi lại>`
- Các field không điền được và lý do: `<ghi lại>`
```

- [ ] **Step 8: Commit**

```bash
git add scripts/dump-manifest-dom.js docs/superpowers/specs/2026-10-26-manifest-autofill-extension-design.md
git commit -m "docs: record live-site DOM verification for the manifest autofill extension"
```

---

## Checklist tự đánh giá trước khi bắt đầu

- [ ] `npm install` chạy được, `npm test` xanh
- [ ] `npm run typecheck` không lỗi
- [ ] `npm run build` sinh `dist/manifest.json` có `content_scripts` + `host_permissions`
- [ ] Extension nạp được bằng "Load unpacked" từ `dist/`
- [ ] Trên trang thật: điền đúng form đầu, bảng hàng, bảng container
- [ ] Không tự động phát tán (`send` / `上传船代`) — extension không gọi các endpoint này
- [ ] Không điền `*_AEO` (firmCode là mã đăng ký doanh nghiệp, không phải mã AEO)






