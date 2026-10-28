import type {
  ManifestCargo,
  ManifestContainer,
  ManifestContact,
  ManifestData,
} from './types'

export type PlanStatus = 'fill' | 'skip'

export interface FieldPlan {
  /** prop của field trong form (khớp với id `...-${prop}` của Element Plus) */
  prop: string
  /** nhãn tiếng Trung của field trên site (提单号, 船名…) — dùng để hiển thị trong báo cáo */
  label: string
  status: PlanStatus
  /** giá trị cần điền (chỉ có khi status = 'fill') */
  value?: string
  /** text của option cần click; mặc định bằng `value` */
  matchValue?: string
  /** ghi chú để đối chiếu; với plan 'skip' là lý do bỏ qua */
  note?: string
  /** sau khi điền prop này thì đọc lại verifyProp, rỗng thì báo cảnh báo */
  verify?: { prop: string; note: string }
  /** nhãn tiếng Trung của cột, dùng khi điền bảng inline */
  columnLabel?: string
  /** site BẮT BUỘC có field này — nếu bỏ trống thì manifest không submit được */
  required?: boolean
}

export interface MappingContext {
  findTrustCode(supplyId?: number): string | undefined
  findDrType(code?: string): string | undefined
  /** Tên cảng tiếng Trung — widget của site chỉ gợi ý tên Trung (filter `E_PORT_NAM`). */
  findPort(code?: string): string | undefined
  findCntrType(raw?: number | string | null): string | undefined
  findCntrSize(raw?: number | string | null): string | undefined
}

/**
 * 付款方式 của site: 预付='P', 到付='C', 免费='F'. Adapter click theo TEXT hiển thị.
 */
const PAY_WAY_OPTIONS: Record<'P' | 'C', { label: string; code: string }> = {
  P: { label: '预付', code: 'P' },
  C: { label: '到付', code: 'C' },
}

/**
 * Map `payType` của API sang option của site.
 *
 * - `true` / `1` → 预付 (site lưu mã "P");
 * - `false` / `0` → 到付 (site lưu mã "C");
 * - còn lại (`null`/`undefined`, hoặc giá trị lạ như `2`, `-1`) → `undefined`:
 *   KHÔNG đoán, bỏ trống 付款方式. Lý do cụ thể do caller ghi vào note.
 */
function payWayOf(
  payType: boolean | number | null | undefined,
): { label: string; code: string } | undefined {
  if (payType === true || payType === 1) return PAY_WAY_OPTIONS.P
  if (payType === false || payType === 0) return PAY_WAY_OPTIONS.C
  return undefined
}

export type ContactRole = 0 | 1 | 2

