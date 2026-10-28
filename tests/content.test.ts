import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MSG_FILL, MSG_GET_BL_NO } from '../src/core/protocol'

type SendResponse = (response: unknown) => void
type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: SendResponse,
) => boolean | undefined

const MANIFEST_HASH = '#/exportBusinessOperations/maintenanceOfManifestData'

let listener: Listener | undefined
/** Mở chốt để `fetch` treo cho tới khi test kết thúc. */
let release: (() => void) | undefined
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  // `inFlight` là trạng thái ở MỨC MODULE ⇒ phải nạp lại module cho mỗi test.
  vi.resetModules()
  listener = undefined
  release = undefined

  // `fetch` treo mãi ⇒ lần điền đầu vẫn đang chạy ⇒ lần điền thứ hai phải
  // bị chặn. Hết test thì mở chốt để chuỗi promise settle và timer timeout
  // trong `http.ts` được clear.
  fetchMock = vi.fn(
    async () =>
      new Promise((_resolve, reject) => {
        release = () => reject(new Error('test: fetch released'))
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn
        },
      },
    },
  })

  location.hash = MANIFEST_HASH
  await import('../src/content/index')
})

afterEach(async () => {
  release?.()
  // Đợi chuỗi promise kịp settle.
  await new Promise((resolve) => setTimeout(resolve, 0))
  location.hash = ''
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('content script — chống hai lần điền chồng nhau', () => {
  it('MSG_FILL thứ hai bị từ chối, không chạm network lần nữa', async () => {
    const send1 = vi.fn()
    const send2 = vi.fn()

    const ret1 = listener?.({ type: MSG_FILL, blNo: 'ONEYSHAGT1569600' }, {}, send1)
    const ret2 = listener?.({ type: MSG_FILL, blNo: 'ONEYSHAGT1569600' }, {}, send2)

    // Lần đầu trả `true` (trả lời bất đồng bộ); lần thứ hai trả `false`
    // vì đã trả lời ngay trong lời gọi.
    expect(ret1).toBe(true)
    expect(ret2).toBe(false)

    expect(send2).toHaveBeenCalledTimes(1)
    expect(send2).toHaveBeenCalledWith({
      ok: false,
      message: 'A fill is already running — wait for it to finish.',
      items: [],
      cargoRows: 0,
      containerRows: 0,
    })

    // Chỉ MỘT lần gọi API: lần điền thứ hai phải bị chặn TRƯỚC khi chạm
    // network — nếu không thì site bị bấm 新增舱单信息 hai lần ⇒ dòng hàng TRÙNG.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lần điền thứ hai không gửi thêm request nào sau khi lần đầu xong', async () => {
    const send1 = vi.fn()
    listener?.({ type: MSG_FILL, blNo: 'ONEYSHAGT1569600' }, {}, send1)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Lần đầu kết thúc (fetch bị lỗi) ⇒ chốt được mở lại ⇒ lần điền SAU đó
    // phải chạy lại bình thường.
    release?.()
    await vi.waitFor(() => expect(send1).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))

    const send3 = vi.fn()
    const ret3 = listener?.({ type: MSG_FILL, blNo: 'ONEYSHAGT1569600' }, {}, send3)
    expect(ret3).toBe(true)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})

describe('content script — đọc 提单号 từ trang', () => {
  it('lấy ô đang hiển thị, không lấy ô của dialog đã đóng', () => {
    document.body.innerHTML = `
      <div style="display:none">
        <input id="crud-old-BILL_NBR" value="OLD-ONE" />
      </div>
      <div>
        <input id="crud-new-BILL_NBR" value="ONEYSHAGT1569600" />
      </div>
    `

    const send = vi.fn()
    const ret = listener?.({ type: MSG_GET_BL_NO }, {}, send)

    expect(ret).toBe(false)
    expect(send).toHaveBeenCalledWith({ ok: true, blNo: 'ONEYSHAGT1569600' })
  })

  it('không có ô nào ⇒ trả về chuỗi rỗng', () => {
    document.body.innerHTML = '<div>nothing here</div>'

    const send = vi.fn()
    listener?.({ type: MSG_GET_BL_NO }, {}, send)

    expect(send).toHaveBeenCalledWith({ ok: true, blNo: '' })
  })
})
