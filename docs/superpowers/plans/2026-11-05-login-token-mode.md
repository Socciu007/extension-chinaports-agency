# Login Token Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A popup checkbox ("Get the token by logging in") makes the extension obtain the site's JWT by logging in (captcha → captcha service → login) instead of reading the site's `token` cookie, and in that mode the run no longer requires the browser to sit on the 预配舱单 page.

**Architecture:** The login flow runs in the **popup** (an extension page), not in the content script: Chrome blocks cross-origin requests made by content scripts even when the extension holds the host permission, and the captcha-solving service (`upload.chaojiying.net`) sends no CORS headers. The popup logs in, then passes the token to the content script, which uses it for the site API calls instead of the cookie and skips the `isManifestPage` gate.

**Tech Stack:** Chrome MV3 (`@crxjs/vite-plugin` + Vite 5), Vue 3 `<script setup lang="ts">`, TypeScript 5 (`strict` + `noUncheckedIndexedAccess`), Vitest 2 (jsdom).

**Secrets:** the site account and the captcha-service account are **NOT** committed to git. They live in `chrome.storage.local` (never synced) and are typed once on the Options page.

---

## House rules (every task)

- Single quotes, no trailing semicolons, 2-space indent.
- **New code comments are English** (an existing comment block you only EDIT keeps its language; test names in Vietnamese test files stay Vietnamese).
- **UI strings are English**; Chinese site terminology stays verbatim (提单号, 预配舱单, 确定, 舱单, 承运人代码, 交货条款, 上传船代).
- `npm run verify` = `typecheck && test && build && check-manifest` must pass (except the **46 pre-existing failing tests** — see "Baseline" below).
- **Never** call `send/` / `upload/` / `deleteBill/` / `downloadTemplate/`. The manifest is only ever a draft (`is_all: "1"` = 暂存).
- No background service worker (the build must not produce `background` in `dist/manifest.json`).
- `docs.md` and `tests/fixtures/manifest-ONEYSHAGT1569600.json` must NOT be touched.
- Commit form: `git commit <pathspec> -m "<message>"` — pathspec form, **no `git add` first**, **no `Co-Authored-By` / attribution trailer**.

## Baseline (before this plan)

`npx vitest run` fails **46 tests** — they are stale expectations the user deferred (the popup was refactored to "one result message", the site dictionaries are no longer queried, …). The failing names are listed in `.tmp/baseline.json` (regenerate it with the command below). **Do not try to fix them.** After each task, compare the failing-test NAME list with the baseline: the set must not grow.

```bash
npx vitest run --reporter=json --outputFile=.tmp/after.json >/dev/null 2>&1
node -e "const r=require('./.tmp/after.json');console.log(r.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>f.name.replace(/.*[\\\\/]/,'')+' :: '+a.title)).join('\n'))"
```

## File map

| File | Responsibility |
| --- | --- |
| `src/core/site-url.ts` | URLs/routes of the site — add `SITE_ORIGIN` + `SITE_HOME_URL` (single source of truth) |
| `src/core/login-credentials.ts` | **NEW** — the login details in `chrome.storage.local` (never synced) |
| `src/core/login-token.ts` | **NEW** — captcha → captcha service → login → token |
| `src/core/site-api.ts` | site API calls — a `token` option wins over the site's cookie |
| `src/core/manifest-run.ts` | the run — carries the `token` down to the site calls |
| `src/core/protocol.ts` | the popup → content-script message — `loginMode` + `token` |
| `src/core/options.ts` | the synced settings — add the `loginToken` boolean |
| `src/content/index.ts` | the run — skips the manifest-page gate in login mode |
| `src/popup/App.vue` | the popup — the checkbox, the login, the tab to run in |
| `src/options/App.vue` | the Options page — the login-details form |
| `manifest.config.ts` | the manifest — host permission for the captcha service |

---

### Task 0: The plan itself

**Files:**
- Create: `docs/superpowers/plans/2026-11-05-login-token-mode.md`

- [ ] **Step 1: Commit the plan**

```bash
git commit docs/superpowers/plans/2026-11-05-login-token-mode.md -m "docs: add the implementation plan for the login token mode"
```

---

### Task 1: The core — the login flow, the credentials store, the token channel