export function contactRole(contact: ManifestContact): ContactRole | null {
  const t = contact.type
  if (t === true) return 1
  if (t === false) return 0
  if (t === 2) return 2
  if (t === 1) return 1
  if (t === 0) return 0
  return null
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

function text(value: unknown): string {
  return isBlank(value) ? '' : String(value).trim()
}

const PARTY_GROUPS = [
  { role: 0 as const, nameProp: 'E_SHIPPER_NAM', prefix: 'SHIPPER', label: '发货人' },
  { role: 1 as const, nameProp: 'E_CONSIGNEE_NAM', prefix: 'CONSIGNEE', label: '收货人' },
  { role: 2 as const, nameProp: 'E_NOTIFY_NAM', prefix: 'NOTIFY', label: '通知人' },
]

export function mapHeader(data: ManifestData, ctx: MappingContext): FieldPlan[] {
  const plans: FieldPlan[] = []

  const push = (prop: string, label: string, value: unknown, note?: string) => {
    const v = text(value)
    if (v === '') {
      plans.push({ prop, label, status: 'skip', note: note ?? 'The API provides no data for this field' })
    } else {
      plans.push({ prop, label, status: 'fill', value: v })
    }
  }

  push('BILL_NBR', '提单号', data.blNo)
  push('E_SHIP_NAM', '船名', data.shipName)
  push('OUT_VOYAGE_NO', '航次', data.voyage)

  const supplyId = data.sea_order?.sea_order_bind?.supplyId
  const trustCode = ctx.findTrustCode(supplyId)
  plans.push({
    prop: 'TRUST_COD',
    label: '承运人代码',
    status: trustCode ? 'fill' : 'skip',
    value: trustCode ?? undefined,
    note: trustCode
      ? undefined
      : `No carrier found for supplyId=${supplyId ?? 'null'} in getTrustCode()`,
  })

  const drType = ctx.findDrType(data.transportTerms ?? undefined)
  plans.push({
    prop: 'DR_TYPE_STR',
    label: '交货条款',
    status: drType ? 'fill' : 'skip',
    value: drType ?? undefined,
    note: drType
      ? undefined
      : `No 交货条款 found for code "${data.transportTerms ?? ''}" in getDrType()`,
  })

  const payType = data.payType
  const payWay = payWayOf(payType)
  plans.push({
    prop: 'PAY_WAY_ID',
    label: '付款方式',
    status: payWay ? 'fill' : 'skip',
    // Adapter click theo TEXT hiển thị → phải là nhãn, không phải mã.
    value: payWay?.label,
    note: payWay
      ? `The site stores the code "${payWay.code}" for "${payWay.label}"`
      : payType === null || payType === undefined
        ? 'The API provides no payType'
        : `The API returned an unrecognised payType "${payType}", so 付款方式 was left blank`,
  })

  const portGroups = [
    {
      nameProp: 'START_PORT_NAM',
      codeProp: 'START_PORT_COD',
      code: data.loadCode,
      apiName: data.loadPortData?.name,
      label: '收货地（装货港）',
    },
    {
      nameProp: 'DISCHRG_PORT_NAM',
      codeProp: 'DISCHRG_PORT_COD',
      code: data.uploadCode,
      apiName: data.uploadPortData?.name,
      label: '卸货港',
    },
    {
      nameProp: 'DEST_PORT_NAM',
      codeProp: 'DEST_PORT_COD',
      code: data.aimPortCode,
      apiName: data.aimPortData?.name,
      label: '交货地',
    },
  ]

  for (const group of portGroups) {
    // Widget của site chỉ gợi ý tên cảng tiếng Trung → ưu tiên tên từ API,
    // dictionary getPort() chỉ là fallback.
    const name = text(group.apiName) || ctx.findPort(group.code ?? undefined) || ''
    if (name === '') {
      plans.push({
        prop: group.nameProp,
        label: group.label,
        status: 'skip',
        note: `No port found for code "${group.code ?? ''}" in getPort()`,
      })
      continue
    }
    const code = text(group.code)
    plans.push({
      prop: group.nameProp,
      label: group.label,
      status: 'fill',
      // Gõ tên cảng…
      value: name,
      // …nhưng suggestion của site có dạng "名称/代码".
      matchValue: code ? `${name}/${code}` : undefined,
      // Site tự cascade mã cảng khi suggestion được click.
      verify: { prop: group.codeProp, note: `Port code ${group.codeProp} was not set` },
    })
  }

  plans.push({
    prop: 'TRANS_PORT_NAM',
    label: '中转港',
    status: 'skip',
    note: 'The API provides no data for 中转港',
  })
  plans.push({
    prop: 'SIGN_PLACE_STR',
    label: '提单签发地/代码',
    status: 'skip',
    note: 'The API provides no data for 提单签发地',
  })

  const contacts = data.cabContacts ?? []
  for (const group of PARTY_GROUPS) {
    const contact = contacts.find((c) => contactRole(c) === group.role)
    push(group.nameProp, `${group.label}名称`, contact?.master)
    push(`${group.prefix}_ADD_STR`, `${group.label}地址`, contact?.address)
    push(`${group.prefix}_COUNTRY_COD`, `${group.label}国家代码`, contact?.country)
    push(`${group.prefix}_TE_STR`, `${group.label}电话`, contact?.phone)
    push(`${group.prefix}_EM_STR`, `${group.label}EMAIL`, undefined, 'The API provides no email address')
    push(`${group.prefix}_FX_STR`, `${group.label}传真`, undefined, 'The API provides no fax number')
    push(
      `${group.prefix}_AEO`,
      `${group.label}AEO代码`,
      contact?.aeo,
      'firmCode is a business registration number (USCI/TIN), not an AEO code, so this field is left blank',
    )
  }

  return plans
}

/**
 * Loại hàng: S = thường, D = hàng nguy hiểm, R = hàng kiểm dịch (refrigerated/quarantine),
 * G = vừa nguy hiểm vừa kiểm dịch.
 */
export type CargoKind = 'S' | 'D' | 'R' | 'G'

export function deriveCargoKind(goods: ManifestCargo): CargoKind {
  const danger = !isBlank(goods.dangerClass) || !isBlank(goods.unNub)
  const cold = !isBlank(goods.quarantineName) || !isBlank(goods.quarantineCode)
  if (danger && cold) return 'G'
  if (danger) return 'D'
  if (cold) return 'R'
  return 'S'
}

/**
 * Nhãn hiển thị của loại hàng trên site.
 *
 * `el-select` của site khớp option theo **TEXT hiển thị** ⇒ plan phải chứa
 * nhãn (`普货`), mã (`S`) chỉ nằm trong `note` để người dùng đối chiếu.
 */
const CARGO_KIND_LABELS: Record<CargoKind, string> = {
  S: '普货',
  D: '危险品',
  R: '冷藏品',
  G: '危险品+冷藏品',
}

/** Field BẮT BUỘC của site theo từng loại hàng (FACT 5.3 của plan live-site-alignment). */
const REQUIRED_BASE: readonly string[] = [
  'CARGO_KIND_COD',
  'PACKAGE_COD',
  'PACKAGE_STR',
  'PIECE_NUM',
  'GWEIGHT_TON',
  'GVOL_NUM',
  'MARK_STR',
  'E_CARGO_NAM',
]
const REQUIRED_DANGER: readonly string[] = [
  'DANG_CLASS_NAM',
  'DANG_UN_NO',
  'DANGER_CONTACT_NAM',
  'DANGER_TE_STR',
]
const REQUIRED_COLD: readonly string[] = ['TEMP_ID', 'SET_TEMP_NUM']

/** Field BẮT BUỘC của site trong bảng container (FACT 5.3). */
const REQUIRED_CONTAINER: readonly string[] = [
  'CNTR_SIZE_COD',
  'CNTR_TYPE_COD',
  'CNTR_EF_ID',
  'SOC_ID',
]

const REQUIRED_BY_KIND: Record<CargoKind, readonly string[]> = {
  S: REQUIRED_BASE,
  D: [...REQUIRED_BASE, ...REQUIRED_DANGER],
  R: [...REQUIRED_BASE, ...REQUIRED_COLD],
  G: [...REQUIRED_BASE, ...REQUIRED_DANGER, ...REQUIRED_COLD],
}

/**
 * Note của một field bị bỏ trống.
 *
 * Field **bắt buộc** của site phải nói rõ người dùng cần làm tay, còn field
 * thường dùng note chung. 12 field nguy hiểm bị site xoá & disable trừ khi loại
 * là `D`/`G`, `TEMP_ID`/`SET_TEMP_NUM` bị xoá trừ khi loại là `R`/`G` ⇒ ở loại
 * `S` các field `DANG_*` bị skip là đúng và note chung là đủ.
 */
function skippedNote(
  prop: string,
  label: string,
  kind: CargoKind,
  required: ReadonlySet<string>,
): string {
  if (required.has(prop)) {
    return (
      `The site requires ${label} (${prop}) for ${CARGO_KIND_LABELS[kind]} cargo, ` +
      'but the API provides no data — please fill it in by hand on the page.'
    )
  }
  return 'The API provides no data for this field'
}

/**
 * Số nguyên của một giá trị số.
 *
 * `PIECE_NUM` của site chỉ nhận số nguyên (`/^\d*$/` trong bundle) ⇒ `"114.000"`
 * phải cắt thành `"114"`, nếu không site validate fail ⇒ báo `请填必填表格` và
 * **không** POST ⇒ dòng hàng không được lưu.
 *
 * KHÔNG dùng hàm này cho `GWEIGHT_TON`/`GVOL_NUM`: rule của chúng cho phép tối
 * đa 3 chữ số thập phân.
 */
function integerText(value: unknown): { value: string; raw: string; truncated: boolean } {
  const raw = text(value)
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw)
  if (!match) return { value: raw, raw, truncated: false }
  const intPart = match[1]!
  if (match[2] === undefined) return { value: intPart, raw, truncated: false }
  return { value: intPart, raw, truncated: true }
}

