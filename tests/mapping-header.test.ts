import { describe, it, expect } from 'vitest'
import { mapHeader, contactRole, type MappingContext } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'

const data = fixture.data as unknown as ManifestData

const ctx: MappingContext = {
  findTrustCode: (id) => (id === 2 ? 'MAEU' : undefined),
  findDrType: (code) => (code === '1' ? 'FOB' : undefined),
  // Site chỉ gợi ý tên cảng tiếng Trung → `findPort` trả về tên Trung.
  findPort: (code) =>
    code === 'CNSHA' ? '上海' : code === 'IDBLW' ? '勿拉湾' : undefined,
  findCntrType: (raw) => (raw === 2 ? '20GP' : undefined),
  findCntrSize: (raw) => (raw === 0 ? "20'" : undefined),
}

const planFor = <T extends { prop: string }>(plans: T[], prop: string) =>
  plans.find((p) => p.prop === prop)

describe('contactRole', () => {
  it('false = 发货人 (0)', () => {
    expect(contactRole({ type: false })).toBe(0)
  })
  it('true = 收货人 (1)', () => {
    expect(contactRole({ type: true })).toBe(1)
  })
  it('2 = 通知人', () => {
    expect(contactRole({ type: 2 })).toBe(2)
  })
  it('số 0/1 cũng hợp lệ', () => {
    expect(contactRole({ type: 0 })).toBe(0)
    expect(contactRole({ type: 1 })).toBe(1)
  })
  it('undefined thì null', () => {
    expect(contactRole({})).toBeNull()
  })
})

