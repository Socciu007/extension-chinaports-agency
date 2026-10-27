import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  pickFromSelect,
  pickFromPopper,
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

  it('gõ vào ô tìm kiếm của select có filter', async () => {
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
    expect(search.value).toBe('MAEU')
    expect(events).toContain('input')
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
})
