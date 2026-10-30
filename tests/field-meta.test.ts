import { describe, it, expect } from 'vitest'
import {
  contactRole,
  deriveCargoKind,
  payWayOf,
  type MappingContext,
} from '../src/core/field-meta'

/**
 * Ngữ cảnh giả lập — chỉ dùng để kiểm tra KIỂU của `MappingContext`.
 *
 * Sau khi bỏ đường DOM không còn hàm map nào đọc `ctx` ⇒ các hàm tra cứu
 * trả `undefined` hết, đúng như site không có dữ liệu từ điển.
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
    // @ts-expect-error — `portNameField` đã bị gỡ khỏi `MappingContext`.
    const legacyCtx: MappingContext = { ...ctx, portNameField: 'START_PORT_NAM' }
    expect(legacyCtx).toBeTruthy()
  })
})
