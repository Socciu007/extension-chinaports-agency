import { mkdir, writeFile } from 'node:fs/promises'

const blNo = process.argv[2] ?? 'ONEYSHAGT1569600'
const url = `https://www.dadaex.cn/api/vn/insight/manifest?blNo=${encodeURIComponent(blNo)}`

const res = await fetch(url)
if (!res.ok) {
  console.error(`HTTP ${res.status}`)
  process.exit(1)
}
const json = await res.json()
if (!json?.data) {
  console.error(`Không có data cho blNo=${blNo}:`, json)
  process.exit(1)
}

await mkdir('tests/fixtures', { recursive: true })
const path = `tests/fixtures/manifest-${blNo}.json`
await writeFile(path, JSON.stringify(json, null, 2), 'utf8')
console.log('đã ghi', path, '— status:', json.status)
