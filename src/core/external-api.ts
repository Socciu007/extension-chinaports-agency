import { fetchJsonWithTimeout, HttpTimeoutError, type JsonResponse } from './http'
import { billNoAsWritten } from './bill-no'
import type { ManifestApiData } from './types'

/**
 * The external service the extension calls back after the manifest bill has
 * been created on the site.
 *
 * It is the same host as the manifest data API (`/api/vn/insight/manifest`)
 * ⇒ `host_permissions` already covers it.
 */
export const EXTERNAL_SUBMIT_URL = 'https://www.dadaex.cn/api/vn/yitong/submitManifest'

export type ExternalApiErrorKind = 'network' | 'http' | 'bad_response' | 'timeout'

export class ExternalApiError extends Error {
  readonly kind: ExternalApiErrorKind
  readonly status: number | undefined

  constructor(kind: ExternalApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ExternalApiError'
    this.kind = kind
    this.status = status
  }
}

// A string to display to the user, according to the `kind` — English.
export function describeExternalApiError(error: unknown): string {
  if (error instanceof ExternalApiError) {
    switch (error.kind) {
      case 'network':
        return 'Could not reach the external service. Check your network connection.'
      case 'http':
        return 'The external service returned an error. Please try again in a moment.'
      case 'bad_response':
        return 'The external service returned an unexpected response.'
      case 'timeout':
        return 'The external service did not respond in time. Please try again.'
    }
  }
  return 'Something went wrong while saving to the external service.'
}

/** The body of the callback — the four fields the external service reads. */
export interface SubmitManifestPayload {
  /** The id of the order the manifest belongs to. */
  soid?: number | null
  /** The id of the sea order the manifest belongs to. */
  sobid?: number | null
  /** The bill of lading number. */
  blNo?: string | null
  /** The main bill of lading number — the same number for a plain manifest. */
  mainBlNo?: string | null
}

export interface SubmitManifestOptions {
  /** The raw data of the manifest API — it holds the ids of the callback. */
  exBody?: ManifestApiData | null
  /** The bill of lading number the operator typed. */
  blNo?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * Build the body of the callback.
 *
 * The ids come from the data of the manifest API (`exBody`); the bill number
 * is the one the operator typed, with the number of the API as the fallback.
 *
 * The bill number is written the way the site writes it (`billNoAsWritten`):
 * trimmed and upper-cased, so the external service gets the same number as
 * the manifest on the site.
 */
export function buildSubmitManifestPayload(
  exBody: ManifestApiData | null | undefined,
  blNo: string | null | undefined,
): SubmitManifestPayload {
  const typed = billNoAsWritten(blNo ?? '')
  const written = typed !== '' ? typed : billNoAsWritten(exBody?.blNo ?? '')
  return {
    soid: exBody?.oid,
    sobid: exBody?.sea_order?.sea_order_bind?.id,
    blNo: written !== '' ? written : null,
    mainBlNo: written !== '' ? written : null,
  }
}

/**
 * Send the callback to the external service.
 *
 * The shape of the answer of this endpoint was never checked against the live
 * service ⇒ the body is accepted as long as it is JSON. A numeric `status`
 * that is not 1 is a failure: the manifest API of the SAME host uses
 * `{status: 1}` for success, so the envelope of the two is very likely the
 * same. A body without a numeric `status` is accepted — an unknown shape must
 * not stop a manifest that was already created on the site.
 */
export async function submitManifestToExternalApi(
  options: SubmitManifestOptions,
): Promise<unknown> {
  const payload = buildSubmitManifestPayload(options.exBody, options.blNo)

  let res: JsonResponse
  try {
    res = await fetchJsonWithTimeout(
      EXTERNAL_SUBMIT_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      { fetchImpl: options.fetchImpl ?? fetch, timeoutMs: options.timeoutMs },
    )
  } catch (e) {
    if (e instanceof HttpTimeoutError) {
      throw new ExternalApiError('timeout', e.message)
    }
    throw new ExternalApiError(
      'network',
      `Could not reach the external service: ${(e as Error).message}`,
    )
  }

  if (!res.ok) {
    throw new ExternalApiError(
      'http',
      `The external service returned HTTP ${res.status}`,
      res.status,
    )
  }

  if (res.invalidJson) {
    throw new ExternalApiError(
      'bad_response',
      'The external service response is not valid JSON',
    )
  }

  const body = res.data
  const status = (body as { status?: unknown } | undefined)?.status
  if (typeof status === 'number' && status !== 1) {
    throw new ExternalApiError(
      'bad_response',
      `The external service rejected the manifest (status ${status}).`,
    )
  }

  return body
}
