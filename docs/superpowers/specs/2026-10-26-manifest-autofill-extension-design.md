# Thiết kế: Chrome Extension tự động điền thông tin Manifest

**Ngày:** 2026-10-26
**Trạng thái:** Chờ duyệt
**Phạm vi:** Điền form 预配舱单 (Manifest) trên `chinaports-agency.com:8870` từ dữ liệu API `dadaex.cn`.

---

## 1. Mục tiêu

Người dùng nhập một **blNo** (số bill of lading) → extension gọi API của `dadaex.cn` → tự động điền toàn bộ form Manifest (phần đầu + bảng hàng + bảng container) trên trang web của China Ports → người dùng kiểm tra và bấm **确定** để lưu.

**Ngoài phạm vi (không làm):**
- Không tự gọi `send/` hoặc `upload/` (đẩy báo cáo ra ngoài hệ thống) — thao tác này thuộc về người dùng.
- Không tự đăng nhập, không lưu/đọc token ngoài phạm vi trang đích.
- Không tự tạo bản ghi Manifest mới nếu người dùng chỉ muốn sửa bản ghi có sẵn.

---

## 2. Bối cảnh kỹ thuật (đã xác minh)

### 2.1 Trang đích

| Hạng mục | Giá trị |
|---|---|
| URL | `https://www.chinaports-agency.com:8870/#/exportBusinessOperations/maintenanceOfManifestData` |
| Tên trang | 预配舱单申报平台 (Pre-manifest Declaration Platform) |
| Framework | Vue 3 + Element Plus + fast-crud (`fs-crud`) |
| Cấu trúc | Trang danh sách + tab 待发送/已发送 → nút **新增舱单信息** mở dialog chứa form đầu + bảng 货物信息 + bảng 集装箱 |
| Xác thực | JWT trong cookie `token`, header `Authorization: JWT <token>` |

**API của chính site** (`/api/booking/exportManifestDataMaintain/`), dùng để tra dict — extension gọi được nhờ dùng chung session:

| Endpoint | Dùng để |
|---|---|
| `GET getTrustCode/` | options 承运人代码 (`TRUST_COD`) |
| `GET getDrType/` | options 交货条款 (`DR_TYPE_STR`) |
| `GET getPort/` | options 5 cảng (dây chuyền) |
| `GET getCntrCode/` | options 箱型 / 尺寸 |
| `GET getPackageCode/` | options 包装类型 |

### 2.2 Nguồn dữ liệu

```
GET https://www.dadaex.cn/api/vn/insight/manifest?blNo={blNo}
→ { "status": 1, "messgae": "success", "data": { ... } }
→ { "status": 0, "message": "data_not_found", "data": null }
```

- CORS `Access-Control-Allow-Origin: *` → content script gọi trực tiếp được, không cần proxy.
- **`blNo` phải bỏ hậu tố piece.** Đã kiểm chứng: `CHN4139065P1` → `data_not_found`; `CHN4139065` → `status:1`. Hậu tố dạng `P\d+$` bị extension loại bỏ trước khi gọi.
- `data` có thể `null` dù `status:1` → phải báo lỗi rõ ràng, không coi là thành công.

### 2.3 Shape của `data`

```
data
├── blNo, shipName, voyage
├── loadCode, loadPort, uploadCode, uploadPort, aimPort, aimPortCode
├── payType, transportTerms
├── loadPortData {id, name, nameEn}      → 装货港
├── uploadPortData {id, name, nameEn}    → 卸货港
├── aimPortData {id, name, nameEn}       → 交货地
├── sea_order { ebNo, sea_order_bind {id, supplyId} }   → supplyId = 承运人
├── cabContacts[]   (3 bản ghi: 发货人/收货人/通知人)
├── cdgoods[]       (hàng)
└── cdCon[]         (container)
```

`cabContacts.type` là enum vai trò (0/1/2; 0 và 1 bị serialize thành `false`/`true`):

