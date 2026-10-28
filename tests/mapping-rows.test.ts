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

/**
 * Dict `getCntrCode/` của site chỉ chứa **chuỗi thuần** ("20", "GP"…), còn
 * `cType`/`vC` của API là **mã số** ⇒ không tra được ⇒ 尺寸/箱型 phải skip.
 */
const ctx: MappingContext = {
  findTrustCode: () => undefined,
  findDrType: () => undefined,
  findPort: () => undefined,
  findCntrType: () => undefined,
  findCntrSize: () => undefined,
}

/** Ngữ cảnh giả lập site ĐÃ tra được 箱型/尺寸 (dict có dữ liệu). */
const ctxWithDictionary: MappingContext = {
  ...ctx,
  findCntrType: () => 'GP',
  findCntrSize: () => "20'",
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

  it('điền 货物标识 bằng nhãn hiển thị của site, mã chỉ nằm ở note', () => {
    const plan = planFor(plans, 'CARGO_KIND_COD')
    expect(plan).toMatchObject({ status: 'fill', value: '普货' })
    expect(plan?.note).toContain('S')
  })

  it('bỏ trống 包装类型 vì API không có 包装类型 thật', () => {
    const plan = planFor(plans, 'PACKAGE_STR')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('包装类型')
  })

  it('không ghi PACKAGES (đơn vị đếm chung) vào 包装类型', () => {
    expect(cargo.unit).toBe('PACKAGES')
    expect(planFor(plans, 'PACKAGE_STR')?.value).toBeUndefined()
  })

  it('bỏ trống 包装类型代码 vì API không có mã 包装', () => {
    const plan = planFor(plans, 'PACKAGE_COD')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('PACKAGE_COD')
  })

  it('điền 包装件数 bằng số nguyên (site chỉ nhận /^\d*$/)', () => {
    expect(planFor(plans, 'PIECE_NUM')).toMatchObject({ status: 'fill', value: '114' })
  })

  it('ghi chú khi phần thập phân của 包装件数 bị cắt', () => {
    expect(planFor(plans, 'PIECE_NUM')?.note).toBe(
      'The site only accepts whole numbers for 包装件数 — wrote 114 (the API gave "114.000")',
    )
  })

  it('điền 毛重 từ weight (giữ nguyên 3 chữ số thập phân)', () => {
    expect(planFor(plans, 'GWEIGHT_TON')).toMatchObject({ status: 'fill', value: '22400.000' })
  })

  it('điền 体积 từ volume (giữ nguyên 3 chữ số thập phân)', () => {
    expect(planFor(plans, 'GVOL_NUM')).toMatchObject({ status: 'fill', value: '60.130' })
  })

  it('điền 唛头 từ shantou (không phải sign)', () => {
    expect(planFor(plans, 'MARK_STR')).toMatchObject({ status: 'fill', value: 'N/M' })
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

describe('mapCargo — hàng nguy hiểm', () => {
  const dangerous = mapCargo({ ...cargo, dangerClass: '2.1', unNub: null })

  it('ghi 货物标识 = 危险品', () => {
    expect(planFor(dangerous, 'CARGO_KIND_COD')).toMatchObject({
      status: 'fill',
      value: '危险品',
    })
  })

  it('note của field BẮT BUỘC bị skip nói rõ site cần người dùng làm tay', () => {
    const unNo = planFor(dangerous, 'DANG_UN_NO')
    expect(unNo?.status).toBe('skip')
    expect(unNo?.note).toContain('The site requires')
    expect(unNo?.note).toContain('危险品联合国编号')
    expect(unNo?.note).toContain('DANG_UN_NO')
    expect(unNo?.note).toContain('by hand')
  })

  it('note của field BẮT BUỘC khác (危险品联系人电话) cũng nói rõ site cần làm tay', () => {
    const phone = planFor(dangerous, 'DANGER_TE_STR')
    expect(phone?.status).toBe('skip')
    expect(phone?.note).toContain('The site requires')
    expect(phone?.note).toContain('DANGER_TE_STR')
  })

  it('field KHÔNG bắt buộc giữ note chung', () => {
    expect(planFor(dangerous, 'DANG_EMS_NO')?.note).toBe(
      'The API provides no data for this field',
    )
  })
})

describe('mapCargo — hàng kiểm dịch và hàng vừa nguy hiểm vừa kiểm dịch', () => {
  it('loại R: 货物标识 = 冷藏品 và note của TEMP_ID nói rõ site bắt buộc', () => {
    const cold = mapCargo({ ...cargo, quarantineName: '冷藏' })
    expect(planFor(cold, 'CARGO_KIND_COD')).toMatchObject({
      status: 'fill',
      value: '冷藏品',
    })
    const temp = planFor(cold, 'TEMP_ID')
    expect(temp?.status).toBe('skip')
    expect(temp?.note).toContain('The site requires')
    expect(temp?.note).toContain('TEMP_ID')
  })

  it('loại G: field nguy hiểm lẫn field lạnh đều bị site bắt buộc', () => {
    const both = mapCargo({ ...cargo, dangerClass: '2.1', quarantineName: '冷藏' })
    expect(planFor(both, 'CARGO_KIND_COD')).toMatchObject({
      status: 'fill',
      value: '危险品+冷藏品',
    })
    expect(planFor(both, 'DANG_UN_NO')?.note).toContain('The site requires')
    expect(planFor(both, 'SET_TEMP_NUM')?.note).toContain('The site requires')
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

  it('bỏ trống 箱型 vì dict site chỉ có chuỗi, mã số của API không tra được', () => {
    const plan = planFor(plans, 'CNTR_TYPE_COD')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('箱型')
    expect(plan?.note).toContain('The site requires')
  })

  it('bỏ trống 尺寸 vì dict site chỉ có chuỗi, mã số của API không tra được', () => {
    const plan = planFor(plans, 'CNTR_SIZE_COD')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('尺寸')
    expect(plan?.note).toContain('The site requires')
  })

  it('bỏ trống 箱状态 vì API không có dữ liệu', () => {
    const plan = planFor(plans, 'CNTR_EF_ID')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('箱状态')
    expect(plan?.note).toContain('The site requires')
  })

  it('ghi 货主箱标志 bằng nhãn hiển thị của site, mã chỉ nằm ở note', () => {
    const plan = planFor(plans, 'SOC_ID')
    expect(plan).toMatchObject({ status: 'fill', value: '非货主箱' })
    expect(plan?.note).toContain('N')
  })

  it('điền 货物件数 bằng số nguyên', () => {
    expect(planFor(plans, 'PIECE_NUM')).toMatchObject({ status: 'fill', value: '114' })
  })

  it('có nhãn cột tiếng Trung để định vị ô bảng', () => {
    expect(planFor(plans, 'CNTR_NO')?.columnLabel).toBe('箱号')
  })

  it('có đủ 9 cột', () => {
    expect(plans).toHaveLength(9)
  })
})

describe('mapContainer — lookup vẫn chạy khi dict tra được', () => {
  const plans = mapContainer(con, ctxWithDictionary)

  it('điền 箱型 bằng đúng giá trị dict trả về', () => {
    expect(planFor(plans, 'CNTR_TYPE_COD')).toMatchObject({ status: 'fill', value: 'GP' })
  })

  it('điền 尺寸 bằng đúng giá trị dict trả về', () => {
    expect(planFor(plans, 'CNTR_SIZE_COD')).toMatchObject({ status: 'fill', value: "20'" })
  })
})

describe('mapContainer — 货主箱标志', () => {
  it('self = true ⇒ 货主箱', () => {
    const plans = mapContainer({ ...con, self: true }, ctx)
    expect(planFor(plans, 'SOC_ID')).toMatchObject({ status: 'fill', value: '货主箱' })
  })

  it('self = null ⇒ bỏ trống, không đoán', () => {
    const plans = mapContainer({ ...con, self: null }, ctx)
    const plan = planFor(plans, 'SOC_ID')
    expect(plan?.status).toBe('skip')
    expect(plan?.note).toContain('The site requires')
  })
})

describe('cờ required của bảng hàng và bảng container', () => {
  it('field BẮT BUỘC của dòng hàng được đánh dấu', () => {
    const plans = mapCargo(cargo)
    for (const prop of [
      'CARGO_KIND_COD',
      'PACKAGE_COD',
      'PACKAGE_STR',
      'PIECE_NUM',
      'GWEIGHT_TON',
      'GVOL_NUM',
      'MARK_STR',
      'E_CARGO_NAM',
    ]) {
      expect(planFor(plans, prop)?.required, prop).toBe(true)
    }
  })

  it('field KHÔNG bắt buộc của dòng hàng không mang cờ required', () => {
    const plans = mapCargo(cargo)
    for (const prop of ['CARGO_HS_COD', 'DANG_EMS_NO', 'DANG_MFAG_NO', 'TEMP_ID']) {
      expect(planFor(plans, prop)?.required, prop).toBe(false)
    }
  })

  it('loại D: field nguy hiểm được đánh dấu bắt buộc', () => {
    const dangerous = mapCargo({ ...cargo, dangerClass: '2.1' })
    for (const prop of [
      'DANG_CLASS_NAM',
      'DANG_UN_NO',
      'DANGER_CONTACT_NAM',
      'DANGER_TE_STR',
    ]) {
      expect(planFor(dangerous, prop)?.required, prop).toBe(true)
    }
  })

  it('loại R: field lạnh được đánh dấu bắt buộc', () => {
    const cold = mapCargo({ ...cargo, quarantineName: '冷藏' })
    for (const prop of ['TEMP_ID', 'SET_TEMP_NUM']) {
      expect(planFor(cold, prop)?.required, prop).toBe(true)
    }
  })

  it('bảng container: 箱号 và 铅封号 cũng là field BẮT BUỘC', () => {
    const plans = mapContainer(con, ctx)
    for (const prop of [
      'CNTR_NO',
      'CNTR_SIZE_COD',
      'CNTR_TYPE_COD',
      'CNTR_EF_ID',
      'SEAL_NO',
      'SOC_ID',
    ]) {
      expect(planFor(plans, prop)?.required, prop).toBe(true)
    }
  })

  it('bảng container: field KHÔNG bắt buộc không mang cờ required', () => {
    const plans = mapContainer(con, ctx)
    for (const prop of ['PIECE_NUM', 'WEIGH_TON', 'VOLUME_NUM']) {
      expect(planFor(plans, prop)?.required, prop).toBe(false)
    }
  })
})
