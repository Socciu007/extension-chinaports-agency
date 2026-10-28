import { describe, it, expect } from 'vitest'
import { blockingFields, describeIncompleteFill } from '../src/core/report'
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

describe('describeIncompleteFill', () => {
  it('có `message` ⇒ trả về nguyên văn message', () => {
    const message = 'Open the 预配舱单申报平台 page and try again.'
    expect(describeIncompleteFill([], message)).toBe(message)
  })

  it('có `message` ⇒ ưu tiên hơn cả danh sách field bị chặn', () => {
    const message = 'Something went wrong while filling the manifest.'
    const items = [item({ status: 'skip', required: true })]
    expect(describeIncompleteFill(items, message)).toBe(message)
  })

  it('không `message` nhưng có field bị chặn ⇒ nêu TÊN của mọi field bị chặn', () => {
    const items = [
      item({ prop: 'PAY_WAY_ID', label: '付款方式', status: 'skip', required: true }),
      item({ prop: 'FREIGHT_TERM', label: '交货条款', status: 'error', required: true }),
    ]
    const text = describeIncompleteFill(items)
    expect(text).toContain('付款方式')
    expect(text).toContain('交货条款')
    expect(text).toContain('2')
    // KHÔNG được quy mọi field bị chặn là "API không có dữ liệu": field `warn`
    // / `error` nghĩa là SITE từ chối giá trị — API có dữ liệu.
    expect(text).not.toContain('no data from the API')
  })

  it('field `warn` bị chặn KHÔNG bị quy là "API không có dữ liệu"', () => {
    const items = [item({ label: '卸货港', status: 'warn', required: true })]
    const text = describeIncompleteFill(items)
    expect(text).toContain('卸货港')
    expect(text).not.toContain('no data from the API')
    expect(text).not.toContain('API provides no data')
  })

  it('required `skip` + non-required `warn` cùng lúc ⇒ chỉ field required mới chặn', () => {
    const items = [
      item({ prop: 'PAY_WAY_ID', label: '付款方式', status: 'skip', required: true }),
      item({ prop: 'START_PORT_NAM', label: '卸货港', status: 'warn', required: false }),
    ]
    expect(blockingFields(items).map((f) => f.prop)).toEqual(['PAY_WAY_ID'])
    const text = describeIncompleteFill(items)
    expect(text).toContain('付款方式')
    expect(text).not.toContain('卸货港')
  })

  it('field không bắt buộc bị skip KHÔNG được coi là field chặn', () => {
    const items = [item({ label: 'EMAIL', status: 'skip', required: false })]
    const text = describeIncompleteFill(items)
    expect(text).not.toContain('EMAIL')
  })

  it('chỉ có warn/error không bắt buộc ⇒ nêu tên các field đó', () => {
    const items = [
      item({ prop: 'A', label: '甲', status: 'warn' }),
      item({ prop: 'B', label: '乙', status: 'error' }),
    ]
    const text = describeIncompleteFill(items)
    expect(text).toContain('甲')
    expect(text).toContain('乙')
  })

  it('không có gì cả ⇒ trả về câu chung', () => {
    expect(describeIncompleteFill([])).toBe('Could not fill the manifest data.')
  })

  it('mọi field đều ok ⇒ trả về câu chung', () => {
    const items = [item({ status: 'ok', required: true }), item({ status: 'skip' })]
    expect(describeIncompleteFill(items)).toBe('Could not fill the manifest data.')
  })
})
