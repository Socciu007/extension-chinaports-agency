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

> **Bổ sung 2026-10-27:** toàn bộ FACT và FIX LIST trong
> `docs/superpowers/plans/2026-10-27-live-site-alignment.md` là **spec chuẩn** cho
> phần mapping/adapter. Ở đâu plan này mâu thuẫn với brief đó thì **brief thắng**.

### Trang đích

- URL: `https://www.chinaports-agency.com:8870/#/exportBusinessOperations/maintenanceOfManifestData`
- Tên: 预配舱单申报平台 — là trang **danh sách** có 2 tab (待发送 / 已发送).
- Stack: Vue 3 + Element Plus + fast-crud (`fs-crud`).
- Nút **新增舱单信息** mở một dialog chứa 3 phần: form đầu (28 field có nhãn + 5 field mã cảng) → bảng **货物信息** (cargo) → bảng **集装箱** (container).
- Element Plus gán `id` cho input theo mẫu `${formId}-${prop}` → selector ổn định: `input[id$="-BILL_NBR"]`.
- Bảng container dùng **inline editable** (`table.editable.enabled = true`) → điền thẳng vào ô bảng, không qua dialog. Nút thêm dòng là `新增` và **chèn dòng mới vào index 0** (đầu bảng), không phải cuối bảng.
- Bảng cargo dùng **dialog** 24 field, tiêu đề `货物信息`; nút lưu của dialog là **`保存`** (không phải `确定`). Nút `新增` bên trong section 货物信息 gọi `setTimeout(..., 400)` rồi mới mở form → phải chờ ≥ 400ms.
- Trong 24 field của dialog hàng chỉ có **2 `el-select`** (`CARGO_KIND_COD`, `TEMP_ID`) và **2 `el-autocomplete`** (`PACKAGE_STR`, `PACKAGE_COD`); phần còn lại là `el-input`.
- 9 cột của bảng container: 4 cột là `el-select` (`CNTR_SIZE_COD`, `CNTR_TYPE_COD`, `CNTR_EF_ID`, `SOC_ID`), 5 cột còn lại là `el-input`.
- Section 货物信息 nằm trong div `class="CargoInformation"`, section 集装箱 nằm trong div `class="ContainerInformation"`.
- 5 field cảng + 提单签发地 là **`el-autocomplete`** (đã xác minh từ bundle). Mỗi suggestion
  hiển thị dạng `名称/代码` (vd `上海/CNSHA`); site tự điền `*_PORT_COD` khi suggestion
  được click → extension chỉ cần gõ **tên cảng tiếng Trung** rồi click đúng suggestion.
- Adapter phải **nhận diện loại control lúc chạy** (`.el-select` / `.el-autocomplete` /
  input readonly / input thường), không hard-code theo `prop`.

### API của site (dùng để tra dict, dùng chung session)

Prefix: `/api/booking/exportManifestDataMaintain/`
`GET getTrustCode/` · `GET getDrType/` · `GET getPort/` · `GET getCntrCode/`

> Extension chỉ gọi **4** endpoint này. `getPackageCode/` **không** gọi: C-2 bắt
> buộc bỏ trống cả `PACKAGE_STR` và `PACKAGE_COD` (API không có 包装类型 thật) ⇒
> dict 包装种类 không có nơi dùng.

Gọi từ content script bằng `fetch(url, { credentials: 'include' })` — browser tự gửi cookie `token`; đồng thời extension đọc cookie `token` để gắn header `Authorization: JWT <token>` (phòng khi server chỉ chấp nhận header).

Envelope là `{ code, data, msg }` và **lỗi của site nằm trong HTTP 200**
(`{"code":4000,"data":null,"msg":"身份认证信息未提供。"}`) → phải kiểm tra `code`/`data`,
không được chỉ dựa vào `res.ok`.

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
| `src/core/site-api.ts` | gọi 4 endpoint dict của site + chuẩn hoá option |
| `src/core/mapping.ts` | `data` → `FieldPlan[]` cho header / cargo / container |
| `src/core/dom.ts` | tìm field, đặt giá trị text, đọc lại giá trị |
| `src/core/select.ts` | adapter mở dropdown / popper và click option |
| `src/core/table.ts` | đọc cấu trúc bảng inline editable, đặt giá trị vào ô |
| `src/core/wait.ts` | `sleep`, `nextFrame`, `waitFor` |
| `src/core/site.ts` | từ vựng DOM của site: tìm section / nút / bảng / dialog, hỏi "ẩn hay hiện" |
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
// Task 14 sẽ thay nội dung file này.
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
// Task 15 sẽ thay nội dung file này.
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
// Task 16 sẽ thay nội dung file này.
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

> **Sửa sau đối chiếu site thật (2026-10-27, commit `14f45ec` — "fix: map cargo and container fields the way the site expects").**
> `ManifestCargo` cần thêm **`shantou?: string | null`**.
>
> Fixture thật cho thấy `cdgoods[0].shantou = "N/M"` và `cdgoods[0].sign = null`.
> `shantou` là pinyin của **唛头** — đúng field 唛头 của site, và `"N/M"` (= *No
> Marks*) chính là **giá trị mặc định** của 唛头 trong model của site
> (`H.value.MARK_STR = "N/M"` trong bundle). `sign` là field khác và **null**.
> Bản gốc của task này map 唛头 từ `sign` ⇒ field luôn bị bỏ trống ⇒ dòng hàng
> thiếu 1 field bắt buộc của site ⇒ `保存` bị từ chối ⇒ **0 dòng** được lưu.
> Xem `docs/superpowers/plans/2026-10-27-live-site-alignment.md` (mục C-7).

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
  /** 唛头 (pinyin của "mào tóu") — đây mới là field 唛头 của site, `sign` là field khác. */
  shantou?: string | null
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

> **Sửa sau đối chiếu site thật (2026-10-27, commit `34e456c` — "fix: align select filling with the live site").**
> Bản gốc của task này viết **mã** của option vào `value` cho các `el-select` của
> site. Điều đó sai: **mọi `el-select` của site khớp option theo TEXT HIỂN THỊ**,
> mã chỉ nằm trong model của Vue. Ghi mã vào ⇒ không option nào khớp ⇒ field bị
> báo "không chọn được" dù dữ liệu đã có. Ba thay đổi:
>
> 1. **`FieldPlan.matchValue?: string`** — text của option cần click, mặc định bằng
>    `value`. Ô cảng dùng nó: `value` = tên cảng để gõ, `matchValue` = `"名称/代码"`
>    của suggestion (site cascade mã khi suggestion được click).
> 2. **`付款方式` (`PAY_WAY_ID`)** — `value` là **nhãn** (`预付` / `到付`), mã site lưu
>    (`P` / `C`) nằm trong `note`. `payType === true` ⇒ 预付, `payType === false` ⇒
>    到付; mọi giá trị khác (kể cả `2`, `-1`) ⇒ **bỏ trống, không đoán**.
> 3. **Bỏ `portNameField`** khỏi `MappingContext` — widget cảng của site chỉ gợi ý
>    **tên tiếng Trung** (filter `E_PORT_NAM`), nên không cần cấu hình tên nào là
>    "tên" và "mã". Tên cảng lấy từ API (`loadPortData`…) trước, `getPort()` chỉ là
>    fallback.
>
> Ngoài ra `note` của field **ghi thành công** cũng phải mang `note` (xem B-14 của
> `docs/superpowers/plans/2026-10-27-live-site-alignment.md`) để người dùng đối
> chiếu được mã site lưu.

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
  // Site chỉ gợi ý tên cảng tiếng Trung → `findPort` trả về tên Trung.
  findPort: (code) =>
    code === 'CNSHA' ? '上海' : code === 'IDBLW' ? '勿拉湾' : undefined,
  findCntrType: (raw) => (raw === 2 ? '20GP' : undefined),
  findCntrSize: (raw) => (raw === 0 ? "20'" : undefined),
}

