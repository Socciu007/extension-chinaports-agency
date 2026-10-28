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
