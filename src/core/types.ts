export interface PortInfo {
  id?: number
  name?: string
  nameEn?: string
}

export interface ManifestContact {
  id?: number
  /**
   * Vai trò của bên: `false` = 发货人, `true` = 收货人, `2` = 通知人.
   *
   * KHÔNG chuẩn hoá `0`/`1` thành vai trò — chỉ đúng ba giá trị trên mới
   * khớp (xem `contactRole`).
   */
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

/**
 * Dữ liệu RAW của API bên ngoài (`…/insight/manifest?blNo=…`).
 *
 * Đây là hình dạng API trả về — KHÔNG phải hình dạng body của site. Body
 * của site là `ManifestData`.
 */
export interface ManifestApiData {
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
  sea_order?: {
    ebNo?: string | null
    sea_order_bind?: { id?: number; supplyId?: number } | null
  } | null
  cabContacts?: ManifestContact[] | null
  cdgoods?: ManifestCargo[] | null
  cdCon?: ManifestContainer[] | null
}

/** Một dòng hàng trong body của site. */
export type ManifestCargoRow = Record<string, unknown>

/** Một dòng container trong body của site. */
export type ManifestContainerRow = Record<string, unknown>

/**
 * Body của site — 45 key: 43 key header + `cdgoods` + `cntr_list`.
 *
 * PHẢI là `type` alias (KHÔNG phải `interface`): chỉ type alias mới có
 * implicit index signature ⇒ gán được cho `Record<string, unknown>` (code
 * hiện tại dùng kiểu đó ở nhiều nơi, vd `ReportRowSpec.values`).
 */
export type ManifestData = {
  /** Dòng hàng — gửi riêng qua `cargo/add/`, KHÔNG gửi kèm lúc tạo bill. */
  cdgoods: ManifestCargoRow[]
  /** Dòng container — gửi kèm lúc lưu bill (biến `cntr_list` của site). */
  cntr_list: ManifestContainerRow[]
  bill_no: string
  bill_nbr: string
  e_ship_nam: string
  out_voyage_no: string
  trust_cod: string
  pay_way_id: string
  dr_type_str: string
  sign_place_cod: string
  sign_place_str: string
  start_port_cod: string
  start_port_nam: string
  dischrg_port_cod: string
  dischrg_port_nam: string
  trans_port_cod: string
  trans_port_nam: string
  dest_port_cod: string
  dest_port_nam: string
  e_shipper_nam: string
  shipper_add_str: string
  shipper_country_cod: string
  shipper_te_str: string
  shipper_em_str: string
  shipper_fx_str: string
  shipper_aeo: string
  e_consignee_nam: string
  consignee_add_str: string
  consignee_country_cod: string
  consignee_te_str: string
  consignee_em_str: string
  consignee_fx_str: string
  consignee_aeo: string
  e_notify_nam: string
  notify_add_str: string
  notify_country_cod: string
  notify_te_str: string
  notify_em_str: string
  notify_fx_str: string
  total_piece_num: string
  total_gweight_ton: string
  total_gvol_num: string
  mandatory_check: string
  soft_check: string
  is_all: string
}
