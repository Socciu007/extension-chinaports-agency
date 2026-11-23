import { describe, it, expect } from 'vitest'
import {
  buildSubmitManifestPayload,
  describeExternalApiError,
  EXTERNAL_SUBMIT_URL,
  ExternalApiError,
  submitManifestToExternalApi,
} from '../src/core/external-api'
import type { ManifestApiData } from '../src/core/types'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'

// The RAW data of the manifest API — it holds the ids of the callback.
const manifest = fixture.data as ManifestApiData

interface RecordedCall {
  url: string
  method: string
  headers?: HeadersInit
  body?: Record<string, unknown>
}

interface FakeFetchOptions {
  status?: number
  /** The body is not JSON ⇒ `json()` throws. */
  invalidJson?: boolean
}

/** A fetch that answers with one JSON body and records the call. */
function fakeFetch(
  body: unknown,
  options: FakeFetchOptions = {},
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: init?.headers,
      body:
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
    })
    const status = options.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (options.invalidJson === true) throw new Error('not JSON')
        return body
      },
    } as unknown as Response
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('buildSubmitManifestPayload', () => {
  it('lấy soid và sobid từ exBody', () => {
    const payload = buildSubmitManifestPayload(manifest, 'ONEYSHAGT1569600')
    expect(payload.soid).toBe(123688)
    expect(payload.sobid).toBe(120457)
  })

  it('số bill lấy từ operator, trim và upper-case', () => {
    const payload = buildSubmitManifestPayload(manifest, '  oneyshagt1569600  ')
    expect(payload.blNo).toBe('ONEYSHAGT1569600')
    expect(payload.mainBlNo).toBe('ONEYSHAGT1569600')
  })

  it('operator KHÔNG gõ số bill ⇒ lấy số bill của API', () => {
    const payload = buildSubmitManifestPayload(manifest, '')
    expect(payload.blNo).toBe('ONEYSHAGT1569600')
  })

  it('không có exBody ⇒ không có id nào', () => {
    const payload = buildSubmitManifestPayload(null, 'ONEYSHAGT1569600')
    expect(payload.soid).toBeUndefined()
    expect(payload.sobid).toBeUndefined()
  })
})

describe('submitManifestToExternalApi', () => {
  it('POST JSON tới đúng URL với đúng body', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 1, message: 'ok' })
    await submitManifestToExternalApi({
      exBody: manifest,
      blNo: 'ONEYSHAGT1569600',
      fetchImpl,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(EXTERNAL_SUBMIT_URL)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toEqual({
      soid: 123688,
      sobid: 120457,
      blNo: 'ONEYSHAGT1569600',
      mainBlNo: 'ONEYSHAGT1569600',
    })
  })

  it('HTTP lỗi ⇒ lỗi loại http', async () => {
    const { fetchImpl } = fakeFetch({}, { status: 500 })
    await expect(
      submitManifestToExternalApi({ exBody: manifest, blNo: 'X', fetchImpl }),
    ).rejects.toMatchObject({ name: 'ExternalApiError', kind: 'http' })
  })

  it('body KHÔNG phải JSON ⇒ lỗi loại bad_response', async () => {
    const { fetchImpl } = fakeFetch(null, { invalidJson: true })
    await expect(
      submitManifestToExternalApi({ exBody: manifest, blNo: 'X', fetchImpl }),
    ).rejects.toMatchObject({ name: 'ExternalApiError', kind: 'bad_response' })
  })

  it('status KHÁC 1 ⇒ lỗi loại bad_response', async () => {
    const { fetchImpl } = fakeFetch({ status: 0, message: 'no' })
    await expect(
      submitManifestToExternalApi({ exBody: manifest, blNo: 'X', fetchImpl }),
    ).rejects.toMatchObject({ name: 'ExternalApiError', kind: 'bad_response' })
  })

  it('body KHÔNG có status ⇒ vẫn coi là thành công', async () => {
    const { fetchImpl } = fakeFetch({ code: 2000 })
    await expect(
      submitManifestToExternalApi({ exBody: manifest, blNo: 'X', fetchImpl }),
    ).resolves.toEqual({ code: 2000 })
  })
})

describe('describeExternalApiError', () => {
  it('lỗi của external service KHÁC lỗi của site', () => {
    const message = describeExternalApiError(
      new ExternalApiError('network', 'Could not reach the external service'),
    )
    expect(message).toContain('external service')
    expect(message).not.toContain('site')
  })
})
