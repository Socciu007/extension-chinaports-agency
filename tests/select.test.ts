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
