import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fillHeader, fillManifest } from '../src/core/fill'
import { findButtonByText } from '../src/core/site'
import { mapHeader, type MappingContext } from '../src/core/mapping'
import { setVisibilityProbe } from '../src/core/select'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'
import { buildHeaderForm } from './helpers/dom'

const data = fixture.data as unknown as ManifestData

const ctx: MappingContext = {
  findTrustCode: () => 'MAEU',
  findDrType: () => 'FOB',
  findPort: (code) => (code === 'CNSHA' ? '上海' : code === 'IDBLW' ? '勿拉湾' : undefined),
  findCntrType: () => undefined,
  findCntrSize: () => undefined,
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

  it('điền ô cảng bằng cách click suggestion của el-autocomplete', async () => {
    // Ô mã cảng để trống ngay từ đầu → mã chỉ xuất hiện được NẾU site cascade
    // sau khi suggestion được click (đúng như site thật).
    buildHeaderForm({ emptyPortCodes: true })

    // Ô mã cảng rỗng ngay từ đầu → mã chỉ có thể xuất hiện nhờ cascade.
    expect((document.getElementById('el-id-x-START_PORT_COD') as HTMLInputElement).value).toBe('')

    const suggestion = document.querySelector('#port-suggestions li') as HTMLElement
    const clicked: string[] = []
    suggestion.addEventListener('click', () => {
      clicked.push((suggestion.textContent ?? '').trim())
    })

    const report = await fillHeader(document, mapHeader(data, ctx))

    expect(reportItem(report, 'START_PORT_NAM')?.status).toBe('ok')
    // Phải click đúng suggestion "名称/代码", không phải chỉ gõ tên vào ô.
    expect(clicked).toEqual(['上海/CNSHA'])
    // Site cascade mã cảng vào ô *_PORT_COD khi suggestion được click.
    expect((document.getElementById('el-id-x-START_PORT_COD') as HTMLInputElement).value).toBe(
      'CNSHA',
    )
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
    // Ô mã trống và site KHÔNG cascade → nhánh verify phải báo cảnh báo.
    buildHeaderForm({ emptyPortCodes: true, cascadePortCodes: false })

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
    // Site BẮT BUỘC có 包装类型/代码 nhưng API không có ⇒ không thể submit
    // ⇒ báo cáo không được claim là thành công.
    expect(
      report.items.some((i) => i.prop === 'PACKAGE_STR' && i.status === 'skip' && i.required),
    ).toBe(true)
    expect(report.ok).toBe(false)
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
    expect(
      report.items.some((i) => i.prop === 'PACKAGE_STR' && i.status === 'skip' && i.required),
    ).toBe(true)
    expect(report.ok).toBe(false)
  })

  it('tìm nút theo text chính xác và ưu tiên nút đang hiển thị', () => {
    setVisibilityProbe(attrProbe)
    document.body.innerHTML = `
      <div data-hidden="1"><button class="el-button">新增舱单信息</button></div>
      <button class="el-button" id="visible">新增舱单信息</button>`

    expect(findButtonByText('新增舱单信息')?.id).toBe('visible')
  })

  it('báo cáo tổng hợp không có lỗi và không có cảnh báo, nhưng field bắt buộc bị bỏ trống ⇒ chưa thành công', async () => {
    buildHeaderForm()

    const report = await fillManifest({ data, ctx, root: document })

    expect(report.items.filter((i) => i.status === 'error')).toHaveLength(0)
    expect(report.items.filter((i) => i.status === 'warn')).toHaveLength(0)
    // Không lỗi, không cảnh báo — nhưng 包装类型/代码 và 尺寸/箱型/箱状态 của site
    // vẫn trống ⇒ manifest KHÔNG submit được ⇒ `ok` phải là false.
    const blocked = report.items.filter((i) => i.status === 'skip' && i.required)
    expect(blocked.map((i) => i.prop)).toContain('PACKAGE_STR')
    expect(blocked.map((i) => i.prop)).toContain('CNTR_SIZE_COD')
    expect(report.ok).toBe(false)
  })

  it('auto-submit: site nhận form nhưng field bắt buộc còn trống ⇒ vẫn chưa thành công', async () => {
    buildHeaderForm()

    const report = await fillManifest({ data, ctx, root: document, autoSubmit: true })

    expect(report.items.some((i) => i.prop === 'SUBMIT')).toBe(false)
    expect(
      report.items.some((i) => i.prop === 'PACKAGE_STR' && i.status === 'skip' && i.required),
    ).toBe(true)
    expect(report.ok).toBe(false)
  })

  it('không có field bắt buộc nào bị bỏ trống ⇒ báo thành công', async () => {
    buildHeaderForm()

    // Manifest không có dòng hàng, không có container ⇒ không field BẮT BUỘC nào
    // bị skip ⇒ `ok` phải là true. Test này bảo đảm predicate của `ok` không
    // luôn trả false (nếu vậy thì 4 test trên vẫn xanh).
    const empty: ManifestData = { ...data, cdgoods: [], cdCon: [] }
    const report = await fillManifest({ data: empty, ctx, root: document })

    // Báo cáo phải có item — nếu rỗng thì `every` trên mảng rỗng trả true và
    // test này pass vô nghĩa.
    expect(report.items.length).toBeGreaterThan(0)
    expect(report.items.filter((i) => i.status === 'skip' && i.required)).toHaveLength(0)
    expect(report.ok).toBe(true)
  })

  it('field BẮT BUỘC của form đầu bị bỏ trống ⇒ không báo thành công', async () => {
    buildHeaderForm()

    // API không có payType ⇒ 付款方式 trống ⇒ site không cho submit.
    const noPayType: ManifestData = { ...data, payType: null }
    const report = await fillManifest({ data: noPayType, ctx, root: document })

    const blocked = report.items.filter((i) => i.status === 'skip' && i.required)
    expect(blocked.map((i) => i.prop)).toContain('PAY_WAY_ID')
    expect(report.ok).toBe(false)
  })

  it('field BẮT BUỘC của người liên hệ bị bỏ trống ⇒ không báo thành công', async () => {
    buildHeaderForm()

    // 收货人 (type = true) không có địa chỉ ⇒ CONSIGNEE_ADD_STR trống.
    const noAddress: ManifestData = {
      ...data,
      cabContacts: (data.cabContacts ?? []).map((c) =>
        c.type === true ? { ...c, address: '' } : c,
      ),
    }
    const report = await fillManifest({ data: noAddress, ctx, root: document })

    const blocked = report.items.filter((i) => i.status === 'skip' && i.required)
    expect(blocked.map((i) => i.prop)).toContain('CONSIGNEE_ADD_STR')
    expect(report.ok).toBe(false)
  })

  it('site từ chối form (dialog vẫn mở) ⇒ báo cảnh báo, không báo thành công', async () => {
    // 尺寸/箱型/箱状态 bị bỏ trống ⇒ site từ chối form, dialog không đóng.
    buildHeaderForm({ keepDialogOpenOnSubmit: true })

    const report = await fillManifest({ data, ctx, root: document, autoSubmit: true })

    const submit = report.items.find((i) => i.prop === 'SUBMIT')
    expect(submit?.status).toBe('warn')
    expect(submit?.note).toContain('the site did not accept the form')
    expect(submit?.note).toContain('尺寸')
    expect(report.ok).toBe(false)
  })

  it('item "ok" của header vẫn mang note (mã mà site lưu cho 付款方式)', async () => {
    buildHeaderForm()

    const report = await fillManifest({ data, ctx, root: document })
    const payWay = report.items.find((i) => i.prop === 'PAY_WAY_ID')

    expect(payWay?.status).toBe('ok')
    expect(payWay?.note).toContain('到付')
    expect(payWay?.note).toContain('C')
  })

  it('không có nút 确定 ⇒ báo cảnh báo, không báo thành công', async () => {
    // Không có nút ⇒ KHÔNG có gì được submit ⇒ tuyệt đối không báo "ok".
    buildHeaderForm({ submitButton: 'missing' })

    const report = await fillManifest({ data, ctx, root: document, autoSubmit: true })

    const submit = report.items.find((i) => i.prop === 'SUBMIT')
    expect(submit?.status).toBe('warn')
    expect(submit?.note).toContain('确定')
    expect(report.ok).toBe(false)
  })

  it('nút 确定 bị disable ⇒ báo cảnh báo, không báo thành công', async () => {
    buildHeaderForm({ submitButton: 'disabled' })

    const report = await fillManifest({ data, ctx, root: document, autoSubmit: true })

    const submit = report.items.find((i) => i.prop === 'SUBMIT')
    expect(submit?.status).toBe('warn')
    expect(submit?.note).toContain('disabled')
    expect(submit?.note).toContain('确定')
    expect(report.ok).toBe(false)
  })

  it('nút 新增舱单信息 bị disable ⇒ báo lỗi rõ ràng, không điền gì', async () => {
    buildHeaderForm({ addManifestDisabled: true })

    const report = await fillManifest({ data, ctx, root: document })

    expect(report.ok).toBe(false)
    expect(report.message).toContain('disabled')
    expect(report.message).toContain('新增舱单信息')
    // Không có field nào được ghi ⇒ báo cáo rỗng.
    expect(report.items).toHaveLength(0)
  })
})

function reportItem(report: { items: Array<{ prop: string; status: string }> }, prop: string) {
  return report.items.find((i) => i.prop === prop)
}
