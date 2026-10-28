# Live-site alignment brief — the manifest autofill extension

**Date:** 2026-10-27
**Status:** authoritative. Every "FACT" below was read out of the site's own compiled
JavaScript (public static assets, no authentication involved). Where this brief contradicts
the implementation plan or the existing code, **this brief wins**.

---

## How these facts were obtained

The site is a Vite build. Its public bundles are downloadable without a session:

```bash
curl -k https://www.chinaports-agency.com:8870/            # → index.html, lists /assets/index.<hash>.js
curl -k https://www.chinaports-agency.com:8870/assets/index.<hash>.js
```

The manifest page is a lazy chunk. From the main bundle's route table:

- route view → `assets/index.3ee881af.js`
- 待发送 (NotSent) tab → `assets/index.eacda48f.js`  ← the header form
- NotSent API client → `assets/crud.e7635061.js`
- CargoInformation → `assets/index.589991a9.js` + `assets/crud.838d96d5.js`
- ContainerDetails → `assets/index.9e049583.js` + `assets/crud.5286a2b2.js`

All the code below is quoted from those bundles.

---

## FACT 1 — the header form's exact field list

The site renders these `el-form-item`s (label → prop), in this order:

| label | prop | control |
|---|---|---|
| 提单号 | `BILL_NBR` | input |
| 船名 | `E_SHIP_NAM` | input |
| 航次 | `OUT_VOYAGE_NO` | input |
| 承运人代码 | `TRUST_COD` | **el-select** |
| 付款方式 | `PAY_WAY_ID` | **el-select** (static options) |
| 交货条款 | `DR_TYPE_STR` | **el-select** |
| 提单签发地/代码 | `SIGN_PLACE_STR` | **el-autocomplete** (+ `SIGN_PLACE_COD`) |
| 收货地（国内始发装货港） | `START_PORT_NAM` | **el-autocomplete** (+ `START_PORT_COD`) |
| 卸货港/代码 | `DISCHRG_PORT_NAM` | **el-autocomplete** (+ `DISCHRG_PORT_COD`) |
| 中转港/代码 | `TRANS_PORT_NAM` | **el-autocomplete** (+ `TRANS_PORT_COD`) |
| 交货地/代码 | `DEST_PORT_NAM` | **el-autocomplete** (+ `DEST_PORT_COD`) |
| 发货人名称 / 地址 / 国家代码 / AEO代码 / EMAIL / 传真 | `E_SHIPPER_NAM`, `SHIPPER_ADD_STR`, `SHIPPER_COUNTRY_COD`, `SHIPPER_AEO`, `SHIPPER_EM_STR`, `SHIPPER_FX_STR` | inputs |
| 收货人名称 / 地址 / 国家代码 / AEO代码 / EMAIL / 传真 | `E_CONSIGNEE_NAM`, `CONSIGNEE_ADD_STR`, `CONSIGNEE_COUNTRY_COD`, `CONSIGNEE_AEO`, `CONSIGNEE_EM_STR`, `CONSIGNEE_FX_STR` | inputs |
| 通知人名称 / 地址 / 国家代码 / EMAIL / 传真 | `E_NOTIFY_NAM`, `NOTIFY_ADD_STR`, `NOTIFY_COUNTRY_COD`, `NOTIFY_EM_STR`, `NOTIFY_FX_STR` | inputs |

**There is no `NOTIFY_AEO`.** Only `SHIPPER_AEO` and `CONSIGNEE_AEO` exist.
The port-code fields (`*_PORT_COD`) are real `el-form-item`s with an **empty label**.

The site's own "required fields" list for the header is:

```
BILL_NBR, E_SHIP_NAM, OUT_VOYAGE_NO, TRUST_COD, PAY_WAY_ID, DR_TYPE_STR,
START_PORT_COD, START_PORT_NAM, DISCHRG_PORT_NAM, DISCHRG_PORT_COD,
E_SHIPPER_NAM, SHIPPER_ADD_STR, E_CONSIGNEE_NAM, CONSIGNEE_ADD_STR, CONSIGNEE_COUNTRY_COD
```

---

## FACT 2 — 付款方式 (`PAY_WAY_ID`) has static options, and the **label** is what gets clicked

```js
paymentMethodOptions: [
  { value: "",  label: "请选择" },
  { value: "P", label: "预付" },
  { value: "C", label: "到付" },
  { value: "F", label: "免费" }
]
```

The dropdown renders `label` as the visible text and stores `value` in the model:

```js
S(T(Ie).paymentMethodOptions, e => s(g, { key: e.value, label: e.label, value: e.value }, null, 8, ["label","value"]))
```

**Consequences**

1. The site's stored values are `P` / `C` / `F`. The existing code writes `"0"` / `"1"`
   (`src/core/mapping.ts`) — that value does not exist in the dropdown.
2. The extension matches dropdown options **by their visible text**, so the value it must
   type/match is the **label** (`预付` / `到付` / `免费`), not the code.
3. The dadaex API only exposes a boolean `payType`. The user has decided:
   `payType === true` → `预付` (code `P`), `payType === false` → `到付` (code `C`).
   This polarity is still to be confirmed on the live site (Task 17).

---

## FACT 3 — the port fields are `el-autocomplete`, and the site cascades the code itself

```js
i(v, { label: "收货地（国内始发装货港）", prop: "START_PORT_NAM", class: "EntryOfManifestInformation" }, {
  default: u(() => [ i(D, {
    modelValue: T(Be).START_PORT_NAM,
    "fetch-suggestions": me,           // ← Element Plus el-autocomplete
    placeholder: "请输入收货地",
    "trigger-on-focus": true,
    "onSelect": e => T(Ae)(e, { type: "address", name: "START_PORT" }),
    "highlight-first-item": false,
  })])
})
```

The suggestion list is built by the site like this:

