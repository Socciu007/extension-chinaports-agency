import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fillHeader, fillManifest, findButtonByText } from '../src/core/fill'
import { mapHeader, type MappingContext } from '../src/core/mapping'
import { setVisibilityProbe } from '../src/core/select'
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

/** Probe giả lập: phần tử nằm trong container `data-hidden` thì bị coi là ẩn. */
const attrProbe = (el: HTMLElement): boolean => el.closest('[data-hidden]') === null

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  setVisibilityProbe(null)
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

  it('không có lỗi khi fixture đầy đủ', async () => {
    buildHeaderForm()
    const report = await fillHeader(document, mapHeader(data, ctx))

    expect(report.items.filter((i) => i.status === 'error')).toHaveLength(0)
    expect(report.items.filter((i) => i.status === 'warn')).toHaveLength(0)
  })

  it('báo cảnh báo (không phải lỗi) khi field không có trên trang', async () => {
    buildHeaderForm()
    document.getElementById('el-id-x-CONSIGNEE_ADD_STR')!.remove()

    const report = await fillHeader(document, mapHeader(data, ctx))
    const item = report.items.find((i) => i.prop === 'CONSIGNEE_ADD_STR')

    expect(item?.status).toBe('warn')
    expect(item?.note).toContain('Could not find the field on the page')
  })

  it('báo cảnh báo khi verify thất bại (mã cảng chưa được cascade)', async () => {
    buildHeaderForm({ emptyPortCodes: true })

    const report = await fillHeader(document, mapHeader(data, ctx))
    const item = report.items.find((i) => i.prop === 'START_PORT_NAM')

    expect(item?.status).toBe('warn')
    expect(item?.note).toBe('Port code START_PORT_COD was not set')
  })

  it('lỗi gán giá trị không làm dừng lần điền', async () => {
    buildHeaderForm()

    const proto = HTMLInputElement.prototype
    const original = Object.getOwnPropertyDescriptor(proto, 'value')!
    Object.defineProperty(proto, 'value', {
      configurable: true,
      get(this: HTMLInputElement) {
        return original.get!.call(this)
      },
      set() {
        throw new Error('Could not find the native value setter')
      },
    })

    try {
      const report = await fillHeader(document, mapHeader(data, ctx))

      expect(report.items.find((i) => i.prop === 'BILL_NBR')?.status).toBe('error')
      // Field select không đi qua setter text → vẫn điền được sau field lỗi.
      expect(report.items.find((i) => i.prop === 'TRUST_COD')?.status).toBe('ok')
    } finally {
      Object.defineProperty(proto, 'value', original)
    }
  })
})

describe('fillManifest', () => {
  it('báo lỗi khi không thấy nút 新增舱单信息', async () => {
    document.body.innerHTML = '<div></div>'
    const report = await fillManifest({ data, ctx, root: document })
    expect(report.ok).toBe(false)
    expect(report.message).toContain('新增舱单信息')
  })

  it('không click nút có text gần giống', async () => {
    document.body.innerHTML = '<button class="el-button">批量新增舱单信息</button>'
    const report = await fillManifest({ data, ctx, root: document })
    expect(report.ok).toBe(false)
    expect(report.message).toContain('Could not find')
  })

  it('chờ dialog mở rồi điền form đầu', async () => {
    buildHeaderForm({ dialogMode: 'lazy' })
    expect(document.getElementById('manifest-dialog')).toBeNull()

    const report = await fillManifest({ data, ctx, root: document })

    expect(document.getElementById('manifest-dialog')).not.toBeNull()
    expect(
      (document.getElementById('el-id-x-E_SHIP_NAM') as HTMLInputElement).value,
    ).toBe('CALLAO BRIDGE')
    expect(report.ok).toBe(true)
  })

  it('báo lỗi khi dialog không mở trong 5 giây', async () => {
    buildHeaderForm({ dialogMode: 'never' })

    const report = await fillManifest({ data, ctx, root: document })

    expect(report.ok).toBe(false)
    expect(report.message).toContain('5 seconds')
  }, { timeout: 15000 })

  it('bấm nút 新增舱单信息 đang hiển thị, không bấm nút ẩn', async () => {
    setVisibilityProbe(attrProbe)
    buildHeaderForm({ dialogMode: 'lazy', hiddenDuplicateButton: true })

    let hiddenClicks = 0
    document
      .getElementById('add-manifest-hidden')!
      .addEventListener('click', () => {
        hiddenClicks += 1
      })

    const report = await fillManifest({ data, ctx, root: document })

    expect(hiddenClicks).toBe(0)
    expect(document.getElementById('manifest-dialog')).not.toBeNull()
    expect(report.ok).toBe(true)
  })

  it('tìm nút theo text chính xác và ưu tiên nút đang hiển thị', () => {
    setVisibilityProbe(attrProbe)
    document.body.innerHTML = `
      <div data-hidden="1"><button class="el-button">新增舱单信息</button></div>
      <button class="el-button" id="visible">新增舱单信息</button>`

    expect(findButtonByText('新增舱单信息')?.id).toBe('visible')
  })

  it('báo cáo tổng hợp không có lỗi và không có cảnh báo', async () => {
    buildHeaderForm()

    const report = await fillManifest({ data, ctx, root: document })

    expect(report.items.filter((i) => i.status === 'error')).toHaveLength(0)
    expect(report.items.filter((i) => i.status === 'warn')).toHaveLength(0)
    expect(report.ok).toBe(true)
  })
})

function reportItem(report: { items: Array<{ prop: string; status: string }> }, prop: string) {
  return report.items.find((i) => i.prop === prop)
}
