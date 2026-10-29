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

> Extension chỉ gọi **4** endpoint ở trên. `getPackageCode/` **không** được gọi: `PACKAGE_STR`
> và `PACKAGE_COD` đều để trống (xem §4.2) ⇒ dict 包装 không có nơi dùng.

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
│  core/site.ts  — từ vựng DOM của site (section/nút/ │
│                  bảng/dialog, "ẩn hay hiện")        │
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
| `core/site.ts` | Từ vựng DOM của site: tìm section, nút `新增`, bảng, dialog; hỏi "element này ẩn hay hiện" | DOM |
| `core/fill.ts` | Điều phối: mở dialog → điền form → thêm dòng bảng → sinh báo cáo | `dom`, `mapping`, `site` |

`core/options.ts` đọc/ghi `chrome.storage.sync` cho: API base URL, base URL của API dict của site, và cờ tự submit.

### 3.2 Trang Options

Cho phép sửa (không cần build lại):
- **Manifest data API** — base URL của API dadaex (mặc định `https://www.dadaex.cn/api/vn/insight/manifest`).
- **Site dictionary API** — base path của 4 endpoint dict của site (mặc định `/api/booking/exportManifestDataMaintain`).
- **Automatically click 确定 on the header form after filling** — mặc định **TẮT**.

> **Không có** tuỳ chọn "tên cảng tiếng Trung / tiếng Anh": widget cảng của site chỉ có
> tên tiếng Trung (`filter: "E_PORT_NAM"`), nên setting đó vô dụng và đã bị gỡ.
> Mapping override theo field cũng không nằm trong phạm vi bản này — mapping là hằng
> trong `src/core/mapping.ts`.

---

## 4. Bảng mapping (mặc định)

### 4.1 Form đầu (28 field có nhãn + 5 field mã cảng)

| Form prop | Label | Nguồn |
|---|---|---|
| `BILL_NBR` | 提单号 | `data.blNo` |
| `E_SHIP_NAM` | 船名 | `data.shipName` |
| `OUT_VOYAGE_NO` | 航次 | `data.voyage` |
| `TRUST_COD` | 承运人代码 | `sea_order.sea_order_bind.supplyId` → tra `getTrustCode()` (xem rule bên dưới) |
| `PAY_WAY_ID` | 付款方式 | `data.payType` → `预付` (`P`) khi `true`, `到付` (`C`) khi `false` |
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
| `PAY_WAY_ID` | `payType` boolean → **nhãn** `预付` (`true`) / `到付` (`false`) | — |
| 3 cảng | `*_NAM` = `portData.name` (tên tiếng Trung, vd `上海`), `*_COD` = `loadCode`/`uploadCode`/`aimPortCode` | ⚠️ nếu không tìm thấy suggestion |

> **Đã xác minh 2026-10-27 từ bundle của site** (xem
> `docs/superpowers/plans/2026-10-27-live-site-alignment.md`):
>
> - 付款方式 là `el-select` với option **tĩnh**: `请选择` / `预付` (`P`) / `到付` (`C`) /
>   `免费` (`F`). Adapter khớp option theo **text hiển thị** → phải trả **nhãn**, không
>   phải mã.
> - 5 field cảng + 提单签发地 là **`el-autocomplete`**, suggestion hiển thị dạng
>   `名称/代码` (vd `上海/CNSHA`). Site tự điền `*_PORT_COD` khi suggestion được click
>   (tách theo dấu `/` **cuối cùng**).
> - Vì widget chỉ có tên tiếng Trung, **không có tuỳ chọn tên tiếng Anh** — setting
>   `portNameField` đã bị gỡ khỏi thiết kế.

**Cố ý để trống** (API không có, hoặc ngữ nghĩa không khớp):

| Field | Lý do |
|---|---|
| `SHIPPER_AEO`, `CONSIGNEE_AEO` | `firmCode` là mã đăng ký DN (USCI/TIN), **không phải mã AEO** → không nhét vào form khai báo hải quan |
| `SHIPPER_EM_STR`, `SHIPPER_FX_STR`, `CONSIGNEE_EM_STR`, `CONSIGNEE_FX_STR`, `NOTIFY_EM_STR`, `NOTIFY_FX_STR` | API không có trường email/fax |
| `SIGN_PLACE_STR` / `_COD` | 提单签发地 — API không có |
| `TRANS_PORT_NAM` / `_COD` | 中转港 — API không có |
| `TOTAL_PIECE_NUM`, `TOTAL_GWEIGHT_TON`, `TOTAL_GVOL_NUM` | Field disabled, site tự tính |