```js
me = async (e, l) => {                                  // e = the typed query
  let a = (await H({ kw: e.toUpperCase(), filter: "E_PORT_NAM" })).data || []
  a = a.map(e => ({ value: e.E_PORT_NAM + "/" + e.PORT_COD }))
  ...
}
```

So **every suggestion's text is `名称/代码`** (e.g. `上海/CNSHA`), and the query sent to the
server is the text the operator typed — **the whole `名称/代码` string must NOT be typed**,
because the server filters `E_PORT_NAM LIKE '%kw%'`.

The site's own `onSelect` handler fills **both** halves:

```js
Ae = function (e, { type, name }) {
  let t = e.value || ""                       // "上海/CNSHA"
  let o = name + "_NAM", _ = name + "_COD"
  if (name === "SIGN_PLACE") { o = name + "_STR"; _ = name + "_COD" }
  if (t.includes("/")) {
    let parts = t.split("/")
    Be.value[o] = parts.slice(0, -1).join("/")   // "上海"
    Be.value[_] = parts[parts.length - 1]       // "CNSHA"
  } else if (type === "address") { ... } else if (type === "code") { ... }
}
```

Note the split is on the **last** `/` — the same convention the extension must use.

**Consequences**

1. The extension only has to drive the **name** field (`START_PORT_NAM`,
   `DISCHRG_PORT_NAM`, `TRANS_PORT_NAM`, `DEST_PORT_NAM`). The site then fills the
   matching `*_PORT_COD` field itself → the existing `verify` on the code prop is valid.
2. The value the extension must **type** is the Chinese port name (`上海`).
3. The value the extension must **match** among the suggestions is `名称/代码`
   (`上海/CNSHA`).
4. The port name is available **directly from the dadaex API** — `loadPortData`,
   `uploadPortData`, `aimPortData` are `{ id, name, nameEn }` — so the site’s
   `getPort` dictionary is only a fallback.
5. `portNameField` (Chinese vs English) is **meaningless**: the site's widget only ever
   offers Chinese names (`filter: "E_PORT_NAM"`), so an English query returns nothing.
   **The user has decided to remove the setting.**

---

## FACT 4 — the site's dictionary endpoints and their real response shapes

All under `/api/booking/exportManifestDataMaintain/`:

| endpoint | method | params | consumed by the site as |
|---|---|---|---|
| `getTrustCode/` | GET | `{kw:""}` | `e.data.map(e => ({ value: e.TRUST_COD, label: e.TRUST_COD }))` |
| `getDrType/` | GET | `{kw:""}` | `e.data.map(e => ({ value: e, label: e }))` — **plain strings** |
| `getPort/` | GET | `{kw, filter}` — `filter` là `"E_PORT_NAM"` hoặc `"PORT_COD"` | `e.data.map(e => ({ value: e.E_PORT_NAM + "/" + e.PORT_COD }))` |
| `getCntrCode/` | GET | — | dict 箱型 + 尺寸 (chuỗi thuần) |
| `getPackageCode/` | GET | `{kw, filter}` — `filter` là `" E_PACKAGE_NAM"` / `" PACKAGE_COD"` (**có khoảng trắng ở đầu**) | dict 包装 |

Extension chỉ gọi **4** endpoint: `getTrustCode/`, `getDrType/`, `getCntrCode/`,
`getPort/`. **Không** gọi `getPackageCode/` — sau C-2 thì `PACKAGE_STR`/`PACKAGE_COD`
đều để trống ⇒ dict 包装 không có ai dùng.

Also present (and **never to be called** by this extension): `send/` (POST),
`upload/` (POST), `deleteBill/` (DELETE), `downloadTemplate/` (GET).

The envelope is `{ code, data, msg }` and **site errors are returned with HTTP 200**:
`{"code":4000,"data":null,"msg":"身份认证信息未提供。"}`.

---

## FIX LIST A — mapping values and DOM adapters

### A-1 `src/core/mapping.ts` — 付款方式

Replace the `"0"` / `"1"` mapping. The plan must produce the **label**:

```ts
/** 付款方式 của site: 预付='P', 到付='C', 免费='F'. Adapter click theo TEXT hiển thị. */
const PAY_WAY_OPTIONS: Record<'P' | 'C', { label: string; code: string }> = {
  P: { label: '预付', code: 'P' },
  C: { label: '到付', code: 'C' },
}
```

`payType === true` → `预付`; `payType === false` → `到付`; absent → `skip`.
The report note should mention the code so the operator can see what the site will store.

### A-2 `src/core/mapping.ts` — ports

For each of the three port groups:

- `value` = the **Chinese name to type** — `data.loadPortData?.name` (and the
  `uploadPortData` / `aimPortData` equivalents), falling back to the dictionary lookup.
- `matchValue` = `名称/代码` — `${name}/${code}` where `code` is `data.loadCode` /
  `data.uploadCode` / `data.aimPortCode`. (If the site's own `PORT_COD` differs, the
  prefix fallback still finds the right suggestion.)
- `verify` stays on the `*_PORT_COD` prop — the site fills it when the suggestion is clicked.

`TRANS_PORT_NAM` and `SIGN_PLACE_STR` stay `skip` (the API has no data for them).

### A-3 `src/core/mapping.ts` — drop `portNameField`

Remove `portNameField` from `MappingContext` and from every lookup that used it.
`findPort(code)` should return the Chinese name only.

### A-4 `src/core/mapping.ts` — `FieldPlan.matchValue`

Add an optional field so a plan can say "type this, but click the option whose text is
that":

```ts
export interface FieldPlan {
  prop: string
  label: string
  status: PlanStatus
  value?: string
  /** text của option cần click; mặc định bằng `value` */
  matchValue?: string
  note?: string
  verify?: { prop: string; note: string }
  columnLabel?: string
}
```

