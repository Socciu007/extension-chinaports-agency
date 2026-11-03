import type { ManifestCargo, ManifestContact } from './types'

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

/**
 * 付款方式 of the site — the site stores the CODE, not the display label.
 *
 * The API path has only two codes: 预付='P' and 到付='C' (no 'F'/免费).
 */
const PAY_WAY_OPTIONS: Record<'P' | 'C', { label: string; code: string }> = {
  P: { label: '预付', code: 'P' },
  C: { label: '到付', code: 'C' },
}

/**
 * Map the API's `payType` to the site's payment method.
 *
 * - `true` / `1` → 到付 (the site stores the code "C");
 * - `false` / `0` → 预付 (the site stores the code "P");
 * - anything else (`null`/`undefined`, or a stray value like `2`) →
 *   `undefined`: never guess, leave 付款方式 blank. The caller writes the note.
 */
export function payWayOf(
  payType: boolean | number | null | undefined,
): { label: string; code: string } | undefined {
  if (payType === true || payType === 1) return PAY_WAY_OPTIONS.C
  if (payType === false || payType === 0) return PAY_WAY_OPTIONS.P
  return undefined
}

export type ContactRole = 0 | 1 | 2

/**
 * Role of a contact party.
 *
 * - `false` or `0` → 0 (发货人);
 * - `true` or `1` → 1 (收货人);
 * - `2` → 2 (通知人);
 * - anything else → `null`, so it matches no party.
 */
export function contactRole(contact: ManifestContact): ContactRole | null {
  const t = contact.type
  if (t === false || t === 0) return 0
  if (t === true || t === 1) return 1
  if (t === 2) return 2
  return null
}

// Cargo kind: S = normal, D = dangerous, R = refrigerated/quarantine, G = dangerous and refrigerated/quarantine
export type CargoKind = 'S' | 'D' | 'R' | 'G'

export function deriveCargoKind(goods: ManifestCargo): CargoKind {
  const danger = !isBlank(goods.dangerClass) || !isBlank(goods.unNub)
  const cold = !isBlank(goods.quarantineName) || !isBlank(goods.quarantineCode)
  if (danger && cold) return 'G'
  if (danger) return 'D'
  if (cold) return 'R'
  return 'S'
}

// Map container status to the site's container status.
export const containerTypeMap = {
  '0': '20GP',
  '1': '40GP',
  '2': '40HQ',
  '3': '20FR',
  '4': '40FR',
  '5': '20RF',
  '6': '40RF',
  '7': '20OT',
  '8': '40OT',
  '9': '40OH',
  '10': '20TK',
  '11': '40TK',
  '12': '20HT',
  '13': '40HT',
  '14': '45HQ',
  '15': '20GD',
  '16': '40GD'
};

// Map ship company to the site's trust code.
export const shipCompanyMap = {
  1: 'APL',
  6: 'CMA',
  3: 'ESL',
  30: 'ONE',
  35: 'PIL',
  39: 'RCL',
  206: 'SLS',
  154: 'VOL',
  40: 'WHL',
}

// Required fields for the header
export const REQUIRED_HEADER: readonly string[] = [
  'BILL_NBR',
  'E_SHIP_NAM',
  'OUT_VOYAGE_NO',
  'TRUST_COD',
  'PAY_WAY_ID',
  'DR_TYPE_STR',
  'START_PORT_NAM',
  'DISCHRG_PORT_NAM',
  'E_SHIPPER_NAM',
  'SHIPPER_ADD_STR',
  'E_CONSIGNEE_NAM',
  'CONSIGNEE_ADD_STR',
  'CONSIGNEE_COUNTRY_COD',
  'START_PORT_COD',
  'DISCHRG_PORT_COD',
]

// Contact channels for the parties
export const PARTY_CONTACT_CHANNELS: Record<
  0 | 1 | 2,
  {
    phoneKey: string // key lowercase in the payload header of the phone field
    emailKey: string // key lowercase in the payload header of the email field
    faxKey: string // key lowercase in the payload header of the fax field
  }
