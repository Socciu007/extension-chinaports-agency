#!/usr/bin/env node
// Kiểm tra rằng mọi đường dẫn cục bộ mà `dist/manifest.json` tham chiếu tới đều tồn tại.
//
// Chrome từ chối nạp extension nếu manifest trỏ tới file không tồn tại
// (ví dụ "Could not load icon 'public/logo.png' specified in 'action'."),
// nhưng `vite build` không bắt được lỗi này — nên cần script này.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const manifestPath = join(distDir, 'manifest.json')

if (!existsSync(manifestPath)) {
  console.error('✗ Không tìm thấy dist/manifest.json — hãy chạy `npm run build` trước.')
  process.exit(1)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  console.error(`✗ Không đọc được dist/manifest.json: ${error.message}`)
  process.exit(1)
}

/** Gom mọi đường dẫn cục bộ mà manifest tham chiếu tới. */
function collectPaths(manifest) {
  const paths = []
  const icons = manifest.icons ?? {}
  for (const size of Object.keys(icons)) {
    paths.push({ label: `icons.${size}`, value: icons[size] })
  }
  const defaultIcon = manifest.action?.default_icon ?? {}
  for (const size of Object.keys(defaultIcon)) {
    paths.push({ label: `action.default_icon.${size}`, value: defaultIcon[size] })
  }
  if (manifest.action?.default_popup) {
    paths.push({ label: 'action.default_popup', value: manifest.action.default_popup })
  }
  if (manifest.options_page) {
    paths.push({ label: 'options_page', value: manifest.options_page })
  }
  if (manifest.options_ui?.page) {
    paths.push({ label: 'options_ui.page', value: manifest.options_ui.page })
  }
  if (manifest.background?.service_worker) {
    paths.push({
      label: 'background.service_worker',
      value: manifest.background.service_worker,
    })
  }
  const contentScripts = manifest.content_scripts ?? []
  for (const [i, script] of contentScripts.entries()) {
    for (const [j, js] of (script.js ?? []).entries()) {
      paths.push({ label: `content_scripts[${i}].js[${j}]`, value: js })
    }
    for (const [j, css] of (script.css ?? []).entries()) {
      paths.push({ label: `content_scripts[${i}].css[${j}]`, value: css })
    }
  }
  return paths
}

const referenced = collectPaths(manifest)
const missing = []

for (const { label, value } of referenced) {
  if (typeof value !== 'string' || value.length === 0) {
    missing.push(`${label} — giá trị không hợp lệ: ${JSON.stringify(value)}`)
    continue
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    // URL ngoài (http:, https:, data:) — không phải file cục bộ.
    continue
  }
  const target = join(distDir, value)
  if (!existsSync(target)) {
    missing.push(`${label} -> ${value} (thiếu file: ${target})`)
  }
}

if (missing.length > 0) {
  console.error(`✗ Manifest trỏ tới ${missing.length} file không tồn tại trong dist/:`)
  for (const entry of missing) {
    console.error(`  - ${entry}`)
  }
  process.exit(1)
}

console.log(`✓ Manifest hợp lệ — ${referenced.length} đường dẫn cục bộ đều tồn tại trong dist/:`)
for (const { label, value } of referenced) {
  console.log(`  - ${label} -> ${value}`)
}
