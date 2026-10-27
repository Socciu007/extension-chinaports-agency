import { describe, it, expect, beforeEach } from 'vitest'
import { fillContainerRows } from '../src/core/fill'
import { readTableHandles, findColumnIndex } from '../src/core/table'
import { mapContainer, type MappingContext } from '../src/core/mapping'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'
import type { ManifestData } from '../src/core/types'
import { buildContainerSection, simulateAddRow, CONTAINER_COLUMNS } from './helpers/dom'

const data = fixture.data as unknown as ManifestData
const container = data.cdCon![0]!

const ctx: MappingContext = {
  findTrustCode: () => undefined,
  findDrType: () => undefined,
  findPort: () => undefined,
  findCntrType: (raw) => (String(raw) === '2' ? '20GP' : undefined),
  findCntrSize: (raw) => (String(raw) === '0' ? "20'" : undefined),
  portNameField: 'name',
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('readTableHandles / findColumnIndex', () => {
  it('đọc được 9 cột header', () => {
    buildContainerSection()
    const table = document.querySelector('.el-table') as HTMLElement
    const handles = readTableHandles(table)
    expect(handles.headerCells).toHaveLength(9)
  })

  it('tìm đúng index của cột 箱号', () => {
    buildContainerSection()
    const table = document.querySelector('.el-table') as HTMLElement
    const handles = readTableHandles(table)
    expect(findColumnIndex(handles.headerCells, '箱号')).toBe(0)
    expect(findColumnIndex(handles.headerCells, '铅封号')).toBe(CONTAINER_COLUMNS.indexOf('铅封号'))
  })
})

describe('fillContainerRows', () => {
  it('thêm dòng và điền các ô trong bảng', async () => {
    buildContainerSection()
    simulateAddRow()

    const result = await fillContainerRows(document, [container], ctx)

    expect(result.rows).toBe(1)
    const tbody = document.querySelector('.el-table__body tbody')!
    const cells = tbody.querySelectorAll('td')
    expect((cells[0]!.querySelector('input') as HTMLInputElement).value).toBe('ONEU1437898')
    expect((cells[4]!.querySelector('input') as HTMLInputElement).value).toBe('CN28731BH')
  })

  it('báo lỗi khi không thấy bảng container', async () => {
    document.body.innerHTML = '<div></div>'
    const result = await fillContainerRows(document, [container], ctx)
    expect(result.rows).toBe(0)
    expect(result.items.some((i) => i.status === 'error')).toBe(true)
  })
})
