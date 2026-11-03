import { describe, it, expect } from 'vitest'
import {
  buildCargoPayload,
  buildContainerPayload,
  buildManifestBody,
  lowerKeys,
  toWireValue,
} from '../src/core/payload'
import type { ManifestApiData, ManifestCargo, ManifestContainer } from '../src/core/types'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'

/** Dữ liệu mẫu (phần `data` của envelope của API) — hình dạng RAW. */
const manifest = fixture.data as ManifestApiData

/**
 * 45 key của BODY — đúng theo mẫu thật của site.
 *
 * 43 key header + `cdgoods` + `cntr_list`. Site KHÔNG có field AEO cho 通知人
 * (`NOTIFY_AEO` không tồn tại) ⇒ body KHÔNG được có `notify_aeo`.
 *
 * Thứ tự ở đây là thứ tự body THỰC SỰ gửi đi (khớp với `buildManifestBody`)
 * ⇒ test dưới chốt luôn cả vị trí của từng key.
 *
 * LƯU Ý: thứ tự này CỐ TÌNH khác thứ tự form của site (site: 卸货港 →
 * 中转港 → 交货地; body: dischrg → trans → dest). Thứ tự key trong JSON không
 * mang ý nghĩa với POST của site (`keyToLowercase` nhận object) ⇒ giữ nguyên
 * thứ tự body, không sửa để "giống site".
 */
const BODY_KEYS = [
  'cdgoods',
  'cntr_list',
  'bill_no',
  'bill_nbr',
  'e_ship_nam',
  'out_voyage_no',
  'trust_cod',
  'pay_way_id',
  'dr_type_str',
  'sign_place_cod',
  'sign_place_str',
  'start_port_cod',
  'start_port_nam',
  'dischrg_port_cod',
  'dischrg_port_nam',
  'trans_port_cod',
  'trans_port_nam',
  'dest_port_cod',
  'dest_port_nam',
  'e_shipper_nam',
  'shipper_add_str',
  'shipper_country_cod',
  'shipper_te_str',
  'shipper_em_str',
  'shipper_fx_str',
  'shipper_aeo',
  'e_consignee_nam',
  'consignee_add_str',
  'consignee_country_cod',
  'consignee_te_str',
  'consignee_em_str',
  'consignee_fx_str',
  'consignee_aeo',
  'e_notify_nam',
  'notify_add_str',
  'notify_country_cod',
  'notify_te_str',
  'notify_em_str',
  'notify_fx_str',
  'total_piece_num',
  'total_gweight_ton',
  'total_gvol_num',
  'mandatory_check',
  'soft_check',
  'is_all',
]

/** 25 key của body dòng hàng. */
const CARGO_KEYS = [
  'bill_no',
  'piece_num',
  'gweight_ton',
  'gvol_num',
  'nweight_ton',
  'cargo_kind_cod',
  'cargo_hs_cod',
  'package_cod',
  'package_str',
  'mark_str',
  'e_cargo_nam',
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
  'temp_id',
  'set_temp_num',
]

/** 10 key của body container. */
const CONTAINER_KEYS = [
  'bill_no',
  'cntr_no',
  'cntr_size_cod',
  'cntr_type_cod',
  'cntr_ef_id',
  'seal_no',
  'piece_num',
  'weigh_ton',
  'volume_num',
  'soc_id',
]

