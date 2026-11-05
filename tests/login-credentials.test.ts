import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  EMPTY_LOGIN_CREDENTIALS,
  LOGIN_CREDENTIALS_KEY,
  missingLoginCredentialLabels,
  readLoginCredentials,
  writeLoginCredentials,
  type LoginCredentials,
} from '../src/core/login-credentials'

const CREDENTIALS: LoginCredentials = {
  siteUsername: 'site-user',
  sitePassword: 'site-pass',
  ocrUser: 'ocr-user',
  ocrPassword: 'ocr-pass',
  ocrSoftwareId: 'soft-id',
}

const store: Record<string, unknown> = {}
/** Payload thực sự gửi cho `chrome.storage.local.set` — để assert key nào bị ghi. */
let setCalls: Record<string, unknown>[]

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  setCalls = []
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (values: Record<string, unknown>) => {
          setCalls.push(values)
          Object.assign(store, values)
        },
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readLoginCredentials', () => {
  it('chưa lưu gì ⇒ trả về credentials rỗng', async () => {
    const credentials = await readLoginCredentials()

    expect(credentials).toEqual(EMPTY_LOGIN_CREDENTIALS)
  })

  it('lưu rồi ⇒ đọc lại được đúng', async () => {
    await writeLoginCredentials(CREDENTIALS)

    const credentials = await readLoginCredentials()

    expect(credentials).toEqual(CREDENTIALS)
  })

  it('KHÔNG có chrome.storage.local ⇒ trả về credentials rỗng, KHÔNG ném', async () => {
    // Storage bị chặn bởi policy ⇒ không được làm hỏng cả chế độ login.
    vi.stubGlobal('chrome', undefined)

    const credentials = await readLoginCredentials()

    expect(credentials).toEqual(EMPTY_LOGIN_CREDENTIALS)
  })

  it('storage đọc lỗi ⇒ trả về credentials rỗng, KHÔNG ném', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async () => {
            throw new Error('storage disabled')
          },
          set: async () => undefined,
        },
      },
    })

    const credentials = await readLoginCredentials()

    expect(credentials).toEqual(EMPTY_LOGIN_CREDENTIALS)
  })

  it('giá trị trong storage KHÔNG phải object ⇒ credentials rỗng', async () => {
    // Storage có thể bị sửa tay ⇒ không được tin vào hình dạng của nó.
    store[LOGIN_CREDENTIALS_KEY] = 'not-an-object'

    const credentials = await readLoginCredentials()

    expect(credentials).toEqual(EMPTY_LOGIN_CREDENTIALS)
  })

  it('một field KHÔNG phải chuỗi ⇒ field đó rỗng, field khác giữ nguyên', async () => {
    store[LOGIN_CREDENTIALS_KEY] = { ...CREDENTIALS, sitePassword: 42 }

    const credentials = await readLoginCredentials()

    expect(credentials.sitePassword).toBe('')
    expect(credentials.siteUsername).toBe('site-user')
    expect(credentials.ocrUser).toBe('ocr-user')
  })

  it('thiếu một field ⇒ field đó rỗng', async () => {
    store[LOGIN_CREDENTIALS_KEY] = { siteUsername: 'site-user' }

    const credentials = await readLoginCredentials()

    expect(credentials.siteUsername).toBe('site-user')
    expect(credentials.sitePassword).toBe('')
    expect(credentials.ocrSoftwareId).toBe('')
  })
})

describe('writeLoginCredentials', () => {
  it('ghi vào chrome.storage.local, đúng key', async () => {
    await writeLoginCredentials(CREDENTIALS)

    expect(setCalls).toHaveLength(1)
    expect(setCalls[0]).toEqual({ [LOGIN_CREDENTIALS_KEY]: CREDENTIALS })
    expect(store[LOGIN_CREDENTIALS_KEY]).toEqual(CREDENTIALS)
  })

  it('KHÔNG có chrome.storage.local ⇒ phải ném lỗi', async () => {
    // Không có storage ⇒ không có gì được ghi ⇒ phải báo thất bại, KHÔNG
    // được báo thành công.
    vi.stubGlobal('chrome', undefined)

    await expect(writeLoginCredentials(CREDENTIALS)).rejects.toThrow()
  })

  it('storage set lỗi ⇒ phải ném lỗi', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {
            throw new Error('quota exceeded')
          },
        },
      },
    })

    await expect(writeLoginCredentials(CREDENTIALS)).rejects.toThrow()
  })

  it('KHÔNG ghi vào storage.sync (mật khẩu không được rời khỏi máy)', async () => {
    const syncSet = vi.fn(async () => undefined)
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => undefined,
        },
        sync: { get: async () => ({}), set: syncSet },
      },
    })

    await writeLoginCredentials(CREDENTIALS)

    expect(syncSet).not.toHaveBeenCalled()
  })
})

describe('missingLoginCredentialLabels', () => {
  it('mọi field rỗng ⇒ liệt kê TẤT CẢ nhãn, đúng thứ tự', () => {
    const labels = missingLoginCredentialLabels(EMPTY_LOGIN_CREDENTIALS)

    expect(labels).toEqual([
      'site account',
      'site password',
      'captcha service user',
      'captcha service password',
      'captcha service software ID',
    ])
  })

  it('chỉ liệt kê field ĐANG rỗng', () => {
    const labels = missingLoginCredentialLabels({
      ...CREDENTIALS,
      ocrUser: '',
      ocrSoftwareId: '   ',
    })

    expect(labels).toEqual(['captcha service user', 'captcha service software ID'])
  })

  it('đủ mọi field ⇒ không còn nhãn nào', () => {
    expect(missingLoginCredentialLabels(CREDENTIALS)).toEqual([])
  })
})
