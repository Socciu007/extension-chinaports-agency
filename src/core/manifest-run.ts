import { describeApiError, fetchManifest, ManifestApiError } from './api'
import { HTTP_TIMEOUT_MS } from './http'
import {
  BLANK_NOTES,
  DANGER_FIELDS,
  isBlankPayloadValue,
  isUnparsablePayloadValue,
  labelOf,
  optionalBlankNote,
  partyContactRequiredNote,
  partiesWithoutContactChannel,
  REQUIRED_BY_KIND,
  REQUIRED_CONTAINER,
  REQUIRED_HEADER,
  requiredBlankNote,
  TEMP_FIELDS,
  unparsableNumberNote,
  type CargoKind,
} from './field-meta'
import type { FillScope, ReportItem } from './protocol'
import {
  describeSiteError,
  fetchPackageCode,
  fetchPortCode,
  SiteApiError,
  type SiteFetchOptions,
} from './site-api'
import {
  addCargoRow,
  createManifestBill,
  extractBillNo,
  saveManifestContainers,
} from './site-write'
import type { ManifestCargoRow, ManifestContainerRow, ManifestData } from './types'

// Default deadline: 4 minutes.
export const DEFAULT_DEADLINE_MS = 240_000

export interface ManifestRunOptions {
  blNo: string
  apiBase?: string
  siteApiBase?: string
  fetchImpl?: typeof fetch
  siteFetchImpl?: typeof fetch
  cookieString?: string
  timeoutMs?: number
  deadlineMs?: number
}

export interface ManifestRunResult {
  ok: boolean
  blocked: boolean
  message?: string
  steps: string[]
  items: ReportItem[]
  cargoRows: number
  containerRows: number
  billNo?: string
  billCreated: boolean
  written: boolean
}

// Error for the manifest run
export class ManifestRunError extends Error {
  readonly kind: 'deadline'

  constructor(kind: 'deadline', message: string) {
    super(message)
    this.name = 'ManifestRunError'
    this.kind = kind
  }
}

// Error for the manifest run
class NoBillNumberError extends Error {
  constructor() {
    super('The site did not return a bill number.')
    this.name = 'NoBillNumberError'
  }
}

// Keys that are ignored in the report
const IGNORED_PROPS: ReadonlySet<string> = new Set([
  'BILL_NO',
  'TOTAL_PIECE_NUM',
  'TOTAL_GWEIGHT_TON',
  'TOTAL_GVOL_NUM',
  'MANDATORY_CHECK',
  'SOFT_CHECK',
  'IS_ALL',
])

// A sentence reminding the operator that the extension never deletes bills on its own
const NEVER_DELETES_BILLS =
  'The extension never deletes bills on its own — please finish this manifest by hand on the site.'

// Fields that are blanked by the site
const ALL_BLANKED: ReadonlySet<string> = new Set([...DANGER_FIELDS, ...TEMP_FIELDS])
const DANGER_BLANKED: ReadonlySet<string> = new Set(DANGER_FIELDS)
const TEMP_BLANKED: ReadonlySet<string> = new Set(TEMP_FIELDS)
const NOTHING_BLANKED: ReadonlySet<string> = new Set<string>()

// Fields that are blanked by the site by cargo kind
// - `S` (all) - the site blanks both dangerous and temperature fields
// - `D` (dangerous) - the site blanks the temperature field
// - `R` (risky) - the site blanks the dangerous field
// - `G` (all) - the site does not blank any fields
function byDesignBlanks(kind: CargoKind): ReadonlySet<string> {
  if (kind === 'S') return ALL_BLANKED
  if (kind === 'D') return TEMP_BLANKED
  if (kind === 'R') return DANGER_BLANKED
  return NOTHING_BLANKED
}

// Build a report item for a blanked field
function blankItem(
  scope: FillScope,
  prop: string,
  required: boolean,
  row: number | undefined,
  value: unknown,
  note?: string,
): ReportItem {
  const label = labelOf(scope, prop)
  const text =
    note ??
    (isUnparsablePayloadValue(value)
      ? unparsableNumberNote(prop, label)
      : BLANK_NOTES[prop] ??
        (required ? requiredBlankNote(prop, label) : optionalBlankNote(prop, label)))
  return {
    scope,
    prop,
    label,
    status: required ? 'warn' : 'skip',
    note: text,
    row,
    required,
  }
}

// A specification for a row to build a report
interface ReportRowSpec {
  scope: FillScope
  values: Record<string, unknown>
  row?: number
  required: (prop: string) => boolean
  note?: (prop: string) => string | undefined
  skipped?: ReadonlySet<string>
}