### A-5 `src/core/select.ts` — an `el-autocomplete` adapter

New export:

```ts
export async function pickFromAutocomplete(
  input: HTMLInputElement,
  value: string,
  timeout?: number,
  matchValue?: string,
): Promise<SetResult>
```

Behaviour:

1. Focus the input and set its value with the native setter + an `input` event
   (`typeIntoInput`) — this is what makes Element Plus call `fetch-suggestions`.
   **Do not** dispatch `change`/`blur` yet: blurring closes the suggestion popper.
2. Wait for the suggestion popper. Element Plus renders it as
   `.el-popper` containing `ul.el-autocomplete-suggestion > li`; the `li` text is
   `名称/代码`.
3. Pick the option: exact match on `matchValue` first, then an option whose text
   **starts with** `value`, then a `contains` match. Never click an invisible option.
4. Click it → Element Plus emits `update:modelValue` then `select` → the site's
   `onSelect` fills both the name and the code field.
5. Return `{ ok: true, strategy: 'autocomplete' }` (add `'autocomplete'` to
   `SetResult['strategy']`).

### A-6 `src/core/select.ts` — option matching gains a prefix tier

`findOptionIn(container, value, matchValue?)` ranks, each tier preferring a visible
element:

1. exact on `matchValue` (when given)
2. exact on `value`
3. **starts with** `value`  ← new, this is what the ports need
4. contains `value`

Guard: an empty `value` must match nothing (today `''.includes('')` matches the first
option).

### A-7 `src/core/select.ts` — the stale-dropdown defect (Critical)

`resolveDropdown` currently:

```ts
const controls = ariaControlsOf(trigger)
if (controls) {
  const linked = document.getElementById(controls)
  if (linked && visibilityProbe(linked)) return linked      // ← visibility gate
}
...
for (const cls of classes) {
  const visible = candidates.filter(el => el.classList.contains(cls) && visibilityProbe(el))
  if (visible.length > 0) return visible[visible.length - 1]!  // ← stale dropdown
}
```

Vue flushes the DOM on a **microtask**, so right after the trigger click the freshly
opened dropdown is not yet visible → the `aria-controls` branch is skipped → the
"last visible dropdown" branch returns a **stale, still-open dropdown from the previous
field**. The adapter then clicks an option in the wrong control and reports `ok: true`.
On the live site the five port fields share one option list, so this is a *successful
wrong write*.

Fix:

- When `aria-controls` resolves to an element, **return it even if it is not visible
  yet** — the option search will wait for it. Never fall back to "last visible" in that
  case.
- Only use the "last visible" fallback when there is **no** `aria-controls` linkage.
- `justOpened` must take the **newest** candidate (`.filter(...).pop()`), because Element
  Plus appends new poppers to `body`.

### A-8 `src/core/select.ts` — the popper's filter input

`pickFromPopper` currently grabs `popper.querySelector('input')` — the first input in the
popper, which may be the field's own readonly display input. Prefer a filter input that
is **not** `readonly`; if the only input is readonly, do not type into it.

### A-9 `src/core/select.ts` — do not type into a select's filter blindly

`pickFromSelect` types the value into `input:not([readonly])` unconditionally. If the
select filters on something other than the label, typing **removes** the target option.
Type only when the select has a non-readonly input **and** the option is not already
present in the dropdown.

### A-10 `src/core/select.ts` — close the dropdown when a pick fails

On failure, blur the trigger so Element Plus closes the popper; otherwise the next field
inherits a stale open dropdown (this is the trigger for A-7).

### A-11 `src/core/dom.ts` — route the control type at runtime

`setFieldValue` must detect, in this order:

1. `el.closest('.el-select')` → `pickFromSelect`
2. `el.closest('.el-autocomplete')` → `pickFromAutocomplete` (**new** — the port fields)
3. readonly input → `pickFromPopper`
4. plain input / textarea → `setTextValue`

The port fields are `el-autocomplete`, whose inner `<input>` is **not** readonly, so
without branch 2 they fall through to the text branch, which only types into the input —
no suggestion is ever clicked, the site never cascades the code, and the field is silently
wrong.

`readFieldValue` must also read an `el-select`'s current label out of
`.el-select__selected-item` (Element Plus does not put the label in `input.value`).

### A-12 `src/core/table.ts` — check for `.el-select` before looking for an `<input>`

Element Plus renders a non-filterable select's input as `<span class="el-select__input">`,
so the current "the cell has no input" guard rejects select cells before the select
branch runs. Test `cell.querySelector('.el-select')` first.

---

## FIX LIST B — the fillers (`src/core/fill.ts`, `src/core/table.ts`)

These come from the code-quality reviews of `f80d4f3` (Task 10) and `dabdf3b` (Task 11).

### B-1 The cargo dialog can be a stale one (Critical)

`fillCargoRows` clicks 新增, sleeps, then takes **any** `.el-dialog` containing
`E_CARGO_NAM` — including the previous row's dialog, which Element Plus keeps mounted.
If the new dialog has not appeared yet, row 2 is written into row 1's dialog and row 1 is
re-submitted.

Fix: snapshot the `.el-dialog` elements before the click and wait for a **new** one.

### B-2 Wait for the cargo row to be committed

After 保存, the site's `/cargo/add/` POST must land before the next row is opened.
Wait for the 货物信息 table's row count to increase (or the dialog to become hidden) with a
timeout, using a **separate** constant from the dialog-open delay.

### B-3 The 新增 button lookup

- Match `includes('新增')`, preferring an exact `新增` match (the site's buttons are
  `新增舱单信息`, `新增`, `新增货物信息` …).
- **Bound the upward walk** to the section: it currently climbs out of 货物信息 and can
  grab the container section's 新增, which on the live site opens a cargo dialog and adds
  a junk container row.

### B-4 The container table is never bounded (Important)