**Files:**
- Create: `src/core/login-credentials.ts`
- Create: `src/core/login-token.ts`
- Create: `tests/login-credentials.test.ts`
- Create: `tests/login-token.test.ts`
- Modify: `src/core/site-api.ts`
- Modify: `src/core/manifest-run.ts`
- Modify: `src/core/protocol.ts`
- Modify: `src/core/site-url.ts`
- Modify: `manifest.config.ts`
- Modify: `tests/site-api.test.ts`
- Modify: `tests/manifest-run.test.ts`

#### 1.1 `src/core/site-url.ts` — the URLs of the site

Add (and rebuild `MANIFEST_URL` from them, so there is still ONE source of truth):

```ts
/** Origin of the site. */
export const SITE_ORIGIN = 'https://www.chinaports-agency.com:8870'

/** The home page of the site — in login mode ANY page of the site can run the manifest. */
export const SITE_HOME_URL = `${SITE_ORIGIN}/`
```

`MANIFEST_URL` becomes `` `${SITE_ORIGIN}/#${MANIFEST_ROUTE}` `` — the string must not change.

#### 1.2 `src/core/login-credentials.ts` — the login details (LOCAL storage, never synced)

```ts
export interface LoginCredentials {
  siteUsername: string
  sitePassword: string
  ocrUser: string
  ocrPassword: string
  ocrSoftwareId: string
}

export const EMPTY_LOGIN_CREDENTIALS: LoginCredentials = {
  siteUsername: '', sitePassword: '', ocrUser: '', ocrPassword: '', ocrSoftwareId: '',
}

/** Key in `chrome.storage.local` — NOT `sync` (a synced password leaves the machine). */
export const LOGIN_CREDENTIALS_KEY = 'manifest-autofill:login-credentials'

export async function readLoginCredentials(): Promise<LoginCredentials>
export async function writeLoginCredentials(credentials: LoginCredentials): Promise<void>
export function missingLoginCredentialLabels(credentials: LoginCredentials): string[]
```

Rules:
- `readLoginCredentials` reads `chrome.storage.local`; a missing area, a missing key or a value of the wrong type ⇒ the **empty** credentials (never throw, never invent a value). Every field that is not a string ⇒ `''`.
- `writeLoginCredentials` writes the object to `chrome.storage.local` under `LOGIN_CREDENTIALS_KEY`; it **throws** when the area is missing (the UI must report the failure).
- `missingLoginCredentialLabels` returns the English labels of the empty fields: `['site account', 'site password', 'captcha service user', 'captcha service password', 'captcha service software ID']`.

#### 1.3 `src/core/login-token.ts` — captcha → captcha service → login → token

```ts
export const CAPTCHA_SERVICE_URL = 'https://upload.chaojiying.net/Upload/Processing.php'
export const CAPTCHA_PATH = '/api/captcha/'
export const LOGIN_PATH = '/api/login/'

export type LoginTokenErrorKind = 'credentials' | 'captcha' | 'ocr' | 'login' | 'token' | 'network'

export class LoginTokenError extends Error {
  readonly kind: LoginTokenErrorKind
  constructor(kind: LoginTokenErrorKind, message: string) { ... }
}

export interface LoginTokenOptions {
  credentials: LoginCredentials
  fetchImpl?: typeof fetch
  timeoutMs?: number
  siteOrigin?: string
  captchaServiceUrl?: string
}

export async function fetchTokenByLogin(options: LoginTokenOptions): Promise<string>
```

The flow (the shape of the answers follows the site envelope `{code, data, msg}`, `code === 2000` is OK):

1. **Credentials.** Every field of the credentials must be non-empty (trimmed) ⇒ else
   `LoginTokenError('credentials', 'Set the login details in the extension options first: the site account, the site password and the captcha service details.')`.
2. **Captcha.** `GET {siteOrigin}/api/captcha/` (JSON) ⇒ the envelope's `data` holds `image_base` (a data-URL-ish string) and `key`.
   - The envelope `code` (when it is a number) must be `2000` ⇒ else `LoginTokenError('captcha', 'The site refused to give a captcha image.')`.
   - `image_base` missing ⇒ `LoginTokenError('captcha', 'The site did not return the captcha image.')`.
   - The request failed / timed out ⇒ `LoginTokenError('network', 'Could not reach the site to get the captcha.')`.
