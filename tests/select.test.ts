import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  pickFromSelect,
  pickFromPopper,
  pickFromAutocomplete,
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

  it('ưu tiên option bắt đầu bằng giá trị (mức "starts with")', () => {
    document.body.innerHTML = `
      <div class="el-popper">
        <li class="el-select-dropdown__item">舟山上海</li>
        <li class="el-select-dropdown__item">上海港</li>
      </div>`
    const popper = document.querySelector('.el-popper')!
    // "舟山上海" chỉ *chứa* "上海", còn "上海港" *bắt đầu* bằng "上海".
    expect(findOptionIn(popper, '上海')?.textContent?.trim()).toBe('上海港')
  })

  it('giá trị rỗng thì không khớp option nào', () => {
    document.body.innerHTML = `
      <div class="el-popper">
        <li class="el-select-dropdown__item">上海</li>
      </div>`
    const popper = document.querySelector('.el-popper')!
    expect(findOptionIn(popper, '')).toBeNull()
    expect(findOptionIn(popper, '   ')).toBeNull()
  })

  it('khớp chính xác theo matchValue trước mức "starts with"', () => {
    document.body.innerHTML = `
      <div class="el-popper">
        <li class="el-select-dropdown__item">上海港/SHA</li>
        <li class="el-select-dropdown__item">上海/CNSHA</li>
      </div>`
    const popper = document.querySelector('.el-popper')!
    expect(findOptionIn(popper, '上海', '上海/CNSHA')?.textContent?.trim()).toBe('上海/CNSHA')
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
    // Thông điệp phải nêu rõ loại option (đồng bộ với nhánh "is not visible").
    expect(result.reason).toContain('Could not select the option "KHONG_CO"')
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

  it('lấy dropdown theo aria-controls dù nó chưa hiển thị, không dùng dropdown cũ', async () => {
    // Vue flush DOM ở microtask → ngay sau click, popper mới vẫn đang ẩn.
    // Nếu adapter fallback sang "dropdown hiển thị cuối cùng" thì nó sẽ bấm
    // nhầm vào dropdown cũ của field trước và báo thành công (ghi sai chỗ).
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper" aria-controls="dd-target">
            <input class="el-select__input" readonly />
          </div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd-stale">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>
      <div class="el-select-dropdown" id="dd-target">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    let opened = false
    setVisibilityProbe((el) =>
      el.closest('#dd-target') ? opened : el.closest('[data-hidden]') === null,
    )
    const wrapper = document.querySelector('.el-select__wrapper') as HTMLElement
    wrapper.addEventListener('click', () => {
      setTimeout(() => {
        opened = true
      }, 0)
    })

    const clicks: string[] = []
    const stale = document.querySelector('#dd-stale .el-select-dropdown__item') as HTMLElement
    const target = document.querySelector('#dd-target .el-select-dropdown__item') as HTMLElement
    stale.addEventListener('click', () => clicks.push('stale'))
    target.addEventListener('click', () => clicks.push('target'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 2000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['target'])
  })

  it('aria-controls chưa resolve thì vẫn dùng được dropdown vừa mở', async () => {
    // Element Plus mount popper lazily: lúc click, id trong `aria-controls` có
    // thể chưa có trong DOM. Nếu adapter trả về null ngay thì mọi el-select
    // trên site (承运人代码 / 付款方式 / 交货条款) đều timeout.
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper" aria-controls="dd-lazy">
            <input class="el-select__input" readonly />
          </div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd-just-opened">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    let opened = false
    setVisibilityProbe((el) =>
      el.closest('#dd-just-opened') ? opened : el.closest('[data-hidden]') === null,
    )
    const wrapper = document.querySelector('.el-select__wrapper') as HTMLElement
    wrapper.addEventListener('click', () => {
      setTimeout(() => {
        opened = true
      }, 0)
    })

    const clicks: string[] = []
    const option = document.querySelector('#dd-just-opened .el-select-dropdown__item') as HTMLElement
    option.addEventListener('click', () => clicks.push('just-opened'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 2000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['just-opened'])
  })

  it('khi nhiều dropdown cùng vừa mở thì lấy dropdown MỚI NHẤT', async () => {
    // Element Plus append popper mới vào cuối `body` → dropdown mới nhất nằm
    // cuối DOM. Lấy nhầm dropdown cũ sẽ ghi sai field mà vẫn báo thành công.
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd-old">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>
      <div class="el-select-dropdown" id="dd-new">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    let opened = false
    setVisibilityProbe((el) => {
      const dropdown = el.closest('#dd-old, #dd-new')
      return dropdown ? opened : el.closest('[data-hidden]') === null
    })
    const wrapper = document.querySelector('.el-select__wrapper') as HTMLElement
    wrapper.addEventListener('click', () => {
      opened = true
    })

    const clicks: string[] = []
    const oldOption = document.querySelector('#dd-old .el-select-dropdown__item') as HTMLElement
    const newOption = document.querySelector('#dd-new .el-select-dropdown__item') as HTMLElement
    oldOption.addEventListener('click', () => clicks.push('old'))
    newOption.addEventListener('click', () => clicks.push('new'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 1000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['new'])
  })

  it('select không click nhầm suggestion của el-autocomplete', async () => {
    // 5 ô cảng dùng chung một list gợi ý `名称/代码`; adapter của select
    // không được bấm vào suggestion đó (ghi sai chỗ, báo thành công).
    // Fixture phải giống markup thật: popper của site có CẢ `el-popper` (đó là
    // điều khiến `.el-popper li` trong OPTION_SELECTORS bắt được suggestion).
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-select-dropdown el-popper" id="dd">
        <ul class="el-autocomplete-suggestion">
          <li>上海/CNSHA</li>
        </ul>
      </div>`

    const suggestion = document.querySelector('.el-autocomplete-suggestion li') as HTMLElement
    let clicked = 0
    suggestion.addEventListener('click', () => {
      clicked += 1
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, '上海', 300)

    // Cả hai phía: KHÔNG click suggestion, và adapter không được báo thành công.
    expect(clicked).toBe(0)
    expect(result.ok).toBe(false)
  })

  it('khi trang có cả popper lẫn select-dropdown thì lấy phần tử MỚI NHẤT trong DOM', async () => {
    // `collectByClasses` gom theo thứ tự ưu tiên class → `.pop()` trả về
    // `.el-popper` cuối cùng, KHÔNG phải phần tử mới nhất. Ở đây popper
    // (giống tooltip/popper của field khác) đứng trước dropdown trong DOM và
    // cũng "vừa hiện" → adapter phải chọn dropdown, không phải popper.
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input readonly /></div>
        </div>
      </div>
      <div class="el-popper" id="pp-other">
        <div role="option">COSCO</div>
      </div>
      <div class="el-select-dropdown" id="dd-dropdown">
        <div class="el-select-dropdown__item">COSCO</div>
      </div>`

    let opened = false
    setVisibilityProbe((el) => {
      const dropdown = el.closest('#pp-other, #dd-dropdown')
      return dropdown ? opened : el.closest('[data-hidden]') === null
    })
    const wrapper = document.querySelector('.el-select__wrapper') as HTMLElement
    wrapper.addEventListener('click', () => {
      opened = true
    })

    const clicks: string[] = []
    const popperOption = document.querySelector('#pp-other [role="option"]') as HTMLElement
    const dropdownOption = document.querySelector('#dd-dropdown .el-select-dropdown__item') as HTMLElement
    popperOption.addEventListener('click', () => clicks.push('popper'))
    dropdownOption.addEventListener('click', () => clicks.push('dropdown'))

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'COSCO', 1000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['dropdown'])
  })

  it('gõ vào ô tìm kiếm của select có filter khi option chưa có sẵn', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input id="el-id-a-TRUST_COD" /></div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd"></div>`

    const search = document.getElementById('el-id-a-TRUST_COD') as HTMLInputElement
    const dropdown = document.getElementById('dd') as HTMLElement
    const events: string[] = []
    search.addEventListener('input', () => {
      events.push('input')
      dropdown.insertAdjacentHTML(
        'beforeend',
        '<div class="el-select-dropdown__item">MAEU</div>',
      )
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'MAEU', 1000)

    expect(result.ok).toBe(true)
    expect(search.value).toBe('MAEU')
    expect(events).toContain('input')
  })

  it('không gõ vào ô filter khi option đã có sẵn trong dropdown', async () => {
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
    expect(search.value).toBe('')
    expect(events).not.toContain('input')
  })

  it('gõ vào ô filter khi option đã có sẵn nhưng đang ẩn', async () => {
    // Dropdown còn giữ filter cũ nên option khớp đang bị ẩn: adapter phải gõ
    // để lọc lại, nếu không sẽ timeout ở `waitForVisibleOption`.
    setVisibilityProbe(attrProbe)
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select">
          <div class="el-select__wrapper"><input id="el-id-a-TRUST_COD" /></div>
        </div>
      </div>
      <div class="el-select-dropdown" id="dd">
        <div class="el-select-dropdown__item" data-hidden="1">MAEU</div>
      </div>`

    const search = document.getElementById('el-id-a-TRUST_COD') as HTMLInputElement
    const option = document.querySelector('.el-select-dropdown__item') as HTMLElement
    const clicks: string[] = []
    option.addEventListener('click', () => clicks.push('MAEU'))
    search.addEventListener('input', () => {
      option.removeAttribute('data-hidden')
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'MAEU', 1000)

    expect(result.ok).toBe(true)
    expect(search.value).toBe('MAEU')
    expect(clicks).toEqual(['MAEU'])
  })

  it('blur trigger khi không tìm thấy option', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <div class="el-select"><input id="trig" readonly /></div>
      </div>
      <div class="el-select-dropdown">
        <div class="el-select-dropdown__item">MAEU</div>
      </div>`

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromSelect(scope, 'KHONG_CO', 300)

    expect(result.ok).toBe(false)
    expect(document.activeElement?.id).not.toBe('trig')
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

  it('popper không click nhầm suggestion của el-autocomplete', async () => {
    // Popper của site chứa list gợi ý `el-autocomplete`; adapter popper phải bỏ
    // qua chúng, nếu không sẽ bấm nhầm suggestion của 5 ô cảng.
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="el-id-a-START_PORT_NAM" readonly />
      </div>
      <div class="el-popper">
        <input class="filter-input" />
        <ul class="el-autocomplete-suggestion">
          <li>上海/CNSHA</li>
        </ul>
      </div>`

    const suggestion = document.querySelector('.el-autocomplete-suggestion li') as HTMLElement
    let clicked = 0
    suggestion.addEventListener('click', () => {
      clicked += 1
    })

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '上海', 300)

    expect(result.ok).toBe(false)
    expect(clicked).toBe(0)
  })

  it('không gõ vào input readonly trong popper', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="el-id-a-START_PORT_NAM" readonly />
      </div>
      <div class="el-popper">
        <input class="display-input" readonly />
        <div role="option">上海</div>
      </div>`

    const display = document.querySelector('.display-input') as HTMLInputElement
    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '上海', 1000)

    expect(result.ok).toBe(true)
    expect(display.value).toBe('')
  })

  it('blur trigger khi không tìm thấy option', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="trig" readonly />
      </div>
      <div class="el-popper"><div role="option">上海</div></div>`

    const scope = document.querySelector('.el-form-item') as HTMLElement
    const result = await pickFromPopper(scope, '宁波', 300)

    expect(result.ok).toBe(false)
    expect(document.activeElement?.id).not.toBe('trig')
  })
})

describe('pickFromAutocomplete', () => {
  /** Dựng mô phỏng el-autocomplete: gõ vào input → site trả về list gợi ý. */
  function buildAutocomplete(options: { hidden?: boolean } = {}): {
    input: HTMLInputElement
    clicks: string[]
  } {
    document.body.innerHTML = `
      <div class="el-autocomplete">
        <input id="el-id-a-START_PORT_NAM" />
      </div>`

    const input = document.getElementById('el-id-a-START_PORT_NAM') as HTMLInputElement
    const clicks: string[] = []

    input.addEventListener('input', () => {
      // Site gọi API rồi mới render list gợi ý.
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          `
          <div class="el-popper" id="sug">
            <ul class="el-autocomplete-suggestion">
              <li${options.hidden ? ' data-hidden="1"' : ''}>上海/CNSHA</li>
              <li>上海虹桥/SHA</li>
            </ul>
          </div>`,
        )
      }, 0)
    })

    document.addEventListener('click', (event) => {
      const li = (event.target as HTMLElement).closest('li')
      if (li) clicks.push((li.textContent ?? '').trim())
    })

    return { input, clicks }
  }

  it('gõ vào input rồi click suggestion 名称/代码', async () => {
    const { input, clicks } = buildAutocomplete()
    const events: string[] = []
    input.addEventListener('input', () => events.push('input'))

    const result = await pickFromAutocomplete(input, '上海', 2000, '上海/CNSHA')

    expect(result.ok).toBe(true)
    expect(result.strategy).toBe('autocomplete')
    expect(input.value).toBe('上海')
    expect(events).toContain('input')
    expect(clicks).toEqual(['上海/CNSHA'])
  })

  it('không click suggestion đang ẩn', async () => {
    setVisibilityProbe(attrProbe)
    const { input, clicks } = buildAutocomplete({ hidden: true })

    const result = await pickFromAutocomplete(input, '上海', 300, '上海/CNSHA')

    expect(result.ok).toBe(false)
    expect(result.strategy).toBe('autocomplete')
    expect(clicks).toEqual([])
  })

  it('báo lỗi khi không có suggestion nào xuất hiện', async () => {
    document.body.innerHTML = `
      <div class="el-autocomplete">
        <input id="el-id-a-START_PORT_NAM" />
      </div>`
    const input = document.getElementById('el-id-a-START_PORT_NAM') as HTMLInputElement

    const result = await pickFromAutocomplete(input, '上海', 300)

    expect(result.ok).toBe(false)
    expect(result.strategy).toBe('autocomplete')
    expect(result.reason).toContain('上海')
    // Thông điệp phải nêu rõ loại suggestion (đồng bộ với nhánh "is not visible").
    expect(result.reason).toContain('Could not select the suggestion "上海"')
  })

  it('không blur input trước khi click (blur sẽ đóng list gợi ý)', async () => {
    const { input, clicks } = buildAutocomplete()
    const events: string[] = []
    input.addEventListener('blur', () => events.push('blur'))
    input.addEventListener('change', () => events.push('change'))

    await pickFromAutocomplete(input, '上海', 2000, '上海/CNSHA')

    expect(events).not.toContain('blur')
    expect(events).not.toContain('change')
    expect(clicks).toEqual(['上海/CNSHA'])
  })
})
