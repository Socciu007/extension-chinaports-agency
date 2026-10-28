import { describe, it, expect, beforeEach } from 'vitest'
import {
  findReusedCargoDialog,
  findVisibleCargoDialog,
  isHidden,
  isReusableCargoDialog,
  snapshotHiddenDialogs,
} from '../src/core/site'
import {
  buildCargoDialog,
  buildHeaderForm,
  buildPreMountedCargoDialog,
  hideDialog,
  showDialog,
} from './helpers/dom'

/** Ô E_CARGO_NAM (tên hàng) của dialog hàng — dùng để dựng dữ liệu dòng trước. */
function cargoNameInput(dialog: HTMLElement): HTMLInputElement {
  return dialog.querySelector<HTMLInputElement>('input[id$="-E_CARGO_NAM"]')!
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('isHidden', () => {
  it('coi phần tử có display:none là ẩn', () => {
    const el = document.createElement('div')
    el.style.display = 'none'
    document.body.appendChild(el)
    expect(isHidden(el)).toBe(true)
  })

  it('coi dialog là ẩn khi overlay RIÊNG của nó bị ẩn (v-show nằm trên .el-overlay)', () => {
    const dialog = buildCargoDialog()
    // `.el-dialog` KHÔNG bị đụng tới — chỉ overlay có display:none.
    expect(isHidden(dialog)).toBe(false)
    hideDialog(dialog)
    expect(isHidden(dialog)).toBe(true)
  })

  it('không coi dialog đang hiện là ẩn', () => {
    const dialog = buildCargoDialog()
    expect(isHidden(dialog)).toBe(false)
  })
})

describe('overlay của chính dialog', () => {
  it('overlay chứa CẢ 2 dialog thì không được nhận là overlay của riêng dialog nào', () => {
    // Một dialog hàng có overlay RIÊNG ⇒ overlay đó là overlay của chính nó.
    const lonely = buildCargoDialog()
    hideDialog(lonely)
    expect(isHidden(lonely)).toBe(true)

    // Thêm một dialog thứ hai vào CÙNG overlay ⇒ overlay không còn là overlay
    // riêng của dialog nào ⇒ không dialog nào bị coi là ẩn nữa.
    const overlay = lonely.closest<HTMLElement>('.el-overlay')!
    const sibling = document.createElement('div')
    sibling.className = 'el-dialog'
    overlay.querySelector('.el-overlay-dialog')!.appendChild(sibling)
    expect(isHidden(lonely)).toBe(false)
  })

  it('dialog hàng lồng trong dialog đầu không bị coi là ẩn khi overlay của dialog đầu ẩn', () => {
    buildHeaderForm()
    const header = document.getElementById('manifest-dialog')!
    // Dialog hàng KHÔNG teleport ⇒ nằm trong overlay của dialog đầu.
    const cargo = buildCargoDialog({ nestedCargoDialog: true })
    hideDialog(header)

    // Overlay của dialog đầu chứa cả 2 dialog ⇒ KHÔNG phải overlay riêng của
    // dialog hàng ⇒ đóng dialog đầu KHÔNG được coi là đóng dialog hàng.
    expect(isHidden(cargo)).toBe(false)
  })
})

describe('findReusedCargoDialog', () => {
  it('trả về dialog đã ẩn lúc chụp ảnh và giờ đã hiện lại, form đang trống', () => {
    const dialog = buildPreMountedCargoDialog()
    const beforeHidden = snapshotHiddenDialogs()
    // Site hiện lại đúng element cũ (không mount node mới).
    showDialog(dialog)
    expect(findReusedCargoDialog(beforeHidden)).toBe(dialog)
  })

  it('KHÔNG trả về dialog hàng còn dữ liệu của dòng trước (tránh ghi đè)', () => {
    const dialog = buildPreMountedCargoDialog()
    const beforeHidden = snapshotHiddenDialogs()
    showDialog(dialog)
    cargoNameInput(dialog).value = 'STEEL COIL'
    expect(findReusedCargoDialog(beforeHidden)).toBe(null)
  })

  it('KHÔNG trả về dialog đã hiện sẵn lúc chụp ảnh (người dùng tự mở)', () => {
    const dialog = buildCargoDialog()
    const beforeHidden = snapshotHiddenDialogs()
    expect(findReusedCargoDialog(beforeHidden)).toBe(null)
  })

  it('trả về null khi không có gì thay đổi', () => {
    buildPreMountedCargoDialog()
    const beforeHidden = snapshotHiddenDialogs()
    expect(findReusedCargoDialog(beforeHidden)).toBe(null)
  })
})

describe('isReusableCargoDialog', () => {
  it('false với node đã bị gỡ khỏi DOM', () => {
    const dialog = buildCargoDialog()
    dialog.remove()
    expect(isReusableCargoDialog(dialog)).toBe(false)
  })

  it('false với dialog đang ẩn', () => {
    const dialog = buildCargoDialog()
    hideDialog(dialog)
    expect(isReusableCargoDialog(dialog)).toBe(false)
  })

  it('false với dialog còn dữ liệu của dòng trước', () => {
    const dialog = buildCargoDialog()
    cargoNameInput(dialog).value = 'STEEL COIL'
    expect(isReusableCargoDialog(dialog)).toBe(false)
  })

  it('true với dialog đang hiện và form đã trống', () => {
    const dialog = buildCargoDialog()
    expect(isReusableCargoDialog(dialog)).toBe(true)
  })
})

describe('findVisibleCargoDialog', () => {
  it('trả về null khi dialog đang hiện còn dữ liệu của dòng trước', () => {
    const dialog = buildCargoDialog()
    cargoNameInput(dialog).value = 'STEEL COIL'
    expect(findVisibleCargoDialog()).toBe(null)
  })

  it('trả về dialog đang hiện khi form đã trống', () => {
    const dialog = buildCargoDialog()
    expect(findVisibleCargoDialog()).toBe(dialog)
  })
})
