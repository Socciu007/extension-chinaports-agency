import { describe, it, expect } from 'vitest'
import { blockingFields } from '../src/core/report'
import type { ReportItem } from '../src/core/protocol'

/** Dựng nhanh một `ReportItem` — chỉ cần ghi đè phần khác nhau giữa các test. */
function item(overrides: Partial<ReportItem> = {}): ReportItem {
  return {
    scope: 'header',
    prop: 'PAY_WAY_ID',
    label: '付款方式',
    status: 'ok',
    ...overrides,
  }
}

describe('blockingFields', () => {
  it('field BẮT BUỘC bị skip ⇒ chặn', () => {
    const blocking = blockingFields([item({ status: 'skip', required: true })])
    expect(blocking).toHaveLength(1)
    expect(blocking[0]?.prop).toBe('PAY_WAY_ID')
    expect(blocking[0]?.label).toBe('付款方式')
  })

  it('field BẮT BUỘC bị warn ⇒ chặn', () => {
    expect(blockingFields([item({ status: 'warn', required: true })])).toHaveLength(1)
  })

  it('field BẮT BUỘC bị error ⇒ chặn', () => {
    expect(blockingFields([item({ status: 'error', required: true })])).toHaveLength(1)
  })

  it('field BẮT BUỘC đã điền ok ⇒ KHÔNG chặn', () => {
    expect(blockingFields([item({ status: 'ok', required: true })])).toHaveLength(0)
  })

  it('field KHÔNG bắt buộc bị skip ⇒ KHÔNG chặn (case quan trọng nhất)', () => {
    // EMAIL/FAX/中转港… API không có dữ liệu và cố ý để trống ⇒ vẫn submit được.
    const blocking = blockingFields([item({ status: 'skip', required: false })])
    expect(blocking).toHaveLength(0)
  })

  it('field KHÔNG bắt buộc (required undefined) bị skip ⇒ KHÔNG chặn', () => {
    expect(blockingFields([item({ status: 'skip' })])).toHaveLength(0)
  })

  it('giữ lại prop/scope/row/note của field bị chặn', () => {
    const blocking = blockingFields([
      item({
        scope: 'cargo',
        prop: 'PACKAGE_TYPE',
        label: '包装类型',
        status: 'skip',
        row: 2,
        note: 'API không có dữ liệu',
        required: true,
      }),
    ])
    expect(blocking[0]).toEqual({
      label: '包装类型',
      prop: 'PACKAGE_TYPE',
      scope: 'cargo',
      row: 2,
      note: 'API không có dữ liệu',
    })
  })

  it('danh sách rỗng ⇒ không có field chặn', () => {
    expect(blockingFields([])).toHaveLength(0)
  })

  it('giữ nguyên thứ tự của danh sách field bị chặn', () => {
    const items = [
      item({ prop: 'A', status: 'skip', required: true }),
      item({ prop: 'B', status: 'warn', required: true }),
      item({ prop: 'C', status: 'error', required: true }),
    ]
    expect(blockingFields(items).map((f) => f.prop)).toEqual(['A', 'B', 'C'])
  })
})