3. **Captcha service.** `POST {captchaServiceUrl}` with a `FormData` body:
   `user` = `ocrUser`, `pass` = `ocrPassword`, `softid` = `ocrSoftwareId`, `codetype` = `'6001'`,
   `file_base64` = the base64 PART of `image_base` (everything after the first `,`; the whole string when there is no `,`).
   - **No `Content-Type` header** — the browser must set the multipart boundary itself.
   - The answer holds `pic_str` (also look inside `data`) ⇒ the captcha text.
   - Missing ⇒ `LoginTokenError('ocr', 'The captcha service did not return the captcha text.')`.
   - Network failure ⇒ `LoginTokenError('network', 'Could not reach the captcha service.')`.
4. **Login.** `POST {siteOrigin}/api/login/` with JSON
   `{username: siteUsername, password: sitePassword, captcha: picStr, captchaKey: captchaKey, captchaImgBase: image_base}`
   (`Content-Type: application/json`).
   - The envelope `code` (when it is a number) must be `2000` ⇒ else `LoginTokenError('login', 'The site refused the login — check the account details and try again.')`.
   - Network failure ⇒ `LoginTokenError('network', 'Could not reach the site to log in.')`.
5. **The token.** Look for a string value under the keys `token`, `jwt`, `access_token`, `accessToken`, `access_token_jwt`, `Authorization`, `authorization` — in the envelope, in `envelope.data` and in `envelope.data.data`. Strip a leading `JWT ` / `Bearer `.
   - Found ⇒ return it. Not found ⇒ `LoginTokenError('token', 'The site did not return a token after the login.')`.

Use `fetchJsonWithTimeout` from `./http` (the project has **no axios**) and `HTTP_TIMEOUT_MS` as the default timeout.

#### 1.4 `src/core/site-api.ts` — the token wins over the cookie

- `SiteFetchOptions` gains `token?: string`.
- In `sendSiteJson`:

```ts
// The token of the login wins over the cookie of the site.
const token =
  options.token !== undefined && options.token !== ''
    ? options.token
    : readCookieToken(
        options.cookieString ?? (typeof document !== 'undefined' ? document.cookie : ''),
      )
```

Everything else in `sendSiteJson` stays as it is.

#### 1.5 `src/core/manifest-run.ts` — carry the token down

- `ManifestRunOptions` gains `token?: string`.
- `siteOptions()` gains `token: options.token`.

#### 1.6 `src/core/protocol.ts` — the message

```ts
export interface CreateRequest {
  type: typeof MSG_CREATE_MANIFEST
  blNo: string
  apiBase?: string
  siteApiBase?: string
  /** The run gets the token by logging in (the manifest page is not needed). */
  loginMode?: boolean
  /** The token obtained by logging in — it wins over the site's cookie. */
  token?: string
}
```

#### 1.7 `manifest.config.ts` — the host permission for the captcha service

`host_permissions` gains `'https://upload.chaojiying.net/*'` (the popup must be allowed to call it — extension pages bypass CORS only for hosts they hold a permission for). Keep the existing entries.

#### 1.8 Tests

`tests/login-token.test.ts` (new): the whole flow with a fake `fetchImpl` (captcha → captcha service → login ⇒ the token), the base64 part of `image_base`, the `pic_str` answer, the token found in `data`, the token with a `JWT ` prefix, and one test per error kind (missing credentials, captcha refused, no captcha image, no captcha text, login refused, no token).

`tests/login-credentials.test.ts` (new): read/write in `chrome.storage.local`, a missing area ⇒ empty credentials on read and a throw on write, a value of the wrong type ⇒ empty credentials, `missingLoginCredentialLabels`.

`tests/site-api.test.ts` (add): a `token` in the options wins over the cookie in `document.cookie`; without a token the cookie is still used.

`tests/manifest-run.test.ts` (add): the run sends `Authorization: JWT <token>` when a token is given.

- [ ] **Step 1: Commit**

```bash
git commit src/core/login-credentials.ts src/core/login-token.ts src/core/site-api.ts src/core/manifest-run.ts src/core/protocol.ts src/core/site-url.ts manifest.config.ts tests/login-credentials.test.ts tests/login-token.test.ts tests/site-api.test.ts tests/manifest-run.test.ts -m "feat: add the login token flow and the token channel"
```

---

### Task 2: The content script — the manifest page is not needed in login mode

