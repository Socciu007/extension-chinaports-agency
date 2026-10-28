/**
 * Timeout cứng cho mọi request ra ngoài.
 *
 * Không dùng `AbortSignal.timeout()`: môi trường test (jsdom) không chắc có
 * `AbortSignal.timeout`, và — quan trọng hơn — ta cần phân biệt "hết giờ" với
 * "mạng hỏng" để báo đúng nguyên nhân cho người dùng.
 *
 * Module này còn cung cấp `withDeadline()`: bọc một promise bất kỳ (vd
 * `chrome.tabs.sendMessage`) vào hạn chờ để tầng UI không bao giờ kẹt vĩnh viễn.
 */

/** Thời gian chờ tối đa cho một request. */
export const HTTP_TIMEOUT_MS = 15_000

/** Request quá thời gian chờ — KHÁC với lỗi mạng. */
export class HttpTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HttpTimeoutError'
  }
}

export interface FetchWithTimeoutOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Kết quả của một request JSON. */
export interface JsonResponse {
  /** status HTTP nằm trong khoảng 2xx */
  ok: boolean
  status: number
  /** body đã parse thành JSON; `undefined` khi response không ok */
  data?: unknown
  /** true nếu body không parse được thành JSON */
  invalidJson?: boolean
}

/**
 * `fetch` + timeout cứng, và **đọc body cũng nằm trong cửa sổ timeout**.
 *
 * `fetch()` chỉ resolve khi header về; nếu server gửi header rồi treo body,
 * `res.json()` sẽ đợi mãi. Vì vậy hàm này tự đọc body trước khi tắt timer —
 * nếu không, popup có thể treo vô hạn dù đã bật timeout.
 *
 * Lỗi mạng (DNS, offline, CORS) đi ra nguyên vẹn để tầng trên tự phân loại.
 *
 * LƯU Ý: `init.signal` của caller bị **thay bằng** signal của timeout ở đây.
 * Muốn hủy request từ bên ngoài thì phải truyền `timeoutMs` nhỏ hơn, hoặc
 * dùng `AbortSignal.any([init.signal, controller.signal])` nếu cần cả hai.
 */
export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  options: FetchWithTimeoutOptions = {},
): Promise<JsonResponse> {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const timedOut = () =>
    new HttpTimeoutError(`The request to ${url} timed out after ${timeoutMs}ms`)

  try {
    const res = await doFetch(url, { ...init, signal: controller.signal })
    if (!res.ok) return { ok: false, status: res.status }

    let data: unknown
    try {
      data = await res.json()
    } catch (e) {
      // Abort giữa chừng cũng làm `json()` ném — phải phân biệt với body
      // không phải JSON, nếu không timeout sẽ bị báo nhầm thành lỗi dữ liệu.
      if (controller.signal.aborted) throw timedOut()
      return { ok: true, status: res.status, invalidJson: true }
    }
    return { ok: true, status: res.status, data }
  } catch (e) {
    if (controller.signal.aborted) {
      throw timedOut()
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Hết thời gian chờ một promise bất kỳ (không phải request ra ngoài). */
export class DeadlineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeadlineError'
  }
}

/**
 * Chặn một promise không bao giờ settle.
 *
 * Dùng ở tầng UI: `chrome.tabs.sendMessage` có thể không bao giờ trả lời (tab
 * đã đóng, content script chết) ⇒ nếu không có hạn, nút "Fill data" kẹt ở
 * trạng thái "đang điền" vĩnh viễn và người dùng không làm được gì khác.
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new DeadlineError(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