| `type` | Vai trò | Field form |
|---|---|---|
| `false` (0) | 发货人 | `E_SHIPPER_NAM`, `SHIPPER_*` |
| `true` (1) | 收货人 | `E_CONSIGNEE_NAM`, `CONSIGNEE_*` |
| `2` | 通知人 | `E_NOTIFY_NAM`, `NOTIFY_*` |

---

## 3. Kiến trúc

```
┌─ Popup (Vue 3 + TS) ──────────────┐
│ input blNo                         │
│ [Điền dữ liệu]  [Mở trang]        │──┐
│ ☐ tự submit                       │  │
│ bảng báo cáo từng field           │  │
└───────────────────────────────────┘  │  chrome.runtime.sendMessage
                                       ▼
┌─ Content Script (TS) ────────────────────────────────┐
│  core/fill.ts  — điều phối                          │
│    1. mở dialog 新增舱单信息                        │
│    2. điền 36 field form đầu (thứ tự phụ thuộc)     │
│    3. mỗi cdgoods  → dialog 24 field → lưu          │
│    4. mỗi cdCon    → bảng inline editable 9 field   │
│    5. trả báo cáo                                   │
│  core/dom.ts   — tìm field & đặt giá trị (Vue 3)    │
│  core/mapping.ts — data → giá trị field (config)    │
│  core/api.ts   — gọi dadaex, bóc envelope           │
└─────────────────────────────────────────────────────┘
                    │
                    ▼ fetch (CORS *)
        https://www.dadaex.cn/api/vn/insight/manifest
```

### 3.1 Module lõi (TypeScript thuần, test được độc lập)

| Module | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `core/api.ts` | Chuẩn hoá blNo, gọi API, bóc envelope, sinh lỗi có kiểu | — |
| `core/mapping.ts` | `data` → `{formProp, value}[]` cho form đầu / hàng / container. **Mapping là dữ liệu (config), không hardcode trong code** | — |
| `core/dom.ts` | Tìm control theo `prop`, đặt giá trị đúng kiểu Vue/Element Plus, chờ render | DOM |
| `core/fill.ts` | Điều phối: mở dialog → điền form → thêm dòng bảng → sinh báo cáo | `dom`, `mapping` |

`core/options.ts` đọc/ghi `chrome.storage.sync` cho: API base URL, mapping override, giá trị mặc định.

### 3.2 Trang Options

Cho phép sửa (không cần build lại):
- API base URL + endpoint.
- Ghi đè mapping (formProp ↔ đường dẫn trong `data`) cho từng field.
- Bật/tắt từng field trong báo cáo.

Cấu hình mặc định nằm trong `src/core/default-mapping.ts` (ship kèm extension).

---

## 4. Bảng mapping (mặc định)

### 4.1 Form đầu (36 field)

| Form prop | Label | Nguồn |
|---|---|---|
| `BILL_NBR` | 提单号 | `data.blNo` |
| `E_SHIP_NAM` | 船名 | `data.shipName` |
| `OUT_VOYAGE_NO` | 航次 | `data.voyage` |
| `TRUST_COD` | 承运人代码 | `sea_order.sea_order_bind.supplyId` → tra `getTrustCode()` (xem rule bên dưới) |
| `PAY_WAY_ID` | 付款方式 | `data.payType` → `"0"` khi `false`, `"1"` khi `true` (site không có endpoint dict riêng cho 付款方式 trong bundle) |
| `DR_TYPE_STR` | 交货条款 | `data.transportTerms` → tra `getDrType()` |
| `START_PORT_NAM` / `_COD` | 收货地（装货港） | `loadPortData.name` / `loadCode` |
| `DISCHRG_PORT_NAM` / `_COD` | 卸货港 | `uploadPortData.name` / `uploadCode` |
| `DEST_PORT_NAM` / `_COD` | 交货地 | `aimPortData.name` / `aimPortCode` |
| `E_SHIPPER_NAM` | 发货人名称 | `cabContacts[type=0].master` |
| `SHIPPER_ADD_STR` | 发货人地址 | `cabContacts[type=0].address` |
| `SHIPPER_COUNTRY_COD` | 国家代码 | `cabContacts[type=0].country` |
| `SHIPPER_TE_STR` | 电话 | `cabContacts[type=0].phone` |
| `E_CONSIGNEE_NAM` + `CONSIGNEE_*` | 收货人… | `cabContacts[type=1]` |
| `E_NOTIFY_NAM` + `NOTIFY_*` | 通知人… | `cabContacts[type=2]` |