describe('buildManifestBody', () => {
  const body = buildManifestBody(manifest)

  it('có đúng 45 key (43 key header + cdgoods + cntr_list)', () => {
    expect(Object.keys(body).sort()).toEqual([...BODY_KEYS].sort())
    expect(Object.keys(body)).toHaveLength(45)
  })

  it('giữ thứ tự key như body thực sự gửi đi (45 key, không lệch vị trí nào)', () => {
    expect(Object.keys(body)).toEqual(BODY_KEYS)
  })

  it('mọi giá trị HEADER là chuỗi (thiếu dữ liệu ⇒ "" chứ không null/undefined)', () => {
    for (const [key, value] of Object.entries(body)) {
      if (key === 'cdgoods' || key === 'cntr_list') continue
      expect(typeof value).toBe('string')
    }
  })

  it('`cdgoods` / `cntr_list` là mảng dòng hàng / dòng container', () => {
    expect(Array.isArray(body.cdgoods)).toBe(true)
    expect(Array.isArray(body.cntr_list)).toBe(true)
    expect(body.cdgoods).toHaveLength(1)
    expect(body.cntr_list).toHaveLength(1)
    // Dòng hàng / dòng container đi qua endpoint riêng ⇒ `bill_no` rỗng.
    expect(body.cdgoods[0]?.bill_no).toBe('')
    expect(body.cntr_list[0]?.bill_no).toBe('')
  })

  it('điền thông tin chuyến tàu', () => {
    expect(body.bill_no).toBe('')
    expect(body.bill_nbr).toBe('ONEYSHAGT1569600')
    expect(body.e_ship_nam).toBe('CALLAO BRIDGE')
    expect(body.out_voyage_no).toBe('0294S')
  })

  it('điền 承运人代码', () => {
    expect(body.trust_cod).toBe('ONE')
  })

  it('điền cảng theo mã + tên cảng', () => {
    expect(body.start_port_cod).toBe('CNSHA')
    // Tên cảng lấy từ `loadPortData.nameEn` của API — tên TIẾNG ANH.
    expect(body.start_port_nam).toBe('SHANGHAI')
    expect(body.dischrg_port_cod).toBe('IDBLW')
    expect(body.dischrg_port_nam).toBe('BELAWAN')
  })

  it('điền 交货地 theo `uploadCode` kể cả khi trùng cảng 卸货港', () => {
    // Fixture: `aimPortCode === uploadCode === 'IDBLW'` ⇒ 交货地 lấy `uploadCode`
    // ⇒ vẫn điền, KHÔNG để trống.
    expect(body.dest_port_cod).toBe('IDBLW')
    expect(body.dest_port_nam).toBe('BELAWAN')
  })

  it('卸货港 lấy `aimPortCode`, 交货地 lấy `uploadCode`', () => {
    const data: ManifestApiData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: 'IDSUB',
      aimPortData: { name: '泗水', nameEn: 'SURABAYA' },
    }
    const body = buildManifestBody(data)
    expect(body.dischrg_port_cod).toBe('IDSUB')
    expect(body.dischrg_port_nam).toBe('SURABAYA')
    expect(body.dest_port_cod).toBe('IDBLW')
    expect(body.dest_port_nam).toBe('BELAWAN')
  })

  it('API không có tên cảng ⇒ để trống (KHÔNG tra dict lúc dựng body)', () => {
    const data: ManifestApiData = { ...manifest, uploadPortData: null }
    const body = buildManifestBody(data)
    expect(body.dest_port_cod).toBe('IDBLW')
    // Không còn đường dự phòng từ dict ⇒ tên cảng rỗng.
    expect(body.dest_port_nam).toBe('')
  })

  it('dùng `nameEn` của API cho tên cảng', () => {
    const data: ManifestApiData = {
      ...manifest,
      aimPortCode: 'IDXYZ',
      aimPortData: { nameEn: 'UNKNOWN PORT' },
    }
    const body = buildManifestBody(data)
    expect(body.dischrg_port_cod).toBe('IDXYZ')
    expect(body.dischrg_port_nam).toBe('UNKNOWN PORT')
  })

  it('lấy 3 bên theo vai trò (false = 发货人, true = 收货人, 2 = 通知人)', () => {
    expect(body.e_shipper_nam).toBe('SHANGHAI JUNYI TRADE & DEVELOPMENT CO.,LTD.')
    expect(body.shipper_country_cod).toBe('CN')
    expect(body.shipper_te_str).toBe('02152160262')
    expect(body.e_consignee_nam).toBe('PT KARYA BINA NUSANTARA')
    expect(body.consignee_country_cod).toBe('ID')
    expect(body.consignee_te_str).toBe('021-5452772')
    expect(body.e_notify_nam).toBe('PT KARYA BINA NUSANTARA')
    expect(body.notify_country_cod).toBe('ID')
    expect(body.notify_te_str).toBe('021-5452772')
  })

  it('KHÔNG điền AEO (firmCode là mã đăng ký doanh nghiệp, không phải mã AEO)', () => {
    expect(body.shipper_aeo).toBe('')
    expect(body.consignee_aeo).toBe('')
  })

  it('KHÔNG có key `notify_aeo` (site không có field AEO cho 通知人)', () => {
    // Site chỉ có `SHIPPER_AEO` / `CONSIGNEE_AEO` ⇒ body phải đúng 45 key.
    expect(Object.keys(body)).not.toContain('notify_aeo')
  })

  it('KHÔNG có key "undefined" (party không có field AEO thì KHÔNG ghi key)', () => {
    expect(Object.keys(body)).not.toContain('undefined')
  })

  it('KHÔNG điền email/fax (API không có)', () => {
    expect(body.shipper_em_str).toBe('')
    expect(body.shipper_fx_str).toBe('')
    expect(body.consignee_em_str).toBe('')
    expect(body.notify_em_str).toBe('')
  })

  it('để trống field mà API không có dữ liệu', () => {
    expect(body.sign_place_cod).toBe('')
    expect(body.sign_place_str).toBe('')
    expect(body.trans_port_cod).toBe('')
    expect(body.trans_port_nam).toBe('')
    expect(body.total_piece_num).toBe('')
    expect(body.total_gweight_ton).toBe('')
    expect(body.total_gvol_num).toBe('')
    expect(body.mandatory_check).toBe('')
    expect(body.soft_check).toBe('')
  })

  it('tạo bill (is_all = "0", KHÔNG phải "2" = 发送)', () => {
    expect(body.is_all).toBe('0')
  })

  it('rỗng hết khi không có dữ liệu nào', () => {
    const empty = buildManifestBody({})
    expect(empty.cdgoods).toEqual([])
    expect(empty.cntr_list).toEqual([])
    const values = empty as Record<string, unknown>
    for (const key of BODY_KEYS) {
      if (key === 'cdgoods' || key === 'cntr_list') continue
      if (key === 'is_all') {
        expect(values[key]).toBe('0')
        continue
      }
      expect(values[key]).toBe('')
    }
  })
})