> = {
  0: {
    phoneKey: 'shipper_te_str',
    emailKey: 'shipper_em_str',
    faxKey: 'shipper_fx_str',
  },
  1: {
    phoneKey: 'consignee_te_str',
    emailKey: 'consignee_em_str',
    faxKey: 'consignee_fx_str',
  },
  2: {
    phoneKey: 'notify_te_str',
    emailKey: 'notify_em_str',
    faxKey: 'notify_fx_str',
  },
}

// Parties without contact channels
export function partiesWithoutContactChannel(
  header: Record<string, unknown>,
): ReadonlySet<string> {
  const withoutContact = new Set<string>()
  for (const role of [0, 1, 2] as const) {
    const party = PARTY_CONTACT_CHANNELS[role]
    if (
      isBlankPayloadValue(header[party.phoneKey]) &&
      isBlankPayloadValue(header[party.emailKey]) &&
      isBlankPayloadValue(header[party.faxKey])
    ) {
      withoutContact.add(party.phoneKey.toUpperCase())
    }
  }
  return withoutContact
}

// Required fields for the cargo
export const REQUIRED_BASE: readonly string[] = [
  'CARGO_KIND_COD',
  'PACKAGE_COD',
  'PACKAGE_STR',
  'PIECE_NUM',
  'GWEIGHT_TON',
  'GVOL_NUM',
  'MARK_STR',
  'E_CARGO_NAM',
]
export const REQUIRED_DANGER: readonly string[] = [
  'DANG_CLASS_NAM',
  'DANG_UN_NO',
  'DANGER_CONTACT_NAM',
  'DANGER_TE_STR',
]
export const REQUIRED_COLD: readonly string[] = ['TEMP_ID', 'SET_TEMP_NUM']

// Required fields for the container
export const REQUIRED_CONTAINER: readonly string[] = [
  'CNTR_NO',
  'CNTR_SIZE_COD',
  'CNTR_TYPE_COD',
  'CNTR_EF_ID',
  'SEAL_NO',
  'SOC_ID',
]

export const REQUIRED_BY_KIND: Record<CargoKind, readonly string[]> = {
  S: REQUIRED_BASE,
  D: [...REQUIRED_BASE, ...REQUIRED_DANGER],
  R: [...REQUIRED_BASE, ...REQUIRED_COLD],
  G: [...REQUIRED_BASE, ...REQUIRED_DANGER, ...REQUIRED_COLD],
}

// Dangerous fields
export const DANGER_FIELDS: readonly string[] = [
  'dang_class_nam',
  'dang_page_no',
  'dang_un_no',
  'dang_lable_str',
  'dang_flash_point',
  'dang_ems_no',
  'dang_mfag_no',
  'dang_contactstr',
  'danger_contact_nam',
  'danger_te_str',
  'danger_em_str',
  'danger_fx_str',
]

// Temperature fields for the cargo when the cargo kind is R or G
export const TEMP_FIELDS: readonly string[] = ['temp_id', 'set_temp_num']