**Rule khớp giá trị cho các field dạng select:**

| Field | Cách khớp | Khi không khớp |
|---|---|---|
| `TRUST_COD` | `supplyId` khớp `id` của option trong `getTrustCode()`; nếu không có `id` thử khớp `code`/`value` bằng chính `supplyId` | ⚠️ báo "không tìm thấy 承运人 cho supplyId=X", để trống |
| `DR_TYPE_STR` | `transportTerms` khớp `value`/`code` của option trong `getDrType()`; không có thì dùng luôn giá trị thô | ⚠️ báo, để trống |
| `PAY_WAY_ID` | `payType` boolean → `"0"` / `"1"` | — |
| 5 cảng | `*_NAM` = `portData.name` (tên tiếng Trung, vd `上海`), `*_COD` = `loadCode`/`uploadCode`/`aimPortCode` | ⚠️ nếu option không tồn tại trong `getPort()` |

Tên cảng: mặc định lấy `name` (tiếng Trung). Nếu cần tiếng Anh thì đổi sang `nameEn` — cấu hình được trong Options (không cần build lại).

**Cố ý để trống** (API không có, hoặc ngữ nghĩa không khớp):

| Field | Lý do |
|---|---|
| `SHIPPER_AEO`, `CONSIGNEE_AEO` | `firmCode` là mã đăng ký DN (USCI/TIN), **không phải mã AEO** → không nhét vào form khai báo hải quan |
| `SHIPPER_EM_STR`, `SHIPPER_FX_STR`, `CONSIGNEE_EM_STR`, `CONSIGNEE_FX_STR`, `NOTIFY_EM_STR`, `NOTIFY_FX_STR` | API không có trường email/fax |
| `SIGN_PLACE_STR` / `_COD` | 提单签发地 — API không có |
| `TRANS_PORT_NAM` / `_COD` | 中转港 — API không có |
| `TOTAL_PIECE_NUM`, `TOTAL_GWEIGHT_TON`, `TOTAL_GVOL_NUM` | Field disabled, site tự tính |

Mỗi field để trống sẽ xuất hiện trong báo cáo với nhãn ⚠️ *thiếu dữ liệu nguồn*.

### 4.2 Bảng hàng — `cdgoods[]` (dialog 24 field)

| Form prop | Nguồn |
|---|---|
| `CARGO_KIND_COD` | suy ra: có `dangerClass` **và** `quarantineName` → `G`; chỉ `dangerClass` → `D`; chỉ `quarantineName` → `R`; không có → `S` |
| `CARGO_HS_COD` | `hscode` |
| `PACKAGE_STR` / `PACKAGE_COD` | `unit` / `packType` |
| `PIECE_NUM` | `amount` |
| `GWEIGHT_TON` | `weight` |
| `GVOL_NUM` | `volume` |
| `NWEIGHT_TON` | `grossWeight` |
| `E_CARGO_NAM` | `name` (trim khoảng trắng thừa) |
| `MARK_STR` | `sign` (mặc định site là `N/M`) |
| `DANG_CLASS_NAM` | `dangerClass` |
| `DANG_UN_NO` | `unNub` |
| `DANG_LABLE_STR` | `dangerCode` |
| `DANG_FLASH_POINT` | `dangerPoint` |
| `DANGER_CONTACT_NAM` | `exigencyName` |
| `DANGER_TE_STR` | `exigencyPhone` |
| `DANGER_EM_STR` | `exigencyEmail` |
| `DANGER_FX_STR` | `exigencyFax` |

