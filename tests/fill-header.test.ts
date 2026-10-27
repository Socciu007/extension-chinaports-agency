import { describe, it, expect, beforeEach } from 'vitest'
import { fillHeader, fillManifest } from '../src/core/fill'
import { mapHeader, type MappingContext } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'
import { buildHeaderForm } from './helpers/dom'

const data = fixture.data as unknown as ManifestData

const ctx: MappingContext = {
  findTrustCode: () => 'MAEU',
  findDrType: () => 'FOB',
  findPort: (code) =>
    code === 'CNSHA'
      ? { label: '上海', value: 'CNSHA' }
      : code === 'IDBLW'
        ? { label: '勿拉湾', value: 'IDBLW' }
        : undefined,
  findCntrType: () => undefined,
  findCntrSize: () => undefined,
  portNameField: 'name',
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('fillHeader', () => {
  it('điền được các field text', async () => {
    buildHeaderForm()
    const report = await fillHeader(document, mapHeader(data, ctx))

    const bill = report.items.find((i) => i.prop === 'BILL_NBR')
    expect(bill?.status).toBe('ok')
    expect(
      (document.getElementById('el-id-x-BILL_NBR') as HTMLInputElement).value,
    ).toBe('ONEYSHAGT1569600')
  })

  it('điền được select bằng cách click option', async () => {
    buildHeaderForm()
    const report = await fillHeader(document, mapHeader(data, ctx))
    const trust = reportItem(report, 'TRUST_COD')
    expect(trust?.status).toBe('ok')
  })

  it('báo skip cho field không có dữ liệu', async () => {
    buildHeaderForm()
    const report = await fillHeader(document, mapHeader(data, ctx))
    const aeo = report.items.find((i) => i.prop === 'SHIPPER_AEO')
    expect(aeo?.status).toBe('skip')
  })
})

describe('fillManifest', () => {
  it('báo lỗi khi không thấy nút 新增舱单信息', async () => {
    document.body.innerHTML = '<div></div>'
    const report = await fillManifest({ data, ctx, root: document })
    expect(report.ok).toBe(false)
    expect(report.message).toContain('新增舱单信息')
  })

  it('mở dialog và điền form đầu', async () => {
    buildHeaderForm()
    const report = await fillManifest({ data, ctx, root: document })
    expect(report.ok).toBe(true)
    expect(
      (document.getElementById('el-id-x-E_SHIP_NAM') as HTMLInputElement).value,
    ).toBe('CALLAO BRIDGE')
  })
})

function reportItem(report: { items: Array<{ prop: string; status: string }> }, prop: string) {
  return report.items.find((i) => i.prop === prop)
}