**Files:**
- Modify: `src/content/index.ts`
- Modify: `tests/content.test.ts`

#### 2.1 `src/content/index.ts`

- `handleCreate` computes the login mode from the request:

```ts
// The "get the token by logging in" mode does NOT need the manifest page:
// the run only talks to the site's API, it does not touch the page.
const loginMode = request.loginMode === true
if (!loginMode && !isManifestPage()) {
  return errorResult(
    'Open the manifest page (#/exportBusinessOperations/maintenanceOfManifestData) and try again.',
  )
}
```

- The run receives the token:

```ts
const result = await runManifest({
  blNo: request.blNo,
  apiBase,
  siteApiBase,
  token: request.token,
})
```

Everything else in the file stays as it is — in particular the "bill already created" lock and the `createOnSite` opt-in check still apply in login mode.

#### 2.2 `tests/content.test.ts` (add)

- login mode + a route that is NOT the manifest page ⇒ the run happens (no "Open the manifest page" message).
- login mode + the token in the request ⇒ every site call carries `Authorization: JWT <token>`.
- WITHOUT login mode + a wrong route ⇒ still the "Open the manifest page" message (the old behaviour).

- [ ] **Step 1: Commit**

```bash
git commit src/content/index.ts tests/content.test.ts -m "feat: run the manifest from any page of the site in login mode"
```

---

### Task 3: The popup — the checkbox and the login run

**Files:**
- Modify: `src/core/options.ts`
- Modify: `src/popup/App.vue`
- Modify: `src/popup/styles.css` (only if the new row needs it)
- Modify: `tests/options.test.ts`
- Modify: `tests/popup.test.ts`

#### 3.1 `src/core/options.ts` — the `loginToken` setting

- `ExtensionSettings` gains `loginToken: boolean`; `DEFAULT_SETTINGS.loginToken = false`.
- `withDefaults`: `loginToken: stored.loginToken === true`.
- `toStoredSettings`: `if (typeof raw.loginToken === 'boolean') stored.loginToken = raw.loginToken`.
- `SettingsChange` gains `loginToken?: boolean`.

`normalizePatch` and `subscribeSettingsChanges` iterate over the keys of `DEFAULT_SETTINGS` ⇒ they pick the new setting up on their own.

#### 3.2 `src/popup/App.vue` — the checkbox

- `const loginToken = ref(false)` + `const savedLoginToken = ref(false)`, filled by `refreshFromStorage` from `outcome.settings.loginToken`.
- `onToggleLoginToken` mirrors `onToggleCreateOnSite`: `saveSettings({ loginToken: next })`, on failure roll the checkbox back to the SAVED value and show the error in `.settings-error`.
- The template gets a NEW row **AFTER** the "Create the manifest on the site" row (the existing tests find the FIRST `input[type="checkbox"]` — the new one must not steal that spot):

```html
<div v-if="settingsLoaded" class="row">
  <label>
    <input
      v-model="loginToken"
      type="checkbox"
      :disabled="saving"
      @change="onToggleLoginToken"
    />
    Get the token by logging in
  </label>
</div>
<p v-if="settingsLoaded && loginTokenOptIn" class="hint">
  The extension logs in to the site and uses the token it gets back. The manifest page does not have to be open.
</p>
```

#### 3.3 `src/popup/App.vue` — the run

```ts
// The "get the token by logging in" mode is ON (the setting was read).
const loginTokenOptIn = computed(() => settingsLoaded.value && savedLoginToken.value === true)
```

`run()` becomes:

1. the opt-in checks stay as they are (`busy`, `createOptIn`, the empty bill number);
2. **when `loginTokenOptIn` is true**: read the credentials (`readLoginCredentials()`) and log in (`fetchTokenByLogin({ credentials })`) — the login happens IN THE POPUP because a content script may not call the captcha service cross-origin. The request then carries `loginMode: true` and (when it is not empty) `token`;
3. the tab that runs the manifest:

```ts
/**
 * The tab that runs the manifest.
 *
 * Normal mode: the active tab.
 * Login mode: the active tab when it is a page of the site; otherwise a NEW
 * tab on the site — the manifest page is not needed in this mode. The new tab
 * is opened in the BACKGROUND so that the popup stays open.
 */
```

   - the new tab waits for `complete` before the message is sent (the content script is injected at `document_idle`);
   - the URL of the new tab is `SITE_HOME_URL` from `src/core/site-url.ts`;
   - `isSiteUrl(url)` compares the ORIGIN only (the route does not matter in login mode);
