// Dump DOM của trang khai báo 舱单 để CHỐT cấu trúc thật của site.
//
// Cách dùng:
//   1. Mở `https://www.chinaports-agency.com:8870/#/exportBusinessOperations/maintenanceOfManifestData`
//      → tab 待发送 → bấm **新增舱单信息** (mở dialog 货物信息).
//   2. DevTools → Console → dán TOÀN BỘ file này vào → Enter.
//      Script sẽ tự chạy `dumpManifestDom()` và in kết quả ra console.
//   3. Bấm vào ô **收货地（装货港）** để mở popper gợi ý cảng, rồi gõ trong
//      console: `dumpPortPopper()`.
//   4. Lưu kết quả (kèm ảnh chụp màn hình) vào
//      `docs/superpowers/specs/2026-10-26-dom-dump.md`.
//
// Script này KHÔNG tự động chạy được ngoài trang đích (không có `fetch`,
// không có storage) — nó chỉ đọc DOM.

/**
 * Dump cấu trúc các dialog đang mở: tiêu đề + từng form-item.
 *
 * Mục đích: chốt chính xác `id` / `name` / loại control (`el-select`,
 * `el-autocomplete`, `el-cascader`) / `readonly` của từng field ⇒ đối chiếu
 * với selector trong `src/core/dom.ts` và `src/core/select.ts`.
 */
function dumpManifestDom() {
  const dialogs = Array.from(document.querySelectorAll('.el-dialog'))
  const payload = dialogs.map((dialog) => ({
    title: dialog.querySelector('.el-dialog__title')?.textContent?.trim() ?? '(không tiêu đề)',
    items: Array.from(dialog.querySelectorAll('.el-form-item')).map((item) => {
      const input = item.querySelector('input, textarea')
      return {
        label: item.querySelector('.el-form-item__label')?.textContent?.trim() ?? '',
        id: input?.id ?? null,
        name: input?.getAttribute('name') ?? null,
        readonly: input?.readOnly ?? false,
        hasSelect: Boolean(item.querySelector('.el-select')),
        hasAutocomplete: Boolean(item.querySelector('.el-autocomplete')),
        hasCascader: Boolean(item.querySelector('.el-cascader')),
        html: item.innerHTML.slice(0, 300),
      }
    }),
  }))
  console.log('=== MANIFEST DIALOG DUMP ===')
  console.log(JSON.stringify(payload, null, 2))
  return payload
}

/**
 * Dump các popper đang mở (gợi ý cảng của `el-autocomplete`).
 *
 * Mục đích: xác nhận cấu trúc option gợi ý là `名称/代码` (tách theo dấu
 * `/` CUỐI CÙNG) — điều mà `src/core/select.ts` dựa vào khi chọn cảng.
 */
function dumpPortPopper() {
  const poppers = Array.from(document.querySelectorAll('.el-popper'))
  console.log('=== PORT POPPER DUMP ===')
  console.log(JSON.stringify(poppers.map((p) => p.outerHTML.slice(0, 2500)), null, 2))
  return poppers.length
}

// Chạy ngay khi dán — dump dialog (bước 2 ở trên).
dumpManifestDom()
