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