Để trống: `DANG_PAGE_NO`, `DANG_EMS_NO`, `DANG_MFAG_NO`, `DANG_CONTACTSTR`, `TEMP_ID`, `SET_TEMP_NUM`.

### 4.3 Bảng container — `cdCon[]` (bảng inline editable, 9 field)

| Form prop | Nguồn |
|---|---|
| `CNTR_NO` | `boxNub` |
| `CNTR_SIZE_COD` | `vC` → dict `getCntrCode().cntr_size` |
| `CNTR_TYPE_COD` | `cType` → dict `getCntrCode().cntr_type` |
| `SEAL_NO` | `sealNUb` |
| `PIECE_NUM` | `amount` |
| `WEIGH_TON` | `weight` |
| `VOLUME_NUM` | `volume` |
| `SOC_ID` | `self` ? `1` : `0` |

Để trống: `CNTR_EF_ID` (箱状态).

---

## 5. Fill engine

### 5.1 Tìm field

Element Plus gán `id` cho input theo mẫu `${formId}-${prop}` (formId sinh động), nên selector ổn định là:

```
input[id$="-BILL_NBR"], textarea[id$="-MARK_STR"]
```

Fallback khi không có `id`: tìm `.el-form-item` có label khớp text trong scope `.EntryOfManifestInformation` (form đầu) hoặc `.el-dialog` (dialog hàng).

Với bảng inline (container) và bảng fast-crud (cargo), dùng `prop` của cột để định vị ô theo vị trí hàng/cột.

### 5.2 Đặt giá trị — text / textarea

Vue 3 không nhận `el.value = v` gán trực tiếp. Bắt buộc dùng native setter:

```ts
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
setter.call(el, value)
el.dispatchEvent(new Event('input', { bubbles: true }))
el.dispatchEvent(new Event('change', { bubbles: true }))
el.dispatchEvent(new FocusEvent('blur', { bubbles: true }))   // kích hoạt validator onBlur của site
```

### 5.3 Đặt giá trị — control dạng chọn (runtime-adaptive)

Đã kiểm chứng từ bundle của site: các field chọn **không đồng nhất** —
`TRUST_COD`/`PAY_WAY_ID`/`DR_TYPE_STR` là `el-select` thuần, còn 5 field cảng + 提单签发地
dùng **component tuần biến** của dự án (site đăng ký chúng qua một bảng `ref` nội bộ:
`signPlaceStrRef`, `startPortNamRef`, …). Vì vậy extension **không hardcode theo loại control**,
mà nhận diện lúc chạy.

**Adapter `setFieldValue(prop, value)` — chọn chiến lược theo DOM thực tế:**

| Phát hiện trong DOM | Chiến lược |
|---|---|
| `input` / `textarea` (kể cả nằm trong component tuần biến) | native setter + `input`/`change`/`blur` (§5.2) |
| Có `.el-select` bên trong | Mở dropdown → chờ option → click option khớp (xem bên dưới) |
| Có `input[readonly]` + popper tự dựng | Click để mở popper → gõ vào ô lọc → chờ → click phần tử khớp trong popper |
| Có `.el-cascader` | Click → chọn lần lượt theo từng cấp |

**Cách chọn option (dùng chung cho mọi loại dropdown):**
1. Tra option list từ API dict của site (`getTrustCode`, `getDrType`, `getPort`, `getCntrCode`, `getPackageCode`) — dùng chung session, không cần token riêng.
2. Click control để mở dropdown (Element Plus render popper ra `body`, không nằm trong form).
3. Tìm phần tử option theo nhiều selector phổ biến: `.el-select-dropdown__item`, `.el-cascader-node`, `[role="option"]`, `.el-popper li`.
4. Click option khớp **text** (khớp chính xác trước, khớp chứa sau).
5. Nếu control có ô filter (`input` bên trong popper hoặc `filterable`), gõ giá trị cần tìm để lọc rồi mới click.
6. Không tìm thấy option → ⚠️ báo kèm giá trị cần tìm, bỏ qua field (không click bừa).