Mỗi field để trống sẽ xuất hiện trong báo cáo với nhãn ⚠️ *thiếu dữ liệu nguồn*.

### 4.2 Bảng hàng — `cdgoods[]` (dialog 24 field, tiêu đề `货物信息`, nút lưu `保存`)

| Form prop | Nguồn |
|---|---|
| `CARGO_KIND_COD` | suy ra: có `dangerClass` **và** `quarantineName` → `危险品+冷藏品`; chỉ `dangerClass` → `危险品`; chỉ `quarantineName` → `冷藏品`; không có → `普货` |
| `CARGO_HS_COD` | `hscode` |
| `PIECE_NUM` | `amount` — nhưng phải ghi **số nguyên** (`"114.000"` → `"114"`): rule `只允许整数` của site (`/^\d*$/`), không thì form bị từ chối với `请填必填表格` |
| `GWEIGHT_TON` | `weight` |
| `GVOL_NUM` | `volume` |
| `NWEIGHT_TON` | `grossWeight` |
| `E_CARGO_NAM` | `name` (trim khoảng trắng thừa) |
| `MARK_STR` | `shantou` (fallback `sign`) — 唛头; dữ liệu thật có `shantou = "N/M"`, `sign = null` |
| `DANG_CLASS_NAM` | `dangerClass` |
| `DANG_UN_NO` | `unNub` |
| `DANG_LABLE_STR` | `dangerCode` |
| `DANG_FLASH_POINT` | `dangerPoint` |
| `DANGER_CONTACT_NAM` | `exigencyName` |
| `DANGER_TE_STR` | `exigencyPhone` |
| `DANGER_EM_STR` | `exigencyEmail` |
| `DANGER_FX_STR` | `exigencyFax` |

Để trống: `DANG_PAGE_NO`, `DANG_EMS_NO`, `DANG_MFAG_NO`, `DANG_CONTACTSTR`, `TEMP_ID`,
`SET_TEMP_NUM`, `PACKAGE_STR`, `PACKAGE_COD`.

> **Đã xác minh 2026-10-27 từ bundle của site** (xem
> `docs/superpowers/plans/2026-10-27-live-site-alignment.md`, FACT 5):
>
> - `CARGO_KIND_COD` là `el-select` với option **tĩnh** `普货` / `危险品` / `冷藏品` /
>   `危险品+冷藏品` (mã `S`/`D`/`R`/`G`) → adapter khớp theo **text**, nên phải trả nhãn.
> - `PACKAGE_STR` + `PACKAGE_COD` là **2 `el-autocomplete`**, suggestion dạng `名称/代码`.
>   API không có *包装类型 thật* (`unit` chỉ là `"PACKAGES"`, `packType` = `null`) và
>   `PACKAGE_COD` bắt buộc đúng 2 ký tự → **để trống**, người dùng tự chọn.
> - Nút lưu của dialog là **`保存`** (không phải `确定`).

### 4.3 Bảng container — `cdCon[]` (bảng inline editable, 9 field)

| Form prop | Nguồn |
|---|---|
| `CNTR_NO` | `boxNub` |
| `SEAL_NO` | `sealNUb` |
| `PIECE_NUM` | `amount` |
| `WEIGH_TON` | `weight` |
| `VOLUME_NUM` | `volume` |
| `SOC_ID` | `self` ? `货主箱` : `非货主箱` (site lưu mã `Y` / `N`) |

Để trống: `CNTR_SIZE_COD` (尺寸), `CNTR_TYPE_COD` (箱型), `CNTR_EF_ID` (箱状态).

