/**
 * URL/route của trang khai 预配舱单 trên site chinaports-agency.
 *
 * Một nguồn duy nhất: trước đây URL này bị hardcode ở nhiều chỗ (content script,
 * popup) ⇒ sửa một chỗ là các chỗ còn lại lệch.
 */

/** Route (phần sau `#`) của trang khai 预配舱单. */
export const MANIFEST_ROUTE = '/exportBusinessOperations/maintenanceOfManifestData'

/** URL đầy đủ của trang khai 预配舱单. */
export const MANIFEST_URL = `https://www.chinaports-agency.com:8870/#${MANIFEST_ROUTE}`

/**
 * Route nằm trong phần hash của URL — bỏ `#` đầu, cắt ở `?`/`#` kế tiếp.
 *
 * Query string và fragment sau route KHÔNG phải route ⇒ phải cắt bỏ trước
 * khi so.
 *
 * Có một hàm này vì popup và content script PHẢI hiểu "trang khai 预配舱单"
 * giống hệt nhau. Trước đây hai bên tự viết luật riêng và lệch nhau: popup
 * so tiền tố nên nhận nhầm route `…maintenanceOfManifestDataExtra`, reload
 * xong content script vẫn từ chối ⇒ operator mắc vòng lặp, không thoát ra
 * được. Dùng chung một chỗ ⇒ hai bên không thể lệch nhau nữa.
 *
 * So KHỚP CHÍNH XÁC (`===`), KHÔNG so tiền tố: route của site là tiền tố
 * của một route khác có thật (`…maintenanceOfManifestDataExtra`).
 */
export function routeOfHash(hash: string): string {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash
  return withoutHash.split(/[?#]/)[0] ?? ''
}
