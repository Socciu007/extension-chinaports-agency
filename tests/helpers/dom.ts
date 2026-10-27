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
}

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

/** Section 货物信息 trong dialog đầu — bấm 新增 sẽ mở dialog hàng. */
function cargoSectionHtml(): string {
  return `<div class="CargoInformation">
      <div class="fs-crud-title">货物信息</div>
      <button class="el-button" id="add-cargo">新增</button>
    </div>`
}

/** Bảng container inline editable + section 箱信息. */
function containerSectionHtml(): string {
  const header = CONTAINER_COLUMNS.map((c) => `<th>${c}</th>`).join('')
  return `<div class="ContainerInformation">
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
    </div>`
}

/** Dialog đầu (舱单) — gồm form đầu + section hàng + bảng container. */
function headerDialogHtml(emptyPortCodes: boolean): string {
  return `<div class="el-dialog" id="manifest-dialog" style="display: block;">
      <div class="el-dialog__body">
        <div class="el-form">${headerFieldsHtml(emptyPortCodes)}</div>
        ${cargoSectionHtml()}
        ${containerSectionHtml()}
      </div>
      <div class="el-dialog__footer">
        <button class="el-button">取消</button>
        <button class="el-button el-button--primary">确定</button>
      </div>
    </div>`
}

/** Dialog hàng (24 field) — mở khi bấm 新增 trong section 货物信息. */
function cargoDialogHtml(): string {
  const fields = CARGO_PROPS.map(
    (prop) =>
      `<div class="el-form-item"><label class="el-form-item__label" for="el-id-c-${prop}">${prop}</label>
        <input id="el-id-c-${prop}" /></div>`,
  ).join('')

  return `<div class="el-dialog" id="cargo-dialog" style="display: block;">
      <div class="el-dialog__body">
        <div class="el-form">${fields}</div>
      </div>
      <div class="el-dialog__footer">
        <button class="el-button">取消</button>
        <button class="el-button el-button--primary">确定</button>
      </div>
    </div>`
}

/** Gắn sự kiện giả lập cho dialog vừa render: mở dialog hàng + thêm dòng container. */
function wireDialog(): void {
  const cargoAdd = document.getElementById('add-cargo')
  cargoAdd?.addEventListener('click', () => {
    if (document.getElementById('cargo-dialog')) return
    document.body.insertAdjacentHTML('beforeend', cargoDialogHtml())
  })

  const containerAdd = document.getElementById('add-container')
  containerAdd?.addEventListener('click', () => {
    const tbody = document.querySelector('.el-table__body tbody')
    if (!tbody) return
    const tr = document.createElement('tr')
    tr.innerHTML = CONTAINER_COLUMNS.map(() => '<td><input /></td>').join('')
    tbody.appendChild(tr)
  })
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
    <button class="el-button" id="add-manifest">新增舱单信息</button>
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

  if (dialogMode === 'static') {
    document.body.insertAdjacentHTML('beforeend', headerDialogHtml(emptyPortCodes))
    wireDialog()
    wirePortSuggestions(cascadePortCodes)
    return
  }

  if (dialogMode === 'lazy') {
    const addButton = document.getElementById('add-manifest')
    addButton?.addEventListener('click', () => {
      if (document.getElementById('manifest-dialog')) return
      document.body.insertAdjacentHTML('beforeend', headerDialogHtml(emptyPortCodes))
      wireDialog()
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