> **Đã xác minh 2026-10-27 từ bundle của site** (FACT 6):
>
> - 4 cột là `el-select` (`CNTR_SIZE_COD`, `CNTR_TYPE_COD`, `CNTR_EF_ID`, `SOC_ID`),
>   5 cột còn lại là `el-input`.
> - `SOC_ID` phải ghi **nhãn** `货主箱` / `非货主箱` (site lưu mã `Y`/`N`), không phải
>   `'1'`/`'0'` cũng không phải mã thô — adapter khớp option theo **text hiển thị**.
> - Dict `getCntrCode/` trả **chuỗi thuần** (`"40"`, `"HQ"`) — **không có `id`** ⇒
>   `vC`/`cType` (mã số của API) **không tra được** ra 尺寸/箱型 ⇒ để trống.
> - Nút thêm dòng là `新增` và **chèn dòng mới vào index 0** (đầu bảng).
> - Cả 3 field để trống đều là field **bắt buộc** của site → ghi chú phải nói rõ người
>   dùng cần tự chọn trên trang.

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
| Có `.el-select` bên trong | Mở dropdown → chờ option → click option khớp (xem bên dưới) |
| Có `.el-autocomplete` bên trong | Gõ tên cảng vào input → chờ suggestion → click suggestion `名称/代码` (xem bên dưới) |
| `input[readonly]` + popper tự dựng | Click để mở popper → gõ vào ô lọc → chờ → click phần tử khớp trong popper |
| `input` / `textarea` | native setter + `input`/`change`/`blur` (§5.2) |
| Có `.el-cascader` | Click → chọn lần lượt theo từng cấp |

**Cách chọn option (dùng chung cho mọi loại dropdown):**
1. Tra option list từ API dict của site (`getTrustCode`, `getDrType`, `getPort`, `getCntrCode`) — dùng chung session, không cần token riêng.
2. Click control để mở dropdown (Element Plus render popper ra `body`, không nằm trong form).
3. Tìm phần tử option theo nhiều selector phổ biến: `.el-select-dropdown__item`, `.el-cascader-node`, `[role="option"]`, `.el-popper li`.
4. Click option khớp **text** (khớp chính xác trước, khớp **tiều tố** sau, khớp chứa cuối cùng).
5. Nếu control có ô filter (`input` bên trong popper hoặc `filterable`), gõ giá trị cần tìm để lọc rồi mới click.
6. Không tìm thấy option → ⚠️ báo kèm giá trị cần tìm, bỏ qua field (không click bừa).

**Riêng `el-autocomplete` của 5 field cảng:**
1. Gõ **tên cảng tiếng Trung** vào input (site lọc `E_PORT_NAM LIKE '%kw%'` — **không** gõ
   cả `名称/代码`, nếu không sẽ không ra suggestion nào).
2. Chờ popper suggestion (`.el-popper` chứa `ul.el-autocomplete-suggestion > li`).
3. Click suggestion có text `名称/代码` (khớp chính xác `matchValue` trước, rồi tới tiều tố
   tên cảng).
4. Site tự cascade `*_PORT_COD` → extension đọc lại `*_PORT_COD` để verify.

**Sửa chọn dropdown cũ:** Element Plus giữ dropdown đã đóng trong DOM (ẩn, không unmount)
và Vue flush DOM trên microtask → phải **chỉ** dùng dropdown vừa mở (qua `aria-controls`,
hoặc dropdown mới nhất trong DOM), tuyệt đối không click vào dropdown đang ẩn.

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
│   │   ├── site-api.ts         dict của site (4 endpoint)
│   │   ├── mapping.ts
│   │   ├── default-mapping.ts
│   │   ├── dom.ts
│   │   ├── site.ts             từ vựng DOM của site
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

---

## 12. Kết quả xác minh trên site thật (2026-10-29)

- DOM dump của dialog 新增舱单信息: `docs/superpowers/specs/2026-10-26-dom-dump.md`
- Selector cảng dùng thực tế: `input[id$="-<prop>"]` (Element Plus gán
  `id = ${formId}-${prop}`) — dùng cho **mọi** field, kể cả 5 ô cảng; ô cảng
  được nhận diện qua `.el-autocomplete` chứ không phải `.el-select`.
- Shape thật của API dict: `getCntrCode/` → `data.cntr_type` + `data.cntr_size`
  (mảng **chuỗi thuần**) — đúng như `pickArray(cntrRaw, ['cntr_type'|'cntr_size'])`
  của extension.
- Các field không điền được và lý do: xem bảng bên dưới.

### 12.1 — Đã xác minh KHÔNG cần đăng nhập (bundle + API công khai)