`findContainerTable` walks up from the title and returns the first `.el-table` it meets —
which may be the **cargo** table. The add-button lookup has the same problem. On the live
page the manifest dialog contains a cargo table *and* a container table.

Fix: compute the section root (the closest ancestor of the title that contains the table)
and constrain both lookups to it; **validate** the candidate table by checking that its
header contains `箱号`, and report `Could not find the container table` rather than
silently using the first table in the scope.

### B-5 The new container row is assumed to be the last one (Important)

`rowsNow[rowsNow.length - 1]` breaks if the table prepends the new row. Snapshot the row
elements before the click and pick the row that is **not** in the snapshot.

### B-6 The table and header handles go stale (Important)

`findContainerTable` and `readTableHandles(table)` are captured **once**, before the first
row is added. Element Plus re-renders the table when the data changes. Re-resolve the
table and re-read the header cells **inside** the loop.

### B-7 `rows` counts rows that were not filled

`rows` is reported to the operator as "cargo: N" / "containers: N". Count a row only when
at least one of its fields was actually written; otherwise record an error item.

### B-8 One bad row must not abort the rest

Wrap the per-row body in `try/catch`; replace the `rowsNow[rowsNow.length - 1]!`
non-null assertion with a real check.

### B-9 `nextFrame()` on the skip path is wasted time

17 of the 24 cargo plans are skips and the skip branch touches no DOM. Remove the
`await nextFrame()` from the skip branch.

### B-10 The report needs a row discriminator

The popup renders `:key="`${item.scope}-${item.prop}`"`. With N cargo rows the same 24
props repeat N times → duplicate Vue keys. Add `row?: number` to `FillItem` and include it
in the popup's key.

### B-11 Housekeeping

- Remove the unused `mapCargo` import in `tests/fill-cargo.test.ts`.
- `FillItem.scope` should reuse the exported `FillScope` union.
- Hoist the section/button lookup out of the per-row loop.
- Check `button.disabled` before clicking.
- `SetResult.strategy` should distinguish `'select'` from `'autocomplete'`.

### B-12 Tests that bite

The cargo and container tests currently pass even if the 新增 click, the 确定 click, or
the container row insert is deleted. Add:

- a click handler on 新增 that opens a **new** cargo dialog, and one on 保存 that records
  the click — assert both happened;
- `rows === 0` when 保存 is missing;
- row 2 lands in a **new** dialog, not row 1's;
- a scope containing **both** a cargo table and a container table → the container table
  gets the row and the container 新增 is the one clicked;
- two containers → two distinct rows with the right values;
- a cell rendered as an `el-select` (no `<input>`) → the select branch runs;
- the add button that never adds a row → `rows === 0` and one error item;
- an `el-autocomplete` port field → the suggestion is clicked and the code field is read
  back.

### B-13 Một dòng hàng **chưa chắc** đã được lưu (nguy hiểm)

FACT 5.3: với loại `S` thì **PACKAGE_COD và PACKAGE_STR là field bắt buộc** của site.
C-2 lại bắt buộc bỏ trống 2 field này (API không có 包装类型 thật) ⇒ bấm `保存` sẽ bị
site **từ chối** vì validation ⇒ dòng hàng **không** được thêm vào bảng danh sách.

Hiện `fillCargoRows` bấm `确定` (nút không tồn tại ⇒ không có gì được lưu) rồi
`rows += 1` ⇒ báo cáo nói "cargo: 1" trong khi thực tế **0 dòng** được lưu. Đây
đúng loại lỗi mà commit `4f2a3f0` đã sửa cho header — không được lặp lại.

Sửa: sau khi bấm `保存`, **kiểm tra kết quả thật** (dialog đóng lại **và/hoặc** số dòng
trong bảng `货物信息` tăng lên) trong một timeout. Nếu không → **không** cộng `rows`,
ghi 1 item ⚠️ nói rõ: *"the site did not accept the row — it requires 包装类型/代码
(PACKAGE_STR / PACKAGE_COD), please choose them on the page and save again"*.

### B-14 `note` phải đi tới báo cáo cả khi field ghi **thành công**

`fillPlans` hiện chỉ copy `plan.note` vào item khi `status !== 'ok'` ⇒ các note như
*"The site stores the code \"P\" for \"预付\""* (PAY_WAY_ID) hoặc mã `货物标识` bị **mất**.

Sửa: item `ok` cũng mang `note` (chỉ những field có note mới có) ⇒ người dùng đối
chiếu được mã mà site lưu.

### B-15 Header form cũng có thể **không** được lưu (khi auto-submit)

C-4 bỏ trống 尺寸/箱型/箱状态 — cả 3 là field **bắt buộc** của site ⇒ nếu người dùng
bật auto-submit, site sẽ từ chối form (dialog vẫn mở) vì container chưa đủ dữ liệu.

Sửa: sau khi bấm `确定` (auto-submit), kiểm tra dialog có đóng lại không; còn mở ⇒
báo ⚠️ *"the site did not accept the form — the container rows still require 尺寸 / 箱型 /
箱状态"*, tuyệt đối không báo thành công.

---

## FACT 5 — the cargo dialog (`货物信息`) — 24 field, control types thật

Nguồn: `CargoInformation/index.vue` (`index.589991a9.js`) + `crud.tsx` (`crud.838d96d5.js`).

**Tiêu đề dialog là `货物信息`, KHÔNG phải `新增货物信息`.** Nút `新增` là nút trên
**toolbar của bảng** (actionbar-left) mở dialog này.

**Nút lưu của dialog là `保存`** (footer: `取消` + ` 保存 `) — **KHÔNG phải `确定`**.
(`确定` chỉ xuất hiện trong hộp thoại xác nhận xoá: `确定要删除这条货物信息吗？`.)

### 5.1 Bảng 24 field theo thứ tự DOM thật