4. the message is sent to that tab; the rest of `run()` (the deadline, the result, the reload) stays as it is.

**The error messages** (English, shown in the red message box):
- a `LoginTokenError` ⇒ its own `message`;
- a missing / unreadable credential store ⇒ `'Could not read the login details from the extension options.'`;
- any other failure ⇒ the OLD sentence in normal mode (`'Could not reach the page. Open the manifest declaration page, reload it, and try again.'`) and, in login mode, `'Could not run the manifest. Check the login details in the extension options and try again.'`.

#### 3.4 Tests

`tests/options.test.ts` (add): the default of `loginToken` is `false`; a stored value that is not a boolean ⇒ `false`; `saveSettings({ loginToken: true })` writes it.

`tests/popup.test.ts` (add):
- the checkbox exists and is ticked when the setting is `true`;
- ticking it saves `loginToken: true` (and a failed save rolls it back);
- with the setting on and the credentials in `chrome.storage.local`, the run sends a message that carries `loginMode: true` and the token, and the three login requests are made (captcha → captcha service → login);
- with the setting on and NO credentials ⇒ the red message names the extension options and **no** message is sent to the tab;
- in login mode with an active tab that is NOT on the site ⇒ a new tab is created on `SITE_HOME_URL` and the message goes to that tab;
- in login mode with an active tab ON the site (any route) ⇒ NO new tab is created.

- [ ] **Step 1: Commit**

```bash
git commit src/core/options.ts src/popup/App.vue src/popup/styles.css tests/options.test.ts tests/popup.test.ts -m "feat: add the get-the-token-by-logging-in option to the popup"
```

---

### Task 4: The Options page — the login details

**Files:**
- Modify: `src/options/App.vue`
- Modify: `src/options/styles.css` (only if the new section needs it)
- Modify: `tests/options-page.test.ts`

#### 4.1 `src/options/App.vue`

A NEW section (below the existing form, with its OWN Save button — the details live in `chrome.storage.local`, not in the synced settings):

```html
<h2>Login details</h2>
<p class="hint">
  Used only when "Get the token by logging in" is ticked in the popup. The details stay in this
  browser: they are never synced and are sent nowhere except the site and the captcha service.
</p>
<label for="site-username">Site account</label>
<input id="site-username" v-model="siteUsername" type="text" autocomplete="off" spellcheck="false" />
<label for="site-password">Site password</label>
<input id="site-password" v-model="sitePassword" type="password" autocomplete="off" />
<label for="ocr-user">Captcha service user</label>
<input id="ocr-user" v-model="ocrUser" type="text" autocomplete="off" spellcheck="false" />
<label for="ocr-password">Captcha service password</label>
<input id="ocr-password" v-model="ocrPassword" type="password" autocomplete="off" />
<label for="ocr-software-id">Captcha service software ID</label>
<input id="ocr-software-id" v-model="ocrSoftwareId" type="text" autocomplete="off" spellcheck="false" />
```

- The section is filled by `readLoginCredentials()` when the page loads; the form is only shown once the read has SUCCEEDED (the same rule as the settings form: a form that lies about what is stored is worse than no form).
- "Save login details" writes them with `writeLoginCredentials(...)` and shows `Saved.` / the error.
- The settings form and the login-details form keep SEPARATE state and SEPARATE buttons.

#### 4.2 `tests/options-page.test.ts` (add)

- the section shows the stored details;
- "Save login details" writes them to `chrome.storage.local` (the key `manifest-autofill:login-credentials`);
- a failed write shows the error and does NOT say "Saved.";
- the existing settings form still behaves as before.

- [ ] **Step 1: Commit**

```bash
git commit src/options/App.vue src/options/styles.css tests/options-page.test.ts -m "feat: enter the login details on the options page"
```

---

## Out of scope (open questions for the live site)

- The exact shape of `/api/captcha/` and `/api/login/` answers could not be verified live (the probes were blocked); the code is tolerant on purpose.
- Whether the site accepts `package_cod` / `cntr_ef_id` copied from the API.
- Whether the server computes the header `total_*` fields.
- `bill_no` — array or string.