| # | Mục | Kết quả |
|---|---|---|
| 1 | `manifest_version`, `content_scripts`, `host_permissions`, `options_page` | ✅ khớp 100% với plan (`npm run build` + đọc `dist/manifest.json`) |
| 2 | Nhãn option của 付款方式 | ✅ `请选择` / `预付`(`P`) / `到付`(`C`) / `免费`(`F`) — option **tĩnh**, adapter khớp theo **nhãn** |
| 3 | Kiểu DOM của 5 ô cảng | ✅ `el-autocomplete` (không phải input thường, không phải `el-select`) ⇒ đọc được qua `input.value` |
| 4 | Shape của `getCntrCode/` | ✅ `data.cntr_type` / `data.cntr_size` — mảng chuỗi |
| 5 | Nút lưu của dialog 货物信息 | ✅ đúng 2 nút `取消` + ` 保存 ` (có khoảng trắng), **không có `确定`** ⇒ bấm `保存` sau khi trim |
| 6 | Cơ chế cascade mã cảng | ✅ site tự tách `名称/代码` theo dấu `/` **cuối cùng** khi suggestion của ô *tên cảng* được chọn ⇒ cách extension gõ tên rồi click suggestion vẫn đúng |
| 7 | Field bắt buộc của form đầu | ✅ site có 2 danh sách (`ge` / `ye`, tuỳ 收货人 = `TO ORDER` hay không); extension khớp, phần `START_PORT_COD`/`DISCHRG_PORT_COD` được cover bằng cơ chế `verify` mã cảng |
| 8 | Field bắt buộc của dialog hàng | ✅ khớp `REQUIRED_BASE` / `REQUIRED_DANGER` / `REQUIRED_COLD` của extension |
| 9 | Field bắt buộc của bảng container | ✅ khớp `REQUIRED_CONTAINER` (6 field) |
| 10 | Enum vai trò `cabContacts[].type` | ⚠️ API trả **0/false = 发货人, 1/true = 收货人, 2 = 通知人** (bản ghi thật trả `2`, `true`, `false`) — `contactRole()` của extension đã xử lý đúng cả hai dạng |
| 11 | 包装类型 thật của API | ✅ `packType` / `packDesc` / `packSize` đều `null` ⇒ để trống `PACKAGE_STR`/`PACKAGE_COD` là đúng |
| 12 | Mã lỗi của API site | ✅ thành công = `2000`, hết phiên = `4000` (lỗi nằm trong HTTP 200) |

### 12.2 — Còn phải kiểm trên trình duyệt (cần đăng nhập)

| # | Mục | Trạng thái |
|---|---|---|
| 1 | Dump DOM thật của dialog + popper | ⏳ chưa chạy — xem `2026-10-26-dom-dump.md` mục A |
| 2 | 12 dòng checklist chức năng của Task 17 | ⏳ chưa chạy |
| 3 | **Cực tính `payType`** | ⏳ API trả `payType=false` cho `ONEYSHAGT1569600` ⇒ theo quy ước đã chốt extension chọn **到付 (`C`)**; cần đối chiếu bản ghi thật trên site |
| 4 | Cookie `token` có `HttpOnly` không | ⏳ chưa kiểm (không ảnh hưởng cơ chế chính `credentials: 'include'`) |

### 12.3 — Khoảng trống phát hiện khi xác minh

**`电话` (`*_TE_STR`) chưa được coi là field bắt buộc của extension.**

Site kiểm lúc bấm 确定: mỗi bên trong `[发货人, 收货人, 通知人]` phải có **ít nhất
một** trong `电话 / EMAIL / 传真` (trừ 收货人 khi 收货人名称 = `TO ORDER`), nếu
không thì báo `发货人联系方式未填写` / … . Extension chỉ điền được `电话` (từ
`cabContacts[].phone`) — EMAIL và FAX luôn để trống — nên khi API **không** có
`phone` cho một bên thì cả ba ô đều trống và site từ chối, trong khi báo cáo của
extension **không** đánh dấu field này là bắt buộc (`REQUIRED_HEADER` không có
`*_TE_STR`) ⇒ người dùng không biết vì sao form không submit được.

Bản ghi thật `ONEYSHAGT1569600` có `phone` cho cả 3 bên nên không gặp lỗi này.
Cần một task riêng để sửa (đưa `*_TE_STR` vào nhóm bắt buộc khi bên tương ứng
không có bất kỳ thông tin liên hệ nào).
