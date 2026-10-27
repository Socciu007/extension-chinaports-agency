import { describe, it, expect } from 'vitest'
import { mapHeader, contactRole, type MappingContext } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'

const data = fixture.data as unknown as ManifestData

const ctx: MappingContext = {
  findTrustCode: (id) => (id === 2 ? 'MAEU' : undefined),
  findDrType: (code) => (code === '1' ? 'FOB' : undefined),
  findPort: (code) =>
    code === 'CNSHA'
      ? { label: '上海', value: 'CNSHA' }
      : code === 'IDBLW'
        ? { label: '勿拉湾', value: 'IDBLW' }
        : undefined,
  findCntrType: (raw) => (raw === 2 ? '20GP' : undefined),
  findCntrSize: (raw) => (raw === 0 ? "20'" : undefined),
  portNameField: 'name',
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

  it('map 付款方式 từ boolean payType', () => {
    expect(planFor(plans, 'PAY_WAY_ID')).toMatchObject({ status: 'fill', value: '0' })
  })

  it('map 装货港 sang START_PORT_NAM và verify START_PORT_COD', () => {
    expect(planFor(plans, 'START_PORT_NAM')).toMatchObject({ status: 'fill', value: '上海' })
    expect(planFor(plans, 'START_PORT_NAM')?.verify?.prop).toBe('START_PORT_COD')
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