/**
 * 付款方式 — CHIỀU ĐẢO.
 *
 * `payType === true` ⇒ 到付 (mã "C"), `payType === false` ⇒ 预付 (mã "P").
 */
describe('buildManifestBody — 付款方式', () => {
  it('payType = true ⇒ "C" (到付)', () => {
    const body = buildManifestBody({ ...manifest, payType: true })
    expect(body.pay_way_id).toBe('C')
  })

  it('payType = false ⇒ "P" (预付)', () => {
    const body = buildManifestBody({ ...manifest, payType: false })
    expect(body.pay_way_id).toBe('P')
  })

  it('payType = 1 ⇒ "C", payType = 0 ⇒ "P"', () => {
    expect(buildManifestBody({ ...manifest, payType: 1 }).pay_way_id).toBe('C')
    expect(buildManifestBody({ ...manifest, payType: 0 }).pay_way_id).toBe('P')
  })

  it('không có dữ liệu ⇒ để trống (KHÔNG đoán)', () => {
    expect(buildManifestBody({ ...manifest, payType: null }).pay_way_id).toBe('')
    expect(buildManifestBody({ ...manifest, payType: undefined }).pay_way_id).toBe('')
  })

  it('giá trị lạ ⇒ để trống', () => {
    expect(buildManifestBody({ ...manifest, payType: 2 }).pay_way_id).toBe('')
  })
})

/**
 * 交货条款 — lấy THẲNG giá trị của API.
 *
 * Dict `getDrType/` của site chỉ có nhãn tiếng Trung (không có mã) ⇒ tra
 * dict là tra hụt ⇒ extension KHÔNG gọi dict đó nữa, body lấy thẳng
 * `transportTerms` của API.
 */
