import { describe, it, expect, beforeEach } from 'vitest'
import { findField, setTextValue, readFieldValue, setFieldValue } from '../src/core/dom'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('findField', () => {
  it('tìm theo id kết thúc bằng prop', () => {
    document.body.innerHTML = '<input id="el-id-abc-BILL_NBR" />'
    expect(findField(document, 'BILL_NBR')?.id).toBe('el-id-abc-BILL_NBR')
  })

  it('tìm textarea', () => {
    document.body.innerHTML = '<textarea id="el-id-abc-MARK_STR"></textarea>'
    expect(findField(document, 'MARK_STR')?.tagName).toBe('TEXTAREA')
  })

  it('tìm theo name khi không có id', () => {
    document.body.innerHTML = '<input name="PIECE_NUM" />'
    expect(findField(document, 'PIECE_NUM')?.getAttribute('name')).toBe('PIECE_NUM')
  })

  it('tìm theo label for', () => {
    document.body.innerHTML =
      '<label for="el-id-zz-OUT_VOYAGE_NO">航次</label><input id="el-id-zz-OUT_VOYAGE_NO" />'
    expect(findField(document, 'OUT_VOYAGE_NO')?.id).toBe('el-id-zz-OUT_VOYAGE_NO')
  })

  it('trả null khi không có field', () => {
    expect(findField(document, 'KHONG_CO')).toBeNull()
  })
})

describe('setTextValue', () => {
  it('set value và bắn input/change/blur', () => {
    document.body.innerHTML = '<input id="el-id-a-BILL_NBR" />'
    const el = document.getElementById('el-id-a-BILL_NBR') as HTMLInputElement
    const seen: string[] = []
    el.addEventListener('input', () => seen.push('input'))
    el.addEventListener('change', () => seen.push('change'))
    el.addEventListener('blur', () => seen.push('blur'))

    setTextValue(el, 'ABC123')

    expect(el.value).toBe('ABC123')
    expect(seen).toEqual(['input', 'change', 'blur'])
  })

  it('gán được giá trị rỗng', () => {
    document.body.innerHTML = '<input id="el-id-a-BILL_NBR" />'
    const el = document.getElementById('el-id-a-BILL_NBR') as HTMLInputElement
    el.value = 'cũ'
    setTextValue(el, '')
    expect(el.value).toBe('')
  })
})

describe('readFieldValue', () => {
  it('đọc value của input', () => {
    document.body.innerHTML = '<input id="el-id-a-BILL_NBR" value="XYZ" />'
    expect(readFieldValue(document, 'BILL_NBR')).toBe('XYZ')
  })
  it('trả chuỗi rỗng khi không có field', () => {
    expect(readFieldValue(document, 'KHONG_CO')).toBe('')
  })
  it('đọc label của el-select qua .el-select__selected-item', () => {
    document.body.innerHTML = `
      <div class="el-select">
        <div class="el-select__wrapper">
          <input id="el-id-a-PAY_WAY_ID" readonly />
          <span class="el-select__selected-item">预付</span>
        </div>
      </div>`
    expect(readFieldValue(document, 'PAY_WAY_ID')).toBe('预付')
  })
  it('đọc label của select chứ không phải text gõ trong input', () => {
    // el-select filterable đẩy text đang gõ vào `input.value`; label đã chọn
    // mới là giá trị thật của field.
    document.body.innerHTML = `
      <div class="el-select">
        <div class="el-select__wrapper">
          <input id="el-id-a-PAY_WAY_ID" value="COS" />
          <span class="el-select__selected-item">COSCO</span>
        </div>
      </div>`
    expect(readFieldValue(document, 'PAY_WAY_ID')).toBe('COSCO')
  })
  it('chưa chọn gì thì trả chuỗi rỗng, không trả placeholder của select', () => {
    // Placeholder "请选择" không phải giá trị → trả về nó sẽ làm verify pass
    // một cách giả.
    document.body.innerHTML = `
      <div class="el-select">
        <div class="el-select__wrapper">
          <input id="el-id-a-PAY_WAY_ID" readonly />
          <span class="el-select__selected-item is-transparent">请选择</span>
        </div>
      </div>`
    expect(readFieldValue(document, 'PAY_WAY_ID')).toBe('')
  })
  it('ô cảng (el-autocomplete) vẫn đọc được input.value', () => {
    document.body.innerHTML = `
      <div class="el-autocomplete">
        <input id="el-id-a-START_PORT_NAM" value="上海" />
      </div>`
    expect(readFieldValue(document, 'START_PORT_NAM')).toBe('上海')
  })
})

describe('setFieldValue với text input', () => {
  it('điền được qua adapter chung', async () => {
    document.body.innerHTML = '<input id="el-id-a-BILL_NBR" />'
    const result = await setFieldValue(document, 'BILL_NBR', 'FOO')
    expect(result.ok).toBe(true)
    expect(result.strategy).toBe('text')
    expect(readFieldValue(document, 'BILL_NBR')).toBe('FOO')
  })

  it('báo lỗi khi không tìm thấy field', async () => {
    const result = await setFieldValue(document, 'KHONG_CO', 'FOO')
    expect(result.ok).toBe(false)
    expect(result.strategy).toBe('none')
  })
})

describe('setFieldValue với popper', () => {
  it('adapter popper dùng đúng input cần điền, không phải input đầu tiên', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input id="other-input" />
        <input id="el-id-a-START_PORT_NAM" readonly />
      </div>
      <div class="el-popper"><div role="option">上海</div></div>`

    const other = document.getElementById('other-input') as HTMLInputElement
    const target = document.getElementById('el-id-a-START_PORT_NAM') as HTMLInputElement
    const clicks: string[] = []
    other.addEventListener('click', () => clicks.push('other'))
    target.addEventListener('click', () => clicks.push('target'))

    const result = await setFieldValue(document, 'START_PORT_NAM', '上海')

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['target'])
  })
})

describe('setFieldValue với el-autocomplete', () => {
  it('dùng adapter autocomplete chứ không gõ thẳng vào input', async () => {
    document.body.innerHTML = `
      <div class="el-autocomplete">
        <input id="el-id-a-START_PORT_NAM" />
      </div>`

    const input = document.getElementById('el-id-a-START_PORT_NAM') as HTMLInputElement
    const events: string[] = []
    input.addEventListener('input', () => events.push('input'))
    input.addEventListener('change', () => events.push('change'))
    input.addEventListener('blur', () => events.push('blur'))

    input.addEventListener('input', () => {
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          `
          <div class="el-popper">
            <ul class="el-autocomplete-suggestion">
              <li>上海/CNSHA</li>
            </ul>
          </div>`,
        )
      }, 0)
    })

    const clicks: string[] = []
    document.addEventListener('click', (event) => {
      const li = (event.target as HTMLElement).closest('li')
      if (li) clicks.push((li.textContent ?? '').trim())
    })

    const result = await setFieldValue(document, 'START_PORT_NAM', '上海', {
      matchValue: '上海/CNSHA',
    })

    expect(result.ok).toBe(true)
    expect(result.strategy).toBe('autocomplete')
    // Nhánh text (setTextValue) sẽ bắn change + blur → không được dùng.
    expect(events).not.toContain('change')
    expect(events).not.toContain('blur')
    expect(clicks).toEqual(['上海/CNSHA'])
  })
})