// Labels for the header fields
export const HEADER_LABELS: Record<string, string> = {
  BILL_NO: 'Site bill ID',
  BILL_NBR: '提单号',
  E_SHIP_NAM: '船名',
  OUT_VOYAGE_NO: '航次',
  TRUST_COD: 'Trust code',
  PAY_WAY_ID: '付款方式',
  DR_TYPE_STR: 'Cargo type',
  SIGN_PLACE_COD: '提单签发地 (code)',
  SIGN_PLACE_STR: '提单签发地',
  START_PORT_COD: '装货港 (code)',
  START_PORT_NAM: '装货港',
  DISCHRG_PORT_COD: '卸货港 (code)',
  DISCHRG_PORT_NAM: '卸货港',
  DEST_PORT_COD: '交货地 (code)',
  DEST_PORT_NAM: '交货地',
  TRANS_PORT_COD: '中转港 (code)',
  TRANS_PORT_NAM: '中转港',
  E_SHIPPER_NAM: '发货人 (name)',
  SHIPPER_ADD_STR: '发货人 (address)',
  SHIPPER_COUNTRY_COD: '发货人 (country)',
  SHIPPER_TE_STR: '发货人 (telephone)',
  SHIPPER_EM_STR: '发货人 (email)',
  SHIPPER_FX_STR: '发货人 (fax)',
  SHIPPER_AEO: '发货人 (AEO)',
  E_CONSIGNEE_NAM: '收货人 (name)',
  CONSIGNEE_ADD_STR: '收货人 (address)',
  CONSIGNEE_COUNTRY_COD: '收货人 (country)',
  CONSIGNEE_TE_STR: '收货人 (telephone)',
  CONSIGNEE_EM_STR: '收货人 (email)',
  CONSIGNEE_FX_STR: '收货人 (fax)',
  CONSIGNEE_AEO: '收货人 (AEO)',
  E_NOTIFY_NAM: '通知人 (name)',
  NOTIFY_ADD_STR: '通知人 (address)',
  NOTIFY_COUNTRY_COD: '通知人 (country)',
  NOTIFY_TE_STR: '通知人 (telephone)',
  NOTIFY_EM_STR: '通知人 (email)',
  NOTIFY_FX_STR: '通知人 (fax)',
  TOTAL_PIECE_NUM: 'Total pieces',
  TOTAL_GWEIGHT_TON: 'Total gross weight (kg)',
  TOTAL_GVOL_NUM: 'Total volume (m³)',
  MANDATORY_CHECK: 'Mandatory check',
  SOFT_CHECK: 'Soft check',
  IS_ALL: 'Save mode',
}

// Labels for the cargo fields
export const CARGO_LABELS: Record<string, string> = {
  BILL_NO: 'Site bill ID',
  PIECE_NUM: '包装件数',
  GWEIGHT_TON: '毛重 (kg)',
  GVOL_NUM: '体积 (m³)',
  NWEIGHT_TON: '净重 (kg)',
  CARGO_KIND_COD: '货物标识',
  CARGO_HS_COD: '海关编码',
  PACKAGE_COD: '包装代码',
  PACKAGE_STR: '包装类型',
  MARK_STR: '唛头',
  E_CARGO_NAM: '货物名称',
  DANG_CLASS_NAM: '危险品类别',
  DANG_PAGE_NO: '危险品页号',
  DANG_UN_NO: 'UN 编号',
  DANG_LABLE_STR: '危险品标签',
  DANG_FLASH_POINT: '闪点',
  DANG_EMS_NO: 'EMS',
  DANG_MFAG_NO: 'MFAG',
  DANG_CONTACTSTR: '危险品联系人',
  DANGER_CONTACT_NAM: '危险品联系人 (name)',
  DANGER_TE_STR: '危险品联系人 (telephone)',
  DANGER_EM_STR: '危险品联系人 (email)',
  DANGER_FX_STR: '危险品联系人 (fax)',
  TEMP_ID: '温度设置 (id)',
  SET_TEMP_NUM: '温度设置 (°C)',
}

// Labels for the container fields
export const CONTAINER_LABELS: Record<string, string> = {
  BILL_NO: 'Site bill ID',
  CNTR_NO: '箱号',
  CNTR_SIZE_COD: '尺寸',
  CNTR_TYPE_COD: '箱型',
  CNTR_EF_ID: '箱状态',
  SEAL_NO: '铅封号',
  PIECE_NUM: '箱内件数',
  WEIGH_TON: '箱内货重 (kg)',
  VOLUME_NUM: '箱内体积 (m³)',
  SOC_ID: '货主箱标志',
}