// Report a row - by key in the row
function reportRow(spec: ReportRowSpec): ReportItem[] {
  const items: ReportItem[] = []
  for (const [key, value] of Object.entries(spec.values)) {
    const prop = key.toUpperCase()
    if (IGNORED_PROPS.has(prop)) continue
    if (spec.skipped?.has(key)) continue
    if (!isBlankPayloadValue(value)) continue
    items.push(
      blankItem(spec.scope, prop, spec.required(prop), spec.row, value, spec.note?.(prop)),
    )
  }
  return items
}

// Keys that are not fields in the header
const BODY_ROW_KEYS: ReadonlySet<string> = new Set(['cdgoods', 'cntr_list'])

// Report the header - by key in the body
// - `cdgoods` - cargo rows
// - `cntr_list` - container rows
// - other keys - fields in the header
function reportHeader(body: ManifestData): ReportItem[] {
  // Calculate once: the condition is for the parties, not for each prop.
  const withoutContact = partiesWithoutContactChannel(body)
  // Skip the two keys for cargo and container rows - they are not fields in the header.
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (BODY_ROW_KEYS.has(key)) continue
    values[key] = value
  }
  return reportRow({
    scope: 'header',
    values,
    required: (prop) => REQUIRED_HEADER.includes(prop) || withoutContact.has(prop),
    note: (prop) =>
      withoutContact.has(prop)
        ? partyContactRequiredNote(prop, labelOf('header', prop))
        : undefined,
  })
}

// Get the cargo kind of a row
// - `D` (dangerous) - the site blanks the temperature field
// - `R` (risky) - the site blanks the dangerous field
// - `G` (all) - the site does not blank any fields
// - `S` (all) - the site blanks both dangerous and temperature fields
function cargoKindOf(row: Record<string, unknown>): CargoKind {
  const code = row.cargo_kind_cod
  if (code === 'D' || code === 'R' || code === 'G') return code
  return 'S'
}

// Report the cargo rows - by index and key in the row
function reportCargo(rows: ManifestCargoRow[]): ReportItem[] {
  return rows.flatMap((row, index) => {
    const kind = cargoKindOf(row)
    return reportRow({
      scope: 'cargo',
      values: row,
      row: index + 1,
      required: (prop) => REQUIRED_BY_KIND[kind].includes(prop),
      skipped: byDesignBlanks(kind),
    })
  })
}

// Report the container rows - by index and key in the row
function reportContainers(rows: ManifestContainerRow[]): ReportItem[] {
  return rows.flatMap((row, index) =>
    reportRow({
      scope: 'container',
      values: row,
      row: index + 1,
      required: (prop) => REQUIRED_CONTAINER.includes(prop),
    }),
  )
}

// A sentence describing the state on the site — always mentioning what the extension has done.
function partialStateSentence(
  createAttempted: boolean,
  billCreated: boolean,
  rowsAdded: number,
  cargoRows: number,
): string {
  if (!createAttempted) return 'Nothing was created on the site.'
  if (!billCreated) {
    return 'The manifest bill may already exist on the site.'
  }
  if (rowsAdded < cargoRows) {
    return `The manifest bill was created on the site and ${rowsAdded} of ${cargoRows} cargo rows were added. ${NEVER_DELETES_BILLS}`
  }
  return `The manifest bill was created on the site. ${NEVER_DELETES_BILLS}`
}

/** Message khi run thành công nhưng còn field BẮT BUỘC bị trống. */
function blockedMessage(requiredCount: number, items: ReportItem[]): string {
  return `${requiredCount} field(s) (${items.map((item) => item.label).join(', ')}) required by the site are not provided by the API.`
}

// A step describing a bill number mismatch
// - the site may have a suffix (`P1`, `P12`) while the API only returns the original number
// - the site may have a different number than the API returns
function billNoMismatchStep(written: string, apiBillNo: string): string {
  if (apiBillNo === '') {
    return `The manifest will use the bill number ${written} — the API did not return a bill number.`
  }
  return `The manifest will use the bill number ${written} — the API returned ${apiBillNo}.`
}

// Describe an error for the user - by error type
function describeError(error: unknown): string {
  if (error instanceof ManifestApiError) return describeApiError(error)
  if (error instanceof SiteApiError) return describeSiteError(error)
  if (error instanceof ManifestRunError) return error.message
  return 'Something went wrong while running the manifest.'
}

/**
 * Fill 包装代码 (PACKAGE_COD) for every cargo row.
 *
 * Each package NAME is looked up ONCE — rows sharing a name share the result.
 *
 * A failed lookup (site error / network error) leaves the field blank ⇒ the
 * report tells the operator to fill it in by hand. One broken dictionary must
 * NOT break the whole run.
 */