| # | prop | label | control | option value | option label (text hiển thị) |
|---|---|---|---|---|---|
| 1 | `CARGO_KIND_COD` | 货物标识 | **el-select** | `S`/`D`/`R`/`G` | 普货 / 危险品 / 冷藏品 / 危险品+冷藏品 |
| 2 | `CARGO_HS_COD` | HS编码 | el-input | — | — |
| 3 | `PACKAGE_STR` | 包装类型/代码 | **el-autocomplete** | `名称/代码` | `名称/代码` |
| 4 | `PACKAGE_COD` | (label rỗng) | **el-autocomplete** | `名称/代码` | `名称/代码` |
| 5 | `PIECE_NUM` | 包装件数 | el-input | — | — |
| 6 | `GWEIGHT_TON` | 货物毛重（公斤） | el-input | — | — |
| 7 | `GVOL_NUM` | 货物体积（m³） | el-input | — | — |
| 8 | `NWEIGHT_TON` | 货物净重（公斤） | el-input | — | — |
| 9 | `MARK_STR` | 唛头 | el-input (textarea) | — | — |
| 10 | `E_CARGO_NAM` | 货物描述 | el-input (textarea) | — | — |
| 11 | `DANG_CLASS_NAM` | 危险品类别 | el-input | — | — |
| 12 | `DANG_PAGE_NO` | 危险品页号 | el-input | — | — |
| 13 | `DANG_UN_NO` | 危险品联合国编号 | el-input | — | — |
| 14 | `DANG_LABLE_STR` | 危险品标签 | el-input | — | — |
| 15 | `DANG_FLASH_POINT` | 危险货物闪点（摄氏） | el-input | — | — |
| 16 | `DANG_EMS_NO` | 船运危险品应急措施号 | el-input | — | — |
| 17 | `DANG_MFAG_NO` | 医疗急救指南号 | el-input | — | — |
| 18 | `DANG_CONTACTSTR` | 应急联系 | el-input | — | — |
| 19 | `DANGER_CONTACT_NAM` | 危险品联系人姓名 | el-input | — | — |
| 20 | `DANGER_TE_STR` | 危险品联系人电话 | el-input | — | — |
| 21 | `DANGER_EM_STR` | 危险品联系人邮箱 | el-input | — | — |
| 22 | `DANGER_FX_STR` | 危险品联系人传真 | el-input | — | — |
| 23 | `TEMP_ID` | 温度计量单位 | **el-select** | `C`/`F` | 摄氏 / 华氏 |
| 24 | `SET_TEMP_NUM` | 设置温度 | el-input | — | — |

**Đủ 24 prop, không thừa không thiếu** — chỉ khác thứ tự so với plan (plan đặt
`DANG_PAGE_NO` sau `DANG_UN_NO`).

Chỉ **2** field là `el-select` (`CARGO_KIND_COD`, `TEMP_ID`); **2** field là
`el-autocomplete` (`PACKAGE_STR`, `PACKAGE_COD`); phần còn lại là `el-input`.

### 5.2 `getPackageCode/` — suggestion của 2 field 包装

```js
W=async(e,l)=>{ … (await S({kw:e.toUpperCase(),filter:" E_PACKAGE_NAM"})).data||[];
  r=r.map(e=>({value:e.E_PACKAGE_NAM+"/"+e.PACKAGE_COD})) … }
z=async(e,l)=>{ … (await S({kw:e.toUpperCase(),filter:" PACKAGE_COD"})).data||[];
  r=r.map(e=>({value:e.E_PACKAGE_NAM+"/"+e.PACKAGE_COD})) … }
```

- Option là `{value: "名称/代码"}` — **không có `label`**, chuỗi `名称/代码` vừa là text
  hiển thị vừa là giá trị được chọn.
- `filter` của 2 endpoint này **có khoảng trắng ở đầu** (`" E_PACKAGE_NAM"`,
  `" PACKAGE_COD"`), khác `getPort/` (`"E_PORT_NAM"`).
- Handler chọn của site **ghi cả 2 field** dù chọn ở autocomplete nào:
  ```js
  Z=function(e,l){let a=e.value||"";
    if(a.includes("/")){let e=a.split("/");H.value.PACKAGE_STR=e[0],H.value.PACKAGE_COD=e[1]}
    else "address"==l.type?H.value.PACKAGE_STR=a:"code"==l.type&&(H.value.PACKAGE_COD=a)}
  ```
- `PACKAGE_COD` bắt buộc **đúng 2 ký tự**; `PACKAGE_STR` ≤ 35 ký tự, chỉ half-width.

### 5.3 Quy tắc bắt buộc của site theo loại hàng

12 field nguy hiểm bị **xoá và disable** trừ khi loại là `D`/`G`; `TEMP_ID`/
`SET_TEMP_NUM` bị xoá và disable trừ khi loại là `R`/`G`.

| loại | field bắt buộc |
|---|---|
| `S` 普货 | CARGO_KIND_COD, PACKAGE_COD, PACKAGE_STR, PIECE_NUM, GWEIGHT_TON, GVOL_NUM, MARK_STR, E_CARGO_NAM |
| `D` 危险品 | + DANG_CLASS_NAM, DANG_UN_NO, DANGER_CONTACT_NAM, DANGER_TE_STR |
| `R` 冷藏品 | + TEMP_ID, SET_TEMP_NUM |
| `G` 危险品+冷藏品 | S + D + R |

Danh sách trên đọc thẳng từ object rule `Gl` của bundle `index.589991a9.js` — mỗi
field đều có `{ required: !0, … }` **cộng** thêm validator định dạng:

| field | validator định dạng (ngoài `required`) |
|---|---|
| `PIECE_NUM` | `Ie = /^.{1,7}$/`, `ye = /^\d*$/` ⇒ **chỉ số nguyên** |
| `GWEIGHT_TON` | `Ve`, `Ke = /^(?!\.)\d{1,9}(?:\.\d{1,3})?$/` ⇒ tối đa 3 chữ số thập phân |
| `GVOL_NUM` | `Le`, `Ue = /^(?!.{10,})(?!\.)\d{1,5}(?:\.\d{1,3})?$/` |
| `PACKAGE_COD` | `Se = /^.{2}$/` ⇒ **đúng 2 ký tự**, `Me = /^[A-Za-z0-9]*$/` |
| `PACKAGE_STR` | `he = /^.{1,35}$/`, `Pe = /^[ -~]*$/` (không full-width) |
| `MARK_STR` | `$e = /^.{1,512}$/`, `qe = /^[ -~]*$/` |
| `E_CARGO_NAM` | `we = /^.{1,1024}$/`, `Fe = /^[ -~]*$/` |

Khi validate fail, site hiện lỗi **`请填必填表格`** và **không** POST ⇒ dòng hàng
không được lưu (⇒ B-13).

### 5.4 Endpoint của dialog

`POST /api/booking/exportManifestDataMaintain/cargo/add/` (thêm) và
`/cargo/update/` (sửa). Payload qua `keyToLowercase` → **wire format là snake_case
thường** (`piece_num`, `gweight_ton`, `cargo_kind_cod`) trong khi model của form là
UPPER_CASE.

Bảng **danh sách** hàng (không phải dialog) có 12 cột và **đổi mã thành nhãn tiếng
Trung khi hiển thị**: `CARGO_KIND_COD` → 普货/危险品/冷藏品/危险品+冷藏品,
`TEMP_ID` → 摄氏/华氏. Nếu extension đọc bảng danh sách thì sẽ thấy text, không thấy mã.

---

## FACT 6 — bảng container (`箱信息`) — 9 cột, inline editable

Nguồn: `ContainerDetails/index.vue` (`index.9e049583.js`) + `crud.tsx` (`crud.5286a2b2.js`).

| cột | prop | control | option value | option label | ghi chú |
|---|---|---|---|---|---|
| 箱号 | `CNTR_NO` | el-input | — | — | `^[A-Z0-9]{1,11}$`, bắt buộc |
| 尺寸 | `CNTR_SIZE_COD` | **el-select** | chuỗi của `getCntrCode().cntr_size` | **giống value** | bắt buộc |
| 箱型 | `CNTR_TYPE_COD` | **el-select** | chuỗi của `getCntrCode().cntr_type` | **giống value** | bắt buộc |
| 箱状态 | `CNTR_EF_ID` | **el-select** | `F`/`L`/`E` | 整箱 / 拼箱 / 空箱 | bắt buộc |
| 铅封号 | `SEAL_NO` | el-input | — | — | bắt buộc; khi 箱状态 = `E` thì bị ép `"EMPTY"` + disable |
| 货物件数 | `PIECE_NUM` | el-input | — | — | `^[0-9]{1,6}$` |
| 箱内货重（公斤） | `WEIGH_TON` | el-input | — | — | |
| 箱内体积 | `VOLUME_NUM` | el-input | — | — | |
| 货主箱标志 | `SOC_ID` | **el-select** | `Y`/`N` | 货主箱 / 非货主箱 | bắt buộc |

**Đủ 9 cột, không thừa không thiếu.** Mọi cột đều inline-editable, không có cột
read-only, không có dialog sửa.

### 6.1 Nút thêm dòng — chèn vào **đầu** bảng

```js
addRow:{show:!0,text:"新增",click:async e=>{""!=i.BILL_NO&&r.insertTableRow(0,{}),i.crudPassByValue({type:"addRow"})}}
```

`insertTableRow(0,{})` → `data.splice(0, 0, {})` → **dòng mới nằm ở index 0**, không
phải cuối bảng. Đây là lý do "dòng mới = dòng cuối" **sai**.

Nút là `新增` (không phải `添加`); nút `add` chung của fs-crud bị ẩn (`show:!1`).

### 6.2 `getCntrCode/` — item là **chuỗi thuần**, không có id

```js
await e({url:"/api/booking/exportManifestDataMaintain/getCntrCode/",method:"get"}).then(e=>{
  c.value.boxData=e.data.cntr_type.map(e=>({value:e,label:e})),
  c.value.sizeData=e.data.cntr_size.map(e=>({value:e,label:e}))});
```

- Không có query param.
- `data` là **object** có đúng 2 key: `cntr_type` (箱型) và `cntr_size` (尺寸) — tên
  **ngược** với trực giác.
- **Item là chuỗi thuần** (`"40"`, `"HQ"`) — option value == option label == chuỗi đó.
  **Không hề có** sub-field `id`/`code`/`name` nào được đọc ở bất kỳ đâu trong bundle.

⇒ Vì dict chỉ có chuỗi, **không thể tra `cType`/`vC` (mã số của API) ra 箱型/尺寸**.
Danh sách trong file Excel template của site cho thấy giá trị thật:
尺寸 `["20","22","24","30","40","45","53"]`, 箱型 `["BK","FL","FR","GH","GP","HC",…]`.

### 6.3 Endpoint khác

- `POST /computePgv/` — body `{cargo_list:[{piece_num, gweight_ton, gvol_num}]}` →
  `{total_piece_num, total_gweight_ton}`. Nó **cộng** các dòng container để hiện chỉ số
  箱内总件数/箱内总毛重, **không** phân bổ gì cả. Được gọi khi blur `PIECE_NUM`/
  `WEIGH_TON` hoặc xoá dòng.
- `POST /checkCntrNo/` — body `{cntr_no}` khi blur ô 箱号; **client không đọc kết quả**
  (fire-and-forget).