describe('buildManifestBody — 交货条款', () => {
  it('lấy thẳng `transportTerms` của API, KHÔNG tra dict', () => {
    const body = buildManifestBody(manifest)
    // Fixture: `transportTerms` = "1"; dict của site KHÔNG được tra.
    expect(body.dr_type_str).toBe('1')
  })

  it('giữ nguyên giá trị của API — KHÔNG còn đường tra dict nào', () => {
    // Không còn ngữ cảnh tra cứu nào ⇒ body KHÔNG THỂ tra dict cho
    // 交货条款 ⇒ giá trị của API đi thẳng vào body.
    const body = buildManifestBody(manifest)
    expect(body.dr_type_str).toBe('1')
  })

  it('không có dữ liệu ⇒ để trống', () => {
    const body = buildManifestBody({ ...manifest, transportTerms: null })
    expect(body.dr_type_str).toBe('')
  })
})

/**
 * 3 bên — khớp theo vai trò.
 *
 * `type` bằng `false`/`0` là 发货人, bằng `true`/`1` là 收货人, bằng `2` là
 * 通知人 ⇒ bên đó ĐƯỢC điền vào body.
 */
describe('buildManifestBody — 3 bên (khớp theo vai trò)', () => {
  it('`type: 0` khớp 发货人', () => {
    const data: ManifestApiData = {
      ...manifest,
      cabContacts: [{ type: 0, master: 'NOT SHIPPER' }],
    }
    const body = buildManifestBody(data)
    expect(body.e_shipper_nam).toBe('NOT SHIPPER')
  })

  it('`type: 1` khớp 收货人', () => {
    const data: ManifestApiData = {
      ...manifest,
      cabContacts: [{ type: 1, master: 'NOT CONSIGNEE' }],
    }
    const body = buildManifestBody(data)
    expect(body.e_consignee_nam).toBe('NOT CONSIGNEE')
  })

  it('`type: 2` khớp 通知人', () => {
    const data: ManifestApiData = {
      ...manifest,
      cabContacts: [{ type: 2, master: 'NOTIFY ME' }],
    }
    const body = buildManifestBody(data)
    expect(body.e_notify_nam).toBe('NOTIFY ME')
  })

  it('`type: false` khớp 发货人', () => {
    const data: ManifestApiData = {
      ...manifest,
      cabContacts: [{ type: false, master: 'SHIPPER' }],
    }
    const body = buildManifestBody(data)
    expect(body.e_shipper_nam).toBe('SHIPPER')
  })

  it('`type: true` khớp 收货人', () => {
    const data: ManifestApiData = {
      ...manifest,
      cabContacts: [{ type: true, master: 'CONSIGNEE' }],
    }
    const body = buildManifestBody(data)
    expect(body.e_consignee_nam).toBe('CONSIGNEE')
  })
})

/**
 * Số bill ghi vào 提单号 trên site.
 *
 * Số bill trên site CÓ THỂ mang hậu tố piece (`P1`, `P12`) — đó là số bill
 * thật mà operator gõ. API của dadaex chỉ trả mã gốc ⇒ ghi mã gốc vào
 * 提单号 là ĐỔI ÂM THẦM số bill trên tờ khai.
 */
describe('buildManifestBody — số bill ghi lên site', () => {
  it('ghi số bill CÓ hậu tố piece đúng như operator gõ', () => {
    const body = buildManifestBody(manifest, 'CHN4139065P1')
    expect(body.bill_nbr).toBe('CHN4139065P1')
  })

  it('giữ hậu tố piece P12', () => {
    const body = buildManifestBody(manifest, 'ONEYSHAGT1569600P12')
    expect(body.bill_nbr).toBe('ONEYSHAGT1569600P12')
  })

  it('trim + upper-case (site upper-case mọi field chuỗi trước khi POST)', () => {
    const body = buildManifestBody(manifest, '  chn4139065p1 ')
    expect(body.bill_nbr).toBe('CHN4139065P1')
  })

  it('fallback sang blNo của API khi operator KHÔNG gõ số bill', () => {
    const body = buildManifestBody(manifest, '')
    expect(body.bill_nbr).toBe('ONEYSHAGT1569600')
  })

  it('không có tham số ⇒ vẫn lấy blNo của API', () => {
    const body = buildManifestBody(manifest)
    expect(body.bill_nbr).toBe('ONEYSHAGT1569600')
  })
})

