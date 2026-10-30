import { describe, it, expect } from 'vitest'
import {
  ManifestApiError,
  billNoAsWritten,
  normalizeBlNo,
  parseEnvelope,
  fetchManifest,
  describeApiError,
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

  it('không bỏ hậu tố P<digits> khi mã gốc thật sự kết thúc bằng nó', () => {
    expect(normalizeBlNo('ABCP12')).toBe('ABCP12')
  })
})

/**
 * Số bill ĐI LÊN SITE — giữ hậu tố piece.
 *
 * Số bill trên site CÓ THỂ kèm hậu tố piece (`P1`, `P12`); API của dadaex
 * chỉ nhận mã gốc ⇒ hai số khác nhau, đừng gộp.
 */
describe('billNoAsWritten', () => {
  it('giữ hậu tố piece P1', () => {
    expect(billNoAsWritten('CHN4139065P1')).toBe('CHN4139065P1')
  })

  it('giữ hậu tố piece P12', () => {
    expect(billNoAsWritten('ONEYSHAGT1569600P12')).toBe('ONEYSHAGT1569600P12')
  })

  it('trim và upper-case', () => {
    expect(billNoAsWritten('  chn4139065p1 ')).toBe('CHN4139065P1')
  })

  it('không đụng vào blNo không có hậu tố', () => {
    expect(billNoAsWritten('ONEYSHAGT1569600')).toBe('ONEYSHAGT1569600')
  })

  it('không đụng vào mã gốc thật sự kết thúc bằng P<digits>', () => {
    expect(billNoAsWritten('ABCP12')).toBe('ABCP12')
  })

  it('KHÁC normalizeBlNo (bản tra cứu thì bỏ hậu tố piece)', () => {
    expect(normalizeBlNo('CHN4139065P1')).toBe('CHN4139065')
    expect(billNoAsWritten('CHN4139065P1')).not.toBe(normalizeBlNo('CHN4139065P1'))
  })
})

