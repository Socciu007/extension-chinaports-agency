import { describe, it, expect, beforeEach } from 'vitest'
import { setCellValue } from '../src/core/table'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('setCellValue', () => {
  it('ô render bằng .el-select không có <input> vẫn đi nhánh select', async () => {
    // Element Plus render input của select không filterable thành
    // <span class="el-select__input"> → trong ô không có <input> nào.
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr>
            <td class="cell">
              <div class="el-select">
                <div class="el-select__wrapper">
                  <span class="el-select__input"></span>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="el-select-dropdown" id="dd">
        <div class="el-select-dropdown__item">MAEU</div>
      </div>`

    const clicks: string[] = []
    const option = document.querySelector('#dd .el-select-dropdown__item') as HTMLElement
    option.addEventListener('click', () => clicks.push('MAEU'))

    const cell = document.querySelector('.cell') as HTMLElement
    const result = await setCellValue(cell, 'MAEU', 1000)

    expect(result.ok).toBe(true)
    expect(clicks).toEqual(['MAEU'])
  })

  it('ô không có input lẫn select thì báo lỗi', async () => {
    document.body.innerHTML = '<table><tbody><tr><td class="cell">x</td></tr></tbody></table>'
    const cell = document.querySelector('.cell') as HTMLElement
    const result = await setCellValue(cell, 'MAEU', 300)

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('no input')
  })
})
