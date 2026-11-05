/**
 * The login details of the user — the site account and the captcha-service
 * account.
 *
 * The details live in `chrome.storage.local`, NEVER in `chrome.storage.sync`:
 * a synced password leaves the machine (it is uploaded to the Google account
 * and copied to every other machine of the user).
 *
 * The details are only used by the login mode of the popup and are sent
 * nowhere except the site itself and the captcha service.
 */

/** The details needed to log in to the site and to the captcha service. */
export interface LoginCredentials {
  /** The account of the site (the operator of the manifest). */
  siteUsername: string
  /** The password of the site. */
  sitePassword: string
  /** The user of the captcha service (超級鹰 / chaojiying). */
  ocrUser: string
  /** The password of the captcha service. */
  ocrPassword: string
  /** The software ID of the captcha service. */
  ocrSoftwareId: string
}

/** The details when nothing is stored yet — every field is empty. */
export const EMPTY_LOGIN_CREDENTIALS: LoginCredentials = {
  siteUsername: '',
  sitePassword: '',
  ocrUser: '',
  ocrPassword: '',
  ocrSoftwareId: '',
}

/** Key in `chrome.storage.local` — NOT `sync` (a synced password leaves the machine). */
export const LOGIN_CREDENTIALS_KEY = 'manifest-autofill:login-credentials'

/** The label of every field — the order is the order of the fields. */
const CREDENTIAL_LABELS: ReadonlyArray<{ key: keyof LoginCredentials; label: string }> = [
  { key: 'siteUsername', label: 'site account' },
  { key: 'sitePassword', label: 'site password' },
  { key: 'ocrUser', label: 'captcha service user' },
  { key: 'ocrPassword', label: 'captcha service password' },
  { key: 'ocrSoftwareId', label: 'captcha service software ID' },
]

/** The area of the storage — `undefined` when it is not there at all. */
function localArea(): chrome.storage.StorageArea | undefined {
  if (typeof chrome === 'undefined') return undefined
  return chrome.storage?.local
}

/** A string field of the credentials — anything that is not a string is empty. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The credentials of a raw value of the storage.
 *
 * A value that is not an object at all (the storage can be edited by hand)
 * gives the EMPTY credentials — never a made-up value.
 */
function toCredentials(raw: unknown): LoginCredentials {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...EMPTY_LOGIN_CREDENTIALS }
  }
  const source = raw as Record<string, unknown>
  return {
    siteUsername: textOf(source.siteUsername),
    sitePassword: textOf(source.sitePassword),
    ocrUser: textOf(source.ocrUser),
    ocrPassword: textOf(source.ocrPassword),
    ocrSoftwareId: textOf(source.ocrSoftwareId),
  }
}

/**
 * Read the login details.
 *
 * Never throws: a missing area, a missing key, a failed read or a value of
 * the wrong type give the EMPTY credentials. The login flow reports the
 * missing details itself, so a broken storage must not throw here.
 */
export async function readLoginCredentials(): Promise<LoginCredentials> {
  const area = localArea()
  if (!area) return { ...EMPTY_LOGIN_CREDENTIALS }
  try {
    const stored = (await area.get(LOGIN_CREDENTIALS_KEY)) as Record<string, unknown>
    return toCredentials(stored[LOGIN_CREDENTIALS_KEY])
  } catch {
    // The storage may be blocked by a policy ⇒ the login details are simply
    // not available; the UI reports it.
    return { ...EMPTY_LOGIN_CREDENTIALS }
  }
}

/**
 * Save the login details.
 *
 * Throws when the storage is not there (or the write fails): the user asked
 * for the details to be saved ⇒ a silent "Saved." would be a lie.
 */
export async function writeLoginCredentials(credentials: LoginCredentials): Promise<void> {
  const area = localArea()
  if (!area) throw new Error('chrome.storage.local is not available')
  await area.set({ [LOGIN_CREDENTIALS_KEY]: toCredentials(credentials) })
}

/**
 * The labels of the fields that are still empty — for the message of the UI.
 *
 * The order is the order of the fields, so the message always reads the same.
 */
export function missingLoginCredentialLabels(credentials: LoginCredentials): string[] {
  const labels: string[] = []
  for (const entry of CREDENTIAL_LABELS) {
    const value = credentials[entry.key]
    if (textOf(value).trim() === '') labels.push(entry.label)
  }
  return labels
}