/** Giá trị đầu tiên khác rỗng (dùng cho fallback `shantou` → `sign`). */
function firstNonBlank(...values: unknown[]): string {
  for (const value of values) {
    const v = text(value)
    if (v !== '') return v
  }
  return ''
}

/**
 * Ánh xạ 1 dòng hàng (cdgoods) sang danh sách field plan cho bảng 货物明细.
 */
export function mapCargo(goods: ManifestCargo): FieldPlan[] {
  const plans: FieldPlan[] = []
  const kind = deriveCargoKind(goods)
  const kindLabel = CARGO_KIND_LABELS[kind]
  const required = new Set(REQUIRED_BY_KIND[kind])

  const push = (
    prop: string,
    label: string,
    value: unknown,
    options: { skipNote?: string; fillNote?: string } = {},
  ) => {
    const v = text(value)
    if (v === '') {
      plans.push({
        prop,
        label,
        status: 'skip',
        note: options.skipNote ?? skippedNote(prop, label, kind, required),
        required: required.has(prop),
      })
    } else {
      plans.push({
        prop,
        label,
        status: 'fill',
        value: v,
        note: options.fillNote,
        required: required.has(prop),
      })
    }
  }

  // 货物标识 — `el-select` khớp theo nhãn hiển thị, mã chỉ để đối chiếu.
  plans.push({
    prop: 'CARGO_KIND_COD',
    label: '货物标识',
    status: 'fill',
    value: kindLabel,
    note: `The site stores the code "${kind}" for "${kindLabel}"`,
    required: true,
  })

  push('CARGO_HS_COD', 'HS编码', goods.hscode)

  // 包装类型/代码 — API KHÔNG có 包装类型 thật: `unit` chỉ là đơn vị đếm chung
  // ("PACKAGES"), `packType`/`packDesc` đều null ⇒ ghi vào tờ khai là rác.
  push('PACKAGE_STR', '包装类型/代码', undefined, {
    skipNote:
      'The site requires 包装类型/代码 (PACKAGE_STR) but the API provides no real packaging type ' +
      '— its `unit` is a generic counting unit (PACKAGES). Please choose it on the page; ' +
      'it must be filled in by hand.',
  })
  push('PACKAGE_COD', '包装类型代码', undefined, {
    skipNote:
      'The site requires 包装类型代码 (PACKAGE_COD) — exactly 2 characters — but the API ' +
      'provides no packaging code. Please choose it on the page; it must be filled in by hand.',
  })

  // 包装件数 — site chỉ nhận số nguyên ⇒ cắt phần thập phân.
  const pieces = integerText(goods.amount)
  push('PIECE_NUM', '包装件数', pieces.value, {
    fillNote: pieces.truncated
      ? `The site only accepts whole numbers for 包装件数 — wrote ${pieces.value} ` +
        `(the API gave "${pieces.raw}")`
      : undefined,
  })

  // 毛重 / 体积 — rule của site cho phép tối đa 3 chữ số thập phân ⇒ giữ nguyên.
  push('GWEIGHT_TON', '货物毛重（公斤）', goods.weight)
  push('GVOL_NUM', '货物体积（m³）', goods.volume)
  push('NWEIGHT_TON', '货物净重（公斤）', goods.grossWeight)

  // 唛头 — `shantou` là pinyin của 唛头 và là field 唛头 thật của site;
  // `sign` là field khác (null trong dữ liệu thật) nên chỉ dùng làm fallback.
  push('MARK_STR', '唛头', firstNonBlank(goods.shantou, goods.sign))

  push('E_CARGO_NAM', '货物描述', goods.name)
  push('DANG_CLASS_NAM', '危险品类别', goods.dangerClass)
  push('DANG_UN_NO', '危险品联合国编号', goods.unNub)
  push('DANG_LABLE_STR', '危险品标签', goods.dangerCode)
  push('DANG_FLASH_POINT', '危险货物闪点（摄氏）', goods.dangerPoint)
  push('DANG_PAGE_NO', '危险品页号', undefined)
  push('DANG_EMS_NO', '船运危险品应急措施号', undefined)
  push('DANG_MFAG_NO', '医疗急救指南号', undefined)
  push('DANG_CONTACTSTR', '应急联系', undefined)
  push('DANGER_CONTACT_NAM', '危险品联系人姓名', goods.exigencyName)
  push('DANGER_TE_STR', '危险品联系人电话', goods.exigencyPhone)
  push('DANGER_EM_STR', '危险品联系人邮箱', goods.exigencyEmail)
  push('DANGER_FX_STR', '危险品联系人传真', goods.exigencyFax)
  push('TEMP_ID', '温度计量单位', undefined)
  push('SET_TEMP_NUM', '设置温度', undefined)

  // Lưu ý (C-6): cột 货物标识 của bảng DANH SÁCH hàng hiện `普货` (không phải `S`),
  // cột 温度计量单位 hiện `摄氏` (không phải `C`). Nếu sau này extension verify
  // bằng cách đọc bảng danh sách thì phải so khớp **nhãn**, không so mã.

  return plans
}