/**
 * Số API trả về mà extension KHÔNG parse được.
 *
 * `num()` trước đây nuốt lỗi parse thành `0` ⇒ `"22,400"` thành 0 kg mà
 * không có bất kỳ cảnh báo nào. Nay là `NaN` ⇒ report biết đây là lý do
 * KHÁC ("không parse được"). Payload TRONG BỘ NHỚ giữ `NaN` (report đọc
 * chính payload đó); tầng gửi đi đổi thành `0` — cùng giá trị với case
 * thiếu dữ liệu ⇒ field số giữ nguyên kiểu JSON **number** (site validate
 * 货物毛重/货物体积/包装件数 bằng regex số, KHÔNG nhận chuỗi rỗng).
 */
describe('số không parse được', () => {
  it('NaN (KHÔNG phải 0) khi API trả giá trị không phải số', () => {
    const payload = buildCargoPayload({ name: 'x', weight: '22,400' }, 'BILL-123')
    expect(Number.isNaN(payload.gweight_ton)).toBe(true)
  })

  it('NaN cho cả số nguyên (包装件数) khi API trả giá trị không phải số', () => {
    const payload = buildCargoPayload({ name: 'x', amount: 'abc' }, 'BILL-123')
    expect(Number.isNaN(payload.piece_num)).toBe(true)
  })

  it('giá trị THẬT 0 từ API thì VẪN là 0 (không phải "không có dữ liệu")', () => {
    const payload = buildCargoPayload({ name: 'x', weight: 0 }, 'BILL-123')
    expect(payload.gweight_ton).toBe(0)
  })

  it('thiếu dữ liệu ⇒ 0 (không phải NaN)', () => {
    const payload = buildCargoPayload({ name: 'x' }, 'BILL-123')
    expect(payload.gweight_ton).toBe(0)
  })

  it('toWireValue đổi NaN thành 0 (giữ nguyên kiểu số của field số)', () => {
    expect(toWireValue({ gweight_ton: Number.NaN })).toEqual({ gweight_ton: 0 })
  })

  it('toWireValue đi đệ quy (object lồng nhau, mảng)', () => {
    const wire = toWireValue({
      rows: [{ gweight_ton: Number.NaN }],
      nested: { deep: { gvol_num: Number.NaN } },
    })
    expect(wire).toEqual({
      rows: [{ gweight_ton: 0 }],
      nested: { deep: { gvol_num: 0 } },
    })
  })

  it('toWireValue giữ nguyên số hợp lệ và chuỗi', () => {
    expect(toWireValue({ piece_num: 114, mark_str: 'N/M' })).toEqual({
      piece_num: 114,
      mark_str: 'N/M',
    })
  })

  it('toWireValue KHÔNG mutate input', () => {
    const input = { gweight_ton: Number.NaN }
    toWireValue(input)
    expect(Number.isNaN(input.gweight_ton)).toBe(true)
  })
})

/**
 * `null` / `undefined` trong payload.
 *
 * Site TỪ CHỐI giá trị null ⇒ hai giá trị này phải đi ra là CHUỖI RỐNG. Key
 * cũng phải CÒN trong body: `JSON.stringify` BỎ HẲN key có giá trị
 * `undefined` ⇒ để nguyên thì site sẽ thiếu key đó.
 */
describe('toWireValue — null / undefined', () => {
  it('null ⇒ CHUỖI RỐNG (giữ key, tránh null)', () => {
    expect(toWireValue({ mark_str: null })).toEqual({ mark_str: '' })
    expect(JSON.stringify(toWireValue({ mark_str: null }))).toBe('{"mark_str":""}')
  })

  it('undefined ⇒ CHUỖI RỐNG (giữ key, tránh null)', () => {
    expect(toWireValue({ mark_str: undefined })).toEqual({ mark_str: '' })
    expect(JSON.stringify(toWireValue({ mark_str: undefined }))).toBe('{"mark_str":""}')
  })
})

/**
 * Tên cảng trong body header.
 *
 * Body lấy tên cảng tiếng Anh (`PortData.nameEn`) của API. KHÔNG còn đường
 * dự phòng từ dict `getPort()` của site — dict đó giờ chỉ dùng để tra MÃ
 * cảng, và việc tra đó diễn ra SAU khi đã có tên (xem `runManifest`).
 */