Các cảng có phụ thuộc dây chuyền (`signPlace → startPort → dischrgPort → transPort → destPort`) → điền đúng thứ tự, chờ render sau mỗi bước.

**Xác nhận bằng DOM thật:** trước khi viết adapter cho field cảng, cần chạy 1 lần DOM dump trên dialog
**新增舱单信息** (xem §8) để chốt cấu trúc popper của component tuần biến. Đây là bước xác minh
duy nhất còn lại; nếu DOM khác dự kiến thì adapter được sửa cho vừa, không ảnh hưởng kiến trúc.

### 5.4 Thứ tự thao tác

```
1. Đảm bảo đang ở tab 待发送
2. Click nút "新增舱单信息"  → chờ dialog .el-dialog hiện ra
3. Điền form đầu theo thứ tự phụ thuộc (cảng trước, port sau)
4. Với mỗi cdgoods:
     click "新增" (nút trong section 货物信息)
     chờ ≥ 400ms  (site dùng setTimeout 400ms rồi mới mở form)
     điền 24 field
     click "确定" trong dialog hàng  → chờ API /cargo/add/ xong
5. Với mỗi cdCon:
     click "新增" (addRow của bảng container)
     điền 9 field trực tiếp trong ô bảng
6. Trả báo cáo
```

### 5.5 Chờ render

Vue render bất đồng bộ. Dùng `await nextFrame()` (2× `requestAnimationFrame`) giữa các field, và `waitFor(selector, timeout)` với polling 100ms cho các phần tử xuất hiện muộn (dialog, popper, dòng bảng). Timeout mặc định 5s, hết giờ → báo ⚠️ field đó thất bại, tiếp tục field còn lại.

---

## 6. Luồng người dùng & báo cáo

Popup:
1. Ô nhập `blNo` (có nút "lấy từ ô 提单号 của trang").
2. Nút **Điền dữ liệu** → gửi message tới content script.
3. Nút **Mở trang** → mở tab trang manifest.
4. Ô **☐ tự submit** (mặc định tắt) — nếu bật, extension bấm **确定** ở form đầu sau khi điền xong.
5. Bảng báo cáo, gồm 4 trạng thái:
   - ✅ đã điền
   - ⚠️ không tìm thấy field trên trang / thiếu dữ liệu nguồn (kèm lý do)
   - ❌ lỗi khi đặt giá trị
   - ⏭ bỏ qua (không có trong mapping)

Mọi thao tác **ghi** (lưu dòng hàng, lưu container) đều do extension thực hiện — giống hệt người dùng bấm tay. Thao tác **phát tán** (`上传船代` / `send`) không bao giờ tự động.

---

## 7. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| API trả `status:0` / `data:null` | Báo: "Không tìm thấy manifest cho blNo X (đã thử cả dạng có/không hậu tố P)" |
| API lỗi mạng | Báo rõ lỗi, không điền gì |
| Không ở trang manifest | Báo "Hãy mở trang 预配舱单申报平台" + nút mở trang |
| Dialog không mở trong 5s | Báo ❌, dừng |
| Field không có trên trang | ⚠️, bỏ qua, tiếp tục |
| Option select không khớp | ⚠️ kèm giá trị cần tìm, bỏ qua field đó |
| Một dòng hàng lỗi khi lưu | Ghi lỗi của dòng đó, tiếp tục dòng sau, tổng hợp cuối |

Không dừng toàn bộ quy trình vì một field lỗi — trừ khi lỗi ở bước mở dialog.

---

## 8. Kiểm thử