/**
 * Ánh xạ 1 dòng container (cdCon) sang danh sách field plan cho bảng 集装箱.
 */
export function mapContainer(
  container: ManifestContainer,
  ctx: MappingContext,
): FieldPlan[] {
  const plans: FieldPlan[] = []

  const push = (
    prop: string,
    label: string,
    columnLabel: string,
    value: unknown,
    options: { skipNote?: string; fillNote?: string } = {},
  ) => {
    const v = text(value)
    if (v === '') {
      plans.push({
        prop,
        label,
        status: 'skip',
        note: options.skipNote ?? 'The API provides no data for this field',
        columnLabel,
        required: REQUIRED_CONTAINER.includes(prop),
      })
    } else {
      plans.push({
        prop,
        label,
        status: 'fill',
        value: v,
        note: options.fillNote,
        columnLabel,
        required: REQUIRED_CONTAINER.includes(prop),
      })
    }
  }

  push('CNTR_NO', '箱号', '箱号', container.boxNub)

  // 尺寸 / 箱型 — lookup VẪN chạy; chỉ khi dict của site không tra được
  // (dict chỉ chứa chuỗi thuần "20"/"GP" còn `vC`/`cType` của API là mã số)
  // thì mới skip — không điền bừa giá trị sai.
  const size = ctx.findCntrSize(container.vC ?? undefined)
  push('CNTR_SIZE_COD', '尺寸', '尺寸', size, {
    skipNote: isBlank(container.vC)
      ? 'The site requires 尺寸 (CNTR_SIZE_COD) but the API provides no data. ' +
        'Please choose it on the page; it must be filled in by hand.'
      : 'The site requires 尺寸 (CNTR_SIZE_COD) but the API gives numeric codes (vC) while ' +
        "the site's dictionary only holds plain strings, so the container size cannot be " +
        'resolved. Please choose it on the page; it must be filled in by hand.',
  })

  const cntrType = ctx.findCntrType(container.cType ?? undefined)
  push('CNTR_TYPE_COD', '箱型', '箱型', cntrType, {
    skipNote: isBlank(container.cType)
      ? 'The site requires 箱型 (CNTR_TYPE_COD) but the API provides no data. ' +
        'Please choose it on the page; it must be filled in by hand.'
      : 'The site requires 箱型 (CNTR_TYPE_COD) but the API gives numeric codes (cType) while ' +
        "the site's dictionary only holds plain strings, so the container type cannot be " +
        'resolved. Please choose it on the page; it must be filled in by hand.',
  })

  // 箱状态 — API không có dữ liệu nào tương ứng.
  push('CNTR_EF_ID', '箱状态', '箱状态', undefined, {
    skipNote:
      'The site requires 箱状态 (CNTR_EF_ID) but the API provides no container status. ' +
      'Please choose it on the page; it must be filled in by hand.',
  })

  push('SEAL_NO', '铅封号', '铅封号', container.sealNUb)

  // 货物件数 — cùng luật số nguyên với 包装件数 của dòng hàng.
  const pieces = integerText(container.amount)
  push('PIECE_NUM', '货物件数', '货物件数', pieces.value, {
    fillNote: pieces.truncated
      ? `The site only accepts whole numbers for 货物件数 — wrote ${pieces.value} ` +
        `(the API gave "${pieces.raw}")`
      : undefined,
  })

  push('WEIGH_TON', '箱内货重（公斤）', '箱内货重（公斤）', container.weight)
  push('VOLUME_NUM', '箱内体积', '箱内体积', container.volume)

  // 货主箱标志 — `el-select` của site hiện nhãn `货主箱`/`非货主箱` (mã `Y`/`N`
  // chỉ nằm trong model) ⇒ phải ghi nhãn, không ghi mã.
  const soc =
    container.self === null || container.self === undefined
      ? undefined
      : container.self
        ? { label: '货主箱', code: 'Y' }
        : { label: '非货主箱', code: 'N' }
  push('SOC_ID', '货主箱标志', '货主箱标志', soc?.label, {
    fillNote: soc ? `The site stores the code "${soc.code}" for "${soc.label}"` : undefined,
    skipNote:
      'The site requires 货主箱标志 (SOC_ID) but the API provides no data. ' +
      'Please choose it on the page; it must be filled in by hand.',
  })

  return plans
}