async function fillPackageCodes(body: ManifestData, options: SiteFetchOptions): Promise<void> {
  const names = new Set<string>()
  for (const row of body.cdgoods) {
    const name = typeof row.package_str === 'string' ? row.package_str.trim() : ''
    if (name !== '') names.add(name)
  }
  if (names.size === 0) return

  const codes = new Map<string, string>()
  for (const name of names) {
    try {
      const code = await fetchPackageCode(name, options)
      if (code !== undefined && code !== '') codes.set(name, code)
    } catch {
      // Leave the field blank — the report tells the operator to fill it in.
    }
  }

  for (const row of body.cdgoods) {
    const name = typeof row.package_str === 'string' ? row.package_str.trim() : ''
    if (name === '') continue
    const code = codes.get(name)
    if (code !== undefined) row.package_cod = code
  }
}

/**
 * The header fields that hold a port NAME and the field that holds its code.
 */
type PortNameKey = 'start_port_nam' | 'dischrg_port_nam' | 'dest_port_nam'
type PortCodeKey = 'start_port_cod' | 'dischrg_port_cod' | 'dest_port_cod'

const PORT_CODE_PAIRS: ReadonlyArray<readonly [PortNameKey, PortCodeKey]> = [
  ['start_port_nam', 'start_port_cod'],
  ['dischrg_port_nam', 'dischrg_port_cod'],
  ['dest_port_nam', 'dest_port_cod'],
]

/**
 * The port CODE fields the site REQUIRES — 装货港 and 卸货港.
 *
 * Keep in sync with the `*_PORT_COD` entries of `REQUIRED_HEADER`
 * (`field-meta.ts`) — these are exactly the port codes the site asks for.
 *
 * The site's port dictionary is the LAST RESORT: it is only asked when the
 * API gave NO code for either of these two fields.
 */
const REQUIRED_PORT_CODE_KEYS: ReadonlyArray<PortCodeKey> = ['start_port_cod', 'dischrg_port_cod']

