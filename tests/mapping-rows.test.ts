import { describe, it, expect } from 'vitest'
import {
  mapCargo,
  mapContainer,
  deriveCargoKind,
  type MappingContext,
} from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'

const data = fixture.data as unknown as ManifestData
const cargo = data.cdgoods![0]!
const con = data.cdCon![0]!

const ctx: MappingContext = {
  findTrustCode: () => undefined,
  findDrType: () => undefined,
  findPort: () => undefined,
  findCntrType: (raw) => (String(raw) === '2' ? '20GP' : undefined),
  findCntrSize: (raw) => (String(raw) === '0' ? "20'" : undefined),
  portNameField: 'name',
}

const planFor = <T extends { prop: string }>(plans: T[], prop: string) =>
  plans.find((p) => p.prop === prop)

describe('deriveCargoKind', () => {
  it('S khi không có gì đặc biệt', () => {
    expect(deriveCargoKind({})).toBe('S')
  })
  it('D khi có dangerClass', () => {
    expect(deriveCargoKind({ dangerClass: '2.1' })).toBe('D')
  })
  it('R khi có quarantineName', () => {
    expect(deriveCargoKind({ quarantineName: '冷藏' })).toBe('R')
  })
  it('G khi có cả hai', () => {
    expect(deriveCargoKind({ dangerClass: '2.1', quarantineName: '冷藏' })).toBe('G')
  })
})

describe('mapCargo', () => {
  const plans = mapCargo(cargo)

  it('điền 货物标识 mặc định S', () => {
    expect(planFor(plans, 'CARGO_KIND_COD')).toMatchObject({ status: 'fill', value: 'S' })
  })
  it('điền 包装件数 từ amount', () => {
    expect(planFor(plans, 'PIECE_NUM')).toMatchObject({ status: 'fill', value: '114.000' })
  })
  it('điền 毛重 từ weight', () => {
    expect(planFor(plans, 'GWEIGHT_TON')).toMatchObject({ status: 'fill', value: '22400.000' })
  })
  it('điền 体积 từ volume', () => {
    expect(planFor(plans, 'GVOL_NUM')).toMatchObject({ status: 'fill', value: '60.130' })
  })
  it('điền 包装类型 từ unit', () => {
    expect(planFor(plans, 'PACKAGE_STR')).toMatchObject({ status: 'fill', value: 'PACKAGES' })
  })
  it('trim 货物描述', () => {
    expect(planFor(plans, 'E_CARGO_NAM')).toMatchObject({
      status: 'fill',
      value: 'SILENT DIESEL GENERATOR',
    })
  })
  it('để trống field không có trong API', () => {
    expect(planFor(plans, 'DANG_EMS_NO')?.status).toBe('skip')
    expect(planFor(plans, 'TEMP_ID')?.status).toBe('skip')
  })
  it('có đủ 24 field', () => {
    expect(plans).toHaveLength(24)
  })
})

describe('mapContainer', () => {
  const plans = mapContainer(con, ctx)

  it('điền 箱号', () => {
    expect(planFor(plans, 'CNTR_NO')).toMatchObject({ status: 'fill', value: 'ONEU1437898' })
  })
  it('điền 铅封号', () => {
    expect(planFor(plans, 'SEAL_NO')).toMatchObject({ status: 'fill', value: 'CN28731BH' })
  })
  it('map 箱型 qua dict', () => {
    expect(planFor(plans, 'CNTR_TYPE_COD')).toMatchObject({ status: 'fill', value: '20GP' })
  })
  it('map 尺寸 qua dict', () => {
    expect(planFor(plans, 'CNTR_SIZE_COD')).toMatchObject({ status: 'fill', value: "20'" })
  })
  it('map 货主箱标志 thành 0/1', () => {
    expect(planFor(plans, 'SOC_ID')).toMatchObject({ status: 'fill', value: '0' })
  })
  it('để trống 箱状态', () => {
    expect(planFor(plans, 'CNTR_EF_ID')?.status).toBe('skip')
  })
  it('có nhãn cột tiếng Trung để định vị ô bảng', () => {
    expect(planFor(plans, 'CNTR_NO')?.columnLabel).toBe('箱号')
  })
})
