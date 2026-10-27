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
export function deriveCargoKind(goods: ManifestCargo): 'S' | 'D' | 'R' | 'G' {
  const danger = !isBlank(goods.dangerClass) || !isBlank(goods.unNub)
  const cold = !isBlank(goods.quarantineName) || !isBlank(goods.quarantineCode)
  if (danger && cold) return 'G'
  if (danger) return 'D'
  if (cold) return 'R'
  return 'S'
}

/**
 * Ánh xạ 1 dòng hàng (cdgoods) sang danh sách field plan cho bảng 货物明细.
 */
export function mapCargo(goods: ManifestCargo): FieldPlan[] {
  const plans: FieldPlan[] = []

  const push = (prop: string, label: string, value: unknown, note?: string) => {
    const v = text(value)
    if (v === '') {
      plans.push({ prop, label, status: 'skip', note: note ?? 'The API provides no data for this field' })
    } else {
      plans.push({ prop, label, status: 'fill', value: v })
    }
  }

  push('CARGO_KIND_COD', '货物标识', deriveCargoKind(goods))
  push('CARGO_HS_COD', 'HS编码', goods.hscode)
  push('PACKAGE_STR', '包装类型/代码', goods.unit ?? goods.packDesc)
  push('PACKAGE_COD', '包装类型代码', goods.packType)
  push('PIECE_NUM', '包装件数', goods.amount)
  push('GWEIGHT_TON', '货物毛重（公斤）', goods.weight)
  push('GVOL_NUM', '货物体积（m³）', goods.volume)
  push('NWEIGHT_TON', '货物净重（公斤）', goods.grossWeight)
  push('MARK_STR', '唛头', goods.sign)
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

  const push = (prop: string, label: string, columnLabel: string, value: unknown, note?: string) => {
    const v = text(value)
    if (v === '') {
      plans.push({
        prop,
        label,
        status: 'skip',
        note: note ?? 'The API provides no data for this field',
        columnLabel,
      })
    } else {
      plans.push({ prop, label, status: 'fill', value: v, columnLabel })
    }
  }

  push('CNTR_NO', '箱号', '箱号', container.boxNub)
  push(
    'CNTR_SIZE_COD',
    '尺寸',
    '尺寸',
    ctx.findCntrSize(container.vC ?? undefined),
    `No 尺寸 found for code "${container.vC ?? ''}" in getCntrCode()`,
  )
  push(
    'CNTR_TYPE_COD',
    '箱型',
    '箱型',
    ctx.findCntrType(container.cType ?? undefined),
    `No 箱型 found for code "${container.cType ?? ''}" in getCntrCode()`,
  )
  push('CNTR_EF_ID', '箱状态', '箱状态', undefined)
  push('SEAL_NO', '铅封号', '铅封号', container.sealNUb)
  push('PIECE_NUM', '货物件数', '货物件数', container.amount)
  push('WEIGH_TON', '箱内货重（公斤）', '箱内货重（公斤）', container.weight)
  push('VOLUME_NUM', '箱内体积', '箱内体积', container.volume)
  push(
    'SOC_ID',
    '货主箱标志',
    '货主箱标志',
    container.self === null || container.self === undefined ? undefined : container.self ? '1' : '0',
  )

  return plans
}