describe('buildManifestBody — tên cảng', () => {
  it('start_port_nam lấy tên Anh (`nameEn`) từ API', () => {
    const body = buildManifestBody(manifest)
    expect(body.start_port_nam).toBe('SHANGHAI')
  })

  it('start_port_nam để trống khi API không có tên cảng', () => {
    const data: ManifestApiData = { ...manifest, loadCode: 'IDSUB', loadPortData: null }
    const body = buildManifestBody(data)
    expect(body.start_port_cod).toBe('IDSUB')
    expect(body.start_port_nam).toBe('')
  })

  it('dischrg_port_nam lấy tên Anh (`nameEn`) từ API', () => {
    const body = buildManifestBody(manifest)
    expect(body.dischrg_port_nam).toBe('BELAWAN')
  })

  it('dischrg_port_nam để trống khi API không có tên cảng', () => {
    const data: ManifestApiData = { ...manifest, aimPortCode: 'IDSUB', aimPortData: null }
    const body = buildManifestBody(data)
    expect(body.dischrg_port_cod).toBe('IDSUB')
    expect(body.dischrg_port_nam).toBe('')
  })

  it('dest_port_nam lấy tên Anh (`nameEn`) từ API', () => {
    const body = buildManifestBody(manifest)
    expect(body.dest_port_nam).toBe('BELAWAN')
  })

  it('dest_port_nam để trống khi API không có tên cảng', () => {
    const data: ManifestApiData = { ...manifest, uploadPortData: null }
    const body = buildManifestBody(data)
    expect(body.dest_port_cod).toBe('IDBLW')
    expect(body.dest_port_nam).toBe('')
  })

  it('dest_port_nam vẫn được điền khi 交货地 trùng cảng 卸货港', () => {
    const data: ManifestApiData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: 'IDBLW',
      aimPortData: { name: '勿拉湾', nameEn: 'BELAWAN' },
    }
    const body = buildManifestBody(data)
    expect(body.dest_port_cod).toBe('IDBLW')
    expect(body.dest_port_nam).toBe('BELAWAN')
  })

  it('dest_port_nam để trống khi API không có mã cảng', () => {
    const data: ManifestApiData = {
      ...manifest,
      uploadCode: '',
      uploadPortData: null,
    }
    const body = buildManifestBody(data)
    expect(body.dest_port_cod).toBe('')
    expect(body.dest_port_nam).toBe('')
  })

  it('dùng `nameEn` cho tên cảng', () => {
    const data: ManifestApiData = {
      ...manifest,
      loadPortData: { name: '上海', nameEn: 'SHANGHAI' },
      uploadPortData: { name: '勿拉湾', nameEn: 'BELAWAN' },
    }
    const body = buildManifestBody(data)
    expect(body.start_port_nam).toBe('SHANGHAI')
    expect(body.dischrg_port_nam).toBe('BELAWAN')
  })
})

