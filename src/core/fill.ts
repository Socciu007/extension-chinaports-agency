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