**Unit (Vitest + jsdom)**
- `api.ts`: chuẩn hoá blNo (`CHN4139065P1` → `CHN4139065`), bóc envelope, xử lý `data:null`.
- `mapping.ts`: với fixture JSON thật (đã lưu từ `ONEYSHAGT1569600`) → assert đúng giá trị từng field; assert enum `cabContacts.type`; assert suy ra `CARGO_KIND_COD`.
- `dom.ts`: đặt giá trị vào input/textarea/select trong jsdom, assert Vue-style binding nhận đúng giá trị.

**Manual (tải extension unpacked)**
0. *(một lần, trước khi viết adapter cảng)* Mở dialog **新增舱单信息** trên trang thật, chạy DOM dump (§5.3) để chốt cấu trúc popper của component cảng và của dialog hàng.
1. Mở trang → đăng nhập → vào 预配舱单申报平台.
2. Popup → nhập `ONEYSHAGT1569600` → Điền dữ liệu.
3. Đối chiếu từng field với bảng mapping ở §4.
4. Kiểm tra bảng hàng và bảng container đã đúng số dòng.
5. Bấm **确定** ở form đầu → kiểm tra bản ghi xuất hiện trong danh sách.

---

## 9. Rủi ro kỹ thuật & xử lý

| Rủi ro | Mức | Xử lý |
|---|---|---|
| `@crxjs/vite-plugin` không tương thích Vite mới | Trung bình | Pin `vite@^5.4` + `@crxjs/vite-plugin@2.0.0-beta.23`. Nếu lỗi → fallback: `public/manifest.json` tĩnh + Vite multi-entry build (không phụ thuộc plugin) |
| Element Plus đổi DOM | Thấp | Selector chính `input[id$="-PROP"]`; fallback theo label; báo ⚠️ nếu không tìm thấy |
| Tên option select lệch với dict | Thấp | Tra dict từ API site; báo ⚠️ kèm giá trị cần, người dùng sửa mapping trong Options |
| Có option trùng tên | Thấp | Chọn option đầu tiên khớp; ghi cảnh báo nếu >1 khớp |
| Rate-limit API dadaex | Thấp | Extension gọi 1 request/lần người dùng bấm; cache theo blNo trong `chrome.storage.local` (TTL 10 phút) |

---

## 10. Cấu trúc thư mục

```
manifest-huagang/
├── manifest.config.ts          (đã có — sẽ bổ sung content_scripts, host_permissions)
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/
│   ├── logo.png
│   └── manifest.json           (fallback nếu không dùng crxjs)
├── src/
│   ├── background/index.ts     service worker
│   ├── content/
│   │   ├── index.ts            bootstrap content script
│   │   └── fill.ts             điều phối (nằm trong core)
│   ├── core/
│   │   ├── api.ts
│   │   ├── mapping.ts
│   │   ├── default-mapping.ts
│   │   ├── dom.ts
│   │   ├── fill.ts
│   │   ├── wait.ts             nextFrame, waitFor
│   │   └── types.ts
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── App.vue
│   ├── options/
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── App.vue
│   └── styles/
└── tests/
    ├── api.test.ts
    ├── mapping.test.ts
    └── dom.test.ts
```

---

## 11. Quyết định đã chốt

| # | Quyết định | Trạng thái |
|---|---|---|
| 1 | Phương án: Chrome Extension DOM autofill (không gọi API site để ghi dữ liệu) | ✅ chốt |
| 2 | Nguồn dữ liệu: `dadaex.cn/api/vn/insight/manifest?blNo=` | ✅ chốt |
| 3 | Enum vai trò: `type` 0=发货人, 1=收货人, 2=通知人 | ✅ chốt |
| 4 | `firmCode` **không** map vào trường AEO → để trống | ✅ chốt |
| 5 | Field không có trong API → để trống + ghi chú ⚠️ trong báo cáo | ✅ chốt |
| 6 | Không tự submit; người dùng bấm **确定** (có tuỳ chọn tự submit trong popup) | ✅ chốt |