describe('buildCargoPayload', () => {
  const goods = manifest.cdgoods?.[0] as ManifestCargo
  const payload = buildCargoPayload(goods, 'BILL-123')

  it('có đúng 25 key', () => {
    expect(Object.keys(payload).sort()).toEqual([...CARGO_KEYS].sort())
  })

  it('số là number, không phải chuỗi', () => {
    expect(payload.piece_num).toBe(114)
    expect(typeof payload.piece_num).toBe('number')
    expect(payload.gweight_ton).toBe(22400)
    expect(typeof payload.gweight_ton).toBe('number')
    expect(payload.gvol_num).toBe(60.13)
    expect(payload.nweight_ton).toBe(0)
  })

  it('mã loại hàng của site: S (普货)', () => {
    expect(payload.cargo_kind_cod).toBe('S')
  })

  it('trim + uppercase tên hàng', () => {
    expect(payload.e_cargo_nam).toBe('SILENT DIESEL GENERATOR')
  })

  it('lấy 唛头 từ `shantou`', () => {
    expect(payload.mark_str).toBe('N/M')
  })

  it('để trống field mà API không có dữ liệu', () => {
    expect(payload.cargo_hs_cod).toBe('')
    expect(payload.package_cod).toBe('')
    expect(payload.package_str).toBe('')
  })

  it('xoá field `dang_*` + `danger_*` khi loại hàng là S', () => {
    expect(payload.dang_class_nam).toBe('')
    expect(payload.dang_un_no).toBe('')
    expect(payload.dang_lable_str).toBe('')
    expect(payload.dang_flash_point).toBe('')
    expect(payload.dang_page_no).toBe('')
    expect(payload.dang_ems_no).toBe('')
    expect(payload.dang_mfag_no).toBe('')
    expect(payload.dang_contactstr).toBe('')
    expect(payload.danger_contact_nam).toBe('')
    expect(payload.danger_te_str).toBe('')
    expect(payload.danger_em_str).toBe('')
    expect(payload.danger_fx_str).toBe('')
  })

  it('xoá field nhiệt độ khi loại hàng là S', () => {
    expect(payload.temp_id).toBe('')
    expect(payload.set_temp_num).toBe('')
  })

  it('ghi `bill_no` theo tham số truyền vào, KHÔNG uppercase', () => {
    expect(payload.bill_no).toBe('BILL-123')
    // Mã bill do server gán (`e.bill_no = P.BILL_NO`) — site không uppercase
    // giá trị này ⇒ giữ nguyên y nguyên.
    expect(buildCargoPayload(goods, 'bill-123').bill_no).toBe('bill-123')
  })

  it('fallback 唛头 = "N/M" khi không có `shantou` lẫn `sign`', () => {
    const noMark = buildCargoPayload({ name: 'x' }, 'BILL-123')
    expect(noMark.mark_str).toBe('N/M')
  })
})

describe('buildCargoPayload — loại hàng nguy hiểm', () => {
  const dangerous: ManifestCargo = {
    name: '\nPaint',
    amount: '10.000',
    weight: '500.000',
    volume: '1.500',
    grossWeight: '450.000',
    hscode: '3208',
    dangerClass: '3',
    unNub: 'UN1263',
    dangerCode: '3',
    dangerPoint: '20',
    shantou: 'N/M',
    exigencyName: 'John Doe',
    exigencyPhone: '021-123456',
    exigencyEmail: 'john@example.com',
    exigencyFax: '021-654321',
  }

  it('loại D giữ field `dang_*` + `danger_*`', () => {
    const payload = buildCargoPayload(dangerous, 'BILL-123')
    expect(payload.cargo_kind_cod).toBe('D')
    expect(payload.dang_class_nam).toBe('3')
    expect(payload.dang_un_no).toBe('UN1263')
    expect(payload.dang_lable_str).toBe('3')
    expect(payload.dang_flash_point).toBe('20')
    expect(payload.danger_contact_nam).toBe('JOHN DOE')
    expect(payload.danger_te_str).toBe('021-123456')
    expect(payload.danger_em_str).toBe('JOHN@EXAMPLE.COM')
    expect(payload.danger_fx_str).toBe('021-654321')
    expect(payload.e_cargo_nam).toBe('PAINT')
  })

  it('loại D xoá field nhiệt độ', () => {
    const payload = buildCargoPayload(dangerous, 'BILL-123')
    expect(payload.temp_id).toBe('')
    expect(payload.set_temp_num).toBe('')
  })
})

describe('buildCargoPayload — loại hàng kiểm dịch / nguy hiểm + kiểm dịch', () => {
  const cold: ManifestCargo = {
    name: 'Frozen beef',
    amount: '20',
    weight: '100',
    volume: '2',
    quarantineName: 'meat',
    quarantineCode: 'C01',
  }

  it('loại R xoá field `dang_*` + `danger_*`', () => {
    const payload = buildCargoPayload(cold, 'BILL-123')
    expect(payload.cargo_kind_cod).toBe('R')
    expect(payload.dang_class_nam).toBe('')
    expect(payload.dang_un_no).toBe('')
    expect(payload.danger_contact_nam).toBe('')
    // Key bị xoá vẫn PHẢI có trong body.
    expect(Object.keys(payload).sort()).toEqual([...CARGO_KEYS].sort())
  })

  it('loại G giữ cả field `danger_*` và `temp_*`', () => {
    const payload = buildCargoPayload(
      {
        name: 'Paint',
        dangerClass: '3',
        quarantineName: 'meat',
        exigencyName: 'John Doe',
      },
      'BILL-123',
    )
    expect(payload.cargo_kind_cod).toBe('G')
    expect(payload.danger_contact_nam).toBe('JOHN DOE')
    expect(payload.dang_class_nam).toBe('3')
    expect(Object.keys(payload).sort()).toEqual([...CARGO_KEYS].sort())
  })
})

