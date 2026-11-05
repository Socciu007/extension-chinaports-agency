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
export const EMPTY_LOGIN_CREDENTIALS: Readonly<LoginCredentials> = Object.freeze({
  siteUsername: '',
  sitePassword: '',
  ocrUser: '',
  ocrPassword: '',
  ocrSoftwareId: '',
})

/** Key in `chrome.storage.local` — NOT `sync` (a synced password leaves the machine). */
export const LOGIN_CREDENTIALS_KEY = 'manifest-autofill:login-credentials'

/** The message of a store that cannot be read. */
export const LOGIN_CREDENTIALS_READ_ERROR =
  'Could not read the login details from the extension options.'

/** The label of every field — the order is the order of the fields. */
const CREDENTIAL_LABELS: ReadonlyArray<{ key: keyof LoginCredentials; label: string }> = [
  { key: 'siteUsername', label: 'site account' },
  { key: 'sitePassword', label: 'site password' },
  { key: 'ocrUser', label: 'captcha service user' },
  { key: 'ocrPassword', label: 'captcha service password' },
  { key: 'ocrSoftwareId', label: 'captcha service software ID' },
]

/**
 * The area of the storage — `undefined` when it is not there at all.
 *
 * The READ needs `get` ⇒ an area without it is not an area at all.
 */
function localArea(): chrome.storage.StorageArea | undefined {
  if (typeof chrome === 'undefined') return undefined
  const area = chrome.storage?.local
  if (typeof area?.get !== 'function') return undefined
  return area
}

/** A plain object — anything else is not a place where the fields can live. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  if (!isPlainObject(raw)) {
    return { ...EMPTY_LOGIN_CREDENTIALS }
  }
  const source = raw
  return {
    siteUsername: textOf(source.siteUsername),
    sitePassword: textOf(source.sitePassword),
    ocrUser: textOf(source.ocrUser),
    ocrPassword: textOf(source.ocrPassword),
    ocrSoftwareId: textOf(source.ocrSoftwareId),
  }
}

/**
 * The result of reading the login details — it says whether the read worked.
 *
 * Telling "nothing stored yet" apart from "the read failed" is a
 * prerequisite: the popup must be able to say that the options could not be
 * read instead of showing an empty form that looks like a fresh install.
 */
export type ReadLoginCredentialsResult =
  | { ok: true; credentials: LoginCredentials }
  | { ok: false; error: string }

/**
 * Read the login details AND REPORT a failure.
 *
 * This is the "truthful" variant of `readLoginCredentials`: the UI needs to
 * know what it really read, so it never shows a made-up value.
 */
export async function readLoginCredentialsResult(): Promise<ReadLoginCredentialsResult> {
  const area = localArea()
  if (!area) return { ok: false, error: LOGIN_CREDENTIALS_READ_ERROR }
  try {
    const stored = (await area.get(LOGIN_CREDENTIALS_KEY)) as Record<string, unknown>
    return { ok: true, credentials: toCredentials(stored[LOGIN_CREDENTIALS_KEY]) }
  } catch (e) {
    // The storage may be blocked by a policy ⇒ the details are not available;
    // the UI reports it.
    console.warn('[manifest-autofill] could not read the login details', e)
    return { ok: false, error: LOGIN_CREDENTIALS_READ_ERROR }
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
  const outcome = await readLoginCredentialsResult()
  return outcome.ok ? outcome.credentials : { ...EMPTY_LOGIN_CREDENTIALS }
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
  // A value that is not an object would be written as the EMPTY credentials
  // ⇒ the saved account and password would be wiped in silence.
  if (!isPlainObject(credentials)) {
    throw new Error('The login details must be an object with the five fields.')
  }
  // A partial stub (a `local` area without `set`) must not produce a raw
  // `TypeError` ⇒ the same error as a missing area.
  if (typeof area.set !== 'function') throw new Error('chrome.storage.local is not available')
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