const planFor = <T extends { prop: string }>(plans: T[], prop: string) =>
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

  it('map 付款方式 ra NhãN của site (không phải mã 0/1)', () => {
    // Fixture có payType = false → 到付 (mã site lưu là "C").
    expect(planFor(plans, 'PAY_WAY_ID')).toMatchObject({ status: 'fill', value: '到付' })
  })

  it('payType = true → 预付', () => {
    const p = mapHeader({ ...data, payType: true }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p).toMatchObject({ status: 'fill', value: '预付' })
  })

  it('payType = false → 到付', () => {
    const p = mapHeader({ ...data, payType: false }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p).toMatchObject({ status: 'fill', value: '到付' })
  })

  it('note của 付款方式 nói rõ mã site sẽ lưu', () => {
    const p = mapHeader({ ...data, payType: true }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    // Note phải nêu cả mã site lưu ("P") lẫn nhãn hiển thị (预付).
    expect(p?.note).toContain('"P"')
    expect(p?.note).toContain('预付')
  })

  it('payType = 1 → 预付', () => {
    const p = mapHeader({ ...data, payType: 1 }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p).toMatchObject({ status: 'fill', value: '预付' })
  })

  it('payType = 0 → 到付', () => {
    const p = mapHeader({ ...data, payType: 0 }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p).toMatchObject({ status: 'fill', value: '到付' })
  })

  it('payType = 2 (giá trị lạ) thì bỏ trống, không đoán', () => {
    const p = mapHeader({ ...data, payType: 2 }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p?.status).toBe('skip')
    expect(p?.value).toBeUndefined()
    expect(p?.note).toContain('2')
  })

  it('không có payType thì bỏ trống 付款方式', () => {
    const p = mapHeader({ ...data, payType: null }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p?.status).toBe('skip')
    expect(p?.value).toBeUndefined()
  })

  it('map 装货港 sang START_PORT_NAM và verify START_PORT_COD', () => {
    expect(planFor(plans, 'START_PORT_NAM')).toMatchObject({ status: 'fill', value: '上海' })
    expect(planFor(plans, 'START_PORT_NAM')?.verify?.prop).toBe('START_PORT_COD')
  })

  it('ô cảng mang matchValue dạng 名称/代码', () => {
    expect(planFor(plans, 'START_PORT_NAM')).toMatchObject({
      value: '上海',
      matchValue: '上海/CNSHA',
    })
    expect(planFor(plans, 'DISCHRG_PORT_NAM')).toMatchObject({
      value: '勿拉湾',
      matchValue: '勿拉湾/IDBLW',
    })
    expect(planFor(plans, 'DEST_PORT_NAM')).toMatchObject({
      value: '勿拉湾',
      matchValue: '勿拉湾/IDBLW',
    })
  })

  it('tên cảng lấy từ API trước, dictionary chỉ là fallback', () => {
    const p = mapHeader(data, { ...ctx, findPort: () => 'TENDICH' }).find(
      (x) => x.prop === 'START_PORT_NAM',
    )
    expect(p?.value).toBe('上海')
    expect(p?.matchValue).toBe('上海/CNSHA')
  })

  it('khi API không có tên cảng thì lấy từ dictionary getPort()', () => {
    const p = mapHeader(
      { ...data, loadPortData: null },
      { ...ctx, findPort: (code) => (code === 'CNSHA' ? '上海' : undefined) },
    ).find((x) => x.prop === 'START_PORT_NAM')
    expect(p).toMatchObject({ status: 'fill', value: '上海', matchValue: '上海/CNSHA' })
  })

  it('không tìm thấy cảng thì bỏ trống', () => {
    const p = mapHeader({ ...data, loadPortData: null }, { ...ctx, findPort: () => undefined }).find(
      (x) => x.prop === 'START_PORT_NAM',
    )
    expect(p?.status).toBe('skip')
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

describe('MappingContext', () => {
  it('không còn cấu hình portNameField (site chỉ gợi ý tên Trung)', () => {
    // Kiểm tra ở mức kiểu: `portNameField` phải KHÔNG còn là thuộc tính hợp lệ
    // của `MappingContext` (nếu còn, `@ts-expect-error` báo "unused directive").
    // @ts-expect-error — `portNameField` đã bị gỡ khỏi `MappingContext`.
    const legacyCtx: MappingContext = { ...ctx, portNameField: 'START_PORT_NAM' }
    expect(legacyCtx).toBeTruthy()
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
  /** nhãn tiếng Trung của field trên site (提单号, 船名…) — dùng để hiển thị trong báo cáo */
  label: string
  status: PlanStatus
  /** giá trị cần điền (chỉ có khi status = 'fill') */
  value?: string
  /** text của option cần click; mặc định bằng `value` */
  matchValue?: string
  /** ghi chú để đối chiếu; với plan 'skip' là lý do bỏ qua */
  note?: string
  /** sau khi điền prop này thì đọc lại verifyProp, rỗng thì báo cảnh báo */
  verify?: { prop: string; note: string }
  /** nhãn tiếng Trung của cột, dùng khi điền bảng inline */
  columnLabel?: string
}

export interface MappingContext {
  findTrustCode(supplyId?: number): string | undefined
  findDrType(code?: string): string | undefined
  /** Tên cảng tiếng Trung — widget của site chỉ gợi ý tên Trung (filter `E_PORT_NAM`). */
  findPort(code?: string): string | undefined
  findCntrType(raw?: number | string | null): string | undefined
  findCntrSize(raw?: number | string | null): string | undefined
}

/**
 * 付款方式 của site: 预付='P', 到付='C', 免费='F'. Adapter click theo TEXT hiển thị.
 */
const PAY_WAY_OPTIONS: Record<'P' | 'C', { label: string; code: string }> = {
  P: { label: '预付', code: 'P' },
  C: { label: '到付', code: 'C' },
}

/**
 * Map `payType` của API sang option của site.
 *
 * - `true` / `1` → 预付 (site lưu mã "P");
 * - `false` / `0` → 到付 (site lưu mã "C");
 * - còn lại (`null`/`undefined`, hoặc giá trị lạ như `2`, `-1`) → `undefined`:
 *   KHÔNG đoán, bỏ trống 付款方式. Lý do cụ thể do caller ghi vào note.
 */
function payWayOf(
  payType: boolean | number | null | undefined,
): { label: string; code: string } | undefined {
  if (payType === true || payType === 1) return PAY_WAY_OPTIONS.P
  if (payType === false || payType === 0) return PAY_WAY_OPTIONS.C
  return undefined
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
      plans.push({ prop, label, status: 'skip', note: note ?? 'The API provides no data for this field' })
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
      : `No carrier found for supplyId=${supplyId ?? 'null'} in getTrustCode()`,
  })

  const drType = ctx.findDrType(data.transportTerms ?? undefined)
  plans.push({
    prop: 'DR_TYPE_STR',
    label: '交货条款',
    status: drType ? 'fill' : 'skip',
    value: drType ?? undefined,
    note: drType
      ? undefined
      : `No 交货条款 found for code "${data.transportTerms ?? ''}" in getDrType()`,
  })

  const payType = data.payType
  const payWay = payWayOf(payType)
  plans.push({
    prop: 'PAY_WAY_ID',
    label: '付款方式',
    status: payWay ? 'fill' : 'skip',
    // Adapter click theo TEXT hiển thị → phải là nhãn, không phải mã.
    value: payWay?.label,
    note: payWay
      ? `The site stores the code "${payWay.code}" for "${payWay.label}"`
      : payType === null || payType === undefined
        ? 'The API provides no payType'
        : `The API returned an unrecognised payType "${payType}", so 付款方式 was left blank`,
  })

  const portGroups = [
    {
      nameProp: 'START_PORT_NAM',
      codeProp: 'START_PORT_COD',
      code: data.loadCode,
      apiName: data.loadPortData?.name,
      label: '收货地（装货港）',
    },
    {
      nameProp: 'DISCHRG_PORT_NAM',
      codeProp: 'DISCHRG_PORT_COD',
      code: data.uploadCode,
      apiName: data.uploadPortData?.name,
      label: '卸货港',
    },
    {
      nameProp: 'DEST_PORT_NAM',
      codeProp: 'DEST_PORT_COD',
      code: data.aimPortCode,
      apiName: data.aimPortData?.name,
      label: '交货地',
    },
  ]

  for (const group of portGroups) {
    // Widget của site chỉ gợi ý tên cảng tiếng Trung → ưu tiên tên từ API,
    // dictionary getPort() chỉ là fallback.
    const name = text(group.apiName) || ctx.findPort(group.code ?? undefined) || ''
    if (name === '') {
      plans.push({
        prop: group.nameProp,
        label: group.label,
        status: 'skip',
        note: `No port found for code "${group.code ?? ''}" in getPort()`,
      })
      continue
    }
    const code = text(group.code)
    plans.push({
      prop: group.nameProp,
      label: group.label,
      status: 'fill',
      // Gõ tên cảng…
      value: name,
      // …nhưng suggestion của site có dạng "名称/代码".
      matchValue: code ? `${name}/${code}` : undefined,
      // Site tự cascade mã cảng khi suggestion được click.
      verify: { prop: group.codeProp, note: `Port code ${group.codeProp} was not set` },
    })
  }

  plans.push({
    prop: 'TRANS_PORT_NAM',
    label: '中转港',
    status: 'skip',
    note: 'The API provides no data for 中转港',
  })
  plans.push({
    prop: 'SIGN_PLACE_STR',
    label: '提单签发地/代码',
    status: 'skip',
    note: 'The API provides no data for 提单签发地',
  })

  const contacts = data.cabContacts ?? []
  for (const group of PARTY_GROUPS) {
    const contact = contacts.find((c) => contactRole(c) === group.role)
    push(group.nameProp, `${group.label}名称`, contact?.master)
    push(`${group.prefix}_ADD_STR`, `${group.label}地址`, contact?.address)
    push(`${group.prefix}_COUNTRY_COD`, `${group.label}国家代码`, contact?.country)
    push(`${group.prefix}_TE_STR`, `${group.label}电话`, contact?.phone)
    push(`${group.prefix}_EM_STR`, `${group.label}EMAIL`, undefined, 'The API provides no email address')
    push(`${group.prefix}_FX_STR`, `${group.label}传真`, undefined, 'The API provides no fax number')
    push(
      `${group.prefix}_AEO`,
      `${group.label}AEO代码`,
      contact?.aeo,
      'firmCode is a business registration number (USCI/TIN), not an AEO code, so this field is left blank',
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

> **Sửa sau đối chiếu site thật (2026-10-27, commit `14f45ec` — "fix: map cargo and container fields the way the site expects").**
> Bản gốc của task này ghi **mã** của option vào `value` và điền **"114.000"** vào
> 包装件数. Cả hai đều làm site từ chối dòng hàng. Bảy thay đổi:
>
> 1. **C-1 `CARGO_KIND_COD`** — `value` là **nhãn** (`普货` / `危险品` / `冷藏品` /
>    `危险品+冷藏品`), mã (`S`/`D`/`R`/`G`) nằm trong `note`. `deriveCargoKind` vẫn
>    trả **mã**.
> 2. **C-2 `PACKAGE_STR` + `PACKAGE_COD`** — API **không** có 包装类型 thật
>    (`unit` = `"PACKAGES"` chỉ là đơn vị đếm chung; `packType`/`packDesc` = null),
>    mà site bắt buộc `PACKAGE_COD` đúng **2 ký tự** ⇒ cả hai field **bỏ trống** +
>    note yêu cầu người dùng tự chọn.
> 3. **C-3 `SOC_ID`** — `value` là **nhãn** (`货主箱` / `非货主箱`), mã (`Y`/`N`) nằm
>    trong `note`. `self` null ⇒ bỏ trống, không đoán.
> 4. **C-4 `CNTR_SIZE_COD` / `CNTR_TYPE_COD` / `CNTR_EF_ID`** — `cType`/`vC` của API là
>    **mã số**, dict `getCntrCode/` của site chỉ có **chuỗi thuần** ⇒ **không tra
>    được**. Lookup **vẫn chạy**; chỉ khi tra ra `undefined` mới bỏ trống — bỏ trống
>    là **kết quả** của tra cứu, không phải hard-code.
> 5. **C-7 `MARK_STR`** — lấy từ **`shantou`** (fallback `sign`), không phải `sign`.
> 6. **C-9 `PIECE_NUM`** — site chỉ nhận **số nguyên** (`/^\d*$/`) ⇒ `"114.000"` →
>    `"114"`. `GWEIGHT_TON`/`GVOL_NUM` **giữ nguyên** (rule cho phép 3 chữ số thập phân).
> 7. **C-8** — note của field **bắt buộc** của site phải nói rõ người dùng cần
>    làm tay; field thường giữ note chung.
>
> Chi tiết: `docs/superpowers/plans/2026-10-27-live-site-alignment.md` (FIX LIST C).

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

/**
 * Dict `getCntrCode/` của site chỉ chứa **chuỗi thuần** ("20", "GP"…), còn
 * `cType`/`vC` của API là **mã số** ⇒ không tra được ⇒ 尺寸/箱型 phải skip.
 */
const ctx: MappingContext = {
  findTrustCode: () => undefined,
  findDrType: () => undefined,
  findPort: () => undefined,
  findCntrType: () => undefined,
  findCntrSize: () => undefined,
}

/** Ngữ cảnh giả lập site ĐÃ tra được 箱型/尺寸 (dict có dữ liệu). */
const ctxWithDictionary: MappingContext = {
  ...ctx,
  findCntrType: () => 'GP',
  findCntrSize: () => "20'",
}

const planFor = <T extends { prop: string }>(plans: T[], prop: string) =>
  plans.find((p) => p.prop === prop)

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

  it('điền 货物标识 bằng nhãn hiển thị của site, mã chỉ nằm ở note', () => {
    const plan = planFor(plans, 'CARGO_KIND_COD')
    expect(plan).toMatchObject({ status: 'fill', value: '普货' })
    expect(plan?.note).toContain('S')
  })

  it('bỏ trống 包装类型 vì API không có 包装类型 thật', () => {
    const plan = planFor(plans, 'PACKAGE_STR')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('包装类型')
  })

  it('không ghi PACKAGES (đơn vị đếm chung) vào 包装类型', () => {
    expect(cargo.unit).toBe('PACKAGES')
    expect(planFor(plans, 'PACKAGE_STR')?.value).toBeUndefined()
  })

  it('bỏ trống 包装类型代码 vì API không có mã 包装', () => {
    const plan = planFor(plans, 'PACKAGE_COD')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('PACKAGE_COD')
  })

  it('điền 包装件数 bằng số nguyên (site chỉ nhận /^\d*$/)', () => {
    expect(planFor(plans, 'PIECE_NUM')).toMatchObject({ status: 'fill', value: '114' })
  })

  it('ghi chú khi phần thập phân của 包装件数 bị cắt', () => {
    expect(planFor(plans, 'PIECE_NUM')?.note).toBe(
      'The site only accepts whole numbers for 包装件数 — wrote 114 (the API gave "114.000")',
    )
  })

  it('điền 毛重 từ weight (giữ nguyên 3 chữ số thập phân)', () => {
    expect(planFor(plans, 'GWEIGHT_TON')).toMatchObject({ status: 'fill', value: '22400.000' })
  })

  it('điền 体积 từ volume (giữ nguyên 3 chữ số thập phân)', () => {
    expect(planFor(plans, 'GVOL_NUM')).toMatchObject({ status: 'fill', value: '60.130' })
  })

  it('điền 唛头 từ shantou (không phải sign)', () => {
    expect(planFor(plans, 'MARK_STR')).toMatchObject({ status: 'fill', value: 'N/M' })
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

describe('mapCargo — hàng nguy hiểm', () => {
  const dangerous = mapCargo({ ...cargo, dangerClass: '2.1', unNub: null })

  it('ghi 货物标识 = 危险品', () => {
    expect(planFor(dangerous, 'CARGO_KIND_COD')).toMatchObject({
      status: 'fill',
      value: '危险品',
    })
  })

  it('note của field BẮT BUỘC bị skip nói rõ site cần người dùng làm tay', () => {
    const unNo = planFor(dangerous, 'DANG_UN_NO')
    expect(unNo?.status).toBe('skip')
    expect(unNo?.note).toContain('The site requires')
    expect(unNo?.note).toContain('危险品联合国编号')
    expect(unNo?.note).toContain('DANG_UN_NO')
    expect(unNo?.note).toContain('by hand')
  })

  it('note của field BẮT BUỘC khác (危险品联系人电话) cũng nói rõ site cần làm tay', () => {
    const phone = planFor(dangerous, 'DANGER_TE_STR')
    expect(phone?.status).toBe('skip')
    expect(phone?.note).toContain('The site requires')
    expect(phone?.note).toContain('DANGER_TE_STR')
  })

  it('field KHÔNG bắt buộc giữ note chung', () => {
    expect(planFor(dangerous, 'DANG_EMS_NO')?.note).toBe(
      'The API provides no data for this field',
    )
  })
})

describe('mapCargo — hàng kiểm dịch và hàng vừa nguy hiểm vừa kiểm dịch', () => {
  it('loại R: 货物标识 = 冷藏品 và note của TEMP_ID nói rõ site bắt buộc', () => {
    const cold = mapCargo({ ...cargo, quarantineName: '冷藏' })
    expect(planFor(cold, 'CARGO_KIND_COD')).toMatchObject({
      status: 'fill',
      value: '冷藏品',
    })
    const temp = planFor(cold, 'TEMP_ID')
    expect(temp?.status).toBe('skip')
    expect(temp?.note).toContain('The site requires')
    expect(temp?.note).toContain('TEMP_ID')
  })

  it('loại G: field nguy hiểm lẫn field lạnh đều bị site bắt buộc', () => {
    const both = mapCargo({ ...cargo, dangerClass: '2.1', quarantineName: '冷藏' })
    expect(planFor(both, 'CARGO_KIND_COD')).toMatchObject({
      status: 'fill',
      value: '危险品+冷藏品',
    })
    expect(planFor(both, 'DANG_UN_NO')?.note).toContain('The site requires')
    expect(planFor(both, 'SET_TEMP_NUM')?.note).toContain('The site requires')
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

  it('bỏ trống 箱型 vì dict site chỉ có chuỗi, mã số của API không tra được', () => {
    const plan = planFor(plans, 'CNTR_TYPE_COD')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('箱型')
    expect(plan?.note).toContain('The site requires')
  })

  it('bỏ trống 尺寸 vì dict site chỉ có chuỗi, mã số của API không tra được', () => {
    const plan = planFor(plans, 'CNTR_SIZE_COD')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('尺寸')
    expect(plan?.note).toContain('The site requires')
  })

  it('bỏ trống 箱状态 vì API không có dữ liệu', () => {
    const plan = planFor(plans, 'CNTR_EF_ID')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('箱状态')
    expect(plan?.note).toContain('The site requires')
  })

  it('ghi 货主箱标志 bằng nhãn hiển thị của site, mã chỉ nằm ở note', () => {
    const plan = planFor(plans, 'SOC_ID')
    expect(plan).toMatchObject({ status: 'fill', value: '非货主箱' })
    expect(plan?.note).toContain('N')
  })

  it('điền 货物件数 bằng số nguyên', () => {
    expect(planFor(plans, 'PIECE_NUM')).toMatchObject({ status: 'fill', value: '114' })
  })

  it('có nhãn cột tiếng Trung để định vị ô bảng', () => {
    expect(planFor(plans, 'CNTR_NO')?.columnLabel).toBe('箱号')
  })

  it('có đủ 9 cột', () => {
    expect(plans).toHaveLength(9)
  })
})

describe('mapContainer — lookup vẫn chạy khi dict tra được', () => {
  const plans = mapContainer(con, ctxWithDictionary)

  it('điền 箱型 bằng đúng giá trị dict trả về', () => {
    expect(planFor(plans, 'CNTR_TYPE_COD')).toMatchObject({ status: 'fill', value: 'GP' })
  })

  it('điền 尺寸 bằng đúng giá trị dict trả về', () => {
    expect(planFor(plans, 'CNTR_SIZE_COD')).toMatchObject({ status: 'fill', value: "20'" })
  })
})

describe('mapContainer — 货主箱标志', () => {
  it('self = true ⇒ 货主箱', () => {
    const plans = mapContainer({ ...con, self: true }, ctx)
    expect(planFor(plans, 'SOC_ID')).toMatchObject({ status: 'fill', value: '货主箱' })
  })

  it('self = null ⇒ bỏ trống, không đoán', () => {
    const plans = mapContainer({ ...con, self: null }, ctx)
    const plan = planFor(plans, 'SOC_ID')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('The site requires')
  })
})

```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `deriveCargoKind` / `mapCargo` / `mapContainer` chưa tồn tại.

- [ ] **Step 3: Thêm vào cuối `src/core/mapping.ts`**

```ts
/**
 * Loại hàng: S = thường, D = hàng nguy hiểm, R = hàng kiểm dịch (refrigerated/quarantine),
 * G = vừa nguy hiểm vừa kiểm dịch.
 */
export type CargoKind = 'S' | 'D' | 'R' | 'G'

export function deriveCargoKind(goods: ManifestCargo): CargoKind {
  const danger = !isBlank(goods.dangerClass) || !isBlank(goods.unNub)
  const cold = !isBlank(goods.quarantineName) || !isBlank(goods.quarantineCode)
  if (danger && cold) return 'G'
  if (danger) return 'D'
  if (cold) return 'R'
  return 'S'
}

/**
 * Nhãn hiển thị của loại hàng trên site.
 *
 * `el-select` của site khớp option theo **TEXT hiển thị** ⇒ plan phải chứa
 * nhãn (`普货`), mã (`S`) chỉ nằm trong `note` để người dùng đối chiếu.
 */
const CARGO_KIND_LABELS: Record<CargoKind, string> = {
  S: '普货',
  D: '危险品',
  R: '冷藏品',
  G: '危险品+冷藏品',
}

/** Field BẮT BUỘC của site theo từng loại hàng (FACT 5.3 của plan live-site-alignment). */
const REQUIRED_BASE: readonly string[] = [
  'CARGO_KIND_COD',
  'PACKAGE_COD',
  'PACKAGE_STR',
  'PIECE_NUM',
  'GWEIGHT_TON',
  'GVOL_NUM',
  'MARK_STR',
  'E_CARGO_NAM',
]
const REQUIRED_DANGER: readonly string[] = [
  'DANG_CLASS_NAM',
  'DANG_UN_NO',
  'DANGER_CONTACT_NAM',
  'DANGER_TE_STR',
]
const REQUIRED_COLD: readonly string[] = ['TEMP_ID', 'SET_TEMP_NUM']

const REQUIRED_BY_KIND: Record<CargoKind, readonly string[]> = {
  S: REQUIRED_BASE,
  D: [...REQUIRED_BASE, ...REQUIRED_DANGER],
  R: [...REQUIRED_BASE, ...REQUIRED_COLD],
  G: [...REQUIRED_BASE, ...REQUIRED_DANGER, ...REQUIRED_COLD],
}

/**
 * Note của một field bị bỏ trống.
 *
 * Field **bắt buộc** của site phải nói rõ người dùng cần làm tay, còn field
 * thường dùng note chung. 12 field nguy hiểm bị site xoá & disable trừ khi loại
 * là `D`/`G`, `TEMP_ID`/`SET_TEMP_NUM` bị xoá trừ khi loại là `R`/`G` ⇒ ở loại
 * `S` các field `DANG_*` bị skip là đúng và note chung là đủ.
 */
function skippedNote(
  prop: string,
  label: string,
  kind: CargoKind,
  required: ReadonlySet<string>,
): string {
  if (required.has(prop)) {
    return (
      `The site requires ${label} (${prop}) for ${CARGO_KIND_LABELS[kind]} cargo, ` +
      'but the API provides no data — please fill it in by hand on the page.'
    )
  }
  return 'The API provides no data for this field'
}

/**
 * Số nguyên của một giá trị số.
 *
 * `PIECE_NUM` của site chỉ nhận số nguyên (`/^\d*$/` trong bundle) ⇒ `"114.000"`
 * phải cắt thành `"114"`, nếu không site validate fail ⇒ báo `请填必填表格` và
 * **không** POST ⇒ dòng hàng không được lưu.
 *
 * KHÔNG dùng hàm này cho `GWEIGHT_TON`/`GVOL_NUM`: rule của chúng cho phép tối
 * đa 3 chữ số thập phân.
 */
function integerText(value: unknown): { value: string; raw: string; truncated: boolean } {
  const raw = text(value)
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw)
  if (!match) return { value: raw, raw, truncated: false }
  const intPart = match[1]!
  if (match[2] === undefined) return { value: intPart, raw, truncated: false }
  return { value: intPart, raw, truncated: true }
}

/** Giá trị đầu tiên khác rỗng (dùng cho fallback `shantou` → `sign`). */
function firstNonBlank(...values: unknown[]): string {
  for (const value of values) {
    const v = text(value)
    if (v !== '') return v
  }
  return ''
}

/**
 * Ánh xạ 1 dòng hàng (cdgoods) sang danh sách field plan cho bảng 货物明细.
 */
export function mapCargo(goods: ManifestCargo): FieldPlan[] {
  const plans: FieldPlan[] = []
  const kind = deriveCargoKind(goods)
  const kindLabel = CARGO_KIND_LABELS[kind]
  const required = new Set(REQUIRED_BY_KIND[kind])

  const push = (
    prop: string,
    label: string,
    value: unknown,
    options: { skipNote?: string; fillNote?: string } = {},
  ) => {
    const v = text(value)
    if (v === '') {
      plans.push({
        prop,
        label,
        status: 'skip',
        note: options.skipNote ?? skippedNote(prop, label, kind, required),
      })
    } else {
      plans.push({ prop, label, status: 'fill', value: v, note: options.fillNote })
    }
  }

  // 货物标识 — `el-select` khớp theo nhãn hiển thị, mã chỉ để đối chiếu.
  plans.push({
    prop: 'CARGO_KIND_COD',
    label: '货物标识',
    status: 'fill',
    value: kindLabel,
    note: `The site stores the code "${kind}" for "${kindLabel}"`,
  })

  push('CARGO_HS_COD', 'HS编码', goods.hscode)

  // 包装类型/代码 — API KHÔNG có 包装类型 thật: `unit` chỉ là đơn vị đếm chung
  // ("PACKAGES"), `packType`/`packDesc` đều null ⇒ ghi vào tờ khai là rác.
  push('PACKAGE_STR', '包装类型/代码', undefined, {
    skipNote:
      'The site requires 包装类型/代码 (PACKAGE_STR) but the API provides no real packaging type ' +
      '— its `unit` is a generic counting unit (PACKAGES). Please choose it on the page; ' +
      'it must be filled in by hand.',
  })
  push('PACKAGE_COD', '包装类型代码', undefined, {
    skipNote:
      'The site requires 包装类型代码 (PACKAGE_COD) — exactly 2 characters — but the API ' +
      'provides no packaging code. Please choose it on the page; it must be filled in by hand.',
  })

  // 包装件数 — site chỉ nhận số nguyên ⇒ cắt phần thập phân.
  const pieces = integerText(goods.amount)
  push('PIECE_NUM', '包装件数', pieces.value, {
    fillNote: pieces.truncated
      ? `The site only accepts whole numbers for 包装件数 — wrote ${pieces.value} ` +
        `(the API gave "${pieces.raw}")`
      : undefined,
  })

  // 毛重 / 体积 — rule của site cho phép tối đa 3 chữ số thập phân ⇒ giữ nguyên.
  push('GWEIGHT_TON', '货物毛重（公斤）', goods.weight)
  push('GVOL_NUM', '货物体积（m³）', goods.volume)
  push('NWEIGHT_TON', '货物净重（公斤）', goods.grossWeight)

  // 唛头 — `shantou` là pinyin của 唛头 và là field 唛头 thật của site;
  // `sign` là field khác (null trong dữ liệu thật) nên chỉ dùng làm fallback.
  push('MARK_STR', '唛头', firstNonBlank(goods.shantou, goods.sign))

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

  // Lưu ý (C-6): cột 货物标识 của bảng DANH SÁCH hàng hiện `普货` (không phải `S`),
  // cột 温度计量单位 hiện `摄氏` (không phải `C`). Nếu sau này extension verify
  // bằng cách đọc bảng danh sách thì phải so khớp **nhãn**, không so mã.

  return plans
}

/**
 * Ánh xạ 1 dòng container (cdCon) sang danh sách field plan cho bảng 集装箱.
 */
export function mapContainer(
  container: ManifestContainer,
  ctx: MappingContext,
): FieldPlan[] {
  const plans: FieldPlan[] = []

  const push = (
    prop: string,
    label: string,
    columnLabel: string,
    value: unknown,
    options: { skipNote?: string; fillNote?: string } = {},
  ) => {
    const v = text(value)
    if (v === '') {
      plans.push({
        prop,
        label,
        status: 'skip',
        note: options.skipNote ?? 'The API provides no data for this field',
        columnLabel,
      })
    } else {
      plans.push({
        prop,
        label,
        status: 'fill',
        value: v,
        note: options.fillNote,
        columnLabel,
      })
    }
  }

  push('CNTR_NO', '箱号', '箱号', container.boxNub)

  // 尺寸 / 箱型 — lookup VẪN chạy; chỉ khi dict của site không tra được
  // (dict chỉ chứa chuỗi thuần "20"/"GP" còn `vC`/`cType` của API là mã số)
  // thì mới skip — không điền bừa giá trị sai.
  const size = ctx.findCntrSize(container.vC ?? undefined)
  push('CNTR_SIZE_COD', '尺寸', '尺寸', size, {
    skipNote: isBlank(container.vC)
      ? 'The site requires 尺寸 (CNTR_SIZE_COD) but the API provides no data. ' +
        'Please choose it on the page; it must be filled in by hand.'
      : 'The site requires 尺寸 (CNTR_SIZE_COD) but the API gives numeric codes (vC) while ' +
        "the site's dictionary only holds plain strings, so the container size cannot be " +
        'resolved. Please choose it on the page; it must be filled in by hand.',
  })

  const cntrType = ctx.findCntrType(container.cType ?? undefined)
  push('CNTR_TYPE_COD', '箱型', '箱型', cntrType, {
    skipNote: isBlank(container.cType)
      ? 'The site requires 箱型 (CNTR_TYPE_COD) but the API provides no data. ' +
        'Please choose it on the page; it must be filled in by hand.'
      : 'The site requires 箱型 (CNTR_TYPE_COD) but the API gives numeric codes (cType) while ' +
        "the site's dictionary only holds plain strings, so the container type cannot be " +
        'resolved. Please choose it on the page; it must be filled in by hand.',
  })

  // 箱状态 — API không có dữ liệu nào tương ứng.
  push('CNTR_EF_ID', '箱状态', '箱状态', undefined, {
    skipNote:
      'The site requires 箱状态 (CNTR_EF_ID) but the API provides no container status. ' +
      'Please choose it on the page; it must be filled in by hand.',
  })

  push('SEAL_NO', '铅封号', '铅封号', container.sealNUb)

  // 货物件数 — cùng luật số nguyên với 包装件数 của dòng hàng.
  const pieces = integerText(container.amount)
  push('PIECE_NUM', '货物件数', '货物件数', pieces.value, {
    fillNote: pieces.truncated
      ? `The site only accepts whole numbers for 货物件数 — wrote ${pieces.value} ` +
        `(the API gave "${pieces.raw}")`
      : undefined,
  })

  push('WEIGH_TON', '箱内货重（公斤）', '箱内货重（公斤）', container.weight)
  push('VOLUME_NUM', '箱内体积', '箱内体积', container.volume)

  // 货主箱标志 — `el-select` của site hiện nhãn `货主箱`/`非货主箱` (mã `Y`/`N`
  // chỉ nằm trong model) ⇒ phải ghi nhãn, không ghi mã.
  const soc =
    container.self === null || container.self === undefined
      ? undefined
      : container.self
        ? { label: '货主箱', code: 'Y' }
        : { label: '非货主箱', code: 'N' }
  push('SOC_ID', '货主箱标志', '货主箱标志', soc?.label, {
    fillNote: soc ? `The site stores the code "${soc.code}" for "${soc.label}"` : undefined,
    skipNote:
      'The site requires 货主箱标志 (SOC_ID) but the API provides no data. ' +
      'Please choose it on the page; it must be filled in by hand.',
  })

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
- Create: `src/core/select.ts` (stub — Task 8 thay bằng bản thật)
- Create: `tests/dom-text.test.ts`

> **Sửa sau đối chiếu site thật (2026-10-27, commit `34e456c` — "fix: align select filling with the live site").**
> Bản gốc của task này chỉ biết **input text**. Site thật dùng **4 loại control**
> khác nhau, phải nhận diện **lúc chạy** (A-11):
>
> | control trên site | adapter | ghi chú |
> |---|---|---|
> | `el-select` | `pickFromSelect` | click option theo **text hiển thị** |
> | `el-autocomplete` | `pickFromAutocomplete` | 5 ô cảng; phải **gõ** để site bắn `fetch-suggestions` rồi click suggestion |
> | input `readonly` | `pickFromPopper` | widget cảng của bản cũ |
> | input/textarea thường | `setTextValue` | native value setter + event `input` |
>
> Adapter phải nhận **chính field element** (`.el-select` gần nhất, hoặc chính input
> readonly) chứ không phải cả `.el-form-item` — trước đó `scope.querySelector('input')`
> lấy ô input **đầu tiên** của form item.
>
> `setFieldValue` còn nhận `options.matchValue` để truyền xuống
> `pickFromSelect`/`pickFromAutocomplete` (xem `FieldPlan.matchValue` ở Task 5).

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
  it('đọc label của el-select qua .el-select__selected-item', () => {
    document.body.innerHTML = `
      <div class="el-select">
        <div class="el-select__wrapper">
          <input id="el-id-a-PAY_WAY_ID" readonly />
          <span class="el-select__selected-item">预付</span>
        </div>
      </div>`
    expect(readFieldValue(document, 'PAY_WAY_ID')).toBe('预付')
  })
  it('đọc label của select chứ không phải text gõ trong input', () => {
    // el-select filterable đẩy text đang gõ vào `input.value`; label đã chọn
    // mới là giá trị thật của field.
    document.body.innerHTML = `
      <div class="el-select">
        <div class="el-select__wrapper">
          <input id="el-id-a-PAY_WAY_ID" value="COS" />
          <span class="el-select__selected-item">COSCO</span>
        </div>
      </div>`
    expect(readFieldValue(document, 'PAY_WAY_ID')).toBe('COSCO')
  })
  it('chưa chọn gì thì trả chuỗi rỗng, không trả placeholder của select', () => {
    // Placeholder "请选择" không phải giá trị → trả về nó sẽ làm verify pass
    // một cách giả.
    document.body.innerHTML = `
      <div class="el-select">
        <div class="el-select__wrapper">
          <input id="el-id-a-PAY_WAY_ID" readonly />
          <span class="el-select__selected-item is-transparent">请选择</span>
        </div>
      </div>`
    expect(readFieldValue(document, 'PAY_WAY_ID')).toBe('')
  })
  it('ô cảng (el-autocomplete) vẫn đọc được input.value', () => {
    document.body.innerHTML = `
      <div class="el-autocomplete">
        <input id="el-id-a-START_PORT_NAM" value="上海" />
      </div>`
    expect(readFieldValue(document, 'START_PORT_NAM')).toBe('上海')
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

describe('setFieldValue với popper', () => {
  it('adapter popper dùng đúng input cần điền, không phải input đầu tiên', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="other-input" />
        <input id="el-id-a-START_PORT_NAM" readonly />
      </div>
      <div class="el-popper"><div role="option">上海</div></div>`

    const other = document.getElementById('other-input') as HTMLInputElement
    const target = document.getElementById('el-id-a-START_PORT_NAM') as HTMLInputElement
    const clicks: string[] = []
    other.addEventListener('click', () => clicks.push('other'))
    target.addEventListener('click', () => clicks.push('target'))

    const result = await setFieldValue(document, 'START_PORT_NAM', '上海')

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['target'])
  })
})

describe('setFieldValue với el-autocomplete', () => {
  it('dùng adapter autocomplete chứ không gõ thẳng vào input', async () => {
    document.body.innerHTML = `
      <div class="el-autocomplete">
        <input id="el-id-a-START_PORT_NAM" />
      </div>`

    const input = document.getElementById('el-id-a-START_PORT_NAM') as HTMLInputElement
    const events: string[] = []
    input.addEventListener('input', () => events.push('input'))
    input.addEventListener('change', () => events.push('change'))
    input.addEventListener('blur', () => events.push('blur'))

    input.addEventListener('input', () => {
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          `
          <div class="el-popper">
            <ul class="el-autocomplete-suggestion">
              <li>上海/CNSHA</li>
            </ul>
          </div>`,
        )
      }, 0)
    })

    const clicks: string[] = []
    document.addEventListener('click', (event) => {
      const li = (event.target as HTMLElement).closest('li')
      if (li) clicks.push((li.textContent ?? '').trim())
    })

    const result = await setFieldValue(document, 'START_PORT_NAM', '上海', {
      matchValue: '上海/CNSHA',
    })

    expect(result.ok).toBe(true)
    expect(result.strategy).toBe('autocomplete')
    // Nhánh text (setTextValue) sẽ bắn change + blur → không được dùng.
    expect(events).not.toContain('change')
    expect(events).not.toContain('blur')
    expect(clicks).toEqual(['上海/CNSHA'])
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
import { pickFromAutocomplete, pickFromPopper, pickFromSelect } from './select'

export interface SetResult {
  ok: boolean
  strategy: 'text' | 'select' | 'autocomplete' | 'none'
  reason?: string
}

/**
 * Tìm field của form theo `prop`.
 * Element Plus gán `id = ${formId}-${prop}` cho input → ưu tiên selector theo đuôi id.
 */
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

/**
 * Gán giá trị vào input/textarea theo cách Vue 3 không ghi đè:
 * dùng native value setter rồi bắn `input` / `change` / `blur`.
 */
export function setTextValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  if (!desc?.set) {
    throw new Error('Could not find the native value setter')
  }
  desc.set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
}

/** Đọc lại giá trị hiện tại của field để verify. */
export function readFieldValue(root: ParentNode, prop: string): string {
  const el = findField(root, prop)
  if (!el) return ''

  // el-select: label đang chọn nằm ở `.el-select__selected-item`, KHÔNG nằm trong
  // `input.value` (select filterable còn đẩy cả text đang gõ vào đó) → đọc label
  // trước. Chưa chọn gì thì trả '' chứ không phải placeholder ("请选择"): trả
  // placeholder sẽ làm một verify pass giả.
  const select = el.closest<HTMLElement>('.el-select')
  if (select) {
    const items = Array.from(select.querySelectorAll<HTMLElement>('.el-select__selected-item'))
    // `is-transparent` = placeholder đang trong suốt (site đang hiện label khác).
    const real = items.filter((node) => !node.classList.contains('is-transparent'))
    return (real[real.length - 1]?.textContent ?? '').trim()
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value

  return (el.textContent ?? '').trim()
}

/**
 * Adapter chung để điền một field bất kỳ: tự nhận diện input text,
 * el-select, el-autocomplete hoặc popper của site rồi gọi đúng strategy tương ứng.
 */
export async function setFieldValue(
  root: ParentNode,
  prop: string,
  value: string,
  options: { timeout?: number; matchValue?: string } = {},
): Promise<SetResult> {
  const el = findField(root, prop)
  if (!el) {
    return { ok: false, strategy: 'none', reason: 'Could not find the field on the page' }
  }

  const select = el.closest<HTMLElement>('.el-select')
  if (select) {
    return pickFromSelect(select, value, options.timeout, options.matchValue)
  }

  // 5 ô cảng của site là `el-autocomplete` và input bên trong KHÔNG readonly.
  // Không có nhánh này thì chúng rơi vào nhánh text: chỉ gõ chữ, không bao giờ
  // click gợi ý → site không cascade mã cảng và field sai âm thầm.
  const autocomplete = el.closest<HTMLElement>('.el-autocomplete')
  if (autocomplete) {
    const input =
      el instanceof HTMLInputElement ? el : autocomplete.querySelector<HTMLInputElement>('input')
    if (input) {
      return pickFromAutocomplete(input, value, options.timeout, options.matchValue)
    }
  }

  if (el instanceof HTMLInputElement && el.readOnly) {
    return pickFromPopper(el, value, options.timeout)
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try {
      setTextValue(el, value)
      return { ok: true, strategy: 'text' }
    } catch (e) {
      // Không ném lỗi ra ngoài: một field hỏng không được dừng cả lần điền.
      return { ok: false, strategy: 'text', reason: (e as Error).message }
    }
  }

  return { ok: false, strategy: 'none', reason: 'The field is not an input, textarea or select' }
}

export { nextFrame, sleep, waitFor }

```

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: `tests/dom-text.test.ts` PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/dom.ts src/core/select.ts tests/dom-text.test.ts
git commit -m "feat: add field lookup and Vue-safe text value setter"
```

> Phải stage cả `src/core/select.ts` (stub tạo ở Step 3) — nếu không, file này sẽ nằm untracked
> và Task 8 ("Modify: `src/core/select.ts`") sẽ sửa một file chưa được commit.

---

## Task 8: `select.ts` — adapter chọn option (TDD)

**Files:**
- Modify: `src/core/select.ts`
- Create: `tests/select.test.ts`

> **Sửa sau code review (2026-10-27, commit `48b1b9c` — "fix: scope dropdown lookups to the control being driven").**
> Bản gốc của task này có 2 lỗi Critical mà unit test không bắt được, vì
> jsdom không có layout engine nên mọi phần tử đều "hiển thị":
>
> 1. `findVisiblePopper` fallback về "popper cuối cùng trong document" **kể cả khi
>    nó đang ẩn** → `waitFor` dừng ngay ở lần probe đầu tiên. Trên site thật,
>    Element Plus giữ dropdown đã đóng trong DOM, nên adapter sẽ lọc và click
>    bên trong một dropdown cũ đã đóng.
> 2. `findOptionIn` fallback về *mọi* option khi không có option nào hiển thị,
>    cộng với `pickFromSelect` tìm trong toàn bộ `document` → click giả vào option
>    nằm trong dropdown đóng vẫn kích hoạt handler của Vue, và adapter báo
>    `{ ok: true }` cho một field chưa hề được điền.
>
> Cách sửa đã áp dụng:
> - Thêm **seam** `setVisibilityProbe` / `isVisible` để logic phụ thuộc trình duyệt
>   trở nên test được. Mặc định coi mọi phần tử là hiển thị khi document không có
>   layout engine (jsdom); nếu có thì dùng `checkVisibility({ checkOpacity, checkVisibilityCSS })`.
> - `findOptionIn` xếp hạng theo **mức khớp trước** (chính xác > chứa), hiển thị chỉ
>   là tiêu chí phụ.
> - `resolveDropdown` xác định **dropdown mà trigger vừa mở**: `aria-controls` →
>   dropdown vừa xuất hiện → dropdown hiển thị cuối cùng đúng class. Không bao giờ
>   trả về dropdown đang ẩn. `aria-controls` được đọc trên trigger **và** trên
>   `<input>` bên trong nó, vì Element Plus đặt attribute này ở một trong hai chỗ
>   tuỳ phiên bản.
> - Không click option đang ẩn — trả về `{ ok: false }` kèm lý do.
> - `mouseClick` gọi `el.focus()` trước (component hay mở dropdown khi focus).
> - Click trigger nằm trong `try` → lỗi trả về `SetResult` chứ không reject promise.
> - `typeIntoInput` dùng native value setter và **ném lỗi** nếu thiếu setter.
>   `pickFromSelect` gõ vào input **không readonly** của select có filter;
>   `pickFromPopper` gõ vào ô filter của popper.
> - `dom.ts` truyền **chính field element** cho adapter (`.el-select` gần nhất, hoặc
>   chính input readonly) thay vì cả `.el-form-item` — trước đó
>   `scope.querySelector('input')` lấy ô input **đầu tiên** của form item.

> **Sửa sau đối chiếu site thật (2026-10-27, commit `34e456c` — "fix: align select filling with the live site").**
> Bản gốc của task này chỉ biết `el-select`. Site thật còn có **5 ô cảng dạng
> `el-autocomplete`** ⇒ thêm adapter riêng (A-5) và sửa 6 điểm sau:
>
> 1. **`pickFromAutocomplete`** — adapter riêng, có **danh sách selector riêng**
>    (`AUTOCOMPLETE_OPTION_SELECTORS`). Danh sách `OPTION_SELECTORS` dùng chung cho
>    select/popper **không được** chứa `.el-autocomplete-suggestion li`: 5 ô cảng
>    dùng chung một list gợi ý ⇒ adapter popper có thể click nhầm suggestion của
>    cảng khác rồi báo `ok` (E-2).
> 2. **`findOptionIn` có thêm tầng khớp "tiền tố"** (A-6) — suggestion của cảng có
>    dạng `名称/代码`, cần khớp được cả khi chỉ gõ tên.
> 3. **`resolveDropdown` thu candidate theo THỨ TỰ DOM** (A-7 + E-1) — Element Plus
>    append popper mới vào **cuối** `body` nên phần tử mới nhất là phần tử cuối cùng
>    trong DOM. Gom theo thứ tự ưu tiên class sẽ khiến `.pop()` trả về `.el-popper`
>    cuối cùng — có thể là popper của field khác. Thứ tự ưu tiên: `aria-controls` →
>    dropdown **vừa** mở → dropdown hiển thị cuối cùng đúng class.
> 4. **Gõ vào ô filter khi option đã có sẵn nhưng đang ẩn** — điều kiện là
>    `present && visible`, không chỉ `present`.
> 5. **Không gõ mù vào filter của select** (A-9) và **đóng dropdown khi pick hỏng**
>    (A-10).
> 6. **Thông điệp lỗi thống nhất** — `Could not select the option "X"` /
>    `Could not select the suggestion "X"`.
>
> Chi tiết: `docs/superpowers/plans/2026-10-27-live-site-alignment.md` (FIX LIST A +
> FIX LIST E).
>
- [ ] **Step 1: Viết test fail trước — `tests/select.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  pickFromSelect,
  pickFromPopper,
  pickFromAutocomplete,
  findOptionIn,
  isVisible,
  setVisibilityProbe,
} from '../src/core/select'

/** Probe giả lập: phần tử nằm trong container `data-hidden` thì bị coi là ẩn. */
const attrProbe = (el: HTMLElement): boolean => el.closest('[data-hidden]') === null

beforeEach(() => {
  document.body.innerHTML = ''
  setVisibilityProbe(null)
})

afterEach(() => {
  setVisibilityProbe(null)
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

  it('khớp chính xác ẩn vẫn thắng khớp chứa đang hiển thị', () => {
    setVisibilityProbe(attrProbe)
    document.body.innerHTML = `
      <div class="el-popper">
        <li class="el-select-dropdown__item">上海虹桥</li>
        <li class="el-select-dropdown__item" data-hidden="1">上海</li>
      </div>`
    const popper = document.querySelector('.el-popper')!
    expect(findOptionIn(popper, '上海')?.textContent?.trim()).toBe('上海')
  })

  it('ưu tiên option bắt đầu bằng giá trị (mức "starts with")', () => {
    document.body.innerHTML = `
      <div class="el-popper">
        <li class="el-select-dropdown__item">舟山上海</li>
        <li class="el-select-dropdown__item">上海港</li>
      </div>`
    const popper = document.querySelector('.el-popper')!
    // "舟山上海" chỉ *chứa* "上海", còn "上海港" *bắt đầu* bằng "上海".
    expect(findOptionIn(popper, '上海')?.textContent?.trim()).toBe('上海港')
  })

  it('giá trị rỗng thì không khớp option nào', () => {
    document.body.innerHTML = `
      <div class="el-popper">
        <li class="el-select-dropdown__item">上海</li>
      </div>`
    const popper = document.querySelector('.el-popper')!
    expect(findOptionIn(popper, '')).toBeNull()
    expect(findOptionIn(popper, '   ')).toBeNull()
  })

  it('khớp chính xác theo matchValue trước mức "starts with"', () => {
    document.body.innerHTML = `
      <div class="el-popper">
        <li class="el-select-dropdown__item">上海港/SHA</li>
        <li class="el-select-dropdown__item">上海/CNSHA</li>
      </div>`
    const popper = document.querySelector('.el-popper')!
    expect(findOptionIn(popper, '上海', '上海/CNSHA')?.textContent?.trim()).toBe('上海/CNSHA')
  })
})

describe('isVisible', () => {
  it('đi qua seam nên test giả lập được trạng thái hiển thị', () => {
    document.body.innerHTML = '<div id="hidden-box" data-hidden="1"></div><div id="shown-box"></div>'
    setVisibilityProbe(attrProbe)
    expect(isVisible(document.getElementById('hidden-box') as HTMLElement)).toBe(false)
    expect(isVisible(document.getElementById('shown-box') as HTMLElement)).toBe(true)
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
    // Thông điệp phải nêu rõ loại option (đồng bộ với nhánh "is not visible").
    expect(result.reason).toContain('Could not select the option "KHONG_CO"')
  })

  it('không click option đang ẩn', async () => {
    setVisibilityProbe(attrProbe)
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown">
        <div class="el-select-dropdown__item" data-hidden="1">COSCO</div>
      </div>`

    const option = document.querySelector('.el-select-dropdown__item') as HTMLElement
    let clicked = 0
    option.addEventListener('click', () => {
      clicked += 1
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 300)

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('COSCO')
    expect(clicked).toBe(0)
  })

  it('không dùng dropdown cũ đang ẩn', async () => {
    setVisibilityProbe(attrProbe)
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown" data-hidden="1">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    const option = document.querySelector('.el-select-dropdown__item') as HTMLElement
    let clicked = 0
    option.addEventListener('click', () => {
      clicked += 1
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 300)

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('COSCO')
    expect(clicked).toBe(0)
  })

  it('chỉ tìm option trong dropdown vừa mở, không tìm cả document', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd-other">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>
      <div class="el-select-dropdown" id="dd-open">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    let open = false
    setVisibilityProbe((el) => (el.id === 'dd-open' ? open : el.closest('[data-hidden]') === null))
    const wrapper = document.querySelector('.el-select__wrapper') as HTMLElement
    wrapper.addEventListener('click', () => {
      open = true
    })

    const clicks: string[] = []
    const otherOption = document.querySelector('#dd-other .el-select-dropdown__item') as HTMLElement
    const openOption = document.querySelector('#dd-open .el-select-dropdown__item') as HTMLElement
    otherOption.addEventListener('click', () => clicks.push('other'))
    openOption.addEventListener('click', () => clicks.push('open'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 1000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['open'])
  })

  it('ưu tiên dropdown vừa mở hơn dropdown hiển thị cuối cùng', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd-open">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>
      <div class="el-select-dropdown" id="dd-other">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    let open = false
    setVisibilityProbe((el) => (el.id === 'dd-open' ? open : el.closest('[data-hidden]') === null))
    const wrapper = document.querySelector('.el-select__wrapper') as HTMLElement
    wrapper.addEventListener('click', () => {
      open = true
    })

    const clicks: string[] = []
    const otherOption = document.querySelector('#dd-other .el-select-dropdown__item') as HTMLElement
    const openOption = document.querySelector('#dd-open .el-select-dropdown__item') as HTMLElement
    otherOption.addEventListener('click', () => clicks.push('other'))
    openOption.addEventListener('click', () => clicks.push('open'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 1000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['open'])
  })

  it('tìm dropdown qua aria-controls nằm trên input bên trong wrapper', async () => {
    // Element Plus đặt aria-controls lên <input class="el-select__input">,
    // không phải lên .el-select__wrapper.
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper">
            <input class="el-select__input" aria-controls="dd-target" readonly />
          </div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd-target">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>
      <div class="el-select-dropdown" id="dd-other">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    const clicks: string[] = []
    const target = document.querySelector('#dd-target .el-select-dropdown__item') as HTMLElement
    const other = document.querySelector('#dd-other .el-select-dropdown__item') as HTMLElement
    target.addEventListener('click', () => clicks.push('target'))
    other.addEventListener('click', () => clicks.push('other'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 1000)

    expect(result.ok).toBe(true)
    // dd-other nằm sau trong DOM nên fallback "dropdown hiển thị cuối cùng" sẽ chọn nó;
    // chỉ aria-controls mới chỉ đúng dd-target.
    expect(clicks).toEqual(['target'])
  })

  it('tìm dropdown qua aria-controls nằm trên wrapper', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper" aria-controls="dd-target">
            <input class="el-select__input" readonly />
          </div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd-target">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>
      <div class="el-select-dropdown" id="dd-other">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    const clicks: string[] = []
    const target = document.querySelector('#dd-target .el-select-dropdown__item') as HTMLElement
    const other = document.querySelector('#dd-other .el-select-dropdown__item') as HTMLElement
    target.addEventListener('click', () => clicks.push('target'))
    other.addEventListener('click', () => clicks.push('other'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 1000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['target'])
  })

  it('lấy dropdown theo aria-controls dù nó chưa hiển thị, không dùng dropdown cũ', async () => {
    // Vue flush DOM ở microtask → ngay sau click, popper mới vẫn đang ẩn.
    // Nếu adapter fallback sang "dropdown hiển thị cuối cùng" thì nó sẽ bấm
    // nhầm vào dropdown cũ của field trước và báo thành công (ghi sai chỗ).
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper" aria-controls="dd-target">
            <input class="el-select__input" readonly />
          </div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd-stale">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>
      <div class="el-select-dropdown" id="dd-target">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    let opened = false
    setVisibilityProbe((el) =>
      el.closest('#dd-target') ? opened : el.closest('[data-hidden]') === null,
    )
    const wrapper = document.querySelector('.el-select__wrapper') as HTMLElement
    wrapper.addEventListener('click', () => {
      setTimeout(() => {
        opened = true
      }, 0)
    })

    const clicks: string[] = []
    const stale = document.querySelector('#dd-stale .el-select-dropdown__item') as HTMLElement
    const target = document.querySelector('#dd-target .el-select-dropdown__item') as HTMLElement
    stale.addEventListener('click', () => clicks.push('stale'))
    target.addEventListener('click', () => clicks.push('target'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 2000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['target'])
  })

  it('aria-controls chưa resolve thì vẫn dùng được dropdown vừa mở', async () => {
    // Element Plus mount popper lazily: lúc click, id trong `aria-controls` có
    // thể chưa có trong DOM. Nếu adapter trả về null ngay thì mọi el-select
    // trên site (承运人代码 / 付款方式 / 交货条款) đều timeout.
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper" aria-controls="dd-lazy">
            <input class="el-select__input" readonly />
          </div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd-just-opened">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    let opened = false
    setVisibilityProbe((el) =>
      el.closest('#dd-just-opened') ? opened : el.closest('[data-hidden]') === null,
    )
    const wrapper = document.querySelector('.el-select__wrapper') as HTMLElement
    wrapper.addEventListener('click', () => {
      setTimeout(() => {
        opened = true
      }, 0)
    })

    const clicks: string[] = []
    const option = document.querySelector('#dd-just-opened .el-select-dropdown__item') as HTMLElement
    option.addEventListener('click', () => clicks.push('just-opened'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 2000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['just-opened'])
  })

  it('khi nhiều dropdown cùng vừa mở thì lấy dropdown MỚI NHẤT', async () => {
    // Element Plus append popper mới vào cuối `body` → dropdown mới nhất nằm
    // cuối DOM. Lấy nhầm dropdown cũ sẽ ghi sai field mà vẫn báo thành công.
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd-old">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>
      <div class="el-select-dropdown" id="dd-new">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    let opened = false
    setVisibilityProbe((el) => {
      const dropdown = el.closest('#dd-old, #dd-new')
      return dropdown ? opened : el.closest('[data-hidden]') === null
    })
    const wrapper = document.querySelector('.el-select__wrapper') as HTMLElement
    wrapper.addEventListener('click', () => {
      opened = true
    })

    const clicks: string[] = []
    const oldOption = document.querySelector('#dd-old .el-select-dropdown__item') as HTMLElement
    const newOption = document.querySelector('#dd-new .el-select-dropdown__item') as HTMLElement
    oldOption.addEventListener('click', () => clicks.push('old'))
    newOption.addEventListener('click', () => clicks.push('new'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 1000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['new'])
  })

  it('select không click nhầm suggestion của el-autocomplete', async () => {
    // 5 ô cảng dùng chung một list gợi ý `名称/代码`; adapter của select
    // không được bấm vào suggestion đó (ghi sai chỗ, báo thành công).
    // Fixture phải giống markup thật: popper của site có CẢ `el-popper` (đó là
    // điều khiến `.el-popper li` trong OPTION_SELECTORS bắt được suggestion).
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown el-popper" id="dd">
        <ul class="el-autocomplete-suggestion">
          <li>上海/CNSHA</li>
        </ul>
      </div>`

    const suggestion = document.querySelector('.el-autocomplete-suggestion li') as HTMLElement
    let clicked = 0
    suggestion.addEventListener('click', () => {
      clicked += 1
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, '上海', 300)

    // Cả hai phía: KHÔNG click suggestion, và adapter không được báo thành công.
    expect(clicked).toBe(0)
    expect(result.ok).toBe(false)
  })

  it('khi trang có cả popper lẫn select-dropdown thì lấy phần tử MỚI NHẤT trong DOM', async () => {
    // `collectByClasses` gom theo thứ tự ưu tiên class → `.pop()` trả về
    // `.el-popper` cuối cùng, KHÔNG phải phần tử mới nhất. Ở đây popper
    // (giống tooltip/popper của field khác) đứng trước dropdown trong DOM và
    // cũng "vừa hiện" → adapter phải chọn dropdown, không phải popper.
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-popper" id="pp-other">
        <div role="option">COSCO</div>
      </div>
      <div class="el-select-dropdown" id="dd-dropdown">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    let opened = false
    setVisibilityProbe((el) => {
      const dropdown = el.closest('#pp-other, #dd-dropdown')
      return dropdown ? opened : el.closest('[data-hidden]') === null
    })
    const wrapper = document.querySelector('.el-select__wrapper') as HTMLElement
    wrapper.addEventListener('click', () => {
      opened = true
    })

    const clicks: string[] = []
    const popperOption = document.querySelector('#pp-other [role="option"]') as HTMLElement
    const dropdownOption = document.querySelector('#dd-dropdown .el-select-dropdown__item') as HTMLElement
    popperOption.addEventListener('click', () => clicks.push('popper'))
    dropdownOption.addEventListener('click', () => clicks.push('dropdown'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 1000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['dropdown'])
  })

  it('gõ vào ô tìm kiếm của select có filter khi option chưa có sẵn', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input id="el-id-a-TRUST_COD" /></div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd"></div>`

    const search = document.getElementById('el-id-a-TRUST_COD') as HTMLInputElement
    const dropdown = document.getElementById('dd') as HTMLElement
    const events: string[] = []
    search.addEventListener('input', () => {
      events.push('input')
      dropdown.insertAdjacentHTML(
        'beforeend',
        '<div class="el-select-dropdown__item">MAEU</div>',
      )
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'MAEU', 1000)

    expect(result.ok).toBe(true)
    expect(search.value).toBe('MAEU')
    expect(events).toContain('input')
  })

  it('không gõ vào ô filter khi option đã có sẵn trong dropdown', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input id="el-id-a-TRUST_COD" /></div>
        </div>
      </div>
      <div class="el-select-dropdown">
        <div class="el-select-dropdown__item">MAEU</div>
      </div>`

    const search = document.getElementById('el-id-a-TRUST_COD') as HTMLInputElement
    const events: string[] = []
    search.addEventListener('input', () => events.push('input'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'MAEU', 1000)

    expect(result.ok).toBe(true)
    expect(search.value).toBe('')
    expect(events).not.toContain('input')
  })

  it('gõ vào ô filter khi option đã có sẵn nhưng đang ẩn', async () => {
    // Dropdown còn giữ filter cũ nên option khớp đang bị ẩn: adapter phải gõ
    // để lọc lại, nếu không sẽ timeout ở `waitForVisibleOption`.
    setVisibilityProbe(attrProbe)
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input id="el-id-a-TRUST_COD" /></div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd">
        <div class="el-select-dropdown__item" data-hidden="1">MAEU</div>
      </div>`

    const search = document.getElementById('el-id-a-TRUST_COD') as HTMLInputElement
    const option = document.querySelector('.el-select-dropdown__item') as HTMLElement
    const clicks: string[] = []
    option.addEventListener('click', () => clicks.push('MAEU'))
    search.addEventListener('input', () => {
      option.removeAttribute('data-hidden')
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'MAEU', 1000)

    expect(result.ok).toBe(true)
    expect(search.value).toBe('MAEU')
    expect(clicks).toEqual(['MAEU'])
  })

  it('blur trigger khi không tìm thấy option', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select"><input id="trig" readonly /></div>
      </div>
      <div class="el-select-dropdown">
        <div class="el-select-dropdown__item">MAEU</div>
      </div>`

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'KHONG_CO', 300)

    expect(result.ok).toBe(false)
    expect(document.activeElement?.id).not.toBe('trig')
  })

  it('không gõ vào input readonly của select', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input id="el-id-a-TRUST_COD" readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown">
        <div class="el-select-dropdown__item">MAEU</div>
      </div>`

    const input = document.getElementById('el-id-a-TRUST_COD') as HTMLInputElement
    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'MAEU', 1000)

    expect(result.ok).toBe(true)
    expect(input.value).toBe('')
  })

  it('lỗi khi click trigger ném exception vẫn trả về SetResult', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    const trigger = document.querySelector('.el-select__wrapper') as HTMLElement
    trigger.dispatchEvent = () => {
      throw new Error('click failed')
    }

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 300)

    expect(result.ok).toBe(false)
    expect(result.strategy).toBe('select')
    expect(result.reason).toContain('COSCO')
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

  it('gõ vào ô filter của popper', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="el-id-a-START_PORT_NAM" readonly />
      </div>
      <div class="el-popper">
        <input class="filter-input" />
        <div role="option">上海</div>
        <div role="option">宁波</div>
      </div>`

    const filter = document.querySelector('.filter-input') as HTMLInputElement
    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '宁波', 1000)

    expect(result.ok).toBe(true)
    expect(filter.value).toBe('宁波')
  })

  it('focus trigger trước khi click', async () => {
    document.body.innerHTML = `
      <div class="el-form-item"><input id="trig" readonly /></div>
      <div class="el-popper"><div role="option">上海</div></div>`

    const trigger = document.getElementById('trig') as HTMLInputElement
    let activeWhenClicked = ''
    trigger.addEventListener('click', () => {
      activeWhenClicked = document.activeElement?.id ?? ''
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '上海', 1000)

    expect(result.ok).toBe(true)
    expect(activeWhenClicked).toBe('trig')
  })

  it('không dùng popper cũ đang ẩn', async () => {
    setVisibilityProbe(attrProbe)
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="el-id-a-START_PORT_NAM" readonly />
      </div>
      <div class="el-popper" data-hidden="1">
        <div role="option">上海</div>
      </div>`

    const option = document.querySelector('[role="option"]') as HTMLElement
    let clicked = 0
    option.addEventListener('click', () => {
      clicked += 1
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '上海', 300)

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('上海')
    expect(clicked).toBe(0)
  })

  it('popper không click nhầm suggestion của el-autocomplete', async () => {
    // Popper của site chứa list gợi ý `el-autocomplete`; adapter popper phải bỏ
    // qua chúng, nếu không sẽ bấm nhầm suggestion của 5 ô cảng.
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="el-id-a-START_PORT_NAM" readonly />
      </div>
      <div class="el-popper">
        <input class="filter-input" />
        <ul class="el-autocomplete-suggestion">
          <li>上海/CNSHA</li>
        </ul>
      </div>`

    const suggestion = document.querySelector('.el-autocomplete-suggestion li') as HTMLElement
    let clicked = 0
    suggestion.addEventListener('click', () => {
      clicked += 1
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '上海', 300)

    expect(result.ok).toBe(false)
    expect(clicked).toBe(0)
  })

  it('không gõ vào input readonly trong popper', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="el-id-a-START_PORT_NAM" readonly />
      </div>
      <div class="el-popper">
        <input class="display-input" readonly />
        <div role="option">上海</div>
      </div>`

    const display = document.querySelector('.display-input') as HTMLInputElement
    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '上海', 1000)

    expect(result.ok).toBe(true)
    expect(display.value).toBe('')
  })

  it('blur trigger khi không tìm thấy option', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="trig" readonly />
      </div>
      <div class="el-popper"><div role="option">上海</div></div>`

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '宁波', 300)

    expect(result.ok).toBe(false)
    expect(document.activeElement?.id).not.toBe('trig')
  })
})

describe('pickFromAutocomplete', () => {
  /** Dựng mô phỏng el-autocomplete: gõ vào input → site trả về list gợi ý. */
  function buildAutocomplete(options: { hidden?: boolean } = {}): {
    input: HTMLInputElement
    clicks: string[]
  } {
    document.body.innerHTML = `
      <div class="el-autocomplete">
        <input id="el-id-a-START_PORT_NAM" />
      </div>`

    const input = document.getElementById('el-id-a-START_PORT_NAM') as HTMLInputElement
    const clicks: string[] = []

    input.addEventListener('input', () => {
      // Site gọi API rồi mới render list gợi ý.
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          `
          <div class="el-popper" id="sug">
            <ul class="el-autocomplete-suggestion">
              <li${options.hidden ? ' data-hidden="1"' : ''}>上海/CNSHA</li>
              <li>上海虹桥/SHA</li>
            </ul>
          </div>`,
        )
      }, 0)
    })

    document.addEventListener('click', (event) => {
      const li = (event.target as HTMLElement).closest('li')
      if (li) clicks.push((li.textContent ?? '').trim())
    })

    return { input, clicks }
  }

  it('gõ vào input rồi click suggestion 名称/代码', async () => {
    const { input, clicks } = buildAutocomplete()
    const events: string[] = []
    input.addEventListener('input', () => events.push('input'))

    const result = await pickFromAutocomplete(input, '上海', 2000, '上海/CNSHA')

    expect(result.ok).toBe(true)
    expect(result.strategy).toBe('autocomplete')
    expect(input.value).toBe('上海')
    expect(events).toContain('input')
    expect(clicks).toEqual(['上海/CNSHA'])
  })

  it('không click suggestion đang ẩn', async () => {
    setVisibilityProbe(attrProbe)
    const { input, clicks } = buildAutocomplete({ hidden: true })

    const result = await pickFromAutocomplete(input, '上海', 300, '上海/CNSHA')

    expect(result.ok).toBe(false)
    expect(result.strategy).toBe('autocomplete')
    expect(clicks).toEqual([])
  })

  it('báo lỗi khi không có suggestion nào xuất hiện', async () => {
    document.body.innerHTML = `
      <div class="el-autocomplete">
        <input id="el-id-a-START_PORT_NAM" />
      </div>`
    const input = document.getElementById('el-id-a-START_PORT_NAM') as HTMLInputElement

    const result = await pickFromAutocomplete(input, '上海', 300)

    expect(result.ok).toBe(false)
    expect(result.strategy).toBe('autocomplete')
    expect(result.reason).toContain('上海')
    // Thông điệp phải nêu rõ loại suggestion (đồng bộ với nhánh "is not visible").
    expect(result.reason).toContain('Could not select the suggestion "上海"')
  })

  it('không blur input trước khi click (blur sẽ đóng list gợi ý)', async () => {
    const { input, clicks } = buildAutocomplete()
    const events: string[] = []
    input.addEventListener('blur', () => events.push('blur'))
    input.addEventListener('change', () => events.push('change'))

    await pickFromAutocomplete(input, '上海', 2000, '上海/CNSHA')

    expect(events).not.toContain('blur')
    expect(events).not.toContain('change')
    expect(clicks).toEqual(['上海/CNSHA'])
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

/** Danh sách gợi ý của `el-autocomplete` (mỗi `li` là một option `名称/代码`). */
const AUTOCOMPLETE_LIST_SELECTOR = '.el-autocomplete-suggestion'

/**
 * Option của dropdown `el-select` và popper của site.
 *
 * KHÔNG gộp `.el-autocomplete-suggestion li` vào đây: 5 ô cảng dùng chung một
 * list gợi ý `名称/代码`, adapter của select/popper bấm nhầm vào đó là ghi sai
 * chỗ mà vẫn báo thành công. `pickFromAutocomplete` dùng danh sách riêng.
 */
const OPTION_SELECTORS = [
  '.el-select-dropdown__item',
  '.el-cascader-node',
  '[role="option"]',
  '.el-popper li',
].join(',')

/** Selector riêng cho adapter autocomplete (tìm trong list gợi ý). */
const AUTOCOMPLETE_OPTION_SELECTORS = [
  `${AUTOCOMPLETE_LIST_SELECTOR} li`,
  '.el-select-dropdown__item',
  '[role="option"]',
].join(',')

/** Class của dropdown, theo thứ tự ưu tiên cho từng adapter. */
const SELECT_DROPDOWN_CLASSES = ['el-select-dropdown', 'el-popper']
const POPPER_DROPDOWN_CLASSES = ['el-popper', 'el-select-dropdown']

export type VisibilityProbe = (el: HTMLElement) => boolean

let hasLayoutEngine: boolean | null = null

/**
 * jsdom không có layout engine nên `getClientRects()` luôn rỗng — nếu không coi
 * mọi phần tử là hiển thị thì adapter sẽ không tìm thấy option trong test.
 */
function documentHasLayout(): boolean {
  if (hasLayoutEngine === null) {
    const root = document.documentElement
    hasLayoutEngine = root ? root.getClientRects().length > 0 : false
  }
  return hasLayoutEngine
}

function defaultIsVisible(el: HTMLElement): boolean {
  if (!documentHasLayout()) return true
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  }
  return el.getClientRects().length > 0 || el.offsetParent !== null
}

let visibilityProbe: VisibilityProbe = defaultIsVisible

/** Seam để test giả lập trạng thái hiển thị; truyền `null` để trở về mặc định. */
export function setVisibilityProbe(probe: VisibilityProbe | null): void {
  visibilityProbe = probe ?? defaultIsVisible
}

/** Kiểm tra hiển thị theo seam (mặc định dùng layout thật). */
export function isVisible(el: HTMLElement): boolean {
  return visibilityProbe(el)
}

/** Cách tìm option bên trong một container. */
export interface OptionQuery {
  /** Danh sách selector dùng để thu thập option. */
  selectors?: string
  /** Có tính cả option nằm trong list gợi ý của `el-autocomplete` hay không. */
  includeAutocomplete?: boolean
}

/** Query dùng cho adapter autocomplete (tìm trong list gợi ý `名称/代码`). */
const AUTOCOMPLETE_QUERY: OptionQuery = {
  selectors: AUTOCOMPLETE_OPTION_SELECTORS,
  includeAutocomplete: true,
}

/**
 * Tìm option khớp `value` bên trong `container`.
 *
 * Các mức khớp, mỗi mức ưu tiên phần tử đang hiển thị:
 * 1. khớp chính xác `matchValue` (nếu có) — dùng cho cảng: ta gõ tên (`上海`)
 *    nhưng suggestion của site hiển thị `名称/代码` (`上海/CNSHA`);
 * 2. khớp chính xác `value`;
 * 3. `value` là tiền tố của text option;
 * 4. `value` nằm trong text option.
 *
 * `value` rỗng thì không khớp gì (trước đây `''.includes('')` khớp option đầu tiên).
 *
 * Mặc định bỏ qua option nằm trong list gợi ý của `el-autocomplete` — đó là
 * danh sách riêng của 5 ô cảng, adapter select/popper bấm vào đó là ghi sai chỗ.
 */
export function findOptionIn(
  container: ParentNode,
  value: string,
  matchValue?: string,
  query: OptionQuery = {},
): HTMLElement | null {
  const needle = value.trim()
  if (needle === '') return null

  const selectors = query.selectors ?? OPTION_SELECTORS
  const includeAutocomplete = query.includeAutocomplete ?? false
  const all = Array.from(container.querySelectorAll<HTMLElement>(selectors)).filter(
    (el) => includeAutocomplete || el.closest(AUTOCOMPLETE_LIST_SELECTOR) === null,
  )
  const textOf = (el: HTMLElement): string => (el.textContent ?? '').trim()

  const tiers: Array<(text: string) => boolean> = []
  const match = matchValue?.trim()
  if (match) tiers.push((text) => text === match)
  tiers.push((text) => text === needle)
  tiers.push((text) => text.startsWith(needle))
  tiers.push((text) => text.includes(needle))

  for (const tier of tiers) {
    const matched = all.filter((el) => tier(textOf(el)))
    if (matched.length === 0) continue
    const visible = matched.find((el) => visibilityProbe(el))
    return visible ?? matched[0]!
  }
  return null
}

/** Click giả: focus trước (component hay mở dropdown khi focus) rồi bắn chuột. */
function mouseClick(el: Element): void {
  try {
    const focusable = el as HTMLElement
    if (typeof focusable.focus === 'function') focusable.focus()
  } catch {
    // Không focus được thì bỏ qua, vẫn click tiếp.
  }
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function collectByClasses(classes: string[]): HTMLElement[] {
  const seen = new Set<HTMLElement>()
  const result: HTMLElement[] = []
  for (const cls of classes) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`.${cls}`))) {
      if (!seen.has(el)) {
        seen.add(el)
        result.push(el)
      }
    }
  }
  return result
}

function collectDropdowns(): HTMLElement[] {
  return collectByClasses(['el-select-dropdown', 'el-popper'])
}

/**
 * `aria-controls` trỏ tới id của dropdown.
 *
 * Element Plus đặt attribute này ở hai chỗ khác nhau tuỳ phiên bản: lên
 * `.el-select__wrapper` (role combobox) hoặc lên `<input class="el-select__input">`
 * bên trong nó. Vì vậy đọc trên trigger trước, rồi mới tìm trong hậu duệ —
 * nếu chỉ đọc một chỗ thì trên site thật nhánh này sẽ không bao giờ chạy.
 */
function ariaControlsOf(trigger: HTMLElement): string | null {
  const own = trigger.getAttribute('aria-controls')
  if (own) return own
  const inner = trigger.querySelector<HTMLElement>('[aria-controls]')
  return inner?.getAttribute('aria-controls') ?? null
}

/**
 * Xác định dropdown mà trigger vừa mở ra:
 * 1. `aria-controls` **đã resolve** → trả về dropdown đó, kể cả khi nó đang ẩn
 *    (Vue flush DOM ở microtask nên ngay sau click popper mới vẫn chưa hiện —
 *    tìm option sẽ chờ nó hiện ra);
 * 2. `aria-controls` có nhưng **chưa resolve** (Element Plus mount popper lazily)
 *    → rơi xuống tầng "dropdown vừa mở": chỉ nhận dropdown trước đó không có
 *    trong DOM hoặc trước đó đang ẩn, nên không bao giờ là dropdown cũ;
 * 3. tầng "dropdown hiển thị cuối cùng" **chỉ** dùng khi trigger không có liên
 *    kết `aria-controls` nào — nếu có, dropdown đang hiện có thể là dropdown cũ
 *    của field trước, bấm vào đó là ghi sai chỗ mà vẫn báo thành công.
 */
function resolveDropdown(
  trigger: HTMLElement,
  before: Set<HTMLElement>,
  visibleBefore: Set<HTMLElement>,
  classes: string[],
): HTMLElement | null {
  const controls = ariaControlsOf(trigger)
  if (controls) {
    const linked = document.getElementById(controls)
    if (linked) {
      // Vue flush DOM ở microtask nên ngay sau click, popper mới vẫn đang ẩn →
      // phải trả về dropdown liên kết (tìm option sẽ chờ nó hiện ra).
      return linked
    }
    // Popper chưa được mount → KHÔNG trả về null ở đây, tầng "dropdown vừa mở"
    // bên dưới vẫn tìm được dropdown của field này.
  }

  // Thu thập candidate theo THỨ TỰ DOM: Element Plus append popper mới vào
  // cuối `body` nên phần tử mới nhất là phần tử cuối cùng trong DOM.
  // (Gom theo thứ tự ưu tiên class sẽ khiến `.pop()` trả về `.el-popper` cuối
  // cùng — có thể là popper của field khác, không phải dropdown vừa mở.)
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(classes.map((cls) => `.${cls}`).join(',')),
  )

  const justOpened = candidates
    .filter((el) => visibilityProbe(el) && (!before.has(el) || !visibleBefore.has(el)))
    .pop()
  if (justOpened) return justOpened

  // Có liên kết `aria-controls` nhưng chưa resolve: tuyệt đối KHÔNG fallback
  // sang "dropdown hiển thị cuối cùng" — đó là dropdown cũ của field trước.
  if (controls) return null

  for (const cls of classes) {
    const visible = candidates.filter((el) => el.classList.contains(cls) && visibilityProbe(el))
    if (visible.length > 0) return visible[visible.length - 1]!
  }
  return null
}

/** Gõ giá trị vào input bằng native setter để Vue 3 không ghi đè, rồi bắn event `input`. */
function typeIntoInput(input: HTMLInputElement, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  if (!desc?.set) {
    throw new Error('Could not find the native value setter')
  }
  desc.set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Blur trigger để Element Plus đóng popper — tránh dropdown cũ sót lại cho field sau. */
function blurTrigger(trigger: HTMLElement): void {
  try {
    if (typeof trigger.blur === 'function') trigger.blur()
  } catch {
    // Không blur được thì bỏ qua, không được làm hỏng cả lần điền.
  }
}

/** Thông điệp lỗi khi không chọn được option. */
function optionFailureReason(
  container: HTMLElement | null,
  value: string,
  matchValue: string | undefined,
  error: unknown,
  noun = 'option',
  query: OptionQuery = {},
): string {
  const hidden = container ? findOptionIn(container, value, matchValue, query) : null
  if (hidden && !visibilityProbe(hidden)) {
    return `The ${noun} "${matchValue ?? value}" is not visible`
  }
  return `Could not select the ${noun} "${value}": ${(error as Error).message}`
}

/**
 * Chờ option khớp **và đang hiển thị** trong `container`.
 *
 * Chờ tới khi hiện (chứ không lấy luôn option đầu tiên rồi mới kêu "không hiện")
 * vì popper vừa mở thường chưa hiển thị ngay — Vue flush DOM ở microtask.
 */
async function waitForVisibleOption(
  container: HTMLElement,
  value: string,
  matchValue: string | undefined,
  timeout: number,
  label: string,
  query: OptionQuery = {},
): Promise<HTMLElement> {
  return waitFor(
    () => {
      const found = findOptionIn(container, value, matchValue, query)
      return found && visibilityProbe(found) ? found : null
    },
    { timeout, interval: 100, label },
  )
}

/** Mở dropdown `el-select` rồi click option khớp. */
export async function pickFromSelect(
  scope: HTMLElement,
  value: string,
  timeout = 5000,
  matchValue?: string,
): Promise<SetResult> {
  const select = scope.querySelector<HTMLElement>('.el-select') ?? scope
  const trigger =
    select.querySelector<HTMLElement>('.el-select__wrapper') ??
    select.querySelector<HTMLElement>('input') ??
    select

  const before = new Set(collectDropdowns())
  const visibleBefore = new Set(Array.from(before).filter((el) => visibilityProbe(el)))
  let dropdown: HTMLElement | null = null

  try {
    mouseClick(trigger)

    dropdown = await waitFor(
      () => resolveDropdown(trigger, before, visibleBefore, SELECT_DROPDOWN_CLASSES),
      { timeout, interval: 100, label: `dropdown for "${value}"` },
    )
    const box = dropdown

    const search = select.querySelector<HTMLInputElement>('input:not([readonly])')
    if (search) {
      // Chỉ gõ khi option CHƯA có sẵn (và đang hiện) trong dropdown: select lọc
      // theo thứ khác (không phải label) sẽ mất option cần chọn khi bị gõ đè.
      // Option tồn tại nhưng đang ẩn (dropdown còn giữ filter cũ) thì vẫn phải
      // gõ — nếu không, `waitForVisibleOption` sẽ timeout.
      const present = findOptionIn(box, value, matchValue)
      if (!present || !visibilityProbe(present)) {
        typeIntoInput(search, value)
        await sleep(300)
      }
    }

    const option = await waitForVisibleOption(
      box,
      value,
      matchValue,
      timeout,
      `option "${matchValue ?? value}"`,
    )

    mouseClick(option)
    await nextFrame()
    return { ok: true, strategy: 'select' }
  } catch (e) {
    blurTrigger(trigger)
    return {
      ok: false,
      strategy: 'select',
      reason: optionFailureReason(dropdown, value, matchValue, e),
    }
  }
}

/** Mở popper tự dựng (component cảng của site), gõ lọc nếu có ô filter, rồi click option. */
export async function pickFromPopper(
  scope: HTMLElement,
  value: string,
  timeout = 5000,
): Promise<SetResult> {
  const trigger =
    scope instanceof HTMLInputElement
      ? scope
      : scope.querySelector<HTMLElement>('input[readonly]') ??
        scope.querySelector<HTMLElement>('input') ??
        scope

  const before = new Set(collectDropdowns())
  const visibleBefore = new Set(Array.from(before).filter((el) => visibilityProbe(el)))
  let popper: HTMLElement | null = null

  try {
    mouseClick(trigger)

    popper = await waitFor(
      () => resolveDropdown(trigger, before, visibleBefore, POPPER_DROPDOWN_CLASSES),
      { timeout, interval: 100, label: `popper for "${value}"` },
    )
    const box = popper

    // Chỉ gõ vào ô filter KHÔNG readonly — input readonly đầu tiên trong popper
    // có thể là chính input display của field.
    const filter = box.querySelector<HTMLInputElement>('input:not([readonly])')
    if (filter) {
      typeIntoInput(filter, value)
      await sleep(300)
    }

    const option = await waitForVisibleOption(
      box,
      value,
      undefined,
      timeout,
      `option "${value}" in the popper`,
    )

    mouseClick(option)
    await nextFrame()
    return { ok: true, strategy: 'select' }
  } catch (e) {
    blurTrigger(trigger)
    return {
      ok: false,
      strategy: 'select',
      reason: optionFailureReason(popper, value, undefined, e),
    }
  }
}

/** Các list gợi ý của `el-autocomplete` đang có trong DOM. */
function collectSuggestionLists(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(AUTOCOMPLETE_LIST_SELECTOR))
}

/**
 * Tìm list gợi ý mà `el-autocomplete` vừa mở.
 *
 * Ưu tiên list sinh ra sau khi gõ; nếu không có (popper được tái dùng) thì lấy
 * list đang hiển thị; cuối cùng mới lấy list mới nhất trong DOM.
 */
function resolveSuggestionList(before: Set<HTMLElement>): HTMLElement | null {
  const lists = collectSuggestionLists().filter((el) => el.querySelector('li'))
  if (lists.length === 0) return null
  const fresh = lists.filter((el) => !before.has(el))
  if (fresh.length > 0) return fresh[fresh.length - 1]!
  // Popper của field khác vẫn nằm trong DOM nhưng đã đóng → tính hiển thị theo popper.
  const visible = lists.filter((el) => visibilityProbe(el.closest<HTMLElement>('.el-popper') ?? el))
  if (visible.length > 0) return visible[visible.length - 1]!
  return lists[lists.length - 1]!
}

/**
 * Điền một ô `el-autocomplete` (5 ô cảng của site).
 *
 * Gõ giá trị bằng native setter + event `input` → Element Plus gọi
 * `fetch-suggestions` và render list gợi ý (`li` có dạng `名称/代码`). Click vào
 * đúng suggestion đó thì site mới cascade mã cảng vào ô `*_PORT_COD`.
 */
export async function pickFromAutocomplete(
  input: HTMLInputElement,
  value: string,
  timeout = 5000,
  matchValue?: string,
): Promise<SetResult> {
  const before = new Set(collectSuggestionLists())
  let list: HTMLElement | null = null

  try {
    // KHÔNG blur/change trước: blur sẽ đóng list gợi ý.
    input.focus()
    typeIntoInput(input, value)

    list = await waitFor(() => resolveSuggestionList(before), {
      timeout,
      interval: 100,
      label: `suggestions for "${value}"`,
    })
    const box = list

    const option = await waitForVisibleOption(
      box,
      value,
      matchValue,
      timeout,
      `suggestion "${matchValue ?? value}"`,
      AUTOCOMPLETE_QUERY,
    )

    mouseClick(option)
    await nextFrame()
    return { ok: true, strategy: 'autocomplete' }
  } catch (e) {
    blurTrigger(input)
    return {
      ok: false,
      strategy: 'autocomplete',
      reason: optionFailureReason(list, value, matchValue, e, 'suggestion', AUTOCOMPLETE_QUERY),
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

> **Sửa sau đối chiếu site thật (2026-10-27, commit `14f45ec` — "fix: map cargo and
> container fields the way the site expects", và commit sửa `src/core/fill.ts` —
> c950758 — "fix: follow the site's real dialog overlay and table structure").**
>
> Block `src/core/fill.ts` bên dưới là **bản file sau khi sửa**, không phải bản gốc
> của Task 9. Các thay đổi so với bản gốc:
>
> 1. **`FillItem` có thêm `row?: number`** (B-10) — popup cần nó để phân biệt các
>    dòng hàng trùng `prop`. `FillScope` được tách ra và dùng lại cho
>    `FillItem.scope` (B-11).
> 2. **`fillPlans`** (B-9, B-14) — nhánh `skip` không còn `await nextFrame()`;
>    item `ok` cũng mang `note` (ví dụ *"The site stores the code \"P\" for
>    \"预付\""*) để người dùng đối chiếu được mã mà site lưu.
> 3. **Tra cứu section có biên giới** (B-3, B-4) — `sectionOf()`,
>    `sectionTableRoot()`, `findContainerTable()` (kiểm tra cột `箱号`),
>    `findContainerAddButton()`: không còn "leo ra khỏi section" để bấm nhầm
>    nút `新增` của section khác.
> 4. **Auto-submit có kiểm tra kết quả** (B-15) — sau khi bấm `确定`, phải thấy
>    dialog đóng lại; còn mở ⇒ báo ⚠️ *"the site did not accept the form — the
>    container rows still require 尺寸 / 箱型 / 箱状态"*, tuyệt đối không báo
>    thành công.
> 5. `isDisabled()` được kiểm tra trước **mọi** lần bấm.
>
> Chi tiết: `docs/superpowers/plans/2026-10-27-live-site-alignment.md` (FIX LIST B
> + FIX LIST D).
>
- [ ] **Step 1: Tạo helper DOM test — `tests/helpers/dom.ts`**

```ts
export interface HeaderFormOptions {
  /**
   * 'static' = dialog có sẵn trong DOM (mặc định — test gọi fillHeader trực tiếp);
   * 'lazy'   = chỉ render sau khi bấm nút 新增舱单信息 (mô phỏng site thật);
   * 'never'  = có nút nhưng dialog không bao giờ mở (nhánh lỗi).
   */
  dialogMode?: 'static' | 'lazy' | 'never'
  /** Để trống 3 ô mã cảng (`*_PORT_COD`) ngay từ đầu — mã chỉ được điền khi
   *  site cascade sau khi suggestion được click. */
  emptyPortCodes?: boolean
  /** Site cascade mã cảng vào ô `*_PORT_COD` khi người dùng click suggestion
   *  (mặc định có). Tắt đi để mô phỏng trường hợp cascade không xảy ra. */
  cascadePortCodes?: boolean
  /** Thêm nút trùng text 新增舱单信息 nằm trong tab đã ẩn (Element Plus giữ tab đã xem). */
  hiddenDuplicateButton?: boolean
  /** Site TỪ CHỐI lưu dòng hàng (dialog hàng không đóng, không thêm dòng vào
   *  bảng danh sách) — mô phỏng validate fail vì thiếu 包装类型/代码. */
  rejectCargoSave?: boolean
  /** Bấm 确定 trong dialog đầu KHÔNG đóng dialog — mô phỏng site từ chối form. */
  keepDialogOpenOnSubmit?: boolean
  /** Trạng thái của nút 确定 trong dialog đầu:
   *  'present' (mặc định) | 'missing' (không có nút) | 'disabled' (bị disable). */
  submitButton?: 'present' | 'missing' | 'disabled'
  /** Section 货物信息 có bảng DANH SÁCH hàng không (mặc định có). */
  goodsList?: boolean
  /** Nút 新增舱单信息 bị disable (site khoá nút khi tab chưa sẵn sàng). */
  addManifestDisabled?: boolean
  /**
   * Dialog hàng KHÔNG teleport: nằm trong `.el-overlay-dialog` của dialog đầu,
   * không có overlay riêng.
   */
  nestedCargoDialog?: boolean
}

/** Tuỳ chọn của dialog hàng (24 field). */
export interface CargoDialogOptions {
  /** Có nút 保存 trong footer không (mặc định có — site thật chỉ có 取消 + 保存). */
  saveButton?: boolean
  /** Site từ chối lưu: dialog không đóng và bảng danh sách không có dòng mới. */
  rejectSave?: boolean
  /** Nút 保存 bị disable (site khoá nút lưu khi form chưa hợp lệ). */
  disabledSaveButton?: boolean
  /**
   * Site từ chối lưu VÀ dựng lại dialog (node cũ bị gỡ khỏi DOM, node mới
   * thay vào chỗ nó) — mô phỏng Vue thay thế element khi re-render.
   *
   * Đây là cái bẫy của B-13: node đã bắt bị detach ⇒ coi như "dialog đã đóng"
   * ⇒ báo thành công trong khi 0 dòng nào được lưu.
   */
  replaceDialogOnSave?: boolean
  /**
   * Sau khi lưu thành công, site dựng lại section 货物信息 ⇒ node nút 新增 cũ
   * bị gỡ khỏi DOM và thay bằng node mới (click trên node cũ là no-op).
   */
  replaceAddButtonOnSave?: boolean
  /**
   * Site DÙNG LẠI một element dialog cho mọi dòng (reset form thay vì mount
   * dialog mới) — biến thể khác của site, extension phải không vỡ.
   */
  reuseDialog?: boolean
  /**
   * Dialog hàng KHÔNG teleport: `.el-dialog` nằm trực tiếp trong
   * `.el-overlay-dialog` của dialog đầu, KHÔNG có overlay riêng.
   */
  nestedCargoDialog?: boolean
  /**
   * Sau khi lưu thành công, site dựng lại CẢ SECTION 货物信息 (node section cũ
   * bị gỡ khỏi DOM, section mới có nút 新增 mới).
   */
  replaceSectionOnSave?: boolean
}

/** Tuỳ chọn của section 货物信息. */
export interface CargoSectionOptions extends CargoDialogOptions {
  /** Bảng DANH SÁCH hàng nằm trong section (mặc định có — giống site thật). */
  goodsList?: boolean
}

/**
 * Nhịp nghỉ trước khi fixture mở dialog hàng.
 *
 * Đây là **lựa chọn của fixture**, KHÔNG phải số liệu của site: site thật
 * dùng `setTimeout(..., 400)` — nhanh hơn `CARGO_DIALOG_DELAY_MS` (600ms) của
 * extension.
 *
 * Fixture cố tình CHẬM HƠN 600ms để bắt được lỗi "tra cứu dialog quá sớm":
 * nếu extension tra cứu ngay sau khi bấm 新增 (sau 600ms) thì nó chỉ thấy
 * dialog CŨ ⇒ test "không dùng dialog hàng đã có sẵn" phải đỏ.
 *
 * Ràng buộc: giá trị này PHẢI lớn hơn `CARGO_DIALOG_DELAY_MS` (600ms).
 */
const CARGO_DIALOG_OPEN_DELAY_MS = 650

interface HeaderField {
  prop: string
  label: string
  kind: 'input' | 'select' | 'autocomplete'
  /** Giá trị có sẵn trong DOM (dùng cho ô do site tự cascade). */
  prefilled?: string
}

/**
 * 25 field của form đầu.
 *
 * Ba ô mã cảng (`*_PORT_COD`) được điền sẵn: extension KHÔNG BAO GIỜ ghi vào
 * chúng — site tự cascade mã khi người dùng chọn *tên* cảng. Giá trị có sẵn
 * trong fixture chỉ để mô phỏng "cascade đã xảy ra", nhờ đó nhánh verify
 * (đọc lại mã cảng) có thể pass.
 */
const HEADER_FIELDS: HeaderField[] = [
  { prop: 'BILL_NBR', label: '提单号', kind: 'input' },
  { prop: 'E_SHIP_NAM', label: '船名', kind: 'input' },
  { prop: 'OUT_VOYAGE_NO', label: '航次', kind: 'input' },
  { prop: 'TRUST_COD', label: '承运人代码', kind: 'select' },
  { prop: 'PAY_WAY_ID', label: '付款方式', kind: 'select' },
  { prop: 'DR_TYPE_STR', label: '交货条款', kind: 'select' },
  { prop: 'START_PORT_NAM', label: '收货地（装货港）', kind: 'autocomplete' },
  { prop: 'START_PORT_COD', label: '收货地代码', kind: 'input', prefilled: 'CNSHA' },
  { prop: 'DISCHRG_PORT_NAM', label: '卸货港', kind: 'autocomplete' },
  { prop: 'DISCHRG_PORT_COD', label: '卸货港代码', kind: 'input', prefilled: 'CNSHA' },
  { prop: 'DEST_PORT_NAM', label: '交货地', kind: 'autocomplete' },
  { prop: 'DEST_PORT_COD', label: '交货地代码', kind: 'input', prefilled: 'CNSHA' },
  { prop: 'E_SHIPPER_NAM', label: '发货人名称', kind: 'input' },
  { prop: 'SHIPPER_ADD_STR', label: '发货人地址', kind: 'input' },
  { prop: 'SHIPPER_COUNTRY_COD', label: '国家代码', kind: 'input' },
  { prop: 'SHIPPER_TE_STR', label: '电话', kind: 'input' },
  { prop: 'E_CONSIGNEE_NAM', label: '收货人名称', kind: 'input' },
  { prop: 'CONSIGNEE_ADD_STR', label: '收货人地址', kind: 'input' },
  { prop: 'CONSIGNEE_COUNTRY_COD', label: '国家代码', kind: 'input' },
  { prop: 'CONSIGNEE_TE_STR', label: '电话', kind: 'input' },
  { prop: 'E_NOTIFY_NAM', label: '通知人名称', kind: 'input' },
  { prop: 'NOTIFY_ADD_STR', label: '通知人地址', kind: 'input' },
  { prop: 'NOTIFY_COUNTRY_COD', label: '国家代码', kind: 'input' },
  { prop: 'NOTIFY_TE_STR', label: '电话', kind: 'input' },
]

/** Gợi ý của `el-autocomplete` — mỗi `li` có dạng `名称/代码`. */
const PORT_SUGGESTIONS = ['上海/CNSHA', '勿拉湾/IDBLW']

function headerFieldsHtml(emptyPortCodes: boolean): string {
  return HEADER_FIELDS.map((field) => {
    let control: string
    if (field.kind === 'select') {
      control = `<div class="el-select"><div class="el-select__wrapper"><input id="el-id-x-${field.prop}" readonly /></div></div>`
    } else if (field.kind === 'autocomplete') {
      control = `<div class="el-autocomplete"><input id="el-id-x-${field.prop}" /></div>`
    } else {
      control = `<input id="el-id-x-${field.prop}"${
        field.prefilled && !emptyPortCodes ? ` value="${field.prefilled}"` : ''
      } />`
    }
    return `<div class="el-form-item EntryOfManifestInformation">
        <label class="el-form-item__label" for="el-id-x-${field.prop}">${field.label}</label>
        ${control}
      </div>`
  }).join('')
}

/** Cột của bảng DANH SÁCH hàng (section 货物信息). */
export const GOODS_LIST_COLUMNS = ['货物标识', '包装件数', '货物毛重（公斤）', '货物描述']

/**
 * Bảng DANH SÁCH hàng — site thêm 1 dòng ở đây mỗi khi lưu được 1 dòng hàng.
 *
 * CỐ Ý CHỈ CÓ 4 CỘT, site thật có 12 (FACT 5.4). Extension chỉ dùng SỐ DÒNG
 * của bảng này (để biết site có nhận dòng hàng hay không) ⇒ thiếu cột không
 * ảnh hưởng, nhưng đừng giả định fixture giống site 1:1.
 */
function goodsListHtml(): string {
  const header = GOODS_LIST_COLUMNS.map((c) => `<th>${c}</th>`).join('')
  return `<div class="el-table" id="goods-table">
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
      </div>`
}

/**
 * Bảng container inline editable.
 *
 * Bảng CỐ TÌNH không nằm trong cùng div với tiêu đề 箱信息: trên site thật,
 * ancestor gần nhất của tiêu đề chứa **cả** bảng danh sách hàng lẫn bảng
 * container ⇒ tra cứu bảng phải khoanh theo section rồi kiểm tra cột 箱号,
 * không được lấy "bảng đầu tiên trong scope".
 *
 * Header có THÊM một ô `<th class="el-table__gutter">` (Element Plus thêm khi
 * bảng cuộn ngang) nhưng body KHÔNG có ô tương ứng ⇒ đọc header phải loại ô
 * gutter, nếu không mọi cột sẽ lệch sang phải một ô.
 */
function containerTableHtml(): string {
  const header =
    `<th class="el-table__gutter"></th>` + CONTAINER_COLUMNS.map((c) => `<th>${c}</th>`).join('')
  return `<div class="el-table" id="container-table">
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
      </div>`
}

/**
 * Bọc dialog vào overlay đúng như Element Plus 2.x.
 *
 * Site thật render:
 * ```html
 * <div class="el-overlay el-overlay--center" style="display: block;">
 *   <div class="el-overlay-dialog">
 *     <div class="el-dialog" role="dialog">…</div>
 *   </div>
 * </div>
 * ```
 * và `v-show` nằm trên **`.el-overlay`** ⇒ khi đóng, overlay có
 * `style="display:none"`, còn `.el-dialog` KHÔNG bị đụng tới.
 *
 * Fixture cũ ẩn thẳng `.el-dialog` ⇒ nhánh `ownOverlay()` của `isHidden()`
 * (chính là nhánh quyết định "dialog đã đóng ⇒ site đã nhận") không bao giờ
 * được chạy trong test ⇒ lỗi ở đó không bị bắt.
 */
function overlayHtml(dialogHtml: string): string {
  return `<div class="el-overlay el-overlay--center" style="display: block;">
      <div class="el-overlay-dialog">${dialogHtml}</div>
    </div>`
}

/** Ẩn dialog đúng như Element Plus: ẩn OVERLAY của nó, không ẩn `.el-dialog`. */
function hideDialog(dialog: HTMLElement): void {
  const overlay = dialog.closest<HTMLElement>('.el-overlay')
  if (overlay) overlay.style.display = 'none'
  else dialog.style.display = 'none'
}

/** Hiện lại dialog (overlay của nó). */
function showDialog(dialog: HTMLElement): void {
  const overlay = dialog.closest<HTMLElement>('.el-overlay')
  if (overlay) overlay.style.display = 'block'
  else dialog.style.display = 'block'
}

/** Section 货物信息 trong dialog đầu — bấm 新增 sẽ mở dialog hàng. */
function cargoSectionHtml(options: CargoSectionOptions = {}): string {
  const goodsList = options.goodsList === false ? '' : goodsListHtml()
  return `<div class="CargoInformation">
      <div class="fs-crud-title">货物信息</div>
      <button class="el-button" id="add-cargo">新增</button>
      ${goodsList}
    </div>`
}

/** Section 箱信息 + bảng container (bảng là anh em, không phải con của section). */
function containerSectionHtml(options: ContainerSectionOptions = {}): string {
  const button = options.noAddButton
    ? ''
    : `<button class="el-button" id="add-container"${
        options.disabledAddButton ? ' disabled' : ''
      }>新增</button>`
  return `<div class="ContainerInformation">
      <div class="fs-crud-title">箱信息</div>
      ${button}
    </div>
    ${containerTableHtml()}`
}

/** Dialog đầu (舱单) — gồm form đầu + section hàng + bảng container. */
function headerDialogHtml(
  emptyPortCodes: boolean,
  cargoOptions: CargoSectionOptions,
  submitButton: HeaderFormOptions['submitButton'],
): string {
  const submit =
    submitButton === 'missing'
      ? ''
      : `<button class="el-button el-button--primary" id="submit-manifest"${
          submitButton === 'disabled' ? ' disabled' : ''
        }>确定</button>`

  return overlayHtml(`<div class="el-dialog" id="manifest-dialog">
      <div class="el-dialog__body">
        <div class="el-form">${headerFieldsHtml(emptyPortCodes)}</div>
        ${cargoSectionHtml(cargoOptions)}
        ${containerSectionHtml()}
      </div>
      <div class="el-dialog__footer">
        <button class="el-button">取消</button>
        ${submit}
      </div>
    </div>`)
}

/* ------------------------------------------------------------------ *
 *  Dialog hàng (货物信息) — 24 field
 * ------------------------------------------------------------------ */

/**
 * Field của dialog hàng là `el-select` với option tĩnh (FACT 5.1).
 *
 * `CARGO_KIND_COD` là select quan trọng nhất: C-1 ghi **nhãn** `普货` vào đó ⇒
 * nếu fixture render nó bằng input thường thì nhánh select không bao giờ chạy
 * và test vẫn xanh trong khi site thật sẽ hỏng.
 */
const CARGO_SELECTS: { prop: string; label: string; options: string[] }[] = [
  {
    prop: 'CARGO_KIND_COD',
    label: '货物标识',
    options: ['普货', '危险品', '冷藏品', '危险品+冷藏品'],
  },
  { prop: 'TEMP_ID', label: '温度计量单位', options: ['摄氏', '华氏'] },
]

let cargoDialogCounter = 0

/** HTML của 1 dialog hàng — footer là 取消 + 保存 (KHÔNG phải 确定). */
function cargoDialogHtml(id: string, prefix: string, options: CargoDialogOptions): string {
  const fields = CARGO_PROPS.map((prop) => {
    const select = CARGO_SELECTS.find((s) => s.prop === prop)
    if (select) {
      // Element Plus: select không filterable có `.el-select__selected-item` chứa
      // nhãn đang chọn; dropdown được `aria-controls` trỏ tới (site mount popper
      // ra body, không nằm trong dialog).
      return `<div class="el-form-item">
        <label class="el-form-item__label" for="${prefix}-${prop}">${select.label}</label>
        <div class="el-select">
          <div class="el-select__wrapper" aria-controls="${id}-${prop}" data-select-prop="${prop}">
            <div class="el-select__selection">
              <span class="el-select__placeholder is-transparent"><span>请选择</span></span>
              <span class="el-select__selected-item"></span>
              <input id="${prefix}-${prop}" readonly />
            </div>
          </div>
        </div>
      </div>`
    }
    // PACKAGE_STR / PACKAGE_COD là `el-autocomplete` trên site thật (FACT 5.1),
    // nhưng C-2 bắt buộc bỏ trống cả hai ⇒ không có gì để điền ⇒ để là input
    // thường trong fixture (KHÔNG phải mô phỏng đầy đủ control của site).
    return `<div class="el-form-item"><label class="el-form-item__label" for="${prefix}-${prop}">${prop}</label>
        <input id="${prefix}-${prop}" /></div>`
  }).join('')

  const footer =
    options.saveButton === false
      ? '<button class="el-button">取消</button>'
      : `<button class="el-button">取消</button><button class="el-button el-button--primary"${
          options.disabledSaveButton ? ' disabled' : ''
        }>保存</button>`

  return `<div class="el-dialog" data-cargo-dialog="1" id="${id}">
      <div class="el-dialog__body">
        <div class="el-form">${fields}</div>
      </div>
      <div class="el-dialog__footer">
        ${footer}
      </div>
    </div>`
}

/**
 * Dropdown của các `el-select` trong dialog hàng — site mount popper ra `body`.
 *
 * Mỗi select có dropdown RIÊNG (Element Plus render 1 popper/select) và được
 * `aria-controls` trỏ tới ⇒ adapter định danh đúng dropdown, không bấm nhầm
 * dropdown của select khác.
 */
function cargoSelectDropdownsHtml(dialogId: string): string {
  return CARGO_SELECTS.map((select) => {
    const items = select.options
      .map(
        (option) =>
          `<div class="el-select-dropdown__item" data-dialog="${dialogId}" data-prop="${select.prop}">${option}</div>`,
      )
      .join('')
    return `<div class="el-select-dropdown" id="${dialogId}-${select.prop}">${items}</div>`
  }).join('')
}

/** Chọn option của `el-select` ⇒ ghi nhãn vào `.el-select__selected-item`. */
function wireCargoSelectOption(option: HTMLElement): void {
  option.addEventListener('click', () => {
    const dialogId = option.getAttribute('data-dialog')
    const prop = option.getAttribute('data-prop')
    if (!dialogId || !prop) return
    const dialog = document.getElementById(dialogId)
    const select = dialog?.querySelector<HTMLElement>(`[data-select-prop="${prop}"]`)
    const target = select?.querySelector('.el-select__selected-item')
    if (target) target.textContent = (option.textContent ?? '').trim()
  })
}

let saveClickCount = 0
let clickedOptions: string[] = []

/**
 * Đặt lại các bộ đếm click.
 *
 * Gọi khi dựng fixture mới — nếu không, một test lưu hàng sẽ làm hỏng test
 * khác đếm số lần bấm 保存.
 */
export function resetClicks(): void {
  saveClickCount = 0
  clickedOptions = []
}

/** Số lần nút 保存 của dialog hàng bị bấm. */
export function cargoSaveClicks(): number {
  return saveClickCount
}

/**
 * Nút 保存 của dialog hàng: ẩn dialog (mô phỏng lưu thành công) và thêm 1 dòng
 * vào bảng DANH SÁCH hàng nếu có. `rejectSave` ⇒ site từ chối (dialog vẫn mở,
 * bảng không đổi) — đúng như khi validate fail vì thiếu 包装类型/代码.
 *
 * `replaceDialogOnSave` ⇒ site vừa từ chối vừa dựng lại dialog: node cũ bị gỡ
 * khỏi DOM, một node MỚI (cùng id) thay vào chỗ nó ⇒ node đã bắt trở nên
 * "không còn trong DOM" trong khi dòng hàng CHƯA được lưu.
 */
function wireCargoSave(dialog: HTMLElement, options: CargoDialogOptions): void {
  const save = Array.from(dialog.querySelectorAll<HTMLElement>('button')).find(
    (b) => (b.textContent ?? '').trim() === '保存',
  )
  if (!save) return

  save.addEventListener('click', () => {
    saveClickCount += 1

    if (options.rejectSave) {
      if (options.replaceDialogOnSave) {
        // Vue thay thế element: node cũ detach, node mới có cùng id.
        const fresh = dialog.cloneNode(true) as HTMLElement
        dialog.parentElement?.replaceChild(fresh, dialog)
        wireCargoSave(fresh, options)
      }
      return
    }

    // Site đóng dialog ⇒ ẩn OVERLAY (Element Plus đặt `v-show` trên overlay),
    // `.el-dialog` không bị đụng tới.
    hideDialog(dialog)
    const tbody = document.querySelector('.CargoInformation .el-table__body tbody')
    if (tbody) {
      const tr = document.createElement('tr')
      tr.innerHTML = GOODS_LIST_COLUMNS.map(() => '<td></td>').join('')
      tbody.appendChild(tr)
    }

    if (options.replaceAddButtonOnSave) {
      // Site dựng lại section ⇒ node nút 新增 cũ bị gỡ khỏi DOM.
      // Listener đã gắn trên SECTION nên node mới vẫn bấm được, còn node cũ
      // (đã rời DOM) thì click() là no-op — đúng hành vi thật của site.
      const old = document.getElementById('add-cargo')
      if (old) {
        const fresh = document.createElement('button')
        fresh.className = 'el-button'
        fresh.id = 'add-cargo'
        fresh.textContent = '新增'
        old.replaceWith(fresh)
      }
    }

    if (options.replaceSectionOnSave) {
      // Site dựng lại CẢ SECTION 货物信息: node section cũ bị gỡ khỏi DOM,
      // section mới có nút 新增 mới ⇒ node nút cũ click() là no-op.
      const old = document.querySelector('.CargoInformation')
      if (old) {
        const fresh = old.cloneNode(true) as HTMLElement
        // Bản clone mang theo cờ "đã gắn listener" ⇒ phải xoá để gắn lại.
        fresh.removeAttribute('data-cargo-add-wired')
        old.replaceWith(fresh)
        // Trên site thật listener của Vue nằm ở gốc app nên section mới vẫn
        // bấm được; fixture gắn listener trên SECTION ⇒ phải gắn lại.
        wireCargoAdd(options)
      }
    }
  })
}

/**
 * Tạo MỘT dialog hàng mới (24 field) và gắn handler của nút 保存.
 *
 * Mỗi lần gọi là một dialog khác nhau — giống site thật (Element Plus mount
 * dialog mới cho mỗi lần bấm 新增, dialog cũ vẫn nằm trong DOM).
 *
 * `reuseDialog` ⇒ site DÙNG LẠI một element cho mọi dòng (reset form rồi hiện
 * lại) — biến thể khác của site, extension phải không vỡ.
 */
export function createCargoDialog(options: CargoDialogOptions = {}): HTMLElement {
  if (options.reuseDialog) {
    const existing = cargoDialogs()[0]
    if (existing) {
      // Reset form của dialog dùng lại rồi hiện lại.
      existing.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
        input.value = ''
      })
      existing.querySelectorAll<HTMLElement>('.el-select__selected-item').forEach((item) => {
        item.textContent = ''
      })
      showDialog(existing)
      return existing
    }
  }

  cargoDialogCounter += 1
  const id = `cargo-dialog-${cargoDialogCounter}`
  const prefix = `el-id-c${cargoDialogCounter}`

  const host = document.createElement('div')
  const dialogMarkup = cargoDialogHtml(id, prefix, options)

  let dialog: HTMLElement
  if (options.nestedCargoDialog) {
    // Dialog hàng KHÔNG teleport: `.el-dialog` nằm trực tiếp trong
    // `.el-overlay-dialog` của dialog đầu, KHÔNG có overlay riêng ⇒ khi
    // dialog đầu đóng, overlay của cha ẩn theo nhưng dialog hàng không bị
    // đụng tới (đúng như site khi dialog con không teleport).
    host.innerHTML = dialogMarkup
    dialog = host.querySelector<HTMLElement>('.el-dialog')!
    const parent = document.querySelector('.el-overlay-dialog')
    ;(parent ?? document.body).appendChild(dialog)
  } else {
    // Bọc overlay đúng như Element Plus ⇒ `.el-dialog` nằm trong
    // `.el-overlay > .el-overlay-dialog`, và đóng dialog = ẩn overlay.
    host.innerHTML = overlayHtml(dialogMarkup)
    const overlay = host.firstElementChild as HTMLElement
    dialog = host.querySelector<HTMLElement>('.el-dialog')!
    document.body.appendChild(overlay)
  }
  wireCargoSave(dialog, options)

  // Dropdown của các el-select — site mount popper ra body.
  const dropdowns = document.createElement('div')
  dropdowns.innerHTML = cargoSelectDropdownsHtml(id)
  document.body.appendChild(dropdowns)
  dropdowns.querySelectorAll<HTMLElement>('.el-select-dropdown__item').forEach((option) => {
    wireCargoSelectOption(option)
  })
  trackOptionClicks()

  return dialog
}

/** Nhãn đang chọn của một field `el-select` trong dialog hàng. */
export function cargoSelectValue(dialog: HTMLElement, prop: string): string {
  const select = dialog.querySelector<HTMLElement>(`[data-select-prop="${prop}"]`)
  const item = select?.querySelector('.el-select__selected-item')
  return (item?.textContent ?? '').trim()
}

/** Các dialog hàng đã mở (theo thứ tự mở). */
export function cargoDialogs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.el-dialog[data-cargo-dialog="1"]'))
}

/** Dialog hàng thứ `index` (0-based). */
export function cargoDialog(index: number): HTMLElement | null {
  return cargoDialogs()[index] ?? null
}

/**
 * Giá trị hiện tại của một field trong dialog hàng.
 *
 * Field render bằng `el-select` (货物标识, 温度计量单位) giữ nhãn đang chọn ở
 * `.el-select__selected-item`, KHÔNG nằm trong `input.value` — đọc input là
 * luôn ra rỗng ⇒ đọc theo đúng loại control.
 */
export function cargoFieldValue(dialog: HTMLElement, prop: string): string {
  const select = dialog.querySelector<HTMLElement>(`[data-select-prop="${prop}"]`)
  if (select) {
    const item = select.querySelector('.el-select__selected-item')
    return (item?.textContent ?? '').trim()
  }
  const input = dialog.querySelector<HTMLInputElement>(`input[id$="-${prop}"]`)
  return input?.value ?? ''
}

/** Số dòng của bảng DANH SÁCH hàng (section 货物信息). */
export function goodsListRowCount(): number {
  const tbody = document.querySelector('.CargoInformation .el-table__body tbody')
  return tbody ? tbody.querySelectorAll('tr').length : 0
}

/* ------------------------------------------------------------------ *
 *  Option của dropdown (dùng để assert nhánh select chạy)
 * ------------------------------------------------------------------ */

/** Các option của dropdown đã bị click (dùng để assert nhánh select chạy). */
export function selectedOptions(): string[] {
  return [...clickedOptions]
}

/** Ghi lại option nào bị click (idempotent — không gắn listener 2 lần). */
function trackOptionClicks(): void {
  document
    .querySelectorAll<HTMLElement>('.el-select-dropdown__item')
    .forEach((item) => {
      if (item.dataset.tracked === '1') return
      item.dataset.tracked = '1'
      item.addEventListener('click', () => {
        clickedOptions.push((item.textContent ?? '').trim())
      })
    })
}

/* ------------------------------------------------------------------ *
 *  Section hàng / bảng container
 * ------------------------------------------------------------------ */

/** Section 货物信息 trong dialog đầu, nút 新增 sẽ mở dialog hàng. */
export function buildCargoSection(options: CargoSectionOptions = {}): void {
  resetClicks()
  document.body.insertAdjacentHTML('beforeend', cargoSectionHtml(options))
  wireCargoAdd(options)
}

/**
 * Gắn handler cho nút 新增 của section 货物信息: mở MỘT dialog hàng mới.
 *
 * Site mở dialog hàng sau một `setTimeout` (không phải ngay khi click) ⇒
 * fixture cũng tạo dialog sau một nhịp nghỉ (650ms — LỰA CHỌN CỦA FIXTURE,
 * xem `CARGO_DIALOG_OPEN_DELAY_MS`). Nếu tạo đồng bộ thì dialog mới luôn nằm
 * cuối DOM và mọi cách "tìm dialog chứa E_CARGO_NAM" đều ra đúng dialog ⇒ test
 * "không dùng dialog hàng đã có sẵn" sẽ xanh dù code cũ.
 *
 * Listener gắn trên SECTION (ancestor ổn định), KHÔNG gắn trên node nút —
 * giống cách Vue gắn listener: khi site dựng lại nút 新增, node cũ bị gỡ
 * khỏi DOM và `click()` trên node cũ là **no-op** (sự kiện không bubble tới
 * section vì node đó đã rời cây DOM). Gắn thẳng vào node nút thì node cũ vẫn
 * giữ listener ⇒ click vào node đã detach vẫn "chạy" ⇒ che mất đúng lỗi
 * mà C-3 cần bắt.
 */
export function wireCargoAdd(options: CargoDialogOptions = {}): void {
  const button = document.getElementById('add-cargo')
  if (!button) return
  const section = button.closest<HTMLElement>('.CargoInformation') ?? document.body
  // Idempotent: gọi lại (site dựng lại section) không được tạo listener chồng.
  if (section.dataset.cargoAddWired === '1') return
  section.dataset.cargoAddWired = '1'
  section.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (!target?.closest('#add-cargo')) return
    window.setTimeout(() => createCargoDialog(options), CARGO_DIALOG_OPEN_DELAY_MS)
  })
}

/** Dialog hàng (24 field) đã có sẵn trong DOM (không mở bằng click). */
export function buildCargoDialog(options: CargoDialogOptions = {}): HTMLElement {
  resetClicks()
  return createCargoDialog(options)
}

/** Tuỳ chọn của section 箱信息 (bảng container). */
export interface ContainerSectionOptions {
  /** Nút 新增 của bảng container bị disable (site khoá nút khi form chưa hợp lệ). */
  disabledAddButton?: boolean
  /** Không có nút 新增 của bảng container. */
  noAddButton?: boolean
}

/** Bảng container inline editable + section 箱信息. */
export function buildContainerSection(options: ContainerSectionOptions = {}): void {
  resetClicks()
  document.body.insertAdjacentHTML('beforeend', containerSectionHtml(options))
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="el-select-dropdown">
      <div class="el-select-dropdown__item">20'</div>
      <div class="el-select-dropdown__item">20GP</div>
      <div class="el-select-dropdown__item">货主箱</div>
      <div class="el-select-dropdown__item">非货主箱</div>
    </div>`,
  )
  trackOptionClicks()
}

/** tbody của bảng container. */
function containerTbody(): HTMLElement | null {
  return document.querySelector('#container-table .el-table__body tbody')
}

/** HTML của một dòng container — cột trong `selectColumns` render bằng el-select. */
function containerRowHtml(selectColumns: string[] = []): string {
  return CONTAINER_COLUMNS.map((column) => {
    if (selectColumns.includes(column)) {
      // Element Plus render select không filterable bằng <span>, trong ô KHÔNG có
      // <input> nào ⇒ nhánh select phải chạy trước khi tìm input.
      return '<td><div class="el-select"><div class="el-select__wrapper"><span class="el-select__input"></span></div></div></td>'
    }
    return '<td><input /></td>'
  }).join('')
}

/**
 * Gắn sự kiện giả lập fast-crud: bấm 新增 → thêm một dòng trống vào tbody.
 *
 * Dòng mới được chèn ở **index 0** (`insertTableRow(0, {})` của site) ⇒ dòng
 * mới KHÔNG phải dòng cuối.
 *
 * `rerenderOnInput` mô phỏng Element Plus dựng lại `<tr>` khi model của dòng
 * đổi: node `<tr>` cũ bị thay bằng một node MỚI ⇒ code ghi field phải tra lại
 * dòng, không được giữ node đã bị detach.
 *
 * `reuseRows` mô phỏng `el-table` KHÔNG có `row-key`: key của dòng là INDEX
 * của nó ⇒ `insertTableRow(0, {})` làm Vue TÁI SỬ DỤNG node `<tr>` #0 cho dòng
 * mới (dữ liệu cũ bị xoá khỏi node đó) và chỉ mount node mới cho dòng cũ
 * cuối. Đây là hành vi thật của site ⇒ dòng mới KHÔNG phải node mới ⇒ tìm
 * dòng bằng "node không nằm trong ảnh chụp trước" sẽ ra SAI dòng.
 */
export function simulateAddRow(
  buttonSelector = '#add-container',
  options: { selectColumns?: string[]; rerenderOnInput?: boolean; reuseRows?: boolean } = {},
): void {
  const button = document.querySelector(buttonSelector) as HTMLElement
  button.addEventListener('click', () => {
    const tbody = containerTbody()
    if (!tbody) return

    if (options.reuseRows) {
      insertRowReusingFirstNode(tbody, options.selectColumns ?? [])
    } else {
      const tr = document.createElement('tr')
      tr.innerHTML = containerRowHtml(options.selectColumns)
      tbody.insertBefore(tr, tbody.firstChild)
    }

    const tr = tbody.firstElementChild as HTMLElement | null
    if (!options.rerenderOnInput || !tr) return
    const first = tr.querySelector('input')
    first?.addEventListener('input', () => {
      const clone = tr.cloneNode(true) as HTMLElement
      const oldInputs = Array.from(tr.querySelectorAll<HTMLInputElement>('input'))
      const newInputs = Array.from(clone.querySelectorAll<HTMLInputElement>('input'))
      oldInputs.forEach((input, i) => {
        const target = newInputs[i]
        if (target) target.value = input.value
      })
      tr.parentElement?.replaceChild(clone, tr)
    })
  })
}

/** Giá trị các input của một dòng. */
function rowInputValues(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll<HTMLInputElement>('input')).map((i) => i.value)
}

/** Gán lại giá trị các input của một dòng. */
function setRowInputValues(row: HTMLElement, values: string[]): void {
  Array.from(row.querySelectorAll<HTMLInputElement>('input')).forEach((input, i) => {
    input.value = values[i] ?? ''
  })
}

/**
 * Chèn dòng mới theo cách Vue render khi `el-table` không có `row-key`.
 *
 * Dữ liệu trước: [d0, d1, …, dn-1] (key = index).
 * Dữ liệu sau `insertTableRow(0, {})`: [mới, d0, d1, …, dn-1] — key vẫn là
 * index ⇒ node `<tr>` #0 được tái sử dụng cho dòng mới (dữ liệu cũ bị xoá),
 * node #1 hiển thị d0, …, và node MỚI (key n) hiển thị dn-1.
 */
function insertRowReusingFirstNode(tbody: HTMLElement, selectColumns: string[]): void {
  const rows = Array.from(tbody.querySelectorAll<HTMLElement>('tr'))

  if (rows.length === 0) {
    const tr = document.createElement('tr')
    tr.innerHTML = containerRowHtml(selectColumns)
    tbody.insertBefore(tr, tbody.firstChild)
    return
  }

  // Chụp dữ liệu của từng dòng TRƯỚC khi dịch.
  const data = rows.map((row) => rowInputValues(row))

  // Node mới cho key mới (dòng cũ cuối) — Vue mount và mount vào cuối tbody.
  const mounted = document.createElement('tr')
  mounted.innerHTML = containerRowHtml(selectColumns)
  tbody.appendChild(mounted)

  // Dịch dữ liệu: dòng i nhận dữ liệu của dòng i-1; dòng 0 rỗng (dòng mới).
  rows.forEach((row, i) => setRowInputValues(row, i === 0 ? [] : data[i - 1]!))
  setRowInputValues(mounted, data[data.length - 1]!)
}

/* ------------------------------------------------------------------ *
 *  Dialog đầu + form đầu + section hàng + bảng container
 * ------------------------------------------------------------------ */

/** Gắn sự kiện giả lập cho dialog vừa render: mở dialog hàng + thêm dòng container. */
function wireDialog(options: HeaderFormOptions): void {
  wireCargoAdd({
    rejectSave: options.rejectCargoSave,
    nestedCargoDialog: options.nestedCargoDialog,
  })

  const containerAdd = document.getElementById('add-container')
  containerAdd?.addEventListener('click', () => {
    const tbody = containerTbody()
    if (!tbody) return
    const tr = document.createElement('tr')
    tr.innerHTML = containerRowHtml()
    tbody.insertBefore(tr, tbody.firstChild)
  })

  if (!options.keepDialogOpenOnSubmit) {
    document.getElementById('submit-manifest')?.addEventListener('click', () => {
      // Nút bị disable thì site KHÔNG đóng dialog — không được giả lập ngược lại.
      const submit = document.getElementById('submit-manifest')
      if (submit?.hasAttribute('disabled')) return
      const dialog = document.getElementById('manifest-dialog')
      if (dialog) hideDialog(dialog)
    })
  }
}

/**
 * Mô phỏng cascade của site: khi người dùng click một suggestion `名称/代码`,
 * site điền mã cảng vào ô `*_PORT_COD` tương ứng với ô tên vừa được gõ.
 */
function wirePortSuggestions(cascade: boolean): void {
  const list = document.querySelector('.el-autocomplete-suggestion')
  if (!list) return

  let activeInput: HTMLInputElement | null = null
  document.querySelectorAll<HTMLInputElement>('.el-autocomplete input').forEach((input) => {
    input.addEventListener('input', () => {
      activeInput = input
    })
  })

  if (!cascade) return

  list.addEventListener('click', (event) => {
    const li = (event.target as HTMLElement).closest('li')
    if (!li || !activeInput) return
    const parts = (li.textContent ?? '').trim().split('/')
    const code = parts[parts.length - 1] ?? ''
    const codeInput = document.getElementById(activeInput.id.replace(/_NAM$/, '_COD'))
    if (codeInput) (codeInput as HTMLInputElement).value = code
  })
}

/**
 * Dialog đầu + form đầu + section hàng + bảng container.
 *
 * Mặc định dialog có sẵn trong DOM (test gọi `fillHeader` trực tiếp cần vậy).
 * Với `dialogMode: 'lazy'` thì dialog chỉ được render sau khi bấm nút
 * 新增舱单信息 — đúng như site thật, nên test phải chờ dialog mở ra.
 */
export function buildHeaderForm(options: HeaderFormOptions = {}): void {
  const {
    dialogMode = 'static',
    emptyPortCodes = false,
    cascadePortCodes = true,
    hiddenDuplicateButton = false,
  } = options

  const hiddenDuplicate = hiddenDuplicateButton
    ? '<div data-hidden="1"><button class="el-button" id="add-manifest-hidden">新增舱单信息</button></div>'
    : ''

  document.body.innerHTML = `
    ${hiddenDuplicate}
    <button class="el-button" id="add-manifest"${
      options.addManifestDisabled ? ' disabled' : ''
    }>新增舱单信息</button>
    <div class="el-select-dropdown">
      <div class="el-select-dropdown__item">MAEU</div>
      <div class="el-select-dropdown__item">FOB</div>
      <div class="el-select-dropdown__item">预付</div>
      <div class="el-select-dropdown__item">到付</div>
    </div>
    <div class="el-popper" id="port-suggestions">
      <ul class="el-autocomplete-suggestion">
        ${PORT_SUGGESTIONS.map((s) => `<li>${s}</li>`).join('\n        ')}
      </ul>
    </div>`

  resetClicks()
  trackOptionClicks()

  const cargoOptions: CargoSectionOptions = {
    rejectSave: options.rejectCargoSave,
    goodsList: options.goodsList,
  }

  if (dialogMode === 'static') {
    document.body.insertAdjacentHTML('beforeend', headerDialogHtml(emptyPortCodes, cargoOptions, options.submitButton))
    wireDialog(options)
    wirePortSuggestions(cascadePortCodes)
    return
  }

  if (dialogMode === 'lazy') {
    const addButton = document.getElementById('add-manifest')
    addButton?.addEventListener('click', () => {
      if (document.getElementById('manifest-dialog')) return
      document.body.insertAdjacentHTML('beforeend', headerDialogHtml(emptyPortCodes, cargoOptions, options.submitButton))
      wireDialog(options)
      wirePortSuggestions(cascadePortCodes)
    })
  }
  // 'never': nút có sẵn nhưng không bao giờ mở dialog.
}

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

```

- [ ] **Step 2: Viết test fail trước — `tests/fill-header.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fillHeader, fillManifest, findButtonByText } from '../src/core/fill'
import { mapHeader, type MappingContext } from '../src/core/mapping'
import { setVisibilityProbe } from '../src/core/select'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'
import { buildHeaderForm } from './helpers/dom'

const data = fixture.data as unknown as ManifestData

const ctx: MappingContext = {
  findTrustCode: () => 'MAEU',
  findDrType: () => 'FOB',
  findPort: (code) => (code === 'CNSHA' ? '上海' : code === 'IDBLW' ? '勿拉湾' : undefined),
  findCntrType: () => undefined,
  findCntrSize: () => undefined,
}

/** Probe giả lập: phần tử nằm trong container `data-hidden` thì bị coi là ẩn. */
const attrProbe = (el: HTMLElement): boolean => el.closest('[data-hidden]') === null

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  setVisibilityProbe(null)
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

  it('điền ô cảng bằng cách click suggestion của el-autocomplete', async () => {
    // Ô mã cảng để trống ngay từ đầu → mã chỉ xuất hiện được NẾU site cascade
    // sau khi suggestion được click (đúng như site thật).
    buildHeaderForm({ emptyPortCodes: true })

    // Ô mã cảng rỗng ngay từ đầu → mã chỉ có thể xuất hiện nhờ cascade.
    expect((document.getElementById('el-id-x-START_PORT_COD') as HTMLInputElement).value).toBe('')

    const suggestion = document.querySelector('#port-suggestions li') as HTMLElement
    const clicked: string[] = []
    suggestion.addEventListener('click', () => {
      clicked.push((suggestion.textContent ?? '').trim())
    })

    const report = await fillHeader(document, mapHeader(data, ctx))

    expect(reportItem(report, 'START_PORT_NAM')?.status).toBe('ok')
    // Phải click đúng suggestion "名称/代码", không phải chỉ gõ tên vào ô.
    expect(clicked).toEqual(['上海/CNSHA'])
    // Site cascade mã cảng vào ô *_PORT_COD khi suggestion được click.
    expect((document.getElementById('el-id-x-START_PORT_COD') as HTMLInputElement).value).toBe(
      'CNSHA',
    )
  })

  it('báo skip cho field không có dữ liệu', async () => {
    buildHeaderForm()
    const report = await fillHeader(document, mapHeader(data, ctx))
    const aeo = report.items.find((i) => i.prop === 'SHIPPER_AEO')
    expect(aeo?.status).toBe('skip')
  })

  it('không có lỗi khi fixture đầy đủ', async () => {
    buildHeaderForm()
    const report = await fillHeader(document, mapHeader(data, ctx))

    expect(report.items.filter((i) => i.status === 'error')).toHaveLength(0)
    expect(report.items.filter((i) => i.status === 'warn')).toHaveLength(0)
  })

  it('báo cảnh báo (không phải lỗi) khi field không có trên trang', async () => {
    buildHeaderForm()
    document.getElementById('el-id-x-CONSIGNEE_ADD_STR')!.remove()

    const report = await fillHeader(document, mapHeader(data, ctx))
    const item = report.items.find((i) => i.prop === 'CONSIGNEE_ADD_STR')

    expect(item?.status).toBe('warn')
    expect(item?.note).toContain('Could not find the field on the page')
  })

  it('báo cảnh báo khi verify thất bại (mã cảng chưa được cascade)', async () => {
    // Ô mã trống và site KHÔNG cascade → nhánh verify phải báo cảnh báo.
    buildHeaderForm({ emptyPortCodes: true, cascadePortCodes: false })

    const report = await fillHeader(document, mapHeader(data, ctx))
    const item = report.items.find((i) => i.prop === 'START_PORT_NAM')

    expect(item?.status).toBe('warn')
    expect(item?.note).toBe('Port code START_PORT_COD was not set')
  })

  it('lỗi gán giá trị không làm dừng lần điền', async () => {
    buildHeaderForm()

    const proto = HTMLInputElement.prototype
    const original = Object.getOwnPropertyDescriptor(proto, 'value')!
    Object.defineProperty(proto, 'value', {
      configurable: true,
      get(this: HTMLInputElement) {
        return original.get!.call(this)
      },
      set() {
        throw new Error('Could not find the native value setter')
      },
    })

    try {
      const report = await fillHeader(document, mapHeader(data, ctx))

      expect(report.items.find((i) => i.prop === 'BILL_NBR')?.status).toBe('error')
      // Field select không đi qua setter text → vẫn điền được sau field lỗi.
      expect(report.items.find((i) => i.prop === 'TRUST_COD')?.status).toBe('ok')
    } finally {
      Object.defineProperty(proto, 'value', original)
    }
  })
})

describe('fillManifest', () => {
  it('báo lỗi khi không thấy nút 新增舱单信息', async () => {
    document.body.innerHTML = '<div></div>'
    const report = await fillManifest({ data, ctx, root: document })
    expect(report.ok).toBe(false)
    expect(report.message).toContain('新增舱单信息')
  })

  it('không click nút có text gần giống', async () => {
    document.body.innerHTML = '<button class="el-button">批量新增舱单信息</button>'
    const report = await fillManifest({ data, ctx, root: document })
    expect(report.ok).toBe(false)
    expect(report.message).toContain('Could not find')
  })

  it('chờ dialog mở rồi điền form đầu', async () => {
    buildHeaderForm({ dialogMode: 'lazy' })
    expect(document.getElementById('manifest-dialog')).toBeNull()

    const report = await fillManifest({ data, ctx, root: document })

    expect(document.getElementById('manifest-dialog')).not.toBeNull()
    expect(
      (document.getElementById('el-id-x-E_SHIP_NAM') as HTMLInputElement).value,
    ).toBe('CALLAO BRIDGE')
    expect(report.ok).toBe(true)
  })

  it('báo lỗi khi dialog không mở trong 5 giây', async () => {
    buildHeaderForm({ dialogMode: 'never' })

    const report = await fillManifest({ data, ctx, root: document })

    expect(report.ok).toBe(false)
    expect(report.message).toContain('5 seconds')
  }, { timeout: 15000 })

  it('bấm nút 新增舱单信息 đang hiển thị, không bấm nút ẩn', async () => {
    setVisibilityProbe(attrProbe)
    buildHeaderForm({ dialogMode: 'lazy', hiddenDuplicateButton: true })

    let hiddenClicks = 0
    document
      .getElementById('add-manifest-hidden')!
      .addEventListener('click', () => {
        hiddenClicks += 1
      })

    const report = await fillManifest({ data, ctx, root: document })

    expect(hiddenClicks).toBe(0)
    expect(document.getElementById('manifest-dialog')).not.toBeNull()
    expect(report.ok).toBe(true)
  })

  it('tìm nút theo text chính xác và ưu tiên nút đang hiển thị', () => {
    setVisibilityProbe(attrProbe)
    document.body.innerHTML = `
      <div data-hidden="1"><button class="el-button">新增舱单信息</button></div>
      <button class="el-button" id="visible">新增舱单信息</button>`

    expect(findButtonByText('新增舱单信息')?.id).toBe('visible')
  })

  it('báo cáo tổng hợp không có lỗi và không có cảnh báo', async () => {
    buildHeaderForm()

    const report = await fillManifest({ data, ctx, root: document })

    expect(report.items.filter((i) => i.status === 'error')).toHaveLength(0)
    expect(report.items.filter((i) => i.status === 'warn')).toHaveLength(0)
    expect(report.ok).toBe(true)
  })

  it('auto-submit được site nhận ⇒ không có cảnh báo', async () => {
    buildHeaderForm()

    const report = await fillManifest({ data, ctx, root: document, autoSubmit: true })

    expect(report.items.some((i) => i.prop === 'SUBMIT')).toBe(false)
    expect(report.ok).toBe(true)
  })

  it('site từ chối form (dialog vẫn mở) ⇒ báo cảnh báo, không báo thành công', async () => {
    // 尺寸/箱型/箱状态 bị bỏ trống ⇒ site từ chối form, dialog không đóng.
    buildHeaderForm({ keepDialogOpenOnSubmit: true })

    const report = await fillManifest({ data, ctx, root: document, autoSubmit: true })

    const submit = report.items.find((i) => i.prop === 'SUBMIT')
    expect(submit?.status).toBe('warn')
    expect(submit?.note).toContain('the site did not accept the form')
    expect(submit?.note).toContain('尺寸')
    expect(report.ok).toBe(false)
  })

  it('item "ok" của header vẫn mang note (mã mà site lưu cho 付款方式)', async () => {
    buildHeaderForm()

    const report = await fillManifest({ data, ctx, root: document })
    const payWay = report.items.find((i) => i.prop === 'PAY_WAY_ID')

    expect(payWay?.status).toBe('ok')
    expect(payWay?.note).toContain('到付')
    expect(payWay?.note).toContain('C')
  })

  it('không có nút 确定 ⇒ báo cảnh báo, không báo thành công', async () => {
    // Không có nút ⇒ KHÔNG có gì được submit ⇒ tuyệt đối không báo "ok".
    buildHeaderForm({ submitButton: 'missing' })

    const report = await fillManifest({ data, ctx, root: document, autoSubmit: true })

    const submit = report.items.find((i) => i.prop === 'SUBMIT')
    expect(submit?.status).toBe('warn')
    expect(submit?.note).toContain('确定')
    expect(report.ok).toBe(false)
  })

  it('nút 确定 bị disable ⇒ báo cảnh báo, không báo thành công', async () => {
    buildHeaderForm({ submitButton: 'disabled' })

    const report = await fillManifest({ data, ctx, root: document, autoSubmit: true })

    const submit = report.items.find((i) => i.prop === 'SUBMIT')
    expect(submit?.status).toBe('warn')
    expect(submit?.note).toContain('disabled')
    expect(submit?.note).toContain('确定')
    expect(report.ok).toBe(false)
  })

  it('nút 新增舱单信息 bị disable ⇒ báo lỗi rõ ràng, không điền gì', async () => {
    buildHeaderForm({ addManifestDisabled: true })

    const report = await fillManifest({ data, ctx, root: document })

    expect(report.ok).toBe(false)
    expect(report.message).toContain('disabled')
    expect(report.message).toContain('新增舱单信息')
    // Không có field nào được ghi ⇒ báo cáo rỗng.
    expect(report.items).toHaveLength(0)
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
import { mapCargo, mapContainer, mapHeader, type FieldPlan, type MappingContext } from './mapping'
import { isVisible } from './select'
import { findColumnIndex, getCell, readTableHandles, setCellValue } from './table'
import type { ManifestCargo, ManifestContainer, ManifestData } from './types'

/**
 * Trạng thái của một field trong báo cáo:
 * - `ok`    ✅ đã ghi giá trị thành công;
 * - `warn`  ⚠️ muốn ghi nhưng chưa được (field không có trên trang, option không
 *            tồn tại, site không nhận dữ liệu…) — người dùng phải xử lý;
 * - `error` ❌ ghi giá trị hỏng, hoặc một bước cấu trúc hỏng (dialog không mở…);
 * - `skip`  ⏭ không có dữ liệu nguồn nên cố ý để trống.
 */
export type FillStatus = 'ok' | 'warn' | 'error' | 'skip'

/** Section mà một item thuộc về. */
export type FillScope = 'header' | 'cargo' | 'container'

export interface FillItem {
  scope: FillScope
  prop: string
  label: string
  status: FillStatus
  /**
   * Số thứ tự dòng (1-based) của item — bắt buộc vì nhiều dòng dùng chung
   * một bộ prop (24 prop của hàng, 9 prop của container).
   */
  row?: number
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

/**
 * Tìm nút có đúng text `text`.
 *
 * Chỉ khớp chính xác — khớp "chứa" sẽ bấm nhầm nút 批量新增舱单信息. Ưu tiên nút
 * đang hiển thị: Element Plus giữ tab đã xem trong DOM (dù đã ẩn), bấm nút ẩn
 * là thao tác vô nghĩa.
 */
export function findButtonByText(text: string, root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, .el-button'))
  const exact = buttons.filter((b) => (b.textContent ?? '').trim() === text)
  return exact.find(isVisible) ?? exact[0] ?? null
}

/**
 * Tiêu đề section có khớp `needle` không.
 *
 * Khớp CHÍNH XÁC hoặc theo tiều tố: site có thể render
 * `.fs-crud-title` là `货物信息 (2)` ⇒ cả `findTitleElement` (tìm tiêu đề) và
 * `sectionOf` (xác định section của một phần tử) phải dùng CÙNG một luật,
 * nếu không thì hai bên bất đồng và ranh giới section bị đặt sai.
 */
function titleMatches(title: string, needle: string): boolean {
  const t = title.trim()
  const n = needle.trim()
  return t === n || t.startsWith(n)
}

/** Tìm phần tử chứa đúng tiêu đề section (phần tử sâu nhất). */
function findTitleElement(scope: ParentNode, title: string): HTMLElement | null {
  const needle = title.trim()
  const isMatch = (el: HTMLElement): boolean =>
    titleMatches(el.textContent ?? '', needle)

  // Ưu tiên `.fs-crud-title` (tiêu đề section của site): quét toàn bộ DOM là
  // rất tốn trên dialog thật (hàng nghìn node).
  const crud = Array.from(scope.querySelectorAll<HTMLElement>('.fs-crud-title')).filter(isMatch)
  const matches =
    crud.length > 0
      ? crud
      : Array.from(scope.querySelectorAll<HTMLElement>('*')).filter(isMatch)
  if (matches.length === 0) return null
  return matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) ?? null
}

/* ------------------------------------------------------------------ *
 *  Section & button
 * ------------------------------------------------------------------ */

/** `true` nếu `a` nằm trước `b` trong thứ tự tài liệu. */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/**
 * Section mà phần tử `el` thuộc về.
 *
 * Section = ancestor gần nhất có `.fs-crud-title`; tiêu đề của section là
 * `.fs-crud-title` gần nhất **phía trước** `el` (site vẽ tiêu đề ở đầu section,
 * nút/table nằm sau nó).
 *
 * Việc này chặn lỗi "leo ra khỏi section": trên site thật dialog đầu có cả
 * section 货物信息 lẫn section 箱信息, mỗi section một nút 新增 — nếu không khoanh
 * vùng thì nút của section 箱信息 sẽ bị bấm nhầm khi đang điền hàng.
 */
function sectionOf(el: HTMLElement): { root: HTMLElement; title: string } | null {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const titles = Array.from(node.querySelectorAll<HTMLElement>('.fs-crud-title'))
    if (titles.length > 0) {
      const preceding = titles.filter((t) => precedes(t, el))
      const chosen = preceding[preceding.length - 1] ?? titles[0]!
      const title = (chosen.textContent ?? '').trim()
      return title ? { root: node, title } : null
    }
    node = node.parentElement
  }
  return null
}

/** Các nút "新增" trong `scope` (khớp "chứa", site có 新增 / 新增货物信息 / …). */
function findAddButtons(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('button, .el-button')).filter((b) =>
    (b.textContent ?? '').trim().includes('新增'),
  )
}

/**
 * Chọn nút tốt nhất trong một nhóm: đang hiển thị trước, rồi text đúng `新增`,
 * cuối cùng mới tới text có chứa `新增` (site có cả 新增 và 新增货物信息).
 *
 * "Đang hiển thị" đứng trước "text đúng" là cố ý: Element Plus giữ tab đã xem
 * trong DOM (dù đã ẩn) ⇒ một nút ẩn có text khớp chính xác hơn vẫn không được
 * thắng nút đang hiển thị.
 */
function pickBestButton(buttons: HTMLElement[]): HTMLElement | null {
  if (buttons.length === 0) return null
  const visible = buttons.filter(isVisible)
  const pool = visible.length > 0 ? visible : buttons
  const exact = pool.filter((b) => (b.textContent ?? '').trim() === '新增')
  return (exact.length > 0 ? exact : pool)[0] ?? null
}

/**
 * Tìm nút "新增" nằm trong section có tiêu đề `title` (ví dụ 货物信息).
 *
 * Cách 1 (chính): nút nào có **tiêu đề section** đúng `title` thì lấy.
 * Cách 2 (dự phòng): leo từ phần tử tiêu đề lên, nhưng **dừng ngay** khi chạm
 * tới ancestor chứa một `.fs-crud-title` khác ⇒ không bao giờ leo ra section.
 */
export function findAddButtonBySectionTitle(
  scope: ParentNode,
  title: string,
): HTMLElement | null {
  const needle = title.trim()
  const inSection = findAddButtons(scope).filter((b) => {
    const section = sectionOf(b)
    return section !== null && titleMatches(section.title, needle)
  })
  const picked = pickBestButton(inSection)
  if (picked) return picked
  return findAddButtonByWalkingUp(scope, needle)
}

/** Dự phòng của `findAddButtonBySectionTitle`: leo từ tiêu đề, có biên giới section. */
function findAddButtonByWalkingUp(scope: ParentNode, title: string): HTMLElement | null {
  const titleEl = findTitleElement(scope, title)
  if (!titleEl) return null

  let container: HTMLElement = titleEl
  let inner: HTMLElement | null = null

  for (let depth = 0; depth < 12; depth++) {
    const candidates = findAddButtons(container).filter((b) => !inner || !inner.contains(b))
    if (candidates.length > 0) return pickBestButton(candidates)
    inner = container
    const parent = container.parentElement
    if (!parent) break
    // Biên giới section: ancestor chứa tiêu đề khác ⇒ dừng, đừng leo ra ngoài.
    const otherSection = Array.from(parent.querySelectorAll<HTMLElement>('.fs-crud-title')).some(
      (t) => !titleMatches(t.textContent ?? '', title),
    )
    if (otherSection) break
    container = parent
  }

  return null
}

/** Nút đang bị disable (site khoá nút khi form chưa hợp lệ). */
function isDisabled(button: HTMLElement): boolean {
  if ((button as HTMLButtonElement).disabled) return true
  if (button.getAttribute('disabled') !== null) return true
  return button.classList.contains('is-disabled')
}

/**
 * Overlay của CHÍNH dialog này (nếu có).
 *
 * `closest('.el-overlay')` có thể trả về overlay của dialog CHA: khi site không
 * teleport, dialog hàng nằm trong dialog đầu ⇒ `closest` leo lên và thấy
 * overlay của dialog đầu ⇒ dialog hàng bị coi là "ẩn" khi dialog đầu ẩn.
 *
 * Overlay của chính nó là overlay CHỈ chứa dialog này (overlay của dialog cha
 * chứa cả hai).
 */
function ownOverlay(dialog: HTMLElement): HTMLElement | null {
  let node = dialog.parentElement
  while (node) {
    if (node.classList.contains('el-overlay') || node.classList.contains('el-dialog__wrapper')) {
      const dialogs = node.querySelectorAll('.el-dialog')
      return dialogs.length === 1 && dialogs[0] === dialog ? node : null
    }
    node = node.parentElement
  }
  return null
}

/**
 * Element Plus ẩn dialog bằng `display:none` (trên chính nó hoặc trên overlay
 * của nó).
 *
 * KHÔNG coi "node bị gỡ khỏi DOM" là "đã đóng": node bị detach chỉ có nghĩa là
 * Vue đã thay thế element — site có thể dựng lại dialog sau khi từ chối lưu,
 * lúc đó node cũ detach nhưng dòng hàng CHƯA được lưu. Muốn biết dialog đã
 * đóng thì phải tra lại dialog HIỆN TẠI rồi hỏi nó (xem `currentDialog`).
 *
 * Không dùng `isVisible` của `select.ts`: hàm đó coi mọi phần tử là hiển thị khi
 * môi trường không có layout engine (jsdom) ⇒ không dùng để kiểm tra "dialog đã
 * đóng" được.
 */
function isHidden(el: HTMLElement): boolean {
  if (el.style.display === 'none') return true
  const overlay = ownOverlay(el)
  return overlay?.style.display === 'none'
}

/* ------------------------------------------------------------------ *
 *  Bảng
 * ------------------------------------------------------------------ */

/** Chuỗi của các ô header của bảng (đã trim). */
function tableHeaderTexts(table: HTMLElement): string[] {
  return Array.from(
    table.querySelectorAll<HTMLElement>('thead th, .el-table__header th'),
  ).map((th) => (th.textContent ?? '').trim())
}

/** Ancestor gần nhất của tiêu đề có chứa bảng ⇒ giới hạn phạm vi tra cứu. */
function sectionTableRoot(titleEl: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = titleEl.parentElement
  while (node) {
    if (node.querySelector('.el-table, table')) return node
    node = node.parentElement
  }
  return null
}

const CONTAINER_SECTION_TITLES = ['箱信息', '集装箱信息', '集装箱']

/** Cột xác nhận đúng là bảng container (bảng hàng không có cột này). */
const CONTAINER_TABLE_COLUMN = '箱号'

/**
 * Tìm bảng container trong `scope`.
 *
 * Mọi tra cứu bị giới hạn trong section của tiêu đề 箱信息 (trên site thật
 * dialog đầu có cả bảng DANH SÁCH hàng lẫn bảng container — lấy nhầm bảng đầu
 * là ghi vào chỗ không liên quan). Bảng tìm được còn phải **có cột 箱号** thì
 * mới chấp nhận, nếu không ⇒ báo lỗi chứ không dùng bảng đầu tiên trong scope.
 */
function findContainerTable(scope: ParentNode): HTMLElement | null {
  for (const title of CONTAINER_SECTION_TITLES) {
    const titleEl = findTitleElement(scope, title)
    if (!titleEl) continue
    const root = sectionTableRoot(titleEl)
    if (!root) continue
    const tables = Array.from(root.querySelectorAll<HTMLElement>('.el-table, table'))
    const valid = tables.find((t) => tableHeaderTexts(t).includes(CONTAINER_TABLE_COLUMN))
    if (valid) return valid
  }
  return null
}

/** Bảng nằm trong section có tiêu đề `title` (dùng cho bảng DANH SÁCH hàng). */
function findTableBySectionTitle(scope: ParentNode, title: string): HTMLElement | null {
  const needle = title.trim()
  const tables = Array.from(scope.querySelectorAll<HTMLElement>('.el-table, table'))
  return (
    tables.find((t) => {
      const section = sectionOf(t)
      return section !== null && titleMatches(section.title, needle)
    }) ?? null
  )
}

/** Số dòng của bảng DANH SÁCH hàng (section 货物信息). */
function countGoodsListRows(scope: ParentNode): number {
  const table = findTableBySectionTitle(scope, '货物信息')
  if (!table) return 0
  return readTableHandles(table).bodyRows.length
}

/**
 * Nút "新增" thêm dòng của bảng container.
 *
 * Ràng buộc vào **cùng section** với bảng ⇒ không bấm nhầm nút 新增 của section
 * 货物信息 (trên site thật nút đó mở dialog hàng).
 */
function findContainerAddButton(scope: ParentNode, table: HTMLElement): HTMLElement | null {
  const section = sectionOf(table)
  if (section) {
    const inSection = findAddButtonBySectionTitle(section.root, section.title)
    if (inSection) return inSection
  }
  for (const title of CONTAINER_SECTION_TITLES) {
    const button = findAddButtonBySectionTitle(scope, title)
    if (button) return button
  }
  return null
}

/* ------------------------------------------------------------------ *
 *  Điền field
 * ------------------------------------------------------------------ */

export async function fillPlans(
  root: ParentNode,
  plans: FieldPlan[],
  scope: FillScope = 'header',
  options: { row?: number } = {},
): Promise<{ items: FillItem[] }> {
  const items: FillItem[] = []
  const row = options.row

  for (const plan of plans) {
    if (plan.status === 'skip') {
      items.push({
        scope,
        prop: plan.prop,
        label: plan.label,
        status: 'skip',
        row,
        note: plan.note,
      })
      // Nhánh skip không đụng DOM ⇒ không cần chờ frame (17/24 plan của hàng là skip).
      continue
    }

    const result = await setFieldValue(root, plan.prop, plan.value ?? '', {
      matchValue: plan.matchValue,
    })
    if (!result.ok) {
      items.push({
        scope,
        prop: plan.prop,
        label: plan.label,
        // Không tìm thấy field / không có option → cảnh báo, người dùng tự xử lý.
        // Chỉ lỗi ghi giá trị (strategy 'text') mới là lỗi thật.
        status: result.strategy === 'text' ? 'error' : 'warn',
        row,
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
          status: 'warn',
          row,
          note: plan.verify.note,
        })
        await nextFrame()
        continue
      }
    }

    // `ok` cũng mang note: ví dụ "The site stores the code \"P\" for \"预付\"" để
    // người dùng đối chiếu mã mà site lưu.
    items.push({ scope, prop: plan.prop, label: plan.label, status: 'ok', row, note: plan.note })
    await nextFrame()
  }

  return { items }
}

export async function fillHeader(root: ParentNode, plans: FieldPlan[]) {
  return fillPlans(root, plans, 'header')
}

/**
 * Tìm dialog đầu (form 舱单).
 *
 * Element Plus giữ lại dialog đã đóng trong DOM (chỉ ẩn đi), nên `.el-dialog`
 * ĐẦU TIÊN trong document có thể là dialog ẩn của một màn khác — lấy nó thì
 * mọi field đều "không tìm thấy" và lần điền im lặng thất bại. Ưu tiên dialog
 * có chứa field 提单号, fallback về dialog đang hiện, cuối cùng là dialog
 * cuối cùng trong DOM.
 */
export function findManifestDialog(root: ParentNode): HTMLElement | null {
  const byField = findDialogWithField(root, 'BILL_NBR')
  if (byField) return byField
  const dialogs = Array.from(root.querySelectorAll<HTMLElement>('.el-dialog'))
  const visible = dialogs.filter(isVisible)
  return visible[visible.length - 1] ?? dialogs[dialogs.length - 1] ?? null
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

/* ------------------------------------------------------------------ *
 *  Dòng hàng (dialog 货物信息)
 * ------------------------------------------------------------------ */

/** Thời gian chờ tối thiểu sau khi bấm 新增 của section hàng (site dùng setTimeout 400ms). */
const CARGO_DIALOG_DELAY_MS = 600

/** Thời gian chờ POST `/cargo/add/` land trước khi mở dòng hàng tiếp theo. */
const CARGO_COMMIT_DELAY_MS = 800

/** Thời gian chờ site chấp nhận (hoặc từ chối) dòng hàng sau khi bấm 保存. */
const CARGO_SAVE_TIMEOUT_MS = 3000

/** Thời gian chờ dialog đầu đóng lại sau khi bấm 确定 (auto-submit). */
const HEADER_SUBMIT_TIMEOUT_MS = 3000

/**
 * Các dialog đang có trong DOM — chụp lại TRƯỚC khi bấm 新增.
 *
 * Quét `document` (không phải `scope` của dialog đầu) vì site TELEPORT dialog
 * hàng ra `body` ⇒ nó nằm NGOÀI dialog đầu.
 */
function snapshotDialogs(): Set<HTMLElement> {
  return new Set(Array.from(document.querySelectorAll<HTMLElement>('.el-dialog')))
}

/**
 * Các dialog đang **ẩn** lúc chụp ảnh.
 *
 * Cần để phân biệt hai ca mà nhìn giống nhau lúc chờ dialog:
 * - site DÙNG LẠI một element đã mount sẵn (trước đó ẩn, giờ hiện lại) ⇒ đó
 *   là dialog site mở cho dòng này;
 * - dialog ĐÃ hiện sẵn trước khi bấm 新增 (dialog của dòng trước, hoặc do
 *   người dùng tự mở) ⇒ tuyệt đối không ghi đè.
 */
function snapshotHiddenDialogs(): Set<HTMLElement> {
  const hidden = new Set<HTMLElement>()
  for (const dialog of document.querySelectorAll<HTMLElement>('.el-dialog')) {
    if (isHidden(dialog)) hidden.add(dialog)
  }
  return hidden
}

/**
 * Dialog hàng MỚI (không nằm trong `snapshot`) có chứa field E_CARGO_NAM.
 *
 * Element Plus giữ dialog đã đóng trong DOM ⇒ lấy "dialog nào chứa E_CARGO_NAM"
 * sẽ trả về dialog của dòng TRƯỚC và ghi đè lên dòng đó.
 */
function findNewCargoDialog(snapshot: Set<HTMLElement>): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('.el-dialog'))
  for (const dialog of dialogs) {
    if (snapshot.has(dialog)) continue
    if (!dialog.querySelector('input[id$="-E_CARGO_NAM"], textarea[id$="-E_CARGO_NAM"]')) continue
    return dialog
  }
  return null
}

/**
 * Dialog hàng HIỆN TẠI trong DOM (dialog cuối cùng có field E_CARGO_NAM).
 *
 * Luôn tra lại thay vì giữ node đã bắt: Vue có thể thay thế element dialog
 * (node cũ bị gỡ khỏi DOM) ⇒ hỏi node cũ là hỏi sai đối tượng.
 */
function currentCargoDialog(): HTMLElement | null {
  return findDialogWithField(document, 'E_CARGO_NAM')
}

/**
 * Dự phòng cho trường hợp site DÙNG LẠI một element dialog và reset nó ⇒ không
 * có node mới nào để tìm.
 *
 * Lấy dialog hàng CUỐI CÙNG đang hiện (không hidden) — nhưng CHỈ dùng được khi
 * form của nó đang TRỐNG: nếu còn dữ liệu của dòng trước ⇒ đó là dialog của dòng
 * trước, ghi vào đó là ghi đè dòng trước.
 */
function findVisibleCargoDialog(): HTMLElement | null {
  const shown = visibleCargoDialogs()
  const last = shown[shown.length - 1]
  if (!last) return null
  const name = last.querySelector<HTMLInputElement>('input[id$="-E_CARGO_NAM"]')
  return (name?.value ?? '') === '' ? last : null
}

/** Các dialog hàng đang hiện (có field E_CARGO_NAM). */
function visibleCargoDialogs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.el-dialog')).filter(
    (d) =>
      d.querySelector('input[id$="-E_CARGO_NAM"], textarea[id$="-E_CARGO_NAM"]') &&
      !isHidden(d),
  )
}

/**
 * Dialog hàng mà site DÙNG LẠI một element đã mount sẵn (không tạo node mới).
 *
 * Chỉ nhận dialog **trước đây đang ẩn** và **giờ đã hiện**: đó là duy nhất
 * chứng cứ cho thấy site vừa hiện nó lên cho dòng này. Dialog ĐÃ hiện sẵn trước
 * khi bấm 新增 là dialog của dòng trước, hoặc do người dùng tự mở ⇒ tuyệt đối
 * không ghi đè.
 *
 * Form phải TRỐNG: còn dữ liệu của dòng trước ⇒ đó là dialog của dòng trước.
 */
function findReusedCargoDialog(beforeHidden: Set<HTMLElement>): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('.el-dialog')).filter((d) =>
    d.querySelector('input[id$="-E_CARGO_NAM"], textarea[id$="-E_CARGO_NAM"]'),
  )
  const shown = dialogs.filter((d) => beforeHidden.has(d) && !isHidden(d))
  const last = shown[shown.length - 1]
  if (!last) return null
  const name = last.querySelector<HTMLInputElement>('input[id$="-E_CARGO_NAM"]')
  return (name?.value ?? '') === '' ? last : null
}

/**
 * Dialog hàng có dùng lại được không? (site mount MỘT element cho mọi dòng)
 *
 * Cần đủ ba điều kiện: node còn trong DOM, đang hiện, và form đã được site
 * reset (E_CARGO_NAM trống). Nếu form còn dữ liệu của dòng trước ⇒ đó là
 * dialog của dòng trước, tuyệt đối không ghi đè.
 */
function isReusableCargoDialog(dialog: HTMLElement | null): boolean {
  if (!dialog?.isConnected) return false
  if (isHidden(dialog)) return false
  const name = dialog.querySelector<HTMLInputElement>('input[id$="-E_CARGO_NAM"]')
  return (name?.value ?? '') === ''
}

/**
 * Kết quả hỏi "site đã nhận dòng hàng chưa".
 *
 * - `accepted` — site đã nhận (bảng DANH SÁCH có dòng mới, hoặc không có bảng
 *   DANH SÁCH mà dialog đã đóng).
 * - `refused`  — site đã TỪ CHỐI: còn bảng DANH SÁCH mà số dòng không tăng và
 *   site VẪN GIỮ dialog hàng mở (validate fail ⇒ cần người dùng chọn
 *   包装类型/代码 rồi lưu lại).
 * - `timeout`  — KHÔNG xác nhận được trong `CARGO_SAVE_TIMEOUT_MS` (mạng chậm,
 *   bảng chưa render lại…). TUYỆT ĐỐI không nói "site từ chối" ở nhánh này:
 *   dòng có thể ĐÃ được lưu ⇒ bảo người dùng nhập lại là tạo dòng TRÙNG.
 */
type CargoAcceptance = 'accepted' | 'refused' | 'timeout'

/**
 * Site có thật sự nhận dòng hàng không?
 *
 * Với loại hàng `S` thì PACKAGE_STR và PACKAGE_COD là field **bắt buộc** mà API
 * không có ⇒ site validate fail (请填必填表格) và **không** POST ⇒ dòng hàng
 * không được lưu. Dấu hiệu nhận biết: bảng danh sách không có dòng mới.
 *
 * Nếu site CÓ bảng DANH SÁCH hàng ⇒ đó là tiêu chí DUY NHẤT. "Dialog đóng"
 * không đủ: node dialog có thể bị Vue gỡ khỏi DOM khi site dựng lại nó sau khi
 * từ chối lưu (B-13) — lúc đó coi như "đã lưu" là báo thành công sai.
 *
 * `captured` là node dialog mà extension vừa điền — chỉ dùng làm DỰ PHÒNG khi
 * trong DOM không còn dialog nào; không dùng nó làm tiêu chí chính vì node đó
 * có thể đã bị detach (xem `isHidden`).
 */
async function waitForCargoRowAccepted(
  scope: ParentNode,
  rowsBefore: number,
  captured: HTMLElement | null = null,
): Promise<CargoAcceptance> {
  const hasGoodsList = findTableBySectionTitle(scope, '货物信息') !== null

  const accepted = await waitFor(
    () => {
      if (hasGoodsList) return countGoodsListRows(scope) > rowsBefore
      // Không có bảng DANH SÁCH ⇒ chỉ còn cách hỏi dialog hiện tại.
      // PHẢI tra lại (node cũ có thể đã bị site gỡ khỏi DOM) rồi mới hỏi nó.
      const current = currentCargoDialog() ?? captured
      if (!current) return true
      return isHidden(current)
    },
    { timeout: CARGO_SAVE_TIMEOUT_MS, interval: 100, label: 'cargo row accepted' },
  ).catch(() => false)

  if (accepted) return 'accepted'

  // Hết giờ chờ mà vẫn chưa xác nhận được.
  if (hasGoodsList) {
    // Site còn GIỮ dialog hàng mở ⇒ site đã từ chối (validate fail), không
    // phải chậm mạng: nhắc đúng cần chọn 包装类型/代码.
    const current = currentCargoDialog() ?? captured
    if (current && !isHidden(current)) return 'refused'
  }
  // Còn lại (bảng chưa render lại, dialog đã đóng nhưng list chưa có dòng):
  // KHÔNG xác nhận được ⇒ nói "chưa xác nhận được", không nói "site từ chối".
  return 'timeout'
}

export async function fillCargoRows(
  scope: ParentNode,
  goodsList: ManifestCargo[],
  options: { log?: (message: string) => void } = {},
): Promise<{ items: FillItem[]; rows: number }> {
  const log = options.log ?? (() => {})
  const items: FillItem[] = []
  let rows = 0

  // Không có dòng nào để điền ⇒ không cần tìm nút 新增, không báo lỗi gì cả.
  if (goodsList.length === 0) return { items, rows }

  // Nút 新增 của section 货物信息.
  //
  // Site có thể DỰNG LẠI section sau mỗi lần lưu ⇒ node nút cũ bị gỡ khỏi DOM
  // và `click()` trên node đó là no-op ⇒ phải tra lại nút ở MỔI dòng.
  const resolveAddButton = (): HTMLElement | null =>
    findAddButtonBySectionTitle(scope, '货物信息')

  // Node dialog đã dùng cho dòng trước — dùng lại được khi site DÙNG LẠI một
  // element cho mọi dòng (lúc đó không có node mới nào xuất hiện).
  let lastDialog: HTMLElement | null = null

  // Không có nút 新增 ⇒ báo MỘT lỗi cho cả lần điền (không lặp lại theo dòng).
  if (!resolveAddButton()) {
    items.push({
      scope: 'cargo',
      prop: 'ADD_BUTTON',
      label: 'Cargo rows',
      status: 'error',
      note: 'Could not find the "新增" button in the 货物信息 section',
    })
    return { items, rows }
  }

  for (const [index, goods] of goodsList.entries()) {
    const rowNo = index + 1
    const label = `Cargo ${rowNo}/${goodsList.length}`

    try {
      // Chụp lại các dialog TRƯỚC khi bấm 新增: Element Plus giữ dialog cũ trong
      // DOM ⇒ không có snapshot thì dòng 2 sẽ bị ghi vào dialog của dòng 1.
      const before = snapshotDialogs()
      // Các dialog đang ẩn lúc này: dùng để nhận ra ca "site dùng lại element
      // đã mount sẵn" (trước đó ẩn, giờ hiện) mà không đụng vào dialog đã hiện
      // sẵn (dialog của dòng trước / do người dùng tự mở).
      const beforeHidden = snapshotHiddenDialogs()

      // Tra lại nút ở MỖI dòng: node đã bị site dựng lại thì click là no-op.
      const addButton = resolveAddButton()
      if (!addButton) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'Could not find the "新增" button in the 货物信息 section',
        })
        continue
      }
      if (isDisabled(addButton)) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'The "新增" button of the 货物信息 section is disabled',
        })
        continue
      }
      addButton.click()
      await sleep(CARGO_DIALOG_DELAY_MS)

      let dialog = await waitFor(
        () => {
          // 1) Node MỚI: site mount dialog mới cho dòng này.
          const fresh = findNewCargoDialog(before)
          if (fresh) return fresh
          // 2) Site DÙNG LẠI một element dialog cho mọi dòng: node của dòng
          //    trước vẫn còn trong DOM, đang hiện và form đã được site reset.
          if (isReusableCargoDialog(lastDialog)) return lastDialog
          // 3) Site dùng lại một element ĐÃ MOUNT SẴN (trước đó ẩn, giờ site
          //    hiện lại) ⇒ không có node mới nào để tìm. Chỉ nhận dialog trước
          //    đây đang ẩn: dialog đã hiện sẵn là dialog của dòng trước hoặc do
          //    người dùng tự mở ⇒ không được ghi đè.
          const reused = findReusedCargoDialog(beforeHidden)
          if (reused) return reused
          return null
        },
        {
          timeout: 5000,
          interval: 100,
          label: `cargo dialog ${rowNo}`,
        },
      ).catch(() => null)

      if (!dialog) {
        // Hết thời gian mà vẫn không có node mới ⇒ site dùng lại một element
        // dialog. Dự phòng chỉ dùng được dialog đang hiện mà form TRỐNG.
        dialog = findVisibleCargoDialog()
      }
      if (dialog) lastDialog = dialog

      if (!dialog) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'The cargo dialog did not open within 5 seconds',
        })
        continue
      }

      log(`Filling in ${label}…`)
      const filled = await fillPlans(dialog, mapCargo(goods), 'cargo', { row: rowNo })
      items.push(...filled.items)

      // Site có thể thay element dialog NGAY TRONG LÚC đang điền (Vue thay vì
      // patch) ⇒ node đang ghi đã rời DOM ⇒ mọi field ghi vào đó là field
      // "ok" trên một node chết ⇒ bấm 保存 vào node đó là vô nghĩa.
      if (!dialog.isConnected) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note:
            'The cargo dialog was replaced by the site while it was being filled — ' +
            'the row was not saved, please fill it in on the page',
        })
        continue
      }

      const written = filled.items.filter((i) => i.status === 'ok').length
      if (written === 0) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'No field of this row could be filled',
        })
        continue
      }

      // Nút lưu của dialog hàng là 保存 (không phải 确定).
      const save = findButtonByText('保存', dialog)
      if (!save) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'Could not find the "保存" button in the cargo dialog',
        })
        continue
      }

      if (isDisabled(save)) {
        // Site khoá nút lưu khi form chưa hợp lệ — 包装类型/代码 bị bỏ trống
        // nên đây là trạng thái có thật trên site, phải nói rõ để người dùng
        // biết cần làm gì (cùng gợi ý với B-13).
        //
        // Khác với nhánh "site từ chối" (bấm 保存 xong mà site không nhận):
        // ở đây nút lưu **bị khoá** ⇒ chưa có gì được gửi đi.
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'warn',
          note:
            'the "保存" button of the cargo dialog is disabled — the site requires ' +
            '包装类型/代码 (PACKAGE_STR / PACKAGE_COD) before it accepts the row; ' +
            'please choose them on the page and save again',
        })
        continue
      }

      const goodsRowsBefore = countGoodsListRows(scope)
      save.click()

      // Site có thật sự nhận dòng không? (B-13)
      const acceptance = await waitForCargoRowAccepted(scope, goodsRowsBefore, dialog)
      if (acceptance !== 'accepted') {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'warn',
          // "Site từ chối" và "chưa xác nhận được" là HAI câu khác nhau:
          // nói nhầm "site từ chối" khi dòng đã lưu được sẽ khiến người dùng
          // nhập lại ⇒ dòng hàng TRÙNG trong manifest.
          note:
            acceptance === 'refused'
              ? 'the site did not accept the row — it requires 包装类型/代码 ' +
                '(PACKAGE_STR / PACKAGE_COD), please choose them on the page and save again'
              : `the site did not confirm the row within ${
                  Math.round(CARGO_SAVE_TIMEOUT_MS / 1000)
                } s — please check the 货物信息 list before entering it again`,
        })
        continue
      }

      rows += 1

      // POST /cargo/add/ phải land trước khi mở dòng tiếp theo (B-2).
      await sleep(CARGO_COMMIT_DELAY_MS)
    } catch (e) {
      // Một dòng hỏng không được làm hỏng các dòng còn lại (B-8).
      items.push({
        scope: 'cargo',
        prop: `ROW_${rowNo}`,
        label,
        row: rowNo,
        status: 'error',
        note: `Row ${rowNo} failed: ${(e as Error).message}`,
      })
    }
  }

  return { items, rows }
}

/* ------------------------------------------------------------------ *
 *  Dòng container (bảng inline editable 箱信息)
 * ------------------------------------------------------------------ */

export async function fillContainerRows(
  scope: ParentNode,
  containers: ManifestContainer[],
  ctx: MappingContext,
  options: { log?: (message: string) => void } = {},
): Promise<{ items: FillItem[]; rows: number }> {
  const log = options.log ?? (() => {})
  const items: FillItem[] = []
  let rows = 0

  // Không có container nào để điền ⇒ không cần tìm bảng, không báo lỗi gì cả.
  if (containers.length === 0) return { items, rows }

  // Bảng container + nút 新增: nếu thiếu thì KHÔNG dòng nào điền được ⇒ báo
  // MỘT lỗi cho cả lần điền, không lặp lại N lỗi giống nhau theo từng dòng.
  const firstTable = findContainerTable(scope)
  if (!firstTable) {
    items.push({
      scope: 'container',
      prop: 'TABLE',
      label: 'Container table',
      status: 'error',
      note: 'Could not find the container table',
    })
    return { items, rows }
  }
  const firstAddButton = findContainerAddButton(scope, firstTable)
  if (!firstAddButton) {
    items.push({
      scope: 'container',
      prop: 'ADD_BUTTON',
      label: 'Container rows',
      status: 'error',
      note: 'Could not find the add-row button of the container table',
    })
    return { items, rows }
  }
  if (isDisabled(firstAddButton)) {
    items.push({
      scope: 'container',
      prop: 'ADD_BUTTON',
      label: 'Container rows',
      status: 'error',
      note: 'The add-row button of the container table is disabled',
    })
    return { items, rows }
  }

  for (const [index, container] of containers.entries()) {
    const rowNo = index + 1
    const label = `Container ${rowNo}/${containers.length}`
    const plans = mapContainer(container, ctx)

    // Số field đã ghi được của dòng — nằm NGOÀI try để `catch` cũng thấy
    // (một dòng gì được một phần vẫn là dòng đã tồn tại trong bảng).
    let written = 0

    try {
      // Element Plus render lại bảng khi data đổi ⇒ phải tra lại bảng và đọc lại
      // header ở MỖI dòng, không giữ handle cũ (B-6).
      const table = findContainerTable(scope)
      if (!table) {
        items.push({
          scope: 'container',
          prop: 'TABLE',
          label: 'Container table',
          status: 'error',
          note: 'Could not find the container table',
        })
        break
      }

      const addButton = findContainerAddButton(scope, table)
      if (!addButton) {
        // Bảng bị site thay thế và bảng mới không có nút 新增 ⇒ dừng luôn, báo
        // MỘT lỗi (không lặp lại y hệt cho từng dòng còn lại).
        items.push({
          scope: 'container',
          prop: 'ADD_BUTTON',
          label: 'Container rows',
          status: 'error',
          note: 'Could not find the add-row button of the container table',
        })
        break
      }
      if (isDisabled(addButton)) {
        items.push({
          scope: 'container',
          prop: 'ADD_BUTTON',
          label: 'Container rows',
          status: 'error',
          note: 'The add-row button of the container table is disabled',
        })
        break
      }

      // Chụp lại số dòng TRƯỚC khi bấm: site chèn dòng mới ở index 0
      // (`insertTableRow(0, {})`) ⇒ dòng mới KHÔNG phải dòng cuối (B-5/D-2).
      const beforeCount = readTableHandles(table).bodyRows.length
      addButton.click()

      /**
       * Dòng mới LUÔN ở index 0.
       *
       * KHÔNG được nhận diện bằng "node không nằm trong ảnh chụp trước": nếu
       * `el-table` không có `row-key` thì key của dòng là INDEX của nó ⇒ Vue
       * TÁI SỬ DỤNG node `<tr>` #0 cho dòng mới và chỉ mount node mới cho dòng
       * cũ cuối ⇒ "node mới" là dòng CUỐI, tức dòng cũ ⇒ ghi đè dòng trước.
       *
       * Bảng được cache theo dòng (tra cứu section rất tốn trên dialog thật);
       * nếu bảng bị site thay thế thì cache tự động bị bỏ.
       */
      let cachedTable: HTMLElement | null = table
      const resolveTable = (): HTMLElement | null => {
        if (cachedTable?.isConnected) return cachedTable
        cachedTable = findContainerTable(scope)
        return cachedTable
      }

      /** Dòng mới = dòng ĐẦU TIÊN của bảng (dòng site vừa chèn ở index 0). */
      const resolveNewRow = (): HTMLElement | null => {
        const current = resolveTable()
        if (!current) return null
        const rows = readTableHandles(current).bodyRows
        // Dòng mới ⇔ bảng dài thêm MỘT dòng.
        //
        // KHÔNG dò "node mới": `el-table` không có `row-key` thì key của dòng là
        // INDEX của nó ⇒ Vue tái sử dụng node `<tr>` #0 cho dòng mới và chỉ mount
        // node mới cho dòng cũ cuối ⇒ "node mới" là dòng CUỐI, tức dòng cũ ⇒
        // ghi đè dòng trước.
        //
        // Số dòng KHÔNG tăng ⇒ site chưa thêm dòng nào ⇒ không có dòng mới để
        // điền. Kể cả khi node ở index 0 trông "lạ" (site vừa dựng lại cả
        // bảng): lúc đó index 0 là dòng CŨ được render lại ⇒ ghi vào đó là ghi
        // đè dòng đã có.
        return rows.length > beforeCount ? rows[0] ?? null : null
      }

      const newRow = await waitFor(resolveNewRow, {
        timeout: 5000,
        interval: 100,
        label: `container row ${rowNo}`,
      }).catch(() => null)

      if (!newRow) {
        items.push({
          scope: 'container',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'The container table did not accept a new row within 5 seconds',
        })
        continue
      }

      log(`Filling in ${label}…`)
      const handles = readTableHandles(resolveTable() ?? table)

      for (const plan of plans) {
        if (plan.status === 'skip') {
          items.push({
            scope: 'container',
            prop: plan.prop,
            label: plan.label,
            status: 'skip',
            row: rowNo,
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
            row: rowNo,
            note: `Could not find the column "${columnLabel}" in the table`,
          })
          continue
        }

        // Element Plus có thể dựng lại `<tr>` khi model đổi ⇒ tra lại dòng mới ở
        // MỖI field, không dùng node đã bị detach.
        const cell = getCell(resolveNewRow() ?? newRow, columnIndex)
        if (!cell) {
          items.push({
            scope: 'container',
            prop: plan.prop,
            label: plan.label,
            status: 'error',
            row: rowNo,
            note: `Could not find the cell of the column "${columnLabel}"`,
          })
          continue
        }

        const result = await setCellValue(cell, plan.value ?? '')
        if (result.ok) written += 1
        items.push({
          scope: 'container',
          prop: plan.prop,
          label: plan.label,
          status: result.ok ? 'ok' : 'error',
          row: rowNo,
          // `ok` cũng mang note (ví dụ mã mà site lưu cho 货主箱标志).
          note: result.ok ? plan.note : result.reason,
        })
        await nextFrame()
      }

      // Chỉ tính dòng khi ít nhất một field của dòng đó thật sự được ghi (B-7).
      if (written === 0) {
        items.push({
          scope: 'container',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'No field of this row could be filled',
        })
        continue
      }

      rows += 1
    } catch (e) {
      // Một dòng hỏng không được làm hỏng các dòng còn lại (B-8).
      //
      // Dòng đã ghi được MỘT PHẦN thì dòng ĐÃ tồn tại trong bảng ⇒ vẫn tính
      // vào `rows` (B-7) và phải nói rõ là ghi được một phần.
      if (written > 0) rows += 1
      items.push({
        scope: 'container',
        prop: `ROW_${rowNo}`,
        label,
        row: rowNo,
        status: 'error',
        note:
          written > 0
            ? `Row ${rowNo} failed after ${written} field(s) had been written: ${(e as Error).message}`
            : `Row ${rowNo} failed: ${(e as Error).message}`,
      })
    }
  }

  return { items, rows }
}

/* ------------------------------------------------------------------ *
 *  Luồng tổng thể
 * ------------------------------------------------------------------ */

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
        'Could not find the "新增舱单信息" button — open the 预配舱单申报平台 page and select the 待发送 tab.',
    }
  }

  if (isDisabled(addButton)) {
    return {
      items: [],
      cargoRows: 0,
      containerRows: 0,
      ok: false,
      message:
        'The "新增舱单信息" button is disabled — open the 预配舱单申报平台 page and select the 待发送 tab.',
    }
  }

  addButton.click()

  const dialog = await waitFor(() => findManifestDialog(root), {
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
      message: 'The "新增舱单信息" dialog did not open within 5 seconds.',
    }
  }

  // Vue render bất đồng bộ: handler "新增" của site thường reset lại model của
  // form — cho nó một frame để flush trước khi bắt đầu điền field đầu tiên.
  await nextFrame()

  log('Filling in the manifest information…')
  const header = await fillPlans(dialog, mapHeader(data, ctx), 'header')

  const cargo = await fillCargoRows(dialog, data.cdgoods ?? [], { log })
  const container = await fillContainerRows(dialog, data.cdCon ?? [], ctx, { log })

  const items = [...header.items, ...cargo.items, ...container.items]

  if (options.autoSubmit) {
    const confirm = findButtonByText('确定', dialog)
    if (!confirm) {
      // Không có nút ⇒ không có gì được submit ⇒ tuyệt đối không báo thành công.
      items.push({
        scope: 'header',
        prop: 'SUBMIT',
        label: 'Submit the manifest',
        status: 'warn',
        note:
          'Could not find the "确定" button in the manifest dialog — the form was not ' +
          'submitted, please submit it by hand on the page',
      })
    } else if (isDisabled(confirm)) {
      items.push({
        scope: 'header',
        prop: 'SUBMIT',
        label: 'Submit the manifest',
        status: 'warn',
        note:
          'The "确定" button of the manifest dialog is disabled — the form was not ' +
          'submitted, please submit it by hand on the page',
      })
    } else {
      log('Clicking 确定 in the header form…')
      confirm.click()
      // Site có thật sự nhận form không? (B-15) — 尺寸/箱型/箱状态 bị bỏ trống
      // nên site từ chối ⇒ dialog vẫn mở ⇒ KHÔNG được báo thành công.
      //
      // Tra lại dialog HIỆN TẠI: nếu site dựng lại dialog sau khi từ chối thì
      // node đã bắt bị gỡ khỏi DOM — hỏi node đó là hỏi sai đối tượng.
      const closed = await waitFor(
        () => {
          const current = findManifestDialog(root)
          if (!current) return true
          return isHidden(current)
        },
        {
          timeout: HEADER_SUBMIT_TIMEOUT_MS,
          interval: 100,
          label: 'manifest dialog closed',
        },
      )
        .then(() => true)
        .catch(() => false)

      if (!closed) {
        items.push({
          scope: 'header',
          prop: 'SUBMIT',
          label: 'Submit the manifest',
          status: 'warn',
          note:
            'the site did not accept the form — the container rows still require ' +
            '尺寸 / 箱型 / 箱状态',
        })
      }
    }
  }

  return {
    items,
    cargoRows: cargo.rows,
    containerRows: container.rows,
    // `ok` = mọi thứ định ghi đều đã ghi được; `warn`/`error` đều cần người dùng xử lý.
    ok: items.every((i) => i.status === 'ok' || i.status === 'skip'),
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

> **Sửa sau đối chiếu site thật (2026-10-27, commit sửa `src/core/fill.ts` —
> c950758 — "fix: follow the site's real dialog overlay and table structure").**
>
> - **Dialog hàng phải là dialog MỚI** (B-1) — chụp lại `.el-dialog` **trước** khi
>   bấm `新增`, rồi chờ một dialog **không nằm trong ảnh chụp** mới có `E_CARGO_NAM`.
>   Element Plus giữ dialog đã đóng trong DOM ⇒ không làm vậy thì dòng 2 sẽ ghi
>   đè lên dialog của dòng 1.
> - **Nút lưu là `保存`, không phải `确定`** (D-1) — trong dialog `货物信息` chỉ có
>   `取消` và `保存`; `确定` chỉ xuất hiện trong hộp thoại xoá.
> - **Phải kiểm tra site có nhận dòng không** (B-13) — với loại hàng `S` thì
>   `PACKAGE_STR`/`PACKAGE_COD` là field **bắt buộc** mà API không có ⇒ site
>   validate fail và **không** POST. Sau `保存` phải đợi (timeout riêng) xem dialog
>   có đóng lại **hoặc** bảng danh sách `货物信息` có thêm dòng không; không thì
>   **không** cộng `rows` và ghi 1 item ⚠️ nói rõ cần tự chọn 包装类型/代码.
> - **`rows` chỉ đếm dòng thật sự được ghi** (B-7, B-8) — mỗi dòng có
>   `try/catch` riêng; một dòng hỏng không được làm hỏng các dòng sau.
> - **Nút `新增` phải nằm trong đúng section** (B-3) — section `货物信息` và section
>   `箱信息` đều có nút `新增`; bấm nhầm sẽ mở dialog hàng từ section container.
> - **Ba hằng số thời gian riêng** (B-2): mở dialog (600 ms), chờ POST
>   `/cargo/add/` land (800 ms), chờ site chấp nhận/từ chối (3 s).
>
> Chi tiết: `docs/superpowers/plans/2026-10-27-live-site-alignment.md` (FIX LIST B
> + FIX LIST D).
>
- [ ] **Step 1: Bổ sung DOM test cho dialog hàng — thêm vào `tests/helpers/dom.ts`**

> File helper được viết lại thành **một khối duy nhất** khi đối chiếu site thật
> (2026-10-27) — xem **Task 9, Step 1** cho bản đầy đủ của `tests/helpers/dom.ts`.
> Riêng phần phục vụ dialog hàng: `CargoDialogOptions`, `cargoDialogHtml`,
> `wireCargoSave`, `createCargoDialog`, `cargoDialogs`, `cargoDialog`,
> `cargoFieldValue`, `goodsListRowCount`, `cargoSaveClicks`, `buildCargoSection`,
> `wireCargoAdd`, `buildCargoDialog`.
>
> Thay đổi so với bản gốc của task: nút lưu là **`保存`** (không phải `确定`),
> bấm `新增` mở **dialog mới** (mỗi lần một `id` riêng), `保存` **đóng** dialog và
> **thêm một dòng** vào bảng danh sách `货物信息` (`#goods-table`), và có
> `rejectSave` để mô phỏng site từ chối lưu.

- [ ] **Step 2: Viết test fail trước — `tests/fill-cargo.test.ts`**

> File helper được viết lại thành **một khối duy nhất** khi đối chiếu site thật
> (2026-10-27) — xem **Task 9, Step 1** cho bản đầy đủ của `tests/helpers/dom.ts`.
> Riêng phần phục vụ dialog hàng: `CargoDialogOptions`, `cargoDialogHtml`,
> `wireCargoSave`, `createCargoDialog`, `cargoDialogs`, `cargoDialog`,
> `cargoFieldValue`, `goodsListRowCount`, `cargoSaveClicks`, `buildCargoSection`,
> `wireCargoAdd`, `buildCargoDialog`.
>
> Thay đổi so với bản gốc của task: nút lưu là **`保存`** (không phải `确定`),
> bấm `新增` mở **dialog mới** (mỗi lần một `id` riêng), `保存` **đóng** dialog và
> **thêm một dòng** vào bảng danh sách `货物信息` (`#goods-table`), và có
> `rejectSave` để mô phỏng site từ chối lưu.

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `findAddButtonBySectionTitle` / `fillCargoRows` chưa được export.

- [ ] **Step 4: Thêm helper tìm section + nút 新增 vào `src/core/fill.ts`**

Thay khối import ở đầu `src/core/fill.ts` bằng:

> File helper được viết lại thành **một khối duy nhất** khi đối chiếu site thật
> (2026-10-27) — xem **Task 9, Step 1** cho bản đầy đủ của `tests/helpers/dom.ts`.
> Riêng phần phục vụ dialog hàng: `CargoDialogOptions`, `cargoDialogHtml`,
> `wireCargoSave`, `createCargoDialog`, `cargoDialogs`, `cargoDialog`,
> `cargoFieldValue`, `goodsListRowCount`, `cargoSaveClicks`, `buildCargoSection`,
> `wireCargoAdd`, `buildCargoDialog`.
>
> Thay đổi so với bản gốc của task: nút lưu là **`保存`** (không phải `确定`),
> bấm `新增` mở **dialog mới** (mỗi lần một `id` riêng), `保存` **đóng** dialog và
> **thêm một dòng** vào bảng danh sách `货物信息` (`#goods-table`), và có
> `rejectSave` để mô phỏng site từ chối lưu.

Thêm các hàm sau (đặt sau `findButtonByText`):

> File helper được viết lại thành **một khối duy nhất** khi đối chiếu site thật
> (2026-10-27) — xem **Task 9, Step 1** cho bản đầy đủ của `tests/helpers/dom.ts`.
> Riêng phần phục vụ dialog hàng: `CargoDialogOptions`, `cargoDialogHtml`,
> `wireCargoSave`, `createCargoDialog`, `cargoDialogs`, `cargoDialog`,
> `cargoFieldValue`, `goodsListRowCount`, `cargoSaveClicks`, `buildCargoSection`,
> `wireCargoAdd`, `buildCargoDialog`.
>
> Thay đổi so với bản gốc của task: nút lưu là **`保存`** (không phải `确定`),
> bấm `新增` mở **dialog mới** (mỗi lần một `id` riêng), `保存` **đóng** dialog và
> **thêm một dòng** vào bảng danh sách `货物信息` (`#goods-table`), và có
> `rejectSave` để mô phỏng site từ chối lưu.

- [ ] **Step 5: Tách `fillHeader` thành `fillPlans` có tham số scope**

Thay thế hàm `fillHeader` trong `src/core/fill.ts` bằng:

```ts
export async function fillPlans(
  root: ParentNode,
  plans: FieldPlan[],
  scope: FillScope = 'header',
  options: { row?: number } = {},
): Promise<{ items: FillItem[] }> {
  const items: FillItem[] = []
  const row = options.row

  for (const plan of plans) {
    if (plan.status === 'skip') {
      items.push({
        scope,
        prop: plan.prop,
        label: plan.label,
        status: 'skip',
        row,
        note: plan.note,
      })
      // Nhánh skip không đụng DOM ⇒ không cần chờ frame (17/24 plan của hàng là skip).
      continue
    }

    const result = await setFieldValue(root, plan.prop, plan.value ?? '', {
      matchValue: plan.matchValue,
    })
    if (!result.ok) {
      items.push({
        scope,
        prop: plan.prop,
        label: plan.label,
        // Không tìm thấy field / không có option → cảnh báo, người dùng tự xử lý.
        // Chỉ lỗi ghi giá trị (strategy 'text') mới là lỗi thật.
        status: result.strategy === 'text' ? 'error' : 'warn',
        row,
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
          status: 'warn',
          row,
          note: plan.verify.note,
        })
        await nextFrame()
        continue
      }
    }

    // `ok` cũng mang note: ví dụ "The site stores the code \"P\" for \"预付\"" để
    // người dùng đối chiếu mã mà site lưu.
    items.push({ scope, prop: plan.prop, label: plan.label, status: 'ok', row, note: plan.note })
    await nextFrame()
  }

  return { items }
}
```

> `FillItem.scope` đã khai báo là `'header' | 'cargo' | 'container'` — giữ nguyên, khớp với `FillScope` mới.

- [ ] **Step 6: Thêm `fillCargoRows` vào `src/core/fill.ts`**

```ts
/**
 * Site có thật sự nhận dòng hàng không?
 *
 * Với loại hàng `S` thì PACKAGE_STR và PACKAGE_COD là field **bắt buộc** mà API
 * không có ⇒ site validate fail (请填必填表格) và **không** POST ⇒ dòng hàng
 * không được lưu. Dấu hiệu nhận biết: bảng danh sách không có dòng mới.
 *
 * Nếu site CÓ bảng DANH SÁCH hàng ⇒ đó là tiêu chí DUY NHẤT. "Dialog đóng"
 * không đủ: node dialog có thể bị Vue gỡ khỏi DOM khi site dựng lại nó sau khi
 * từ chối lưu (B-13) — lúc đó coi như "đã lưu" là báo thành công sai.
 *
 * `captured` là node dialog mà extension vừa điền — chỉ dùng làm DỰ PHÒNG khi
 * trong DOM không còn dialog nào; không dùng nó làm tiêu chí chính vì node đó
 * có thể đã bị detach (xem `isHidden`).
 */
async function waitForCargoRowAccepted(
  scope: ParentNode,
  rowsBefore: number,
  captured: HTMLElement | null = null,
): Promise<CargoAcceptance> {
  const hasGoodsList = findTableBySectionTitle(scope, '货物信息') !== null

  const accepted = await waitFor(
    () => {
      if (hasGoodsList) return countGoodsListRows(scope) > rowsBefore
      // Không có bảng DANH SÁCH ⇒ chỉ còn cách hỏi dialog hiện tại.
      // PHẢI tra lại (node cũ có thể đã bị site gỡ khỏi DOM) rồi mới hỏi nó.
      const current = currentCargoDialog() ?? captured
      if (!current) return true
      return isHidden(current)
    },
    { timeout: CARGO_SAVE_TIMEOUT_MS, interval: 100, label: 'cargo row accepted' },
  ).catch(() => false)

  if (accepted) return 'accepted'

  // Hết giờ chờ mà vẫn chưa xác nhận được.
  if (hasGoodsList) {
    // Site còn GIỮ dialog hàng mở ⇒ site đã từ chối (validate fail), không
    // phải chậm mạng: nhắc đúng cần chọn 包装类型/代码.
    const current = currentCargoDialog() ?? captured
    if (current && !isHidden(current)) return 'refused'
  }
  // Còn lại (bảng chưa render lại, dialog đã đóng nhưng list chưa có dòng):
  // KHÔNG xác nhận được ⇒ nói "chưa xác nhận được", không nói "site từ chối".
  return 'timeout'
}

export async function fillCargoRows(
  scope: ParentNode,
  goodsList: ManifestCargo[],
  options: { log?: (message: string) => void } = {},
): Promise<{ items: FillItem[]; rows: number }> {
  const log = options.log ?? (() => {})
  const items: FillItem[] = []
  let rows = 0

  // Không có dòng nào để điền ⇒ không cần tìm nút 新增, không báo lỗi gì cả.
  if (goodsList.length === 0) return { items, rows }

  // Nút 新增 của section 货物信息.
  //
  // Site có thể DỰNG LẠI section sau mỗi lần lưu ⇒ node nút cũ bị gỡ khỏi DOM
  // và `click()` trên node đó là no-op ⇒ phải tra lại nút ở MỔI dòng.
  const resolveAddButton = (): HTMLElement | null =>
    findAddButtonBySectionTitle(scope, '货物信息')

  // Node dialog đã dùng cho dòng trước — dùng lại được khi site DÙNG LẠI một
  // element cho mọi dòng (lúc đó không có node mới nào xuất hiện).
  let lastDialog: HTMLElement | null = null

  // Không có nút 新增 ⇒ báo MỘT lỗi cho cả lần điền (không lặp lại theo dòng).
  if (!resolveAddButton()) {
    items.push({
      scope: 'cargo',
      prop: 'ADD_BUTTON',
      label: 'Cargo rows',
      status: 'error',
      note: 'Could not find the "新增" button in the 货物信息 section',
    })
    return { items, rows }
  }

  for (const [index, goods] of goodsList.entries()) {
    const rowNo = index + 1
    const label = `Cargo ${rowNo}/${goodsList.length}`

    try {
      // Chụp lại các dialog TRƯỚC khi bấm 新增: Element Plus giữ dialog cũ trong
      // DOM ⇒ không có snapshot thì dòng 2 sẽ bị ghi vào dialog của dòng 1.
      const before = snapshotDialogs()
      // Các dialog đang ẩn lúc này: dùng để nhận ra ca "site dùng lại element
      // đã mount sẵn" (trước đó ẩn, giờ hiện) mà không đụng vào dialog đã hiện
      // sẵn (dialog của dòng trước / do người dùng tự mở).
      const beforeHidden = snapshotHiddenDialogs()

      // Tra lại nút ở MỖI dòng: node đã bị site dựng lại thì click là no-op.
      const addButton = resolveAddButton()
      if (!addButton) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'Could not find the "新增" button in the 货物信息 section',
        })
        continue
      }
      if (isDisabled(addButton)) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'The "新增" button of the 货物信息 section is disabled',
        })
        continue
      }
      addButton.click()
      await sleep(CARGO_DIALOG_DELAY_MS)

      let dialog = await waitFor(
        () => {
          // 1) Node MỚI: site mount dialog mới cho dòng này.
          const fresh = findNewCargoDialog(before)
          if (fresh) return fresh
          // 2) Site DÙNG LẠI một element dialog cho mọi dòng: node của dòng
          //    trước vẫn còn trong DOM, đang hiện và form đã được site reset.
          if (isReusableCargoDialog(lastDialog)) return lastDialog
          // 3) Site dùng lại một element ĐÃ MOUNT SẴN (trước đó ẩn, giờ site
          //    hiện lại) ⇒ không có node mới nào để tìm. Chỉ nhận dialog trước
          //    đây đang ẩn: dialog đã hiện sẵn là dialog của dòng trước hoặc do
          //    người dùng tự mở ⇒ không được ghi đè.
          const reused = findReusedCargoDialog(beforeHidden)
          if (reused) return reused
          return null
        },
        {
          timeout: 5000,
          interval: 100,
          label: `cargo dialog ${rowNo}`,
        },
      ).catch(() => null)

      if (!dialog) {
        // Hết thời gian mà vẫn không có node mới ⇒ site dùng lại một element
        // dialog. Dự phòng chỉ dùng được dialog đang hiện mà form TRỐNG.
        dialog = findVisibleCargoDialog()
      }
      if (dialog) lastDialog = dialog

      if (!dialog) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'The cargo dialog did not open within 5 seconds',
        })
        continue
      }

      log(`Filling in ${label}…`)
      const filled = await fillPlans(dialog, mapCargo(goods), 'cargo', { row: rowNo })
      items.push(...filled.items)

      // Site có thể thay element dialog NGAY TRONG LÚC đang điền (Vue thay vì
      // patch) ⇒ node đang ghi đã rời DOM ⇒ mọi field ghi vào đó là field
      // "ok" trên một node chết ⇒ bấm 保存 vào node đó là vô nghĩa.
      if (!dialog.isConnected) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note:
            'The cargo dialog was replaced by the site while it was being filled — ' +
            'the row was not saved, please fill it in on the page',
        })
        continue
      }

      const written = filled.items.filter((i) => i.status === 'ok').length
      if (written === 0) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'No field of this row could be filled',
        })
        continue
      }

      // Nút lưu của dialog hàng là 保存 (không phải 确定).
      const save = findButtonByText('保存', dialog)
      if (!save) {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'Could not find the "保存" button in the cargo dialog',
        })
        continue
      }

      if (isDisabled(save)) {
        // Site khoá nút lưu khi form chưa hợp lệ — 包装类型/代码 bị bỏ trống
        // nên đây là trạng thái có thật trên site, phải nói rõ để người dùng
        // biết cần làm gì (cùng gợi ý với B-13).
        //
        // Khác với nhánh "site từ chối" (bấm 保存 xong mà site không nhận):
        // ở đây nút lưu **bị khoá** ⇒ chưa có gì được gửi đi.
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'warn',
          note:
            'the "保存" button of the cargo dialog is disabled — the site requires ' +
            '包装类型/代码 (PACKAGE_STR / PACKAGE_COD) before it accepts the row; ' +
            'please choose them on the page and save again',
        })
        continue
      }

      const goodsRowsBefore = countGoodsListRows(scope)
      save.click()

      // Site có thật sự nhận dòng không? (B-13)
      const acceptance = await waitForCargoRowAccepted(scope, goodsRowsBefore, dialog)
      if (acceptance !== 'accepted') {
        items.push({
          scope: 'cargo',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'warn',
          // "Site từ chối" và "chưa xác nhận được" là HAI câu khác nhau:
          // nói nhầm "site từ chối" khi dòng đã lưu được sẽ khiến người dùng
          // nhập lại ⇒ dòng hàng TRÙNG trong manifest.
          note:
            acceptance === 'refused'
              ? 'the site did not accept the row — it requires 包装类型/代码 ' +
                '(PACKAGE_STR / PACKAGE_COD), please choose them on the page and save again'
              : `the site did not confirm the row within ${
                  Math.round(CARGO_SAVE_TIMEOUT_MS / 1000)
                } s — please check the 货物信息 list before entering it again`,
        })
        continue
      }

      rows += 1

      // POST /cargo/add/ phải land trước khi mở dòng tiếp theo (B-2).
      await sleep(CARGO_COMMIT_DELAY_MS)
    } catch (e) {
      // Một dòng hỏng không được làm hỏng các dòng còn lại (B-8).
      items.push({
        scope: 'cargo',
        prop: `ROW_${rowNo}`,
        label,
        row: rowNo,
        status: 'error',
        note: `Row ${rowNo} failed: ${(e as Error).message}`,
      })
    }
  }

  return { items, rows }
}

/* ------------------------------------------------------------------ *
 *  Dòng container (bảng inline editable 箱信息)
 * ------------------------------------------------------------------ */
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

> **Sửa sau đối chiếu site thật (2026-10-27, commit `34e456c` — "fix: align select
> filling with the live site", và commit sửa `src/core/fill.ts` —
> c950758 — "fix: follow the site's real dialog overlay and table structure").**
>
> - **Bảng container phải được khoanh theo section** (B-4) — dialog đầu có cả bảng
>   danh sách hàng lẫn bảng container; `findContainerTable()` phải kiểm tra
>   header có cột `箱号`, nếu không thì báo `Could not find the container table`.
>   Nút `新增` của container cũng phải nằm trong cùng section.
> - **Dòng mới không phải dòng cuối** (B-5, D-2) — site chèn dòng mới vào
>   **index 0**; phải chụp lại các `<tr>` trước khi bấm rồi chọn dòng **không nằm
>   trong ảnh chụp**.
> - **Handle của bảng và header phải đọc lại trong vòng lặp** (B-6) — Element
>   Plus render lại bảng khi data đổi.
> - **`rows` chỉ đếm dòng có ít nhất 1 field được ghi** (B-7, B-8).
> - **`src/core/table.ts`** đã sửa ở commit `34e456c` (A-12): `setCellValue`
>   kiểm tra `.el-select` **trước** khi tìm `<input>`; và sửa thêm (C-5):
>   `readTableHandles` **loại bỏ** ô `<th class="el-table__gutter">` mà Element Plus
>   thêm vào khi bảng cuộn ngang — header có ô này nhưng body `<td>` thì không, nên
>   giữ nó lại sẽ làm mọi cột lệch sang phải 1 cột (箱号 → 尺寸).
> - **Dòng container mới nằm ở index 0 và phải lấy theo index** (C-1) — `el-table`
>   không có `row-key` thì Vue **tái sử dụng** `<tr>` #0 cho dòng mới ⇒ tra theo
>   "DOM node mới" sẽ trỏ nhầm dòng và ghi đè dòng trước.
>
> Chi tiết: `docs/superpowers/plans/2026-10-27-live-site-alignment.md` (FIX LIST B
> + FIX LIST D).
>
- [ ] **Step 1: Bổ sung DOM test cho bảng container — thêm vào `tests/helpers/dom.ts`**

> File helper được viết lại thành **một khối duy nhất** khi đối chiếu site thật
> (2026-10-27) — xem **Task 9, Step 1** cho bản đầy đủ của `tests/helpers/dom.ts`.
> Riêng phần phục vụ bảng container: `CONTAINER_COLUMNS`, `containerSectionHtml`,
> `containerTableHtml`, `containerTbody`, `containerRowHtml`, `buildContainerSection`,
> `simulateAddRow`, `selectedOptions`, `trackOptionClicks`.
>
> Thay đổi so với bản gốc của task: dòng mới được chèn vào **index 0** (D-2),
> bảng container là **anh em** với section `箱信息` (cùng nằm trong ancestor chứa
> bảng) — đúng như site thật, nên phải kiểm tra cột `箱号` mới biết đúng bảng.

- [ ] **Step 2: Viết test fail trước — `tests/fill-container.test.ts`**

> File helper được viết lại thành **một khối duy nhất** khi đối chiếu site thật
> (2026-10-27) — xem **Task 9, Step 1** cho bản đầy đủ của `tests/helpers/dom.ts`.
> Riêng phần phục vụ bảng container: `CONTAINER_COLUMNS`, `containerSectionHtml`,
> `containerTableHtml`, `containerTbody`, `containerRowHtml`, `buildContainerSection`,
> `simulateAddRow`, `selectedOptions`, `trackOptionClicks`.
>
> Thay đổi so với bản gốc của task: dòng mới được chèn vào **index 0** (D-2),
> bảng container là **anh em** với section `箱信息` (cùng nằm trong ancestor chứa
> bảng) — đúng như site thật, nên phải kiểm tra cột `箱号` mới biết đúng bảng.

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/core/table"`.

- [ ] **Step 4: Tạo `src/core/table.ts`**

> File helper được viết lại thành **một khối duy nhất** khi đối chiếu site thật
> (2026-10-27) — xem **Task 9, Step 1** cho bản đầy đủ của `tests/helpers/dom.ts`.
> Riêng phần phục vụ bảng container: `CONTAINER_COLUMNS`, `containerSectionHtml`,
> `containerTableHtml`, `containerTbody`, `containerRowHtml`, `buildContainerSection`,
> `simulateAddRow`, `selectedOptions`, `trackOptionClicks`.
>
> Thay đổi so với bản gốc của task: dòng mới được chèn vào **index 0** (D-2),
> bảng container là **anh em** với section `箱信息` (cùng nằm trong ancestor chứa
> bảng) — đúng như site thật, nên phải kiểm tra cột `箱号` mới biết đúng bảng.

- [ ] **Step 5: Thêm `fillContainerRows` vào `src/core/fill.ts`**

Thêm import:

> File helper được viết lại thành **một khối duy nhất** khi đối chiếu site thật
> (2026-10-27) — xem **Task 9, Step 1** cho bản đầy đủ của `tests/helpers/dom.ts`.
> Riêng phần phục vụ bảng container: `CONTAINER_COLUMNS`, `containerSectionHtml`,
> `containerTableHtml`, `containerTbody`, `containerRowHtml`, `buildContainerSection`,
> `simulateAddRow`, `selectedOptions`, `trackOptionClicks`.
>
> Thay đổi so với bản gốc của task: dòng mới được chèn vào **index 0** (D-2),
> bảng container là **anh em** với section `箱信息` (cùng nằm trong ancestor chứa
> bảng) — đúng như site thật, nên phải kiểm tra cột `箱号` mới biết đúng bảng.

Thay khối import của `mapping` ở đầu `src/core/fill.ts` bằng:

```ts
 *  Dòng container (bảng inline editable 箱信息)
 * ------------------------------------------------------------------ */

export async function fillContainerRows(
  scope: ParentNode,
  containers: ManifestContainer[],
  ctx: MappingContext,
  options: { log?: (message: string) => void } = {},
): Promise<{ items: FillItem[]; rows: number }> {
  const log = options.log ?? (() => {})
  const items: FillItem[] = []
  let rows = 0

  // Không có container nào để điền ⇒ không cần tìm bảng, không báo lỗi gì cả.
  if (containers.length === 0) return { items, rows }

  // Bảng container + nút 新增: nếu thiếu thì KHÔNG dòng nào điền được ⇒ báo
  // MỘT lỗi cho cả lần điền, không lặp lại N lỗi giống nhau theo từng dòng.
  const firstTable = findContainerTable(scope)
  if (!firstTable) {
    items.push({
      scope: 'container',
      prop: 'TABLE',
      label: 'Container table',
      status: 'error',
      note: 'Could not find the container table',
    })
    return { items, rows }
  }
  const firstAddButton = findContainerAddButton(scope, firstTable)
  if (!firstAddButton) {
    items.push({
      scope: 'container',
      prop: 'ADD_BUTTON',
      label: 'Container rows',
      status: 'error',
      note: 'Could not find the add-row button of the container table',
    })
    return { items, rows }
  }
  if (isDisabled(firstAddButton)) {
    items.push({
      scope: 'container',
      prop: 'ADD_BUTTON',
      label: 'Container rows',
      status: 'error',
      note: 'The add-row button of the container table is disabled',
    })
    return { items, rows }
  }

  for (const [index, container] of containers.entries()) {
    const rowNo = index + 1
    const label = `Container ${rowNo}/${containers.length}`
    const plans = mapContainer(container, ctx)

    // Số field đã ghi được của dòng — nằm NGOÀI try để `catch` cũng thấy
    // (một dòng gì được một phần vẫn là dòng đã tồn tại trong bảng).
    let written = 0

    try {
      // Element Plus render lại bảng khi data đổi ⇒ phải tra lại bảng và đọc lại
      // header ở MỖI dòng, không giữ handle cũ (B-6).
      const table = findContainerTable(scope)
      if (!table) {
        items.push({
          scope: 'container',
          prop: 'TABLE',
          label: 'Container table',
          status: 'error',
          note: 'Could not find the container table',
        })
        break
      }

      const addButton = findContainerAddButton(scope, table)
      if (!addButton) {
        // Bảng bị site thay thế và bảng mới không có nút 新增 ⇒ dừng luôn, báo
        // MỘT lỗi (không lặp lại y hệt cho từng dòng còn lại).
        items.push({
          scope: 'container',
          prop: 'ADD_BUTTON',
          label: 'Container rows',
          status: 'error',
          note: 'Could not find the add-row button of the container table',
        })
        break
      }
      if (isDisabled(addButton)) {
        items.push({
          scope: 'container',
          prop: 'ADD_BUTTON',
          label: 'Container rows',
          status: 'error',
          note: 'The add-row button of the container table is disabled',
        })
        break
      }

      // Chụp lại số dòng TRƯỚC khi bấm: site chèn dòng mới ở index 0
      // (`insertTableRow(0, {})`) ⇒ dòng mới KHÔNG phải dòng cuối (B-5/D-2).
      const beforeCount = readTableHandles(table).bodyRows.length
      addButton.click()

      /**
       * Dòng mới LUÔN ở index 0.
       *
       * KHÔNG được nhận diện bằng "node không nằm trong ảnh chụp trước": nếu
       * `el-table` không có `row-key` thì key của dòng là INDEX của nó ⇒ Vue
       * TÁI SỬ DỤNG node `<tr>` #0 cho dòng mới và chỉ mount node mới cho dòng
       * cũ cuối ⇒ "node mới" là dòng CUỐI, tức dòng cũ ⇒ ghi đè dòng trước.
       *
       * Bảng được cache theo dòng (tra cứu section rất tốn trên dialog thật);
       * nếu bảng bị site thay thế thì cache tự động bị bỏ.
       */
      let cachedTable: HTMLElement | null = table
      const resolveTable = (): HTMLElement | null => {
        if (cachedTable?.isConnected) return cachedTable
        cachedTable = findContainerTable(scope)
        return cachedTable
      }

      /** Dòng mới = dòng ĐẦU TIÊN của bảng (dòng site vừa chèn ở index 0). */
      const resolveNewRow = (): HTMLElement | null => {
        const current = resolveTable()
        if (!current) return null
        const rows = readTableHandles(current).bodyRows
        // Dòng mới ⇔ bảng dài thêm MỘT dòng.
        //
        // KHÔNG dò "node mới": `el-table` không có `row-key` thì key của dòng là
        // INDEX của nó ⇒ Vue tái sử dụng node `<tr>` #0 cho dòng mới và chỉ mount
        // node mới cho dòng cũ cuối ⇒ "node mới" là dòng CUỐI, tức dòng cũ ⇒
        // ghi đè dòng trước.
        //
        // Số dòng KHÔNG tăng ⇒ site chưa thêm dòng nào ⇒ không có dòng mới để
        // điền. Kể cả khi node ở index 0 trông "lạ" (site vừa dựng lại cả
        // bảng): lúc đó index 0 là dòng CŨ được render lại ⇒ ghi vào đó là ghi
        // đè dòng đã có.
        return rows.length > beforeCount ? rows[0] ?? null : null
      }

      const newRow = await waitFor(resolveNewRow, {
        timeout: 5000,
        interval: 100,
        label: `container row ${rowNo}`,
      }).catch(() => null)

      if (!newRow) {
        items.push({
          scope: 'container',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'The container table did not accept a new row within 5 seconds',
        })
        continue
      }

      log(`Filling in ${label}…`)
      const handles = readTableHandles(resolveTable() ?? table)

      for (const plan of plans) {
        if (plan.status === 'skip') {
          items.push({
            scope: 'container',
            prop: plan.prop,
            label: plan.label,
            status: 'skip',
            row: rowNo,
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
            row: rowNo,
            note: `Could not find the column "${columnLabel}" in the table`,
          })
          continue
        }

        // Element Plus có thể dựng lại `<tr>` khi model đổi ⇒ tra lại dòng mới ở
        // MỖI field, không dùng node đã bị detach.
        const cell = getCell(resolveNewRow() ?? newRow, columnIndex)
        if (!cell) {
          items.push({
            scope: 'container',
            prop: plan.prop,
            label: plan.label,
            status: 'error',
            row: rowNo,
            note: `Could not find the cell of the column "${columnLabel}"`,
          })
          continue
        }

        const result = await setCellValue(cell, plan.value ?? '')
        if (result.ok) written += 1
        items.push({
          scope: 'container',
          prop: plan.prop,
          label: plan.label,
          status: result.ok ? 'ok' : 'error',
          row: rowNo,
          // `ok` cũng mang note (ví dụ mã mà site lưu cho 货主箱标志).
          note: result.ok ? plan.note : result.reason,
        })
        await nextFrame()
      }

      // Chỉ tính dòng khi ít nhất một field của dòng đó thật sự được ghi (B-7).
      if (written === 0) {
        items.push({
          scope: 'container',
          prop: `ROW_${rowNo}`,
          label,
          row: rowNo,
          status: 'error',
          note: 'No field of this row could be filled',
        })
        continue
      }

      rows += 1
    } catch (e) {
      // Một dòng hỏng không được làm hỏng các dòng còn lại (B-8).
      //
      // Dòng đã ghi được MỘT PHẦN thì dòng ĐÃ tồn tại trong bảng ⇒ vẫn tính
      // vào `rows` (B-7) và phải nói rõ là ghi được một phần.
      if (written > 0) rows += 1
      items.push({
        scope: 'container',
        prop: `ROW_${rowNo}`,
        label,
        row: rowNo,
        status: 'error',
        note:
          written > 0
            ? `Row ${rowNo} failed after ${written} field(s) had been written: ${(e as Error).message}`
            : `Row ${rowNo} failed: ${(e as Error).message}`,
      })
    }
  }

  return { items, rows }
}

/* ------------------------------------------------------------------ *
 *  Luồng tổng thể
 * ------------------------------------------------------------------ */
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
      label: 'Container table',
      status: 'error',
      note: 'Could not find the container table (.el-table)',
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
        note: 'Could not find the add-row button of the container table',
      })
      continue
    }

    const before = readTableHandles(table).bodyRows.length
    addButton.click()

    const grown = await waitFor(
      () => readTableHandles(table).bodyRows.length > before,
      { timeout: 5000, interval: 100, label: `container row ${index + 1}` },
    ).catch(() => false)

    if (!grown) {
      items.push({
        scope: 'container',
        prop: `ROW_${index + 1}`,
        label,
        status: 'error',
        note: 'The container table did not accept a new row within 5 seconds',
      })
      continue
    }

    const rowsNow = readTableHandles(table).bodyRows
    const row = rowsNow[rowsNow.length - 1]!
    log(`Filling in ${label}…`)

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
          note: `Could not find the column "${columnLabel}" in the table`,
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
          note: `Could not find the cell of the column "${columnLabel}"`,
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
        'Could not find the "新增舱单信息" button — open the 预配舱单申报平台 page and select the 待发送 tab.',
    }
  }

  if (isDisabled(addButton)) {
    return {
      items: [],
      cargoRows: 0,
      containerRows: 0,
      ok: false,
      message:
        'The "新增舱单信息" button is disabled — open the 预配舱单申报平台 page and select the 待发送 tab.',
    }
  }

  addButton.click()

  const dialog = await waitFor(() => findManifestDialog(root), {
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
      message: 'The "新增舱单信息" dialog did not open within 5 seconds.',
    }
  }

  // Vue render bất đồng bộ: handler "新增" của site thường reset lại model của
  // form — cho nó một frame để flush trước khi bắt đầu điền field đầu tiên.
  await nextFrame()

  log('Filling in the manifest information…')
  const header = await fillPlans(dialog, mapHeader(data, ctx), 'header')

  const cargo = await fillCargoRows(dialog, data.cdgoods ?? [], { log })
  const container = await fillContainerRows(dialog, data.cdCon ?? [], ctx, { log })

  const items = [...header.items, ...cargo.items, ...container.items]

  if (options.autoSubmit) {
    const confirm = findButtonByText('确定', dialog)
    if (!confirm) {
      // Không có nút ⇒ không có gì được submit ⇒ tuyệt đối không báo thành công.
      items.push({
        scope: 'header',
        prop: 'SUBMIT',
        label: 'Submit the manifest',
        status: 'warn',
        note:
          'Could not find the "确定" button in the manifest dialog — the form was not ' +
          'submitted, please submit it by hand on the page',
      })
    } else if (isDisabled(confirm)) {
      items.push({
        scope: 'header',
        prop: 'SUBMIT',
        label: 'Submit the manifest',
        status: 'warn',
        note:
          'The "确定" button of the manifest dialog is disabled — the form was not ' +
          'submitted, please submit it by hand on the page',
      })
    } else {
      log('Clicking 确定 in the header form…')
      confirm.click()
      // Site có thật sự nhận form không? (B-15) — 尺寸/箱型/箱状态 bị bỏ trống
      // nên site từ chối ⇒ dialog vẫn mở ⇒ KHÔNG được báo thành công.
      //
      // Tra lại dialog HIỆN TẠI: nếu site dựng lại dialog sau khi từ chối thì
      // node đã bắt bị gỡ khỏi DOM — hỏi node đó là hỏi sai đối tượng.
      const closed = await waitFor(
        () => {
          const current = findManifestDialog(root)
          if (!current) return true
          return isHidden(current)
        },
        {
          timeout: HEADER_SUBMIT_TIMEOUT_MS,
          interval: 100,
          label: 'manifest dialog closed',
        },
      )
        .then(() => true)
        .catch(() => false)

      if (!closed) {
        items.push({
          scope: 'header',
          prop: 'SUBMIT',
          label: 'Submit the manifest',
          status: 'warn',
          note:
            'the site did not accept the form — the container rows still require ' +
            '尺寸 / 箱型 / 箱状态',
        })
      }
    }
  }

  return {
    items,
    cargoRows: cargo.rows,
    containerRows: container.rows,
    // `ok` = mọi thứ định ghi đều đã ghi được; `warn`/`error` đều cần người dùng xử lý.
    ok: items.every((i) => i.status === 'ok' || i.status === 'skip'),
  }
}
```

> **Sửa so với bản gốc của plan (2026-10-27):** `fillManifest` không dùng
> `root.querySelector('.el-dialog')` nữa mà dùng `findManifestDialog(root)`.
> Lý do: Element Plus giữ lại dialog đã đóng trong DOM, nên `.el-dialog` đầu
> tiên có thể là dialog ẩn của màn khác — lấy nhầm thì mọi field đều báo
> "không tìm thấy" và lần điền im lặng thất bại. `findManifestDialog` dùng lại
> `findDialogWithField` (đã có từ Task 10) để ưu tiên dialog có chứa field
> `BILL_NBR`, rồi mới fallback sang dialog đang hiện. Sẽ được xác nhận lại trên
> site thật ở Task 17.

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

## Task 12: `site.ts` — tách từ vựng DOM của site ra khỏi `fill.ts` (refactor)

**Files:**
- Create: `src/core/site.ts`
- Modify: `src/core/fill.ts` — bỏ các hàm đã tách, thêm import từ `./site`
- Modify: `tests/fill-cargo.test.ts`, `tests/fill-header.test.ts` — đổi nguồn import

> **Vì sao có task này** — sau khi đối chiếu site thật (FIX LIST B/C/D trong
> `docs/superpowers/plans/2026-10-27-live-site-alignment.md`), `src/core/fill.ts`
> dài hơn 1100 dòng và trộn lẫn 3 loại việc:
>
> 1. **Biết site trông như thế nào** — tìm section, tìm nút `新增`, tìm bảng,
>    tìm dialog, hỏi "element này đang ẩn hay hiện";
> 2. **Biết điền gì** — chiến lược ghi field (`fillPlans`, `fillCargoRows`,
>    `fillContainerRows`);
> 3. **Điều phối** — mở dialog → điền → báo cáo (`fillManifest`).
>
> Tách (1) ra `src/core/site.ts` để mỗi file một trách nhiệm. Đây là refactor
> **THUẦN**: KHÔNG đổi hành vi, KHÔNG đổi câu chữ của bất kỳ note nào, KHÔNG
> đổi tên hàm nào. Nếu một test nào đổi trạng thái ⇒ đã làm sai.
>
> Task này chạy SAU các task sửa lỗi B-1…B-15 và C-1…C-13, vì nó dựng lại
> đúng file `fill.ts` đã sửa. Code review ngày 2026-10-27 cũng **chốt** đây là
> việc cần làm (*"the natural seam is the site-vocabulary block … Schedule it
> before the next feature lands"*) — nhưng không gấp: `fill.ts` vẫn còn 5 khối
> rõ ràng, nên tách được mà không phải vội.

- [ ] **Step 1: Tạo `src/core/site.ts`**

Tạo file mới với nội dung sau — **copy nguyên văn, không sửa gì**:

```ts
import { isVisible } from './select'
import { readTableHandles } from './table'

/**
 * Từ vựng DOM của site 舱单 (Vue 3 + Element Plus + fast-crud).
 *
 * Module này CHỈ biết site trông như thế nào: tìm section, tìm nút, tìm bảng,
 * tìm dialog, hỏi "element này đang ẩn hay hiện". Không biết cần điền gì và
 * không quyết định báo cáo thế nào — phần đó thuộc `fill.ts`.
 */

/**
 * Tìm nút có đúng text `text`.
 *
 * Chỉ khớp chính xác — khớp "chứa" sẽ bấm nhầm nút 批量新增舱单信息. Ưu tiên nút
 * đang hiển thị: Element Plus giữ tab đã xem trong DOM (dù đã ẩn), bấm nút ẩn
 * là thao tác vô nghĩa.
 */
export function findButtonByText(text: string, root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, .el-button'))
  const exact = buttons.filter((b) => (b.textContent ?? '').trim() === text)
  return exact.find(isVisible) ?? exact[0] ?? null
}

/**
 * Tiêu đề section có khớp `needle` không.
 *
 * Khớp CHÍNH XÁC hoặc theo tiều tố: site có thể render
 * `.fs-crud-title` là `货物信息 (2)` ⇒ cả `findTitleElement` (tìm tiêu đề) và
 * `sectionOf` (xác định section của một phần tử) phải dùng CÙNG một luật,
 * nếu không thì hai bên bất đồng và ranh giới section bị đặt sai.
 */
function titleMatches(title: string, needle: string): boolean {
  const t = title.trim()
  const n = needle.trim()
  return t === n || t.startsWith(n)
}

/** Tìm phần tử chứa đúng tiêu đề section (phần tử sâu nhất). */
function findTitleElement(scope: ParentNode, title: string): HTMLElement | null {
  const needle = title.trim()
  const isMatch = (el: HTMLElement): boolean =>
    titleMatches(el.textContent ?? '', needle)

  // Ưu tiên `.fs-crud-title` (tiêu đề section của site): quét toàn bộ DOM là
  // rất tốn trên dialog thật (hàng nghìn node).
  const crud = Array.from(scope.querySelectorAll<HTMLElement>('.fs-crud-title')).filter(isMatch)
  const matches =
    crud.length > 0
      ? crud
      : Array.from(scope.querySelectorAll<HTMLElement>('*')).filter(isMatch)
  if (matches.length === 0) return null
  return matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) ?? null
}

/* ------------------------------------------------------------------ *
 *  Section & button
 * ------------------------------------------------------------------ */

/** `true` nếu `a` nằm trước `b` trong thứ tự tài liệu. */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/**
 * Section mà phần tử `el` thuộc về.
 *
 * Section = ancestor gần nhất có `.fs-crud-title`; tiêu đề của section là
 * `.fs-crud-title` gần nhất **phía trước** `el` (site vẽ tiêu đề ở đầu section,
 * nút/table nằm sau nó).
 *
 * Việc này chặn lỗi "leo ra khỏi section": trên site thật dialog đầu có cả
 * section 货物信息 lẫn section 箱信息, mỗi section một nút 新增 — nếu không khoanh
 * vùng thì nút của section 箱信息 sẽ bị bấm nhầm khi đang điền hàng.
 */
function sectionOf(el: HTMLElement): { root: HTMLElement; title: string } | null {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const titles = Array.from(node.querySelectorAll<HTMLElement>('.fs-crud-title'))
    if (titles.length > 0) {
      const preceding = titles.filter((t) => precedes(t, el))
      const chosen = preceding[preceding.length - 1] ?? titles[0]!
      const title = (chosen.textContent ?? '').trim()
      return title ? { root: node, title } : null
    }
    node = node.parentElement
  }
  return null
}

/** Các nút "新增" trong `scope` (khớp "chứa", site có 新增 / 新增货物信息 / …). */
function findAddButtons(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('button, .el-button')).filter((b) =>
    (b.textContent ?? '').trim().includes('新增'),
  )
}

/**
 * Chọn nút tốt nhất trong một nhóm: đang hiển thị trước, rồi text đúng `新增`,
 * cuối cùng mới tới text có chứa `新增` (site có cả 新增 và 新增货物信息).
 *
 * "Đang hiển thị" đứng trước "text đúng" là cố ý: Element Plus giữ tab đã xem
 * trong DOM (dù đã ẩn) ⇒ một nút ẩn có text khớp chính xác hơn vẫn không được
 * thắng nút đang hiển thị.
 */
function pickBestButton(buttons: HTMLElement[]): HTMLElement | null {
  if (buttons.length === 0) return null
  const visible = buttons.filter(isVisible)
  const pool = visible.length > 0 ? visible : buttons
  const exact = pool.filter((b) => (b.textContent ?? '').trim() === '新增')
  return (exact.length > 0 ? exact : pool)[0] ?? null
}

/**
 * Tìm nút "新增" nằm trong section có tiêu đề `title` (ví dụ 货物信息).
 *
 * Cách 1 (chính): nút nào có **tiêu đề section** đúng `title` thì lấy.
 * Cách 2 (dự phòng): leo từ phần tử tiêu đề lên, nhưng **dừng ngay** khi chạm
 * tới ancestor chứa một `.fs-crud-title` khác ⇒ không bao giờ leo ra section.
 */
export function findAddButtonBySectionTitle(
  scope: ParentNode,
  title: string,
): HTMLElement | null {
  const needle = title.trim()
  const inSection = findAddButtons(scope).filter((b) => {
    const section = sectionOf(b)
    return section !== null && titleMatches(section.title, needle)
  })
  const picked = pickBestButton(inSection)
  if (picked) return picked
  return findAddButtonByWalkingUp(scope, needle)
}

/** Dự phòng của `findAddButtonBySectionTitle`: leo từ tiêu đề, có biên giới section. */
function findAddButtonByWalkingUp(scope: ParentNode, title: string): HTMLElement | null {
  const titleEl = findTitleElement(scope, title)
  if (!titleEl) return null

  let container: HTMLElement = titleEl
  let inner: HTMLElement | null = null

  for (let depth = 0; depth < 12; depth++) {
    const candidates = findAddButtons(container).filter((b) => !inner || !inner.contains(b))
    if (candidates.length > 0) return pickBestButton(candidates)
    inner = container
    const parent = container.parentElement
    if (!parent) break
    // Biên giới section: ancestor chứa tiêu đề khác ⇒ dừng, đừng leo ra ngoài.
    const otherSection = Array.from(parent.querySelectorAll<HTMLElement>('.fs-crud-title')).some(
      (t) => !titleMatches(t.textContent ?? '', title),
    )
    if (otherSection) break
    container = parent
  }

  return null
}

/** Nút đang bị disable (site khoá nút khi form chưa hợp lệ). */
export function isDisabled(button: HTMLElement): boolean {
  if ((button as HTMLButtonElement).disabled) return true
  if (button.getAttribute('disabled') !== null) return true
  return button.classList.contains('is-disabled')
}

/**
 * Overlay của CHÍNH dialog này (nếu có).
 *
 * `closest('.el-overlay')` có thể trả về overlay của dialog CHA: khi site không
 * teleport, dialog hàng nằm trong dialog đầu ⇒ `closest` leo lên và thấy
 * overlay của dialog đầu ⇒ dialog hàng bị coi là "ẩn" khi dialog đầu ẩn.
 *
 * Overlay của chính nó là overlay CHỈ chứa dialog này (overlay của dialog cha
 * chứa cả hai).
 */
function ownOverlay(dialog: HTMLElement): HTMLElement | null {
  let node = dialog.parentElement
  while (node) {
    if (node.classList.contains('el-overlay') || node.classList.contains('el-dialog__wrapper')) {
      const dialogs = node.querySelectorAll('.el-dialog')
      return dialogs.length === 1 && dialogs[0] === dialog ? node : null
    }
    node = node.parentElement
  }
  return null
}

/**
 * Element Plus ẩn dialog bằng `display:none` (trên chính nó hoặc trên overlay
 * của nó).
 *
 * KHÔNG coi "node bị gỡ khỏi DOM" là "đã đóng": node bị detach chỉ có nghĩa là
 * Vue đã thay thế element — site có thể dựng lại dialog sau khi từ chối lưu,
 * lúc đó node cũ detach nhưng dòng hàng CHƯA được lưu. Muốn biết dialog đã
 * đóng thì phải tra lại dialog HIỆN TẠI rồi hỏi nó (xem `currentCargoDialog`).
 *
 * Không dùng `isVisible` của `select.ts`: hàm đó coi mọi phần tử là hiển thị khi
 * môi trường không có layout engine (jsdom) ⇒ không dùng để kiểm tra "dialog đã
 * đóng" được.
 */
export function isHidden(el: HTMLElement): boolean {
  if (el.style.display === 'none') return true
  const overlay = ownOverlay(el)
  return overlay?.style.display === 'none'
}

/* ------------------------------------------------------------------ *
 *  Bảng
 * ------------------------------------------------------------------ */

/** Chuỗi của các ô header của bảng (đã trim). */
function tableHeaderTexts(table: HTMLElement): string[] {
  return Array.from(
    table.querySelectorAll<HTMLElement>('thead th, .el-table__header th'),
  ).map((th) => (th.textContent ?? '').trim())
}

/** Ancestor gần nhất của tiêu đề có chứa bảng ⇒ giới hạn phạm vi tra cứu. */
function sectionTableRoot(titleEl: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = titleEl.parentElement
  while (node) {
    if (node.querySelector('.el-table, table')) return node
    node = node.parentElement
  }
  return null
}

const CONTAINER_SECTION_TITLES = ['箱信息', '集装箱信息', '集装箱']

/** Cột xác nhận đúng là bảng container (bảng hàng không có cột này). */
const CONTAINER_TABLE_COLUMN = '箱号'

/**
 * Tìm bảng container trong `scope`.
 *
 * Mọi tra cứu bị giới hạn trong section của tiêu đề 箱信息 (trên site thật
 * dialog đầu có cả bảng DANH SÁCH hàng lẫn bảng container — lấy nhầm bảng đầu
 * là ghi vào chỗ không liên quan). Bảng tìm được còn phải **có cột 箱号** thì
 * mới chấp nhận, nếu không ⇒ báo lỗi chứ không dùng bảng đầu tiên trong scope.
 */
export function findContainerTable(scope: ParentNode): HTMLElement | null {
  for (const title of CONTAINER_SECTION_TITLES) {
    const titleEl = findTitleElement(scope, title)
    if (!titleEl) continue
    const root = sectionTableRoot(titleEl)
    if (!root) continue
    const tables = Array.from(root.querySelectorAll<HTMLElement>('.el-table, table'))
    const valid = tables.find((t) => tableHeaderTexts(t).includes(CONTAINER_TABLE_COLUMN))
    if (valid) return valid
  }
  return null
}

/** Bảng nằm trong section có tiêu đề `title` (dùng cho bảng DANH SÁCH hàng). */
export function findTableBySectionTitle(scope: ParentNode, title: string): HTMLElement | null {
  const needle = title.trim()
  const tables = Array.from(scope.querySelectorAll<HTMLElement>('.el-table, table'))
  return (
    tables.find((t) => {
      const section = sectionOf(t)
      return section !== null && titleMatches(section.title, needle)
    }) ?? null
  )
}

/** Số dòng của bảng DANH SÁCH hàng (section 货物信息). */
export function countGoodsListRows(scope: ParentNode): number {
  const table = findTableBySectionTitle(scope, '货物信息')
  if (!table) return 0
  return readTableHandles(table).bodyRows.length
}

/**
 * Nút "新增" thêm dòng của bảng container.
 *
 * Ràng buộc vào **cùng section** với bảng ⇒ không bấm nhầm nút 新增 của section
 * 货物信息 (trên site thật nút đó mở dialog hàng).
 */
export function findContainerAddButton(scope: ParentNode, table: HTMLElement): HTMLElement | null {
  const section = sectionOf(table)
  if (section) {
    const inSection = findAddButtonBySectionTitle(section.root, section.title)
    if (inSection) return inSection
  }
  for (const title of CONTAINER_SECTION_TITLES) {
    const button = findAddButtonBySectionTitle(scope, title)
    if (button) return button
  }
  return null
}

/**
 * Tìm dialog đầu (form 舱单).
 *
 * Element Plus giữ lại dialog đã đóng trong DOM (chỉ ẩn đi), nên `.el-dialog`
 * ĐẦU TIÊN trong document có thể là dialog ẩn của một màn khác — lấy nó thì
 * mọi field đều "không tìm thấy" và lần điền im lặng thất bại. Ưu tiên dialog
 * có chứa field 提单号, fallback về dialog đang hiện, cuối cùng là dialog
 * cuối cùng trong DOM.
 */
export function findManifestDialog(root: ParentNode): HTMLElement | null {
  const byField = findDialogWithField(root, 'BILL_NBR')
  if (byField) return byField
  const dialogs = Array.from(root.querySelectorAll<HTMLElement>('.el-dialog'))
  const visible = dialogs.filter(isVisible)
  return visible[visible.length - 1] ?? dialogs[dialogs.length - 1] ?? null
}

/** Tìm dialog có chứa field `prop` (dùng để phân biệt dialog hàng với dialog đầu). */
function findDialogWithField(root: ParentNode, prop: string): HTMLElement | null {
  const dialogs = Array.from(root.querySelectorAll<HTMLElement>('.el-dialog'))
  for (let i = dialogs.length - 1; i >= 0; i--) {
    const dialog = dialogs[i]!
    if (dialog.querySelector(`input[id$="-${prop}"], textarea[id$="-${prop}"]`)) return dialog
  }
  return null
}

/**
 * Các dialog đang có trong DOM — chụp lại TRƯỚC khi bấm 新增.
 *
 * Quét `document` (không phải `scope` của dialog đầu) vì site TELEPORT dialog
 * hàng ra `body` ⇒ nó nằm NGOÀI dialog đầu.
 */
export function snapshotDialogs(): Set<HTMLElement> {
  return new Set(Array.from(document.querySelectorAll<HTMLElement>('.el-dialog')))
}

/**
 * Các dialog đang **ẩn** lúc chụp ảnh.
 *
 * Cần để phân biệt hai ca mà nhìn giống nhau lúc chờ dialog:
 * - site DÙNG LẠI một element đã mount sẵn (trước đó ẩn, giờ hiện lại) ⇒ đó
 *   là dialog site mở cho dòng này;
 * - dialog ĐÃ hiện sẵn trước khi bấm 新增 (dialog của dòng trước, hoặc do
 *   người dùng tự mở) ⇒ tuyệt đối không ghi đè.
 */
export function snapshotHiddenDialogs(): Set<HTMLElement> {
  const hidden = new Set<HTMLElement>()
  for (const dialog of document.querySelectorAll<HTMLElement>('.el-dialog')) {
    if (isHidden(dialog)) hidden.add(dialog)
  }
  return hidden
}

/**
 * Dialog hàng MỚI (không nằm trong `snapshot`) có chứa field E_CARGO_NAM.
 *
 * Element Plus giữ dialog đã đóng trong DOM ⇒ lấy "dialog nào chứa E_CARGO_NAM"
 * sẽ trả về dialog của dòng TRƯỚC và ghi đè lên dòng đó.
 */
export function findNewCargoDialog(snapshot: Set<HTMLElement>): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('.el-dialog'))
  for (const dialog of dialogs) {
    if (snapshot.has(dialog)) continue
    if (!dialog.querySelector('input[id$="-E_CARGO_NAM"], textarea[id$="-E_CARGO_NAM"]')) continue
    return dialog
  }
  return null
}

/**
 * Dialog hàng HIỆN TẠI trong DOM (dialog cuối cùng có field E_CARGO_NAM).
 *
 * Luôn tra lại thay vì giữ node đã bắt: Vue có thể thay thế element dialog
 * (node cũ bị gỡ khỏi DOM) ⇒ hỏi node cũ là hỏi sai đối tượng.
 */
export function currentCargoDialog(): HTMLElement | null {
  return findDialogWithField(document, 'E_CARGO_NAM')
}

/**
 * Dự phòng cho trường hợp site DÙNG LẠI một element dialog và reset nó ⇒ không
 * có node mới nào để tìm.
 *
 * Lấy dialog hàng CUỐI CÙNG đang hiện (không hidden) — nhưng CHỈ dùng được khi
 * form của nó đang TRỐNG: nếu còn dữ liệu của dòng trước ⇒ đó là dialog của dòng
 * trước, ghi vào đó là ghi đè dòng trước.
 */
export function findVisibleCargoDialog(): HTMLElement | null {
  const shown = visibleCargoDialogs()
  const last = shown[shown.length - 1]
  if (!last) return null
  const name = last.querySelector<HTMLInputElement>('input[id$="-E_CARGO_NAM"]')
  return (name?.value ?? '') === '' ? last : null
}

/** Các dialog hàng đang hiện (có field E_CARGO_NAM). */
function visibleCargoDialogs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.el-dialog')).filter(
    (d) =>
      d.querySelector('input[id$="-E_CARGO_NAM"], textarea[id$="-E_CARGO_NAM"]') &&
      !isHidden(d),
  )
}

/**
 * Dialog hàng mà site DÙNG LẠI một element đã mount sẵn (không tạo node mới).
 *
 * Chỉ nhận dialog **trước đây đang ẩn** và **giờ đã hiện**: đó là duy nhất
 * chứng cứ cho thấy site vừa hiện nó lên cho dòng này. Dialog ĐÃ hiện sẵn trước
 * khi bấm 新增 là dialog của dòng trước, hoặc do người dùng tự mở ⇒ tuyệt đối
 * không ghi đè.
 *
 * Form phải TRỐNG: còn dữ liệu của dòng trước ⇒ đó là dialog của dòng trước.
 */
export function findReusedCargoDialog(beforeHidden: Set<HTMLElement>): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('.el-dialog')).filter((d) =>
    d.querySelector('input[id$="-E_CARGO_NAM"], textarea[id$="-E_CARGO_NAM"]'),
  )
  const shown = dialogs.filter((d) => beforeHidden.has(d) && !isHidden(d))
  const last = shown[shown.length - 1]
  if (!last) return null
  const name = last.querySelector<HTMLInputElement>('input[id$="-E_CARGO_NAM"]')
  return (name?.value ?? '') === '' ? last : null
}

/**
 * Dialog hàng có dùng lại được không? (site mount MỘT element cho mọi dòng)
 *
 * Cần đủ ba điều kiện: node còn trong DOM, đang hiện, và form đã được site
 * reset (E_CARGO_NAM trống). Nếu form còn dữ liệu của dòng trước ⇒ đó là
 * dialog của dòng trước, tuyệt đối không ghi đè.
 */
export function isReusableCargoDialog(dialog: HTMLElement | null): boolean {
  if (!dialog?.isConnected) return false
  if (isHidden(dialog)) return false
  const name = dialog.querySelector<HTMLInputElement>('input[id$="-E_CARGO_NAM"]')
  return (name?.value ?? '') === ''
}
```

- [ ] **Step 2: Sửa `src/core/fill.ts` — đổi khối import**

Trong `src/core/fill.ts`, thay 2 dòng:

```ts
import { isVisible } from './select'
import { findColumnIndex, getCell, readTableHandles, setCellValue } from './table'
```

bằng:

```ts
import {
  countGoodsListRows,
  currentCargoDialog,
  findAddButtonBySectionTitle,
  findButtonByText,
  findContainerAddButton,
  findContainerTable,
  findManifestDialog,
  findNewCargoDialog,
  findReusedCargoDialog,
  findTableBySectionTitle,
  findVisibleCargoDialog,
  isDisabled,
  isHidden,
  isReusableCargoDialog,
  snapshotDialogs,
  snapshotHiddenDialogs,
} from './site'
import { findColumnIndex, getCell, readTableHandles, setCellValue } from './table'
```

(`fill.ts` không còn dùng `isVisible` — hàm đó giờ chỉ nằm trong `site.ts`.)

- [ ] **Step 3: Sửa `src/core/fill.ts` — xoá các hàm đã chuyển sang `site.ts`**

Xoá hẳn (kể cả doc comment phía trên) **28 hàm** sau khỏi `src/core/fill.ts`:

`findButtonByText`, `titleMatches`, `findTitleElement`, `precedes`,
`sectionOf`, `findAddButtons`, `pickBestButton`, `findAddButtonBySectionTitle`,
`findAddButtonByWalkingUp`, `isDisabled`, `ownOverlay`, `isHidden`,
`tableHeaderTexts`, `sectionTableRoot`, `findContainerTable`,
`findTableBySectionTitle`, `countGoodsListRows`, `findContainerAddButton`,
`findManifestDialog`, `findDialogWithField`, `snapshotDialogs`,
`snapshotHiddenDialogs`, `findNewCargoDialog`, `currentCargoDialog`,
`findVisibleCargoDialog`, `visibleCargoDialogs`, `findReusedCargoDialog`,
`isReusableCargoDialog`.

Hai hằng số `CONTAINER_SECTION_TITLES` và `CONTAINER_TABLE_COLUMN` đi theo
`findContainerTable` sang `site.ts`.

**Kiểm tra đã xoá đủ** (chạy sau khi sửa):

```bash
grep -n "function " src/core/fill.ts
```

Kết quả **phải** chỉ còn đúng 6 hàm:

```
fillPlans
fillHeader
waitForCargoRowAccepted
fillCargoRows
fillContainerRows
fillManifest
```

Nếu còn hàm nào khác ⇒ đã bỏ sót.

- [ ] **Step 4: Sửa import trong test**

`tests/fill-cargo.test.ts`:

```ts
// trước
import { fillCargoRows, fillManifest, findAddButtonBySectionTitle } from '../src/core/fill'
// sau
import { fillCargoRows, fillManifest } from '../src/core/fill'
import { findAddButtonBySectionTitle } from '../src/core/site'
```

`tests/fill-header.test.ts`:

```ts
// trước
import { fillHeader, fillManifest, findButtonByText } from '../src/core/fill'
// sau
import { fillHeader, fillManifest } from '../src/core/fill'
import { findButtonByText } from '../src/core/site'
```

- [ ] **Step 5: Chạy test — phải PASS y hệt, không test nào đổi**

Run: `npm test`
Expected: **11 file / 224 test PASS** — đúng bằng trước khi tách. Một test nào
đổi từ PASS sang FAIL (hoặc ngược lại) ⇒ đã đổi hành vi ⇒ phải sửa lại cho
khớp, không được "chỉnh" test cho qua.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 7: Commit**

```bash
git commit src/core/site.ts src/core/fill.ts tests/fill-cargo.test.ts tests/fill-header.test.ts -m "refactor: split the site's DOM vocabulary out of fill.ts"
```

---


## Task 13: `site-api.ts` — tra dict của chính site (TDD)

**Files:**
- Create: `src/core/site-api.ts`
- Create: `tests/site-api.test.ts`

> **Đã kiểm chứng trên bundle thật của site (2026-10-27)** — xem
> `docs/superpowers/plans/2026-10-27-live-site-alignment.md` (FACT 4):
> - Envelope `{ code, data, msg }`; **lỗi của site trả về HTTP 200** kèm `code: 4000`.
> - `getTrustCode/` → `data` là mảng object có `TRUST_COD` (kèm `id` của DB).
> - `getDrType/` → `data` là mảng **chuỗi thuần** (`"FOB"`), không phải object.
> - `getPort/` → `data` là mảng object có `E_PORT_NAM` + `PORT_COD`; endpoint cần
>   `{kw, filter}` và site luôn lọc theo `E_PORT_NAM` (tên cảng tiếng Trung).
> - `getCntrCode/` → dict 箱型 + 尺寸, item là **chuỗi thuần** (không có id số).
> - Extension chỉ gọi **4** endpoint (`getTrustCode/`, `getDrType/`, `getPort/`,
>   `getCntrCode/`); `getPackageCode/` **không** gọi — C-2 bỏ trống cả
>   `PACKAGE_STR` và `PACKAGE_COD` nên dict 包装种类 không có nơi dùng.
> - **Không bao giờ** gọi `send/`, `upload/`, `deleteBill/`, `downloadTemplate/`.

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

  it('đọc mảng chuỗi thuần của getDrType', () => {
    const options = normalizeDictOptions(['FOB', 'CIF'])
    expect(options[0]).toMatchObject({ code: 'FOB', name: 'FOB' })
  })

  it('đọc mã của getTrustCode theo TRUST_COD', () => {
    const options = normalizeDictOptions([{ id: 2, TRUST_COD: 'MAEU' }])
    expect(options[0]).toMatchObject({ code: 'MAEU', id: '2' })
  })

  it('đọc cảng theo E_PORT_NAM + PORT_COD', () => {
    const options = normalizeDictOptions([{ E_PORT_NAM: '上海', PORT_COD: 'CNSHA' }])
    expect(options[0]).toMatchObject({ code: 'CNSHA', name: '上海' })
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
    trustCodes: normalizeDictOptions([{ id: 2, TRUST_COD: 'MAEU' }]),
    drTypes: normalizeDictOptions(['FOB', 'CIF']),
    ports: normalizeDictOptions([{ E_PORT_NAM: '上海', PORT_COD: 'CNSHA' }]),
    // `getCntrCode/` trả **chuỗi thuần** (FACT 6.2) — không có id số.
    cntrTypes: normalizeDictOptions(['40', 'HQ']),
    cntrSizes: normalizeDictOptions(['20', '45']),
  }

  it('tìm 承运人 theo supplyId', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findTrustCode(2)).toBe('MAEU')
  })

  it('tìm 交货条款 theo mã', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findDrType('FOB')).toBe('FOB')
  })

  it('tìm cảng theo mã', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findPort('CNSHA')).toBe('上海')
  })

  it('tìm 箱型 và 尺寸 theo **chuỗi** trong dict', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findCntrType('HQ')).toBe('HQ')
    expect(ctx.findCntrSize('45')).toBe('45')
  })

  it('KHÔNG tra được 箱型/尺寸 từ mã số của API (C-5)', () => {
    // API cho `cType: 2`, `vC: 0` — mã số, còn dict của site chỉ có chuỗi.
    const ctx = createMappingContext(dicts)
    expect(ctx.findCntrType(2)).toBeUndefined()
    expect(ctx.findCntrSize(0)).toBeUndefined()
  })

  it('trả undefined khi không tìm thấy', () => {
    const ctx = createMappingContext(dicts)
    expect(ctx.findPort('ZZZZZ')).toBeUndefined()
  })
})

describe('loadSiteDicts', () => {
  const okResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response

  it('gọi đúng 4 endpoint, getPort kèm kw + filter', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      const body = url.includes('getTrustCode')
        ? { code: 2000, data: [{ id: 2, TRUST_COD: 'MAEU' }] }
        : url.includes('getDrType')
          ? { code: 2000, data: ['FOB', 'CIF'] }
          : url.includes('getPort')
            ? { code: 2000, data: [{ E_PORT_NAM: '上海', PORT_COD: 'CNSHA' }] }
            : {
                // `getCntrCode/` trả **chuỗi thuần**, tên key **ngược** (FACT 6.2).
                code: 2000,
                data: {
                  cntr_type: ['40', 'HQ'],
                  cntr_size: ['20', '45'],
                },
              }
      return okResponse(body)
    }) as unknown as typeof fetch

    const dicts = await loadSiteDicts({
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })

    expect(calls).toHaveLength(4)
    // `getTrustCode/` được gọi kèm query `?kw=` ⇒ phải so bằng `startsWith`.
    expect(calls.some((u) => u.startsWith('/api/test/getTrustCode/'))).toBe(true)
    expect(calls).toContain('/api/test/getCntrCode/')
    expect(
      calls.some((u) => u.startsWith('/api/test/getPort/') && u.includes('filter=E_PORT_NAM')),
    ).toBe(true)
    // Không gọi dict 包装 — không ai dùng (C-2).
    expect(calls.some((u) => u.includes('getPackageCode'))).toBe(false)
    expect(dicts.trustCodes[0]?.code).toBe('MAEU')
    expect(dicts.drTypes[0]?.name).toBe('FOB')
    expect(dicts.ports[0]?.name).toBe('上海')
    expect(dicts.cntrTypes[0]?.name).toBe('40')
    expect(dicts.cntrSizes[0]?.name).toBe('20')
  })

  it('vẫn nạp được dict khác khi getPort lỗi', async () => {
    const fakeFetch = (async (url: string) => {
      if (url.includes('getPort')) throw new Error('network down')
      if (url.includes('getTrustCode')) {
        return okResponse({ code: 200, data: [{ id: 2, TRUST_COD: 'MAEU' }] })
      }
      return okResponse({ code: 200, data: [] })
    }) as unknown as typeof fetch

    const dicts = await loadSiteDicts({
      baseUrl: '/api/test',
      fetchImpl: fakeFetch,
      cookieString: 'token=abc',
    })

    expect(dicts.ports).toHaveLength(0)
    expect(dicts.trustCodes[0]?.code).toBe('MAEU')
  })
})

describe('DEFAULT_SITE_API_BASE', () => {
  it('trỏ đúng base của site', () => {
    expect(DEFAULT_SITE_API_BASE).toBe('/api/booking/exportManifestDataMaintain')
  })
})

// --- Bổ sung 2026-10-27 sau khi kiểm tra header/endpoint thật của site ---

describe('envelope {code, data, msg} của site', () => {
  it('normalizeDictOptions bóc vỏ data', () => {
    const options = normalizeDictOptions({
      code: 200,
      data: [{ code: 'MAEU', name: '马士基' }],
    })
    expect(options[0]).toMatchObject({ code: 'MAEU', name: '马士基' })
  })

  it('pickArray tìm thấy mảng lồng trong data', () => {
    const payload = {
      code: 200,
      data: { cntr_type: [{ code: '2', name: '20GP' }], cntr_size: [] },
    }
    expect(pickArray(payload, ['cntr_type', 'cntrType'])).toHaveLength(1)
    expect(pickArray(payload, ['cntr_size', 'cntrSize'])).toHaveLength(0)
  })
})

describe('loadSiteDicts khi session hết hạn', () => {
  it('báo lỗi rõ ràng thay vì trả dict rỗng', async () => {
    const fakeFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 4000, data: null, msg: '身份认证信息未提供。' }),
    })) as unknown as typeof fetch

    await expect(
      loadSiteDicts({ baseUrl: '/api/test', fetchImpl: fakeFetch, cookieString: 'token=abc' }),
    ).rejects.toThrow(/session/i)
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
  /** id trong DB của site (dùng cho 承运人 / 箱型 / 尺寸) */
  id?: string
  /** bản gốc, để đối chiếu theo key khác nếu cần */
  raw: Record<string, unknown>
}