describe('parseEnvelope', () => {
  it('trả về data khi status=1', () => {
    const data = parseEnvelope({ status: 1, messgae: 'success', data: { blNo: 'X' } })
    expect(data.blNo).toBe('X')
  })

  it('ném not_found khi status=0', () => {
    expect(() => parseEnvelope({ status: 0, message: 'data_not_found', data: null })).toThrowError(
      expect.objectContaining({ kind: 'not_found' }),
    )
  })

  it('giữ nguyên message của envelope lỗi', () => {
    expect(() => parseEnvelope({ status: 0, message: 'data_not_found' })).toThrowError(
      expect.objectContaining({ kind: 'not_found', message: 'data_not_found' }),
    )
  })

  it('ném not_found khi status=1 nhưng data=null', () => {
    expect(() => parseEnvelope({ status: 1, messgae: 'success', data: null })).toThrowError(
      expect.objectContaining({ kind: 'not_found' }),
    )
  })

  it('ném bad_response khi payload không phải object', () => {
    expect(() => parseEnvelope('oops')).toThrowError(
      expect.objectContaining({ kind: 'bad_response' }),
    )
  })

  it('ném bad_response khi payload là array', () => {
    expect(() => parseEnvelope([])).toThrowError(expect.objectContaining({ kind: 'bad_response' }))
  })

  it('ném bad_response khi body không có status dạng số', () => {
    expect(() =>
      parseEnvelope({ errors: 'boom', message: 'server error' }),
    ).toThrowError(expect.objectContaining({ kind: 'bad_response' }))
  })

  it('ném bad_response khi status không phải số', () => {
    expect(() => parseEnvelope({ status: '1', data: {} })).toThrowError(
      expect.objectContaining({ kind: 'bad_response' }),
    )
  })

  it('ném bad_response khi data là array thay vì object manifest', () => {
    expect(() => parseEnvelope({ status: 1, data: [] })).toThrowError(
      expect.objectContaining({ kind: 'bad_response' }),
    )
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

    await expect(fetchManifest('X', { fetchImpl: fakeFetch })).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('hết giờ ⇒ kind timeout, không phải lỗi mạng', async () => {
    // Fetch treo mãi, chỉ chờ tín hiệu abort của timeout.
    const fakeFetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch

    await expect(
      fetchManifest('X', { fetchImpl: fakeFetch, timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('hết giờ khi BODY treo ⇒ kind timeout', async () => {
    // Header về rồi body treo. Nếu timeout chỉ phủ `fetch` mà không phủ lúc
    // đọc body thì `json()` đợi mãi ⇒ popup treo vô hạn.
    const fakeFetch = (async (_url: string, init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      }) as unknown as Response) as unknown as typeof fetch

    await expect(
      fetchManifest('X', { fetchImpl: fakeFetch, timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('báo lỗi http khi response không ok', async () => {
    const fakeFetch = (async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({ errors: 'boom', message: 'server error' }),
      } as unknown as Response
    }) as unknown as typeof fetch

    await expect(fetchManifest('X', { fetchImpl: fakeFetch })).rejects.toMatchObject({
      kind: 'http',
    })
  })

  it('báo bad_response khi body không parse được thành JSON', async () => {
    const fakeFetch = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      } as unknown as Response
    }) as unknown as typeof fetch

    await expect(fetchManifest('X', { fetchImpl: fakeFetch })).rejects.toMatchObject({
      kind: 'bad_response',
    })
  })

  it('dùng baseUrl tuỳ chỉnh', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        status: 200,
        json: async () => fixture,
      } as unknown as Response
    }) as unknown as typeof fetch

    await fetchManifest('ONEYSHAGT1569600', {
      baseUrl: 'https://example.test/manifest',
      fetchImpl: fakeFetch,
    })
    expect(calls[0]).toMatch(/^https:\/\/example\.test\/manifest\?blNo=/)
  })

  it('percent-encode blNo trước khi ghép query', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        status: 200,
        json: async () => fixture,
      } as unknown as Response
    }) as unknown as typeof fetch

    await fetchManifest('AB&CD+EF', { fetchImpl: fakeFetch })
    expect(calls[0]).toContain('blNo=AB%26CD%2BEF')
  })

  it('tự normalize blNo (bỏ hậu tố piece) trước khi gọi API', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        status: 200,
        json: async () => fixture,
      } as unknown as Response
    }) as unknown as typeof fetch

    await fetchManifest('ONEYSHAGT1569600P12', { fetchImpl: fakeFetch })
    expect(calls[0]).toContain('blNo=ONEYSHAGT1569600')
    expect(calls[0]).not.toContain('P12')
  })
})

describe('describeApiError', () => {
  it('trả thông báo tiếng Anh cho kind not_found', () => {
    expect(describeApiError(new ManifestApiError('not_found', 'data_not_found'))).toBe(
      'No manifest was found for this bill of lading number.',
    )
  })

  it('trả thông báo tiếng Anh cho kind network', () => {
    expect(describeApiError(new ManifestApiError('network', 'offline'))).toBe(
      'Could not reach the manifest service. Check your network connection.',
    )
  })

  it('trả thông báo tiếng Anh cho kind http', () => {
    expect(describeApiError(new ManifestApiError('http', 'HTTP 500'))).toBe(
      'The manifest service returned an error. Please try again in a moment.',
    )
  })

  it('trả thông báo tiếng Anh cho kind bad_response', () => {
    expect(describeApiError(new ManifestApiError('bad_response', 'not JSON'))).toBe(
      'The manifest service returned an unexpected response.',
    )
  })

  it('trả thông báo tiếng Anh cho kind timeout', () => {
    expect(describeApiError(new ManifestApiError('timeout', 'timed out'))).toBe(
      'The manifest service did not respond in time. Please try again.',
    )
  })

  it('trả thông báo chung khi lỗi không phải ManifestApiError', () => {
    expect(describeApiError(new Error('boom'))).toBe(
      'Something went wrong while fetching the manifest data.',
    )
  })
})