- Bảng container dùng `mode:"local"` ⇒ **không** POST từng dòng; toàn bộ `cntr_list`
  được gửi kèm khi lưu form đầu.

### 6.4 Mã thành công của API site là **2000**, không phải 200

```js
2e3==e.code ? … : …
```

---

## FIX LIST C — mapping của hàng hóa và container

Nguồn: FACT 5 + FACT 6 + fixture `tests/fixtures/manifest-ONEYSHAGT1569600.json`.

### C-1 `CARGO_KIND_COD` phải là **nhãn**, không phải mã

Adapter khớp option theo **text hiển thị** → phải trả `普货` / `危险品` / `冷藏品` /
`危险品+冷藏品`, không phải `S`/`D`/`R`/`G`. Giá trị mã chỉ để **ghi chú** trong báo cáo
để người dùng đối chiếu.

### C-2 `PACKAGE_STR` + `PACKAGE_COD` → **skip + ghi chú**

API không cung cấp *包装类型 thật*:
- `cdgoods[].unit` = `"PACKAGES"` — đơn vị đếm chung, **không** phải tên 包装 trong dict
  của site (dict là tiếng Trung: 纸箱/…).
- `cdgoods[].packType` = `null`, `packDesc` = `null`.

Ghi `PACKAGES` vào `PACKAGE_STR` là ghi rác vào tờ khai hải quan, và `PACKAGE_COD`
bắt buộc đúng 2 ký tự thì không dựng được. → Cả 2 field: `skip` + ghi chú nói rõ
người dùng phải chọn 包装类型/代码 trên site.

### C-3 `SOC_ID` (货主箱标志) phải là **nhãn**, không phải mã

Option của site là `{label:"货主箱", value:"Y"}` / `{label:"非货主箱", value:"N"}`.
Adapter khớp option theo **text hiển thị** ⇒ phải ghi **`货主箱` / `非货主箱`**, không
phải `'Y'`/`'N'` cũng không phải `'1'`/`'0'`.

`cdCon[].self` là boolean: `true` → `货主箱`; `false` → `非货主箱`.

> Cùng lý do với C-1: mọi `el-select` của site đều hiển thị **nhãn**, mã chỉ nằm
> trong model. Ghi mã vào là adapter không tìm thấy option nào khớp ⇒ field đó bị
> báo ⚠️ "không chọn được" dù dữ liệu đã có.

### C-4 `CNTR_SIZE_COD` + `CNTR_TYPE_COD` + `CNTR_EF_ID` → **skip + ghi chú**

- 尺寸/箱型: `cType`/`vC` của API là **mã số**, còn dict của site chỉ có **chuỗi**
  (FACT 6.2) ⇒ **không tra được** (xem C-5).
- 箱状态: API không có dữ liệu nào tương ứng.

Cả 3 đều là field **bắt buộc** của site → ghi chú phải nói rõ *"the site requires this —
the API does not provide it, please choose it on the page"* để người dùng biết cần
làm tay, chứ không phải coi như đã xong.

### C-5 `findCntrType` / `findCntrSize` phải tra được dict chuỗi

Dict `getCntrCode/` trả **chuỗi thuần** ⇒ `normalizeDictOptions` phải nhận phần tử
chuỗi và `findCntrType`/`findCntrSize` phải so khớp bằng **chuỗi**, không phải `id` số.
Với dữ liệu API hiện có (`cType: 2`, `vC: 0`) tra sẽ **không ra** ⇒ kết quả là skip
(C-4), không phải điền sai.

> Phần **dict** của C-5 nằm ở `src/core/site-api.ts` (`normalizeDictOptions` +
> `createMappingContext`) — tức **Task 13**, không phải Fix C. Fix C chỉ lo phía
> *mapping* (dùng kết quả tra để quyết định fill hay skip + ghi chú).

### C-6 Bảng **danh sách** hàng hiển thị nhãn, không phải mã

Cột `货物标识` của bảng danh sách hiện `普货` (không phải `S`) và `温度计量单位` hiện
`摄氏` (không phải `C`). Nếu extension verify bằng cách đọc bảng danh sách thì phải
so khớp nhãn.

### C-7 `MARK_STR` (唛头) lấy từ `shantou`, **không** phải `sign`

Fixture thật: `cdgoods[0].shantou = "N/M"`, `cdgoods[0].sign = null`.

`shantou` là cách viết pinyin của **唛头** (mào tóu) — đúng field 唛头, và giá trị
`"N/M"` (= *No Marks*) chính là giá trị mặc định của 唛头 khi hàng không có ký hiệu.
`sign` là field khác và **null** trong dữ liệu thật.

⇒ `MARK_STR` lấy `goods.shantou ?? goods.sign` (ưu tiên `shantou`, fallback `sign`).
`ManifestCargo` phải có thêm `shantou?: string | null`.

Trước khi sửa, `MARK_STR` luôn bị skip ⇒ dòng hàng thiếu 1 field bắt buộc của site
(FACT 5.3) ⇒ `保存` bị từ chối ⇒ **0 dòng** được lưu.

### C-8 Note của field **bắt buộc** của site phải nói rõ "cần làm tay"
FACT 5.3 liệt kê field bắt buộc theo từng loại hàng. Mọi field đó mà bị skip phải
mang note *"the site requires this — the API provides no data, please fill it in on the
page"*, **không** phải note chung chung *"The API provides no data for this field"*.

- Loại `S` (và `G`): `CARGO_KIND_COD`, `PACKAGE_COD`, `PACKAGE_STR`, `PIECE_NUM`,
  `GWEIGHT_TON`, `GVOL_NUM`, `MARK_STR`, `E_CARGO_NAM`.
- Loại `D` (và `G`): + `DANG_CLASS_NAM`, `DANG_UN_NO`, `DANGER_CONTACT_NAM`,
  `DANGER_TE_STR`.