/** Key chứa mã — `TRUST_COD`/`PORT_COD` là key thật của site (FACT 4). */
const CODE_KEYS = [
  'code',
  'unCode',
  'portCode',
  'value',
  'key',
  'dictCode',
  'itemCode',
  'TRUST_COD',
  'PORT_COD',
]
/** Key chứa tên hiển thị — `E_PORT_NAM` là tên cảng tiếng Trung của site. */
const NAME_KEYS = [
  'name',
  'label',
  'text',
  'dictName',
  'itemName',
  'cnName',
  'portName',
  'E_PORT_NAM',
]

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

/**
 * Bóc vỏ envelope `{code, data, msg}` của site.
 * Đã kiểm chứng ngày 2026-10-27 trên site thật:
 *   GET /api/booking/exportManifestDataMaintain/getTrustCode/
 *   → {"code":4000,"data":null,"msg":"身份认证信息未提供。"}   (HTTP 200!)
 */
function unwrapEnvelope(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload
  const source = payload as Record<string, unknown>
  if ('data' in source && source.data !== null && source.data !== undefined) return source.data
  return payload
}

/** Lấy mảng theo key cụ thể; nếu không có thì lùi về `asArray`. */
export function pickArray(payload: unknown, keys: string[]): unknown[] {
  for (const candidate of [unwrapEnvelope(payload), payload]) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const source = candidate as Record<string, unknown>
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

  for (const entry of asArray(unwrapEnvelope(payload))) {
    // `getDrType/` trả về mảng chuỗi thuần: mã cũng chính là nhãn hiển thị.
    if (typeof entry === 'string') {
      const code = entry.trim()
      if (code === '') continue
      result.push({ code, name: code, raw: { value: code } })
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>

    const code =
      pickString(raw, CODE_KEYS) ?? pickString(raw, ['id'])
    if (code === undefined) continue

    const name = pickString(raw, NAME_KEYS) ?? code
    const id = pickString(raw, ['id'])

    result.push({ code, name, id, raw })
  }

  return result
}

export interface SiteDicts {
  trustCodes: DictOption[]
  drTypes: DictOption[]
  ports: DictOption[]
  cntrTypes: DictOption[]
  cntrSizes: DictOption[]
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

/** Lỗi từ API của site — thường là session thiếu/hết hạn. */
export class SiteApiError extends Error {
  readonly code: number | undefined

  constructor(message: string, code?: number) {
    super(message)
    this.name = 'SiteApiError'
    this.code = code
  }
}

/**
 * Site báo lỗi NGAY TRONG HTTP 200.
 * Đã kiểm chứng 2026-10-27 trên site thật:
 *   GET /api/booking/exportManifestDataMaintain/getTrustCode/
 *   → HTTP 200 {"code":4000,"data":null,"msg":"身份认证信息未提供。"}
 * Nếu không kiểm tra, extension sẽ tưởng dict rỗng và báo "không tìm thấy cảng"
 * cho mọi field — mất dấu vết nguyên nhân thật (session hết hạn).
 */
function assertSiteEnvelope(path: string, payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) return
  const source = payload as { code?: unknown; data?: unknown }
  if (typeof source.code !== 'number') return
  if (source.data !== null && source.data !== undefined) return
  throw new SiteApiError(
    source.code === 4000
      ? `The site rejected ${path} because the session is missing or expired. Log in to the site and try again.`
      : `The site rejected ${path} (code ${source.code}).`,
    source.code,
  )
}

async function fetchSiteJson(
  path: string,
  options: SiteFetchOptions = {},
  params?: Record<string, string>,
): Promise<unknown> {
  const base = options.baseUrl ?? DEFAULT_SITE_API_BASE
  const doFetch = options.fetchImpl ?? fetch
  const token = readCookieToken(options.cookieString ?? document.cookie)

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `JWT ${token}`

  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  const res = await doFetch(`${base}/${path}${query}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    throw new SiteApiError(`The site API ${path} returned HTTP ${res.status}`)
  }
  const payload = (await res.json()) as unknown
  assertSiteEnvelope(path, payload)
  return payload
}

export async function loadSiteDicts(
  options: SiteFetchOptions = {},
): Promise<SiteDicts> {
  // 4 endpoint, đúng như site gọi (FACT 4). `getPackageCode/` **không** gọi:
  // sau C-2 thì PACKAGE_STR/PACKAGE_COD đều để trống ⇒ dict 包装 không có ai dùng.
  const [trustRaw, drRaw, cntrRaw, portRaw] = await Promise.all([
    fetchSiteJson('getTrustCode/', options, { kw: '' }),
    fetchSiteJson('getDrType/', options, { kw: '' }),
    fetchSiteJson('getCntrCode/', options),
    // `getPort/` chỉ là fallback: nó lọc theo tên cảng tiếng Trung nên có thể
    // lỗi mà không được làm hỏng phần còn lại của dict (tên cảng chính đến
    // từ API dadaex).
    fetchSiteJson('getPort/', options, { kw: '', filter: 'E_PORT_NAM' }).catch(() => null),
  ])

  return {
    trustCodes: normalizeDictOptions(trustRaw),
    drTypes: normalizeDictOptions(drRaw),
    ports: normalizeDictOptions(portRaw),
    cntrTypes: normalizeDictOptions(pickArray(cntrRaw, ['cntr_type', 'cntrType', 'type'])),
    cntrSizes: normalizeDictOptions(pickArray(cntrRaw, ['cntr_size', 'cntrSize', 'size'])),
  }
}

export function createMappingContext(dicts: SiteDicts): MappingContext {
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
      // Widget của site chỉ gợi ý tên cảng tiếng Trung → trả về tên.
      return hit.name
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

## Task 14: `protocol.ts` + `options.ts` + content script (TDD)

**Files:**
- Create: `src/core/protocol.ts`
- Create: `src/core/options.ts`
- Modify: `src/content/index.ts`
- Create: `tests/options.test.ts`

> **Sửa sau khi đối chiếu site thật + code review (2026-10-27) — PHẢI làm trong
> task này, không được bỏ qua.**
>
> - **`ok` KHÔNG được coi `skip` là thành công** (reviewer: *"the last remaining
>   reported false success"*). Hiện `src/core/fill.ts` tính
>   `ok: items.every((i) => i.status === 'ok' || i.status === 'skip')` ⇒ báo cáo
>   có thể là `ok: true` trong khi `PACKAGE_STR` / `PACKAGE_COD` / 尺寸 / 箱型 /
>   箱状态 còn trống ⇒ **manifest không thể submit** mà popup lại báo thành công.
> - Sửa bằng cách phân biệt 2 loại `skip`:
>   - `skip` vì **API không có dữ liệu** và site **không** bắt buộc
>     (EMAIL, FAX, 中转港, 提单签发地, 危险品页号/EMS/MFAG) ⇒ vẫn tính là ổn;
>   - `skip` vì site **bắt buộc** có mà API không có (`PACKAGE_STR`,
>     `PACKAGE_COD` theo FACT 5.3; 尺寸 / 箱型 / 箱状态 / 货主箱标志 của
>     container) ⇒ `ok` phải là `false`.
> - Nơi biết "site bắt buộc" là **`src/core/mapping.ts`** — nơi đã có sẵn
>   `REQUIRED_BY_KIND` (FACT 5.3) và các note kiểu *"the site requires 包装类型/代码"*.
>   Thêm cờ `required?: boolean` vào `FieldPlan`, set ở `mapCargo` / `mapContainer`;
>   `FillItem` trong `fill.ts` mang cờ đó theo; `fill.ts` tính `ok` dựa trên cờ.
> - `protocol.ts` (`ReportItem`) cũng phải mang cờ `required` để popup hiển thị
>   được field nào đang chặn việc submit.
>
> **Chi tiết — 4 file phải sửa:**
>
> 1. `src/core/mapping.ts` — `FieldPlan` thêm:
>
>    ```ts
>    /** site BẮT BUỘC có field này — nếu bỏ trống thì manifest không submit được */
>    required?: boolean
>    ```
>
>    `mapCargo`: trong `push()`, thêm `required: required.has(prop)` cho cả 2
>    nhánh (bỏ trống và có giá trị). `mapContainer`: thêm hằng số
>
>    ```ts
>    /** Field BẮT BUỘC của site trong bảng container (FACT 5.3). */
>    const REQUIRED_CONTAINER: readonly string[] = [
>      'CNTR_SIZE_COD',
>      'CNTR_TYPE_COD',
>      'CNTR_EF_ID',
>      'SOC_ID',
>    ]
>    ```
>
>    rồi `required: REQUIRED_CONTAINER.includes(prop)` trong `push()` của
>    `mapContainer`.
>
> 2. `src/core/fill.ts` — `FillItem` thêm `required?: boolean`; `fillPlans` copy
>    `plan.required` vào item (cả nhánh `skip` và nhánh `ok`/`warn`); vòng lặp
>    của `fillContainerRows` copy `plan.required` vào item; và đổi predicate:
>
>    ```ts
>    // `skip` chỉ được coi là ổn khi site KHÔNG bắt buộc field đó.
>    // Field site bắt buộc mà API không có (包装类型/代码, 尺寸, 箱型, 箱状态…)
>    // ⇒ manifest không thể submit ⇒ `ok` phải là false.
>    ok: items.every(
>      (i) => i.status === 'ok' || (i.status === 'skip' && !i.required),
>    ),
>    ```
>
> 3. `src/core/protocol.ts` — `ReportItem` thêm `required?: boolean`.
>
> 4. `src/content/index.ts` — `FillResult` lấy `report.items` thẳng ⇒ không
>    cần sửa, nhưng phải **kiểm tra lại** sau khi `FillItem` đổi.

- [ ] **Step 1: Tạo `src/core/protocol.ts`**

```ts
import type { FillScope } from './fill'

export const MSG_FILL = 'manifest-autofill:fill'
export const MSG_PING = 'manifest-autofill:ping'
export const MSG_GET_BL_NO = 'manifest-autofill:get-bl-no'

/**
 * - `ok`    — điền thành công, đã xác minh lại giá trị trên form
 * - `warn`  — điền xong nhưng bước xác minh không khớp (vd mã cảng site chưa cascade)
 * - `skip`  — API không cung cấp field này, cố ý để trống (có `note` giải thích)
 * - `error` — không điền được (không tìm thấy field, không chọn được option, …)
 */
export type ReportStatus = 'ok' | 'skip' | 'warn' | 'error'

export interface ReportItem {
  scope: FillScope
  prop: string
  label: string
  status: ReportStatus
  note?: string
  /** số thứ tự của dòng (chỉ có với scope cargo/container) — phân biệt các dòng trùng prop */
  row?: number
}

export interface FillRequest {
  type: typeof MSG_FILL
  blNo: string
  autoSubmit?: boolean
  apiBase?: string
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
  /** có tự bấm 确定 ở form đầu sau khi điền xong hay không */
  autoSubmit: boolean
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBase: DEFAULT_API_BASE,
  siteApiBase: '/api/booking/exportManifestDataMaintain',
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
    await writeSettings({ autoSubmit: true })
    const settings = await readSettings()
    expect(settings.autoSubmit).toBe(true)
  })

  it('không ghi đè các setting khác', async () => {
    await writeSettings({ siteApiBase: '/api/custom' })
    await writeSettings({ autoSubmit: true })
    const settings = await readSettings()
    expect(settings.siteApiBase).toBe('/api/custom')
    expect(settings.autoSubmit).toBe(true)
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
      'Open the 预配舱单申报平台 page (#/exportBusinessOperations/maintenanceOfManifestData) and try again.',
    )
  }

  const settings = await readSettings()
  const apiBase = request.apiBase ?? settings.apiBase
  const blNo = normalizeBlNo(request.blNo ?? '')

  if (!blNo) return emptyResult('Enter a bill of lading number first.')

  let data: ManifestData
  try {
    data = await fetchManifest(blNo, { baseUrl: apiBase })
  } catch (e) {
    if (e instanceof ManifestApiError && e.kind === 'not_found') {
      return emptyResult(
        `No manifest found for blNo ${blNo} (tried both the form with and without the P suffix).`,
      )
    }
    return emptyResult(`API call failed: ${(e as Error).message}`)
  }

  let ctx: MappingContext
  try {
    const dicts = await loadSiteDicts({ baseUrl: settings.siteApiBase })
    ctx = createMappingContext(dicts)
  } catch (e) {
    return emptyResult(`Could not read the site dictionaries: ${(e as Error).message}`)
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
      .catch((e: unknown) => sendResponse(emptyResult(`Unexpected error: ${String(e)}`)))
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

## Task 15: Popup — giao diện nhập 提单号 + báo cáo

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
  const acc = { ok: 0, skip: 0, warn: 0, error: 0 }
  for (const item of items.value) acc[item.status] += 1
  return acc
})

/** Mỗi icon ứng với đúng một trạng thái — không trùng lẫn. */
function icon(item: ReportItem): string {
  if (item.status === 'ok') return '✅'
  if (item.status === 'warn') return '⚠️'
  if (item.status === 'error') return '❌'
  return '⏭'
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
      ✅ {{ counts.ok }} · ⚠️ {{ counts.warn }} · ⏭ {{ counts.skip }} · ❌ {{ counts.error }} ·
      cargo: {{ result.cargoRows }} · containers: {{ result.containerRows }}
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
        <tr v-for="item in items" :key="`${item.scope}-${item.row ?? 0}-${item.prop}`">
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

## Task 16: Options — cấu hình API base + tự submit

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
const autoSubmit = ref(false)
const saved = ref(false)

async function load(): Promise<void> {
  const settings: ExtensionSettings = await readSettings()
  apiBase.value = settings.apiBase
  siteApiBase.value = settings.siteApiBase
  autoSubmit.value = settings.autoSubmit
}

async function save(): Promise<void> {
  await writeSettings({
    apiBase: apiBase.value.trim(),
    siteApiBase: siteApiBase.value.trim(),
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
git commit -m "feat: add options page for API base and auto-submit"
```

---

## Task 17: Build, nạp extension và kiểm thử thủ công trên site thật

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
        hasAutocomplete: Boolean(item.querySelector('.el-autocomplete')),
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
| 4 | Đối chiếu bảng hàng | Đủ số dòng `cdgoods`; 24 field trong dialog hàng đúng giá trị, **trừ** 包装类型/代码 (`PACKAGE_STR` / `PACKAGE_COD`) — 2 field này **cố ý để trống** vì API không có 包装类型 thật, và site **bắt buộc** chúng ⇒ phải chọn tay trước khi bấm 保存 |
| 5 | Đối chiếu bảng container | Đủ số dòng `cdCon`; 9 cột đúng giá trị, **trừ** 尺寸 / 箱型 / 箱状态 — 3 field này **cố ý để trống** (API không có dữ liệu dùng được) |
| 6 | Bấm **确定** ở form đầu | **Sẽ bị site từ chối** nếu 3 ô container còn trống ⇒ điền tay 尺寸/箱型/箱状态 cho từng dòng rồi bấm lại; lúc đó bản ghi mới xuất hiện trong danh sách |
| 7 | Bật **Auto-click 确定** rồi chạy lại | Extension tự bấm 确定; nếu container còn thiếu 尺寸/箱型/箱状态 thì site từ chối ⇒ extension phải báo ⚠️ *"the site did not accept the form — the container rows still require 尺寸 / 箱型 / 箱状态"*, **không** được báo thành công |
| 8 | Kiểm tra cookie `token` của site có phải `HttpOnly` không | Ghi lại kết quả — xem ghi chú bên dưới |
| 9 | **Cực tính `payType`** → 预付 hay 到付 | Xem ghi chú bên dưới — nhãn option đã xác minh, còn cực tính thì xác nhận |
| 10 | **3 field `*_PORT_COD`** là input thường hay `el-select` | Xem ghi chú bên dưới — tên cảng đã xác minh là `el-autocomplete` |
| 11 | **Shape `getCntrCode`** khi đã đăng nhập | Xem ghi chú bên dưới — 3 endpoint còn lại đã xác minh; `getPackageCode/` không dùng |
| 12 | **Nút lưu của dialog 货物信息** | Phải là `保存` (xem ghi chú bên dưới) |
| 13 | **3 field bắt buộc mà API không có**: 尺寸, 箱型, 箱状态 | Người dùng phải tự chọn trên site — báo cáo phải nói rõ |

> **Bước 9 — nhãn option của 付款方式 (`PAY_WAY_ID`).** **Đã xác minh** từ bundle thật
> của site (2026-10-27): option tĩnh là `请选择` / `预付` (`P`) / `到付` (`C`) /
> `免费` (`F`) — xem FACT 2 trong `2026-10-27-live-site-alignment.md`. Adapter
> `pickFromSelect` khớp option theo **text hiển thị**, nên `mapHeader` phải trả
> **nhãn** (`预付` / `到付`), không phải mã.
>
> Còn đúng một thứ phải xác nhận trên site thật là **cực tính** của `payType`:
> API dadaex chỉ có boolean. Quyết định hiện tại là `true → 预付` (`P`),
> `false → 到付` (`C`). Kiểm tra bằng cách bấm 付款方式 trên form và xem option nào
> được tick, đối chiếu với dữ liệu API của một bản ghi thật.
>
> ```js
> // sau khi bấm 付款方式
> Array.from(document.querySelectorAll('.el-select-dropdown__item'))
>   .map((el) => el.textContent.trim())
> ```

> **Bước 10 — kiểu DOM của các field cảng.** **Đã xác minh** từ bundle thật:
> `START_PORT_NAM` / `DISCHRG_PORT_NAM` / `TRANS_PORT_NAM` / `DEST_PORT_NAM` /
> `SIGN_PLACE_STR` là **`el-autocomplete`**, và site tự điền `*_PORT_COD` qua
> `onSelect` (tách theo dấu `/` **cuối cùng**) — xem FACT 3. Vì vậy extension chỉ
> cần gõ **tên cảng tiếng Trung** rồi click đúng suggestion `名称/代码`.
>
> Cần xác nhận trên site thật: 3 field `*_PORT_COD` là **input thường** (site ghi
> trực tiếp vào model) — nếu vậy `readFieldValue` đọc được để `verify`.
>
> ```js
> const el = document.querySelector('input[id$="-START_PORT_COD"]')
> console.log(el?.outerHTML, el?.closest('.el-select') !== null)
> ```

> **Bước 11 — shape thật của 5 endpoint dict.** **Đã xác minh** từ bundle thật
> (2026-10-27): `getTrustCode` → `data` là mảng object có `TRUST_COD`;
> `getDrType` → `data` là mảng **chuỗi thuần**; `getPort` → mảng object có
> `E_PORT_NAM` + `PORT_COD`; cả 5 endpoint tồn tại và lỗi nằm trong **HTTP 200**
> (`{"code":4000,"data":null,"msg":"身份认证信息未提供。"}`).
>
> Còn phải xác minh khi **đã đăng nhập**: shape của `data` cho `getCntrCode`
> (plan giả định `getCntrCode` → `{ cntr_type: [...], cntr_size: [...] }`
> nằm bên trong `data`). `getPackageCode/` **không** cần xác minh — extension
> không gọi endpoint đó.
>
> ```js
> const r = await fetch('/api/booking/exportManifestDataMaintain/getCntrCode/', { credentials: 'include' })
> console.log(JSON.stringify(await r.json()).slice(0, 800))
> ```

> **Bước 12 — nút lưu của dialog 货物信息.** **Đã xác minh** từ bundle: footer của
> dialog hàng có đúng 2 nút là `取消` và ` 保存 ` — **không có `确定`**. `确定` chỉ
> xuất hiện trong hộp thoại xác nhận xoá (`确定要删除这条货物信息吗？`). Extension phải
> bấm `保存`.
>
> ```js
> // mở dialog 货物信息 rồi đọc footer
> Array.from(document.querySelectorAll('.el-dialog__footer button')).map(b => b.textContent.trim())
> ```

> **Bước 13 — 3 field bắt buộc mà API không có.** 尺寸 (`CNTR_SIZE_COD`), 箱型
> (`CNTR_TYPE_COD`) và 箱状态 (`CNTR_EF_ID`) đều là field **bắt buộc** của site, nhưng
> API không cung cấp được:
> - 尺寸/箱型: API trả `cType`/`vC` là **mã số**, còn dict `getCntrCode/` chỉ có
>   **chuỗi** (`"40"`, `"HQ"`) ⇒ không thể tra mã → chuỗi.
> - 箱状态: API không có dữ liệu nào tương ứng (site có `F`=整箱, `L`=拼箱, `E`=空箱).
>
> Cả 3 được để trống kèm ghi chú nói rõ *"the site requires this — please choose it on
> the page"*. Sau khi chạy xong, hãy điền tay 3 ô này cho từng dòng container rồi bấm
> 确定 ở form đầu.

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






