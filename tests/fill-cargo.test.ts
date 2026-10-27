import { describe, it, expect, beforeEach } from 'vitest'
import { fillCargoRows, findAddButtonBySectionTitle } from '../src/core/fill'
import { mapCargo } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'
import { buildCargoDialog, buildCargoSection } from './helpers/dom'

const data = fixture.data as unknown as ManifestData
const goods = data.cdgoods![0]!

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('findAddButtonBySectionTitle', () => {
  it('tìm nút 新增 trong section 货物信息', () => {
    buildCargoSection()
    const btn = findAddButtonBySectionTitle(document, '货物信息')
    expect(btn?.textContent?.trim()).toBe('新增')
  })

  it('trả null khi không có section', () => {
    document.body.innerHTML = '<div>không có gì</div>'
    expect(findAddButtonBySectionTitle(document, '货物信息')).toBeNull()
  })
})

describe('fillCargoRows', () => {
  it('mở dialog hàng, điền 24 field và bấm 确定', async () => {
    buildCargoSection()
    buildCargoDialog()

    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(1)
    expect(
      (document.getElementById('el-id-c-E_CARGO_NAM') as HTMLInputElement).value,
    ).toBe('SILENT DIESEL GENERATOR')
    expect(
      (document.getElementById('el-id-c-CARGO_KIND_COD') as HTMLInputElement).value,
    ).toBe('S')
  })

  it('ghi nhận lỗi khi không tìm thấy nút 新增', async () => {
    document.body.innerHTML = '<div></div>'
    const result = await fillCargoRows(document, [goods])

    expect(result.rows).toBe(0)
    expect(result.items.some((i) => i.status === 'error')).toBe(true)
  })

  it('bỏ qua field không có dữ liệu', async () => {
    buildCargoSection()
    buildCargoDialog()

    const result = await fillCargoRows(document, [goods])
    const dang = result.items.find((i) => i.prop === 'DANG_EMS_NO')

    expect(dang?.status).toBe('skip')
  })
})
