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