describe('buildContainerPayload', () => {
  const container = manifest.cdCon?.[0] as ManifestContainer
  const payload = buildContainerPayload(container, 'BILL-123')

  it('có đúng 10 key', () => {
    expect(Object.keys(payload).sort()).toEqual([...CONTAINER_KEYS].sort())
  })

  it('điền 箱号 / 铅封号 / 货主箱标志', () => {
    expect(payload.cntr_no).toBe('ONEU1437898')
    expect(payload.seal_no).toBe('CN28731BH')
    // `self: false` ⇒ 非货主箱 ⇒ mã "N".
    expect(payload.soc_id).toBe('N')
  })

  it('số là number', () => {
    expect(payload.piece_num).toBe(114)
    expect(typeof payload.piece_num).toBe('number')
    expect(payload.weigh_ton).toBe(22400)
    expect(payload.volume_num).toBe(60.13)
  })

  it('để trống field mà API không có dữ liệu', () => {
    expect(payload.cntr_ef_id).toBe('')
  })

  it('ghi `bill_no` theo tham số truyền vào, KHÔNG uppercase', () => {
    expect(payload.bill_no).toBe('BILL-123')
    expect(buildContainerPayload(container, 'bill-123').bill_no).toBe('bill-123')
  })

  it('mã 货主箱标志: true = "Y", false = "N", không rõ = ""', () => {
    expect(buildContainerPayload({ self: true }, 'B').soc_id).toBe('Y')
    expect(buildContainerPayload({ self: false }, 'B').soc_id).toBe('N')
    expect(buildContainerPayload({ self: null }, 'B').soc_id).toBe('')
    expect(buildContainerPayload({}, 'B').soc_id).toBe('')
  })

  it('dùng `containerTypeMap` cho 尺寸 / 箱型 (KHÔNG tra dict)', () => {
    // Fixture: `cType` = 2 ⇒ `40HQ` ⇒ 尺寸 "40", 箱型 "HQ".
    const payloadFromMap = buildContainerPayload(container, 'BILL-123')
    expect(payloadFromMap.cntr_size_cod).toBe('40')
    expect(payloadFromMap.cntr_type_cod).toBe('HQ')
  })
})

describe('lowerKeys', () => {
  it('chuyển key lồng nhau sang chữ thường', () => {
    const input = { Foo: { BAR: { Baz: 1 } }, QUX: 'x' }
    expect(lowerKeys(input)).toEqual({ foo: { bar: { baz: 1 } }, qux: 'x' })
  })

  it('áp dụng cho từng phần tử của mảng', () => {
    const input = { Items: [{ Id: 1 }, { Id: 2 }] }
    expect(lowerKeys(input)).toEqual({ items: [{ id: 1 }, { id: 2 }] })
  })

  it('giữ nguyên giá trị nguyên thủy', () => {
    expect(lowerKeys(5)).toBe(5)
    expect(lowerKeys('ABC')).toBe('ABC')
    expect(lowerKeys(null)).toBe(null)
  })

  it('KHÔNG mutate object gốc', () => {
    const input = { Foo: { Bar: 1 } }
    lowerKeys(input)
    expect(Object.keys(input)).toEqual(['Foo'])
    expect(input.Foo.Bar).toBe(1)
  })

  it('giữ nguyên body (key đã chữ thường sẵn)', () => {
    const body = buildManifestBody(manifest)
    expect(lowerKeys(body)).toEqual(body)
  })
})
