/**
 * Số bill của tờ khai — hai dạng khác nhau, KHÔNG được gộp.
 *
 * - `normalizeBlNo` — dạng TRA CỨU: bỏ hậu tố piece (`P1`, `P12`) vì API
 *   bên ngoài chỉ biết mã gốc;
 * - `billNoAsWritten` — dạng GHI LÊN SITE: giữ hậu tố piece, chỉ trim +
 *   upper-case cho đúng dạng viết HOA của số bill.
 *
 * Module này đứng riêng (không import từ `api.ts` lẫn `payload.ts`) ⇒
 * `api.ts` và `payload.ts` có thể import lẫn nhau mà KHÔNG tạo vòng import.
 */

// Bỏ hậu tố piece khỏi số bill.
export function normalizeBlNo(raw: string): string {
  return raw.trim().toUpperCase().replace(/(?<=\d)P\d+$/, '')
}

// Số bill theo đúng như operator gõ (giữ hậu tố piece).
export function billNoAsWritten(raw: string): string {
  return raw.trim().toUpperCase()
}
