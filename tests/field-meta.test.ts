import { describe, it, expect } from 'vitest'
import {
  BLANK_NOTES,
  CARGO_LABELS,
  CONTAINER_LABELS,
  contactRole,
  deriveCargoKind,
  HEADER_LABELS,
  payWayOf,
  type MappingContext,
} from '../src/core/field-meta'

/**
 * Ngữ cảnh giả lập — chỉ dùng để kiểm tra KIỂU của `MappingContext`.
 *
 * Đây là STUB: mọi hàm tra cứu trả `undefined` hết, giống hệt site không có
 * dữ liệu từ điển. Code THẬT vẫn đọc `ctx` (trust code, loại hàng, tên cảng,
 * kiểu/kích cước container) ⇒ `ctx` KHÔNG được xoá.
 */
const ctx: MappingContext = {
  findTrustCode: () => undefined,
  findDrType: () => undefined,
  findPort: () => undefined,
  findCntrType: () => undefined,
  findCntrSize: () => undefined,
}

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

describe('payWayOf', () => {
  /**
   * Cực tính 付款方式 là quyết định KHÓ ghi đè — đường API gửi MÃ của site
   * (`P`/`C`) chứ không phải nhãn tiếng Trung ⇒ phải chốt được ngay tại đây.
   */
  it('true ⇒ 预付 (mã "P")', () => {
    expect(payWayOf(true)?.code).toBe('P')
    expect(payWayOf(true)?.label).toBe('预付')
  })
  it('false ⇒ 到付 (mã "C")', () => {
    expect(payWayOf(false)?.code).toBe('C')
    expect(payWayOf(false)?.label).toBe('到付')
  })
  it('1 ⇒ 预付 (mã "P")', () => {
    expect(payWayOf(1)?.code).toBe('P')
  })
  it('0 ⇒ 到付 (mã "C")', () => {
    expect(payWayOf(0)?.code).toBe('C')
  })
  it('2 (giá trị lạ) ⇒ KHÔNG đoán, bỏ trống', () => {
    expect(payWayOf(2)).toBeUndefined()
  })
  it('null ⇒ KHÔNG đoán, bỏ trống', () => {
    expect(payWayOf(null)).toBeUndefined()
  })
  it('undefined ⇒ KHÔNG đoán, bỏ trống', () => {
    expect(payWayOf(undefined)).toBeUndefined()
  })
})

describe('MappingContext', () => {
  it('không còn cấu hình portNameField (site chỉ gợi ý tên Trung)', () => {
    // Directive `@ts-expect-error` LÀ phần assert: nếu `portNameField` còn nằm
    // trong `MappingContext` thì directive thành thừa ⇒ TypeScript báo TS2578
    // ⇒ test đỏ. Biến chỉ tồn tại để kích hoạt lỗi đó.
    // @ts-expect-error — `portNameField` đã bị gỡ khỏi `MappingContext`.
    const legacyCtx: MappingContext = { ...ctx, portNameField: 'START_PORT_NAM' }
    void legacyCtx
  })
})

/**
 * Nhãn đơn vị trọng lượng.
 *
 * Site ghi 公斤 cho các field trọng lượng (货物毛重（公斤）/ 货物净重（公斤）/
 * 箱内货重（公斤）) và extension ghi đúng giá trị KG của API ⇒ nhãn phải là
 * `kg`, KHÔNG phải `ton` (lệch 1000 lần so với giá trị 22400).
 */
describe('nhãn trọng lượng', () => {
  it('field trọng lượng của dòng hàng ghi kg', () => {
    expect(CARGO_LABELS.GWEIGHT_TON).toBe('毛重 (kg)')
    expect(CARGO_LABELS.NWEIGHT_TON).toBe('净重 (kg)')
  })

  it('field trọng lượng của container ghi kg', () => {
    expect(CONTAINER_LABELS.WEIGH_TON).toBe('箱内货重 (kg)')
  })

  it('tổng trọng lượng của header ghi kg (cùng đại lượng với 货物毛重)', () => {
    expect(HEADER_LABELS.TOTAL_GWEIGHT_TON).toBe('Total gross weight (kg)')
  })

  it('KHÔNG còn nhãn nhắc tới "ton" ở bất kỳ field nào', () => {
    // Bắt cả "ton"/"tons"/"TON" — nhãn ghi sai đơn vị ở bất kỳ chính tả nào
    // cũng là sai ⇒ không khớp chính xác "(ton)" là không đủ.
    for (const labels of [HEADER_LABELS, CARGO_LABELS, CONTAINER_LABELS]) {
      for (const label of Object.values(labels)) {
        expect(label).not.toMatch(/tons?\b/i)
      }
    }
  })
})

/**
 * Field AEO của site.
 *
 * Site chỉ có `SHIPPER_AEO` / `CONSIGNEE_AEO` — KHÔNG có `NOTIFY_AEO`
 * (FACT 1 của plan live-site-alignment) ⇒ nhãn và note cho 通知人 AEO phải bị
 * gỡ khỏi metadata.
 */
describe('field AEO', () => {
  it('KHÔNG có NOTIFY_AEO', () => {
    expect(HEADER_LABELS.NOTIFY_AEO).toBeUndefined()
    expect(BLANK_NOTES.NOTIFY_AEO).toBeUndefined()
  })

  it('giữ SHIPPER_AEO / CONSIGNEE_AEO (site CÓ 2 field này)', () => {
    expect(HEADER_LABELS.SHIPPER_AEO).toBe('发货人 (AEO)')
    expect(HEADER_LABELS.CONSIGNEE_AEO).toBe('收货人 (AEO)')
    expect(BLANK_NOTES.SHIPPER_AEO).toBeDefined()
    expect(BLANK_NOTES.CONSIGNEE_AEO).toBeDefined()
  })
})
