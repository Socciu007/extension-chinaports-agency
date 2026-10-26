import { describe, it, expect } from 'vitest'
import {
  ManifestApiError,
  normalizeBlNo,
  parseEnvelope,
  fetchManifest,
  DEFAULT_API_BASE,
} from '../src/core/api'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'

describe('normalizeBlNo', () => {
  it('bỏ hậu tố piece P1', () => {
    expect(normalizeBlNo('CHN4139065P1')).toBe('CHN4139065')
  })

  it('bỏ hậu tố piece P12', () => {
    expect(normalizeBlNo('ONEYSHAGT1569600P12')).toBe('ONEYSHAGT1569600')
  })

  it('không đụng vào blNo không có hậu tố', () => {
    expect(normalizeBlNo('ONEYSHAGT1569600')).toBe('ONEYSHAGT1569600')
  })

  it('trim và upper-case', () => {
    expect(normalizeBlNo('  chn4139065p1 ')).toBe('CHN4139065')
  })

  it('không bỏ chữ P đứng riêng', () => {
    expect(normalizeBlNo('ABCXP')).toBe('ABCXP')
  })
})

describe('parseEnvelope', () => {
  it('trả về data khi status=1', () => {
    const data = parseEnvelope({ status: 1, messgae: 'success', data: { blNo: 'X' } })
    expect(data.blNo).toBe('X')
  })

  it('ném not_found khi status=0', () => {
    expect(() => parseEnvelope({ status: 0, message: 'data_not_found', data: null })).toThrowError(
      ManifestApiError,
    )
  })

  it('ném not_found khi status=1 nhưng data=null', () => {
    let err: unknown
    try {
      parseEnvelope({ status: 1, messgae: 'success', data: null })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ManifestApiError)
    expect((err as ManifestApiError).kind).toBe('not_found')
  })

  it('ném bad_response khi payload không phải object', () => {
    let err: unknown
    try {
      parseEnvelope('oops')
    } catch (e) {
      err = e
    }
    expect((err as ManifestApiError).kind).toBe('bad_response')
  })
})

describe('fetchManifest', () => {
  it('gọi đúng URL và bóc data', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        status: 200,
        json: async () => fixture,
      } as unknown as Response
    }) as unknown as typeof fetch

    const data = await fetchManifest('ONEYSHAGT1569600', { fetchImpl: fakeFetch })
    expect(calls[0]).toBe(`${DEFAULT_API_BASE}?blNo=ONEYSHAGT1569600`)
    expect(data.blNo).toBe('ONEYSHAGT1569600')
    expect(data.shipName).toBe('CALLAO BRIDGE')
  })

  it('báo lỗi mạng khi fetch throw', async () => {
    const fakeFetch = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    let err: unknown
    try {
      await fetchManifest('X', { fetchImpl: fakeFetch })
    } catch (e) {
      err = e
    }
    expect((err as ManifestApiError).kind).toBe('network')
  })
})