// Notes for the fields that the API does not provide
export const BLANK_NOTES: Record<string, string> = {
  SHIPPER_EM_STR: 'The API does not provide email addresses — fill this in by hand on the site.',
  SHIPPER_FX_STR: 'The API does not provide fax numbers — fill this in by hand on the site.',
  CONSIGNEE_EM_STR:
    'The API does not provide email addresses — fill this in by hand on the site.',
  CONSIGNEE_FX_STR: 'The API does not provide fax numbers — fill this in by hand on the site.',
  NOTIFY_EM_STR: 'The API does not provide email addresses — fill this in by hand on the site.',
  NOTIFY_FX_STR: 'The API does not provide fax numbers — fill this in by hand on the site.',
  DANGER_EM_STR: 'The API does not provide email addresses — fill this in by hand on the site.',
  DANGER_FX_STR: 'The API does not provide fax numbers — fill this in by hand on the site.',
  SHIPPER_AEO:
    'The API provides a business registration number (USCI/TIN), not an AEO code — leave this blank unless you know the AEO code.',
  CONSIGNEE_AEO:
    'The API provides a business registration number (USCI/TIN), not an AEO code — leave this blank unless you know the AEO code.',
  SIGN_PLACE_COD:
    'The API does not provide the bill of lading issue place — fill this in by hand on the site.',
  SIGN_PLACE_STR:
    'The API does not provide the bill of lading issue place — fill this in by hand on the site.',
  TRANS_PORT_COD:
    'The API does not provide transit ports — fill this in by hand on the site.',
  TRANS_PORT_NAM:
    'The API does not provide transit ports — fill this in by hand on the site.',
  DANG_PAGE_NO:
    'The API does not provide the dangerous-goods page number — fill this in by hand on the site.',
  DANG_EMS_NO: 'The API does not provide the EMS number — fill this in by hand on the site.',
  DANG_MFAG_NO: 'The API does not provide the MFAG number — fill this in by hand on the site.',
  PACKAGE_COD:
    'The site\'s package dictionary did not return a code for this package type — fill this in by hand on the site.',
  PACKAGE_STR:
    'The API does not provide the package type — fill this in by hand on the site.',
  CNTR_SIZE_COD:
    'The API returns a numeric container size code that does not match the site dictionary — fill this in by hand on the site.',
  CNTR_TYPE_COD:
    'The API returns a numeric container type code that does not match the site dictionary — fill this in by hand on the site.',
  CNTR_EF_ID:
    'The API does not provide the container status — fill this in by hand on the site.',
  SOC_ID:
    'The API does not say whether this container belongs to the cargo owner — fill this in by hand on the site.',
  CARGO_HS_COD: 'The API does not provide the HS code — fill this in by hand on the site.',
  NWEIGHT_TON: 'The API does not provide the net weight — fill this in by hand on the site.',
  TEMP_ID: 'The API does not provide the temperature setting — fill this in by hand on the site.',
  SET_TEMP_NUM: 'The API does not provide the temperature setting — fill this in by hand on the site.',
}

// Note for the required fields that the API does not provide
export function requiredBlankNote(prop: string, label: string): string {
  return `${label} (${prop}) is required by the site but the API does not provide it — fill it in by hand on the site.`
}

// Note for the optional fields that the API does not provide
export function optionalBlankNote(prop: string, label: string): string {
  return `${label} (${prop}) is not provided by the API — it was left blank on purpose.`
}

// Note for the party contact that the API does not provide
export function partyContactRequiredNote(prop: string, label: string): string {
  return `${label} (${prop}) is required by the site — the site expects each party to have at least one of phone, email or fax. The API only provides the phone, and this party has none — fill in a contact channel for this party by hand on the site.`
}

// Note for the field that the API returned a value that is not a valid number
export function unparsableNumberNote(prop: string, label: string): string {
  return `${label} (${prop}) could not be parsed — the API returned a value that is not a valid number, so the extension could not fill this field in. Check the value on the site and fill it in by hand if needed.`
}

// Whether the value in the payload is unparsable
export function isUnparsablePayloadValue(value: unknown): boolean {
  return typeof value === 'number' && Number.isNaN(value)
}

// Whether the value in the payload is blank
export function isBlankPayloadValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'number') return value === 0 || Number.isNaN(value)
  return false
}

// Label for the field
export function labelOf(
  scope: 'header' | 'cargo' | 'container',
  prop: string,
): string {
  if (scope === 'header') return HEADER_LABELS[prop] ?? prop
  if (scope === 'cargo') return CARGO_LABELS[prop] ?? prop
  return CONTAINER_LABELS[prop] ?? prop
}
