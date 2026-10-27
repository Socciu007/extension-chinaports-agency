export interface PortInfo {
  id?: number
  name?: string
  nameEn?: string
}

export interface ManifestContact {
  id?: number
  /** 0/false = 发货人, 1/true = 收货人, 2 = 通知人 */
  type?: boolean | number
  master?: string | null
  address?: string | null
  firmCode?: string | null
  country?: string | null
  phone?: string | null
  aeo?: string | null
  spName?: string | null
  spType?: string | null
  spContact?: string | null
}

export interface ManifestCargo {
  id?: number
  name?: string | null
  description?: string | null
  cargoType?: boolean
  amount?: string | number | null
  unit?: string | null
  weight?: string | number | null
  volume?: string | number | null
  grossWeight?: string | number | null
  hscode?: string | null
  dangerClass?: string | null
  unNub?: string | null
  dangerCode?: string | null
  dangerPoint?: string | number | null
  packType?: string | null
  packDesc?: string | null
  /** 唛头 (pinyin của "mào tóu") — đây mới là field 唛头 của site, `sign` là field khác. */
  shantou?: string | null
  sign?: string | null
  quarantineCode?: string | null
  quarantineName?: string | null
  exigencyName?: string | null
  exigencyPhone?: string | null
  exigencyEmail?: string | null
  exigencyFax?: string | null
}

export interface ManifestContainer {
  id?: number
  boxNub?: string | null
  sealNUb?: string | null
  /** 箱型: 2 = 20GP … */
  cType?: number | string | null
  /** Kích thước: 0 = 20' … */
  vC?: number | string | null
  /** true = 货主箱 */
  self?: boolean | null
  amount?: string | number | null
  weight?: string | number | null
  volume?: string | number | null
}

export interface ManifestData {
  id?: number
  blNo?: string | null
  shipName?: string | null
  voyage?: string | null
  loadCode?: string | null
  uploadCode?: string | null
  aimPortCode?: string | null
  payType?: boolean | number | null
  transportTerms?: string | null
  loadPortData?: PortInfo | null
  uploadPortData?: PortInfo | null
  aimPortData?: PortInfo | null
  /** Tên field cố tình giữ dạng snake_case để khớp payload của API — đừng đổi, sẽ hỏng mapping. */
  sea_order?: {
    ebNo?: string | null
    sea_order_bind?: { id?: number; supplyId?: number } | null
  } | null
  cabContacts?: ManifestContact[] | null
  cdgoods?: ManifestCargo[] | null
  cdCon?: ManifestContainer[] | null
}