describe('mapHeader', () => {
  const plans = mapHeader(data, ctx)

  it('điền 提单号, 船名, 航次', () => {
    expect(planFor(plans, 'BILL_NBR')).toMatchObject({
      status: 'fill',
      value: 'ONEYSHAGT1569600',
    })
    expect(planFor(plans, 'E_SHIP_NAM')).toMatchObject({ status: 'fill', value: 'CALLAO BRIDGE' })
    expect(planFor(plans, 'OUT_VOYAGE_NO')).toMatchObject({ status: 'fill', value: '0294S' })
  })

  it('map 承运人代码 qua supplyId', () => {
    expect(planFor(plans, 'TRUST_COD')).toMatchObject({ status: 'fill', value: 'MAEU' })
  })

  it('báo ⚠️ khi không tìm thấy 承运人', () => {
    const p = mapHeader(data, { ...ctx, findTrustCode: () => undefined }).find(
      (x) => x.prop === 'TRUST_COD',
    )
    expect(p?.status).toBe('skip')
    expect(p?.note).toContain('supplyId')
  })

  it('map 交货条款 qua transportTerms', () => {
    expect(planFor(plans, 'DR_TYPE_STR')).toMatchObject({ status: 'fill', value: 'FOB' })
  })

  it('map 付款方式 ra NhãN của site (không phải mã 0/1)', () => {
    // Fixture có payType = false → 到付 (mã site lưu là "C").
    expect(planFor(plans, 'PAY_WAY_ID')).toMatchObject({ status: 'fill', value: '到付' })
  })

  it('payType = true → 预付', () => {
    const p = mapHeader({ ...data, payType: true }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p).toMatchObject({ status: 'fill', value: '预付' })
  })

  it('payType = false → 到付', () => {
    const p = mapHeader({ ...data, payType: false }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p).toMatchObject({ status: 'fill', value: '到付' })
  })

  it('note của 付款方式 nói rõ mã site sẽ lưu', () => {
    const p = mapHeader({ ...data, payType: true }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    // Note phải nêu cả mã site lưu ("P") lẫn nhãn hiển thị (预付).
    expect(p?.note).toContain('"P"')
    expect(p?.note).toContain('预付')
  })

  it('payType = 1 → 预付', () => {
    const p = mapHeader({ ...data, payType: 1 }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p).toMatchObject({ status: 'fill', value: '预付' })
  })

  it('payType = 0 → 到付', () => {
    const p = mapHeader({ ...data, payType: 0 }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p).toMatchObject({ status: 'fill', value: '到付' })
  })

  it('payType = 2 (giá trị lạ) thì bỏ trống, không đoán', () => {
    const p = mapHeader({ ...data, payType: 2 }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p?.status).toBe('skip')
    expect(p?.value).toBeUndefined()
    expect(p?.note).toContain('2')
  })

  it('không có payType thì bỏ trống 付款方式', () => {
    const p = mapHeader({ ...data, payType: null }, ctx).find((x) => x.prop === 'PAY_WAY_ID')
    expect(p?.status).toBe('skip')
    expect(p?.value).toBeUndefined()
  })

  it('map 装货港 sang START_PORT_NAM và verify START_PORT_COD', () => {
    expect(planFor(plans, 'START_PORT_NAM')).toMatchObject({ status: 'fill', value: '上海' })
    expect(planFor(plans, 'START_PORT_NAM')?.verify?.prop).toBe('START_PORT_COD')
  })

  it('ô cảng mang matchValue dạng 名称/代码', () => {
    expect(planFor(plans, 'START_PORT_NAM')).toMatchObject({
      value: '上海',
      matchValue: '上海/CNSHA',
    })
    expect(planFor(plans, 'DISCHRG_PORT_NAM')).toMatchObject({
      value: '勿拉湾',
      matchValue: '勿拉湾/IDBLW',
    })
    expect(planFor(plans, 'DEST_PORT_NAM')).toMatchObject({
      value: '勿拉湾',
      matchValue: '勿拉湾/IDBLW',
    })
  })

  it('tên cảng lấy từ API trước, dictionary chỉ là fallback', () => {
    const p = mapHeader(data, { ...ctx, findPort: () => 'TENDICH' }).find(
      (x) => x.prop === 'START_PORT_NAM',
    )
    expect(p?.value).toBe('上海')
    expect(p?.matchValue).toBe('上海/CNSHA')
  })

  it('khi API không có tên cảng thì lấy từ dictionary getPort()', () => {
    const p = mapHeader(
      { ...data, loadPortData: null },
      { ...ctx, findPort: (code) => (code === 'CNSHA' ? '上海' : undefined) },
    ).find((x) => x.prop === 'START_PORT_NAM')
    expect(p).toMatchObject({ status: 'fill', value: '上海', matchValue: '上海/CNSHA' })
  })

  it('không tìm thấy cảng thì bỏ trống', () => {
    const p = mapHeader({ ...data, loadPortData: null }, { ...ctx, findPort: () => undefined }).find(
      (x) => x.prop === 'START_PORT_NAM',
    )
    expect(p?.status).toBe('skip')
  })

  it('map 卸货港 sang DISCHRG_PORT_NAM', () => {
    expect(planFor(plans, 'DISCHRG_PORT_NAM')).toMatchObject({ status: 'fill', value: '勿拉湾' })
  })

  it('map 交货地 sang DEST_PORT_NAM', () => {
    expect(planFor(plans, 'DEST_PORT_NAM')).toMatchObject({ status: 'fill', value: '勿拉湾' })
  })

  it('để trống 中转港 khi API không có', () => {
    expect(planFor(plans, 'TRANS_PORT_NAM')?.status).toBe('skip')
  })

  it('map 发货人 từ contact type=0', () => {
    expect(planFor(plans, 'E_SHIPPER_NAM')).toMatchObject({
      status: 'fill',
      value: 'SHANGHAI JUNYI TRADE & DEVELOPMENT CO.,LTD.',
    })
    expect(planFor(plans, 'SHIPPER_COUNTRY_COD')).toMatchObject({ status: 'fill', value: 'CN' })
  })

  it('map 收货人 từ contact type=1', () => {
    expect(planFor(plans, 'E_CONSIGNEE_NAM')).toMatchObject({
      status: 'fill',
      value: 'PT KARYA BINA NUSANTARA',
    })
  })

  it('map 通知人 từ contact type=2', () => {
    expect(planFor(plans, 'E_NOTIFY_NAM')).toMatchObject({
      status: 'fill',
      value: 'PT KARYA BINA NUSANTARA',
    })
  })

  it('để trống AEO vì firmCode không phải mã AEO', () => {
    const aeo = planFor(plans, 'SHIPPER_AEO')
    expect(aeo?.status).toBe('skip')
    expect(aeo?.note).toContain('AEO')
  })

  it('để trống EMAIL và FAX', () => {
    expect(planFor(plans, 'SHIPPER_EM_STR')?.status).toBe('skip')
    expect(planFor(plans, 'CONSIGNEE_FX_STR')?.status).toBe('skip')
  })
})

describe('mapHeader — cờ required (FACT 1)', () => {
  const plans = mapHeader(data, ctx)

  it('field site BẮT BUỘC được đánh dấu required', () => {
    for (const prop of [
      'BILL_NBR',
      'E_SHIP_NAM',
      'OUT_VOYAGE_NO',
      'TRUST_COD',
      'PAY_WAY_ID',
      'DR_TYPE_STR',
      'START_PORT_NAM',
      'DISCHRG_PORT_NAM',
      'E_SHIPPER_NAM',
      'SHIPPER_ADD_STR',
      'E_CONSIGNEE_NAM',
      'CONSIGNEE_ADD_STR',
      'CONSIGNEE_COUNTRY_COD',
    ]) {
      expect(planFor(plans, prop)?.required, prop).toBe(true)
    }
  })

  it('field site KHÔNG bắt buộc không mang cờ required', () => {
    // 通知人, EMAIL/FAX/AEO, 交货地, 中转港, 提单签发地 — site không bắt buộc.
    for (const prop of [
      'E_NOTIFY_NAM',
      'NOTIFY_ADD_STR',
      'NOTIFY_COUNTRY_COD',
      'SHIPPER_COUNTRY_COD',
      'SHIPPER_AEO',
      'SHIPPER_EM_STR',
      'SHIPPER_FX_STR',
      'DEST_PORT_NAM',
      'TRANS_PORT_NAM',
      'SIGN_PLACE_STR',
    ]) {
      expect(planFor(plans, prop)?.required, prop).toBe(false)
    }
  })

  it('field BẮT BUỘC bị bỏ trống thì note nói rõ người dùng phải làm tay', () => {
    const pay = mapHeader({ ...data, payType: null }, ctx).find((p) => p.prop === 'PAY_WAY_ID')
    expect(pay?.status).toBe('skip')
    expect(pay?.required).toBe(true)
    expect(pay?.note).toContain('The site requires')
    expect(pay?.note).toContain('by hand')
  })

  it('không tìm được cảng thì field BẮT BUỘC cũng phải nói rõ', () => {
    const p = mapHeader({ ...data, loadPortData: null }, { ...ctx, findPort: () => undefined }).find(
      (x) => x.prop === 'START_PORT_NAM',
    )
    expect(p?.status).toBe('skip')
    expect(p?.required).toBe(true)
    expect(p?.note).toContain('The site requires')
  })
})

describe('MappingContext', () => {
  it('không còn cấu hình portNameField (site chỉ gợi ý tên Trung)', () => {
    // Kiểm tra ở mức kiểu: `portNameField` phải KHÔNG còn là thuộc tính hợp lệ
    // của `MappingContext` (nếu còn, `@ts-expect-error` báo "unused directive").
    // @ts-expect-error — `portNameField` đã bị gỡ khỏi `MappingContext`.
    const legacyCtx: MappingContext = { ...ctx, portNameField: 'START_PORT_NAM' }
    expect(legacyCtx).toBeTruthy()
  })
})