- Loại `R` (và `G`): + `TEMP_ID`, `SET_TEMP_NUM`.

Note phải **chuyên biệt** theo lý do thật:
- `PACKAGE_STR` / `PACKAGE_COD` → *"the API's `unit` is a generic counting unit
  (PACKAGES), not a packaging type — please choose 包装类型/代码 on the page"*.
- `CNTR_SIZE_COD` / `CNTR_TYPE_COD` → *"the API gives numeric codes (cType/vC) but the
  site's dictionary only holds plain strings, so 尺寸/箱型 cannot be resolved — please
  choose it on the page"*.
- `CNTR_EF_ID` (箱状态) → *"the API provides no container status — please choose it on
  the page"*.

### C-9 `PIECE_NUM` của dòng hàng phải là **số nguyên**, không phải `"114.000"`

Đọc thẳng rule của site trong bundle `index.589991a9.js` (object `Gl`):

```js
PIECE_NUM: [
  { required: !0, message: "请输入包装件数", trigger: "change" },
  { validator: De(Ie, "输入字符超长，最大允许7"), trigger: "blur" },
  { validator: De(ye, "只允许整数"), trigger: "blur" },   // ye = /^\d*$/
],
```

`ye = /^\d*$/` ⇒ **`PIECE_NUM` không được có dấu chấm thập phân**. Nhưng API trả
`cdgoods[0].amount = "114.000"` ⇒ validate fail ⇒ site hiện lỗi **`请填必填表格`** và
**không** POST ⇒ dòng hàng không được lưu.

Các field số khác vẫn OK vì rule của chúng cho phép tối đa 3 chữ số thập phân:
`GWEIGHT_TON` (`Ke = /^(?!\.)\d{1,9}(?:\.\d{1,3})?$/`) nhận `"22400.000"`,
`GVOL_NUM` (`Ue`) nhận `"60.130"`.

⇒ `PIECE_NUM` phải ghi **phần nguyên**: `"114.000"` → `"114"`.

> Bên container, `cdCon[0].amount` đã là **số** `114` ⇒ `String(114)` = `"114"` ⇒
> vốn đã hợp lệ, nhưng vẫn nên áp cùng một quy tắc để không phụ thuộc vào kiểu dữ liệu.

Ghi chú thêm từ bundle: site **upper-case mọi field chuỗi** trước khi POST
(`for (let l in e) "string" == typeof e[l] && (e[l] = e[l].toUpperCase())`), và model mặc
định của form hàng là `MARK_STR: "N/M"`, `CARGO_KIND_COD: "S"` — xác nhận `N/M` là giá
trị mặc định của 唛头 (⇒ C-7 đúng).

---

## FIX LIST D — nút lưu của dialog hàng là `保存`, dòng container chèn ở đầu

### D-1 Nút lưu trong dialog 货物信息 là `保存`

`fillCargoRows` hiện bấm `确定` — nút đó **không tồn tại** trong dialog hàng (chỉ có
`取消` và `保存`). Phải bấm `保存`.

### D-2 Dòng container mới nằm ở **index 0**

`insertTableRow(0, {})` ⇒ dòng mới là dòng **đầu tiên**. B-5 (snapshot trước, chọn
dòng không nằm trong snapshot) vẫn đúng, nhưng **không** được giả định "dòng cuối".

---

## FIX LIST E — làm rõ 2 điểm reviewer nêu trong review của FIX LIST A

Hai điểm này **làm rõ** A-7 và A-5 (không đổi phạm vi), do reviewer spec đặt ra.

### E-1 Phân biệt "dropdown vừa mở" với "dropdown hiển thị cuối cùng"

A-7 cấm fallback sang *"dropdown hiển thị cuối cùng"* — đó mới là nguồn của lỗi ghi
nhầm. Nhưng nhánh *"dropdown vừa mở"* (`justOpened`: không có trong DOM **hoặc** đang
ẩn trước khi click) thì **an toàn** theo construction: dropdown đang mở của field
trước luôn *đã hiển thị* trước khi ta click ⇒ không bao giờ lọt vào `justOpened`.

Vì vậy thứ tự đúng là:

1. `aria-controls` **resolve được** → trả về dropdown đó, **kể cả khi đang ẩn**.
2. `aria-controls` **chưa** resolve (popper của Element Plus mount lazy) → vẫn thử
   nhánh `justOpened`.
3. Chỉ khi **không có** liên kết `aria-controls` mới được dùng nhánh "hiển thị cuối
   cùng".

Nếu bỏ qua bước 2 thì mọi `el-select` trên site sẽ timeout (popper chưa mount ⇒
`getElementById` trả null ⇒ không còn đường nào để tìm dropdown).

### E-2 Selector của `el-autocomplete` không được dùng chung

A-5 thêm `.el-autocomplete-suggestion li` vào `OPTION_SELECTORS` — nhưng danh sách đó
dùng chung cho `pickFromSelect` / `pickFromPopper`. Trên site, 5 ô cảng **dùng chung
một** list gợi ý; nếu list đó nằm trong popper mà `pickFromPopper` resolve được cho
field khác thì adapter popper có thể click nhầm suggestion của cảng ⇒ **ghi sai mà
báo `ok`**.

⇒ `pickFromAutocomplete` phải có **danh sách selector riêng**; `findOptionIn` dùng
chung cho select/popper thì **không** được chứa `.el-autocomplete-suggestion li`.

---

## Decisions taken by the user (2026-10-27)

| Question | Decision |
|---|---|
| 付款方式 polarity | `payType === true` → `预付` (`P`); `payType === false` → `到付` (`C`) |
| `portNameField` setting | **Remove** — the site's port widget only offers Chinese names |
| Header auto-submit | Still opt-in only (unchanged) |
| `send/` / `upload/` | Never called (unchanged) |
| `*_AEO` | Left blank with a note (unchanged) |