/** The (trimmed) port NAME of a header field — '' when the field is blank. */
function portNameOf(body: ManifestData, key: PortNameKey): string {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Fill the port codes (装货港 / 卸货港 / 交货地) from the site's port dictionary.
 *
 * The dictionary is the LAST RESORT: the lookup runs ONLY when the API gave
 * NO code for the two port codes the site requires (装货港 / 卸货港). When
 * the API already has one of those two codes, the site is NOT called at all
 * and every code of the API is kept exactly as it is.
 *
 * When the lookup DOES run, it fills ALL THREE port codes (装货港 / 卸货港 /
 * 交货地) — the dictionary's answer wins for each of them.
 *
 * Each port NAME is looked up ONCE — the same name in two ports shares the
 * result.
 *
 * A failed lookup (site error / network error) leaves the MISSING code BLANK ⇒
 * the report tells the operator to fill it in by hand. One broken dictionary
 * must NOT break the whole run.
 *
 * @returns `true` when the site's dictionary was asked (a lookup happened).
 */
async function fillPortCodes(body: ManifestData, options: SiteFetchOptions): Promise<boolean> {
  // Both required codes blank ⇒ look the codes up. Otherwise the site is not
  // called and the code of the API wins.
  if (!REQUIRED_PORT_CODE_KEYS.every((key) => isBlankPayloadValue(body[key]))) return false

  const names = new Set<string>()
  for (const [nameKey] of PORT_CODE_PAIRS) {
    const name = portNameOf(body, nameKey)
    if (name !== '') names.add(name)
  }
  if (names.size === 0) return false

  const codes = new Map<string, string>()
  for (const name of names) {
    try {
      const code = await fetchPortCode(name, options)
      if (code !== undefined && code !== '') codes.set(name, code)
    } catch {
      // The lookup failed — the missing code stays blank; the report asks the
      // operator to fill it in by hand.
    }
  }

  for (const [nameKey, codeKey] of PORT_CODE_PAIRS) {
    const name = portNameOf(body, nameKey)
    if (name === '') continue
    const code = codes.get(name)
    if (code !== undefined) body[codeKey] = code
  }
  return true
}

// Run the entire manifest flow.
export async function runManifest(options: ManifestRunOptions): Promise<ManifestRunResult> {
  const steps: string[] = []
  const items: ReportItem[] = []
  const deadlineAt = Date.now() + (options?.deadlineMs ?? DEFAULT_DEADLINE_MS)

  let cargoRows = 0
  let containerRows = 0
  let billNo: string | undefined
  let billCreated = false
  let written = false
  let createAttempted = false
  let rowsAdded = 0

  // Remaining time of the run (ms) — at least 1 ms.
  const remaining = (): number => Math.max(1, deadlineAt - Date.now())
  // Timeout for each request.
  const requestTimeout = (): number =>
    options.timeoutMs ?? Math.min(HTTP_TIMEOUT_MS, remaining())
  // Options for all requests to the site API.
  const siteOptions = (): SiteFetchOptions => ({
    baseUrl: options.siteApiBase,
    fetchImpl: options.siteFetchImpl,
    cookieString: options.cookieString,
    timeoutMs: requestTimeout(),
  })
  // Check if the run has reached its deadline — before each network call.
  const checkDeadline = (step: string): void => {
    if (Date.now() >= deadlineAt) {
      throw new ManifestRunError('deadline', `The run reached its time limit before "${step}".`)
    }
  }
  // Build the result from the current state of the run.
  const buildResult = (overrides: Partial<ManifestRunResult> = {}): ManifestRunResult => {
    const requiredCount = items.filter((item) => item.required === true).length
    const result: ManifestRunResult = {
      ok: false,
      blocked: requiredCount > 0,
      steps,
      items,
      cargoRows,
      containerRows,
      billCreated,
      written,
    }
    if (billNo !== undefined) result.billNo = billNo
    Object.assign(result, overrides)
    // Default message when there are required fields missing. The message
    // passed through `overrides.message` is kept.
    if (result.message === undefined && requiredCount > 0) {
      result.message = blockedMessage(requiredCount, items.filter((item) => item.required === true))
    }
    return result
  }

  try {
    if ((options.blNo ?? '').trim() === '') {
      return buildResult({
        ok: false,
        message: 'Enter a bill of lading number before running the manifest.',
      })
    }

    checkDeadline('fetching the manifest data')
    const { body, apiBillNo } = await fetchManifest(options.blNo, {
      baseUrl: options.apiBase,
      fetchImpl: options.fetchImpl,
      timeoutMs: requestTimeout(),
      operatorBlNo: options.blNo,
    })
    steps.push('Fetched the manifest data from external API (eb)')

    // The port codes: look them up on the site — but ONLY when the API gave
    // no code at all for the two ports the site requires.
    checkDeadline('looking up the port codes')
    if (await fillPortCodes(body, siteOptions())) {
      steps.push('Looked up the port codes on the site')
    } else {
      steps.push('No port code lookup was needed')
    }

    // The bill number as written by the operator.
    const writtenBillNo = body.bill_nbr
    if (writtenBillNo !== '' && writtenBillNo !== apiBillNo) {
      steps.push(billNoMismatchStep(writtenBillNo, apiBillNo))
    }

    // 包装代码 (PACKAGE_COD): look up the package codes on the site
    checkDeadline('looking up the package codes')
    await fillPackageCodes(body, siteOptions())
    steps.push('Looked up the package codes on the site')

    cargoRows = body.cdgoods.length
    containerRows = body.cntr_list.length
    items.push(...reportHeader(body))
    items.push(...reportCargo(body.cdgoods))
    items.push(...reportContainers(body.cntr_list))

    // Create the manifest bill — the server assigns the internal bill number.
    checkDeadline('creating the manifest bill')
    createAttempted = true
    const created = await createManifestBill(body, siteOptions())
    steps.push('Created the manifest bill on the site')
    billCreated = true

    // Read the bill number — if there is no bill number, no cargo rows are sent (a cargo row attached to the wrong bill will not report any error).
    let assignedBillNo: string
    try {
      assignedBillNo = extractBillNo(created)
    } catch {
      steps.push('The site did not return a bill number, so no cargo rows were attached')
      throw new NoBillNumberError()
    }
    billNo = assignedBillNo
    steps.push('Read the bill number from the site')

    // Attach each cargo row to the bill.
    for (const row of body.cdgoods) {
      checkDeadline('adding the cargo rows')
      await addCargoRow(row, assignedBillNo, siteOptions())
      rowsAdded += 1
    }
    steps.push(`Added ${rowsAdded} cargo row(s) to the bill`)

    // Save the manifest bill with its containers (`is_all` = "1" = 暂存).
    checkDeadline('saving the manifest')
    await saveManifestContainers(body, assignedBillNo, siteOptions())
    steps.push('Saved the manifest with its containers')
    written = true

    return buildResult({ ok: true })
  } catch (e) {
    const result = buildResult()
    if (e instanceof NoBillNumberError) {
      result.message =
        'The manifest bill was created on the site, but the site did not return its bill number, so no cargo rows were attached. ' +
        NEVER_DELETES_BILLS
    } else {
      const state = partialStateSentence(createAttempted, billCreated, rowsAdded, cargoRows)
      result.message = `${describeError(e)} ${state}`
    }
    return result
  }
}
