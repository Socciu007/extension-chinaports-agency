import { describe, it, expect } from 'vitest'
import {
  buildCargoPayload,
  buildContainerPayload,
  buildHeaderPayload,
  lowerKeys,
} from '../src/core/payload'
import type { MappingContext } from '../src/core/field-meta'
import type { ManifestCargo, ManifestContainer, ManifestData } from '../src/core/types'
import fixture from './fixtures/manifest-ONEYSHAGT1569600.json'

/** Dữ liệu mẫu (phần `data` của envelope của API). */
const manifest = fixture.data as ManifestData

/**
 * Tên cảng mà dict `getPort()` của site trả về.
 *
 * Site CHỈ có tên cảng tiếng Trung (`E_PORT_NAM`) — widget autocomplete chỉ
 * gợi ý tên Trung ⇒ dict không bao giờ trả tên tiếng Anh.
 */
const PORT_NAMES: Record<string, string> = {
  CNSHA: '上海',
  IDBLW: '勿拉湾',
  IDSUB: '泗水',
}

/** `ctx` giả lập — dict của site trong test này chỉ có tên cảng. */
const ctx: MappingContext = {
  findTrustCode: (supplyId) => (supplyId === 2 ? 'ONE' : undefined),
  findDrType: (code) => (code === '1' ? 'CY/CY' : undefined),
  findPort: (code) => PORT_NAMES[code ?? ''],
  findCntrType: () => undefined,
  findCntrSize: () => undefined,
}

/** 44 key của body header — đúng theo mẫu thật của site. */
const HEADER_KEYS = [
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
  'notify_aeo',
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

describe('buildHeaderPayload', () => {
  const payload = buildHeaderPayload(manifest, ctx)

  it('có đúng 44 key của mẫu thật', () => {
    expect(Object.keys(payload).sort()).toEqual([...HEADER_KEYS].sort())
    expect(Object.keys(payload)).toHaveLength(44)
  })

  it('mọi giá trị là chuỗi (thiếu dữ liệu ⇒ "" chứ không null/undefined)', () => {
    for (const value of Object.values(payload)) {
      expect(typeof value).toBe('string')
    }
  })

  it('điền thông tin chuyến tàu', () => {
    expect(payload.bill_no).toBe('')
    expect(payload.bill_nbr).toBe('ONEYSHAGT1569600')
    expect(payload.e_ship_nam).toBe('CALLAO BRIDGE')
    expect(payload.out_voyage_no).toBe('0294S')
  })

  it('điền 承运人代码 / 付款方式 / 交货条款', () => {
    expect(payload.trust_cod).toBe('ONE')
    // `payType: false` ⇒ 到付 ⇒ site lưu MÃ "C" (KHÔNG phải nhãn 到付).
    expect(payload.pay_way_id).toBe('C')
    expect(payload.dr_type_str).toBe('CY/CY')
  })

  it('điền cảng theo mã + tên cảng', () => {
    expect(payload.start_port_cod).toBe('CNSHA')
    // Tên cảng lấy từ `loadPortData.name` của API — tên TIẾNG TRUNG, vì site
    // lưu tên Trung (`PortData.nameEn` là tên Anh).
    expect(payload.start_port_nam).toBe('上海')
    expect(payload.dischrg_port_cod).toBe('IDBLW')
    expect(payload.dischrg_port_nam).toBe('勿拉湾')
  })

  it('KHÔNG điền 交货地 khi aimPortCode trùng cảng 卸货港', () => {
    // Fixture: `aimPortCode === uploadCode === 'IDBLW'` ⇒ API chỉ copy cảng
    // 卸货港 sang 交货地 ⇒ để trống CẢ HAI, đúng như mẫu thật của site.
    expect(payload.dest_port_cod).toBe('')
    expect(payload.dest_port_nam).toBe('')
  })

  it('điền 交货地 khi aimPortCode KHÁC cảng 卸货港', () => {
    const data: ManifestData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: 'IDSUB',
      aimPortData: { name: '泗水', nameEn: 'SURABAYA' },
    }
    const withDest = buildHeaderPayload(data, ctx)
    expect(withDest.dest_port_cod).toBe('IDSUB')
    // Tên lấy từ API trước, dict `getPort()` sau — cùng thứ tự với DOM path.
    expect(withDest.dest_port_nam).toBe('泗水')
  })

  it('fallback sang dict `getPort()` khi API không có tên cảng', () => {
    const data: ManifestData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: 'IDSUB',
      aimPortData: null,
    }
    const withDest = buildHeaderPayload(data, ctx)
    expect(withDest.dest_port_cod).toBe('IDSUB')
    expect(withDest.dest_port_nam).toBe(PORT_NAMES.IDSUB)
  })

  it('KHÔNG dùng `aimPortData.nameEn` khi không có tên Trung', () => {
    const data: ManifestData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: 'IDXYZ',
      aimPortData: { nameEn: 'UNKNOWN PORT' },
    }
    const withDest = buildHeaderPayload(data, ctx)
    expect(withDest.dest_port_cod).toBe('IDXYZ')
    // Không có tên Trung ở API lẫn dict ⇒ để trống (KHÔNG điền tên Anh).
    expect(withDest.dest_port_nam).toBe('')
  })

  it('lấy 3 bên theo vai trò (0 = 发货人, 1 = 收货人, 2 = 通知人)', () => {
    expect(payload.e_shipper_nam).toBe('SHANGHAI JUNYI TRADE & DEVELOPMENT CO.,LTD.')
    expect(payload.shipper_country_cod).toBe('CN')
    expect(payload.shipper_te_str).toBe('02152160262')
    expect(payload.e_consignee_nam).toBe('PT KARYA BINA NUSANTARA')
    expect(payload.consignee_country_cod).toBe('ID')
    expect(payload.consignee_te_str).toBe('021-5452772')
    expect(payload.e_notify_nam).toBe('PT KARYA BINA NUSANTARA')
    expect(payload.notify_country_cod).toBe('ID')
    expect(payload.notify_te_str).toBe('021-5452772')
  })

  it('KHÔNG điền AEO (firmCode là mã đăng ký doanh nghiệp, không phải mã AEO)', () => {
    expect(payload.shipper_aeo).toBe('')
    expect(payload.consignee_aeo).toBe('')
    expect(payload.notify_aeo).toBe('')
  })

  it('KHÔNG điền email/fax (API không có)', () => {
    expect(payload.shipper_em_str).toBe('')
    expect(payload.shipper_fx_str).toBe('')
    expect(payload.consignee_em_str).toBe('')
    expect(payload.notify_em_str).toBe('')
  })

  it('để trống field mà API không có dữ liệu', () => {
    expect(payload.sign_place_cod).toBe('')
    expect(payload.sign_place_str).toBe('')
    expect(payload.trans_port_cod).toBe('')
    expect(payload.trans_port_nam).toBe('')
    expect(payload.total_piece_num).toBe('')
    expect(payload.total_gweight_ton).toBe('')
    expect(payload.total_gvol_num).toBe('')
    expect(payload.mandatory_check).toBe('')
    expect(payload.soft_check).toBe('')
  })

  it('tạo bill (is_all = "0", KHÔNG phải "2" = 发送)', () => {
    expect(payload.is_all).toBe('0')
  })

  it('rỗng hết khi không có dữ liệu nào', () => {
    const empty = buildHeaderPayload({}, ctx)
    for (const key of HEADER_KEYS) {
      if (key === 'is_all') {
        expect(empty[key]).toBe('0')
        continue
      }
      expect(empty[key]).toBe('')
    }
  })
})

/**
 * Tên cảng trong body header.
 *
 * Site lưu TÊN TIẾNG TRUNG: dict `getPort()` của site chỉ có tên Trung
 * (`E_PORT_NAM`) và widget autocomplete chỉ gợi ý tên Trung ⇒ `PortData.name`
 * (Trung) là nguồn đúng, `PortData.nameEn` (Anh) KHÔNG được dùng.
 */
describe('buildHeaderPayload — tên cảng', () => {
  /** Dict `getPort()` không tra được cảng nào. */
  const noDict: MappingContext = {
    ...ctx,
    findPort: () => undefined,
  }

  /** Dict trả tên KHÁC tên của API cho cùng một mã cảng (biến thể có hậu tố). */
  const CONFLICT_NAMES: Record<string, string> = {
    CNSHA: '上海港',
    IDBLW: '勿拉湾港',
    IDSUB: '泗水港',
  }

  const conflictingDict: MappingContext = {
    ...ctx,
    findPort: (code) => CONFLICT_NAMES[code ?? ''] ?? PORT_NAMES[code ?? ''],
  }

  it('start_port_nam lấy tên Trung từ API khi dict không tra được', () => {
    const payload = buildHeaderPayload(manifest, noDict)
    expect(payload.start_port_nam).toBe('上海')
  })

  it('start_port_nam lấy từ dict `getPort()` khi API không có tên cảng', () => {
    const data: ManifestData = { ...manifest, loadCode: 'IDSUB', loadPortData: null }
    const payload = buildHeaderPayload(data, ctx)
    expect(payload.start_port_nam).toBe('泗水')
  })

  it('start_port_nam lấy từ API trước, dict `getPort()` sau', () => {
    // Dict trả '上海港' cho mã CNSHA ⇒ phải lấy tên của API ('上海').
    const payload = buildHeaderPayload(manifest, conflictingDict)
    expect(payload.start_port_nam).toBe('上海')
  })

  it('start_port_nam để trống khi API lẫn dict đều không có tên', () => {
    const data: ManifestData = { ...manifest, loadCode: 'IDXYZ', loadPortData: null }
    const payload = buildHeaderPayload(data, ctx)
    expect(payload.start_port_nam).toBe('')
  })

  it('dischrg_port_nam lấy tên Trung từ API khi dict không tra được', () => {
    const payload = buildHeaderPayload(manifest, noDict)
    expect(payload.dischrg_port_nam).toBe('勿拉湾')
  })

  it('dischrg_port_nam lấy từ dict `getPort()` khi API không có tên cảng', () => {
    const data: ManifestData = { ...manifest, uploadCode: 'IDSUB', uploadPortData: null }
    const payload = buildHeaderPayload(data, ctx)
    expect(payload.dischrg_port_nam).toBe('泗水')
  })

  it('dischrg_port_nam lấy từ API trước, dict `getPort()` sau', () => {
    // Dict trả '勿拉湾港' cho mã IDBLW ⇒ phải lấy tên của API ('勿拉湾').
    const payload = buildHeaderPayload(manifest, conflictingDict)
    expect(payload.dischrg_port_nam).toBe('勿拉湾')
  })

  it('dischrg_port_nam để trống khi API lẫn dict đều không có tên', () => {
    const data: ManifestData = { ...manifest, uploadCode: 'IDXYZ', uploadPortData: null }
    const payload = buildHeaderPayload(data, ctx)
    expect(payload.dischrg_port_nam).toBe('')
  })

  it('dest_port_nam lấy tên Trung từ API khi dict không tra được', () => {
    const data: ManifestData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: 'IDSUB',
      aimPortData: { name: '泗水', nameEn: 'SURABAYA' },
    }
    const payload = buildHeaderPayload(data, noDict)
    expect(payload.dest_port_nam).toBe('泗水')
  })

  it('dest_port_nam lấy từ dict `getPort()` khi API không có tên cảng', () => {
    const data: ManifestData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: 'IDSUB',
      aimPortData: null,
    }
    const payload = buildHeaderPayload(data, ctx)
    expect(payload.dest_port_nam).toBe('泗水')
  })

  it('dest_port_nam lấy từ API trước, dict `getPort()` sau', () => {
    // Dict trả '泗水港' cho mã IDSUB ⇒ phải lấy tên của API ('泗水').
    const data: ManifestData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: 'IDSUB',
      aimPortData: { name: '泗水', nameEn: 'SURABAYA' },
    }
    const payload = buildHeaderPayload(data, conflictingDict)
    expect(payload.dest_port_nam).toBe('泗水')
  })

  it('dest_port_nam để trống khi API lẫn dict đều không có tên', () => {
    const data: ManifestData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: 'IDXYZ',
      aimPortData: null,
    }
    const payload = buildHeaderPayload(data, ctx)
    expect(payload.dest_port_nam).toBe('')
  })

  it('dest_port_nam để trống khi 交货地 trùng cảng 卸货港', () => {
    // Quy tắc có sẵn trong `buildHeaderPayload`: 交货地 khác 卸货港 mới điền.
    const data: ManifestData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: 'IDBLW',
      aimPortData: { name: '勿拉湾' },
    }
    const payload = buildHeaderPayload(data, ctx)
    expect(payload.dest_port_cod).toBe('')
    expect(payload.dest_port_nam).toBe('')
  })

  it('dest_port_nam để trống khi không có mã 交货地', () => {
    const data: ManifestData = {
      ...manifest,
      uploadCode: 'IDBLW',
      aimPortCode: '',
      aimPortData: { name: '泗水' },
    }
    const payload = buildHeaderPayload(data, ctx)
    expect(payload.dest_port_cod).toBe('')
    expect(payload.dest_port_nam).toBe('')
  })

  it('KHÔNG dùng `nameEn` cho tên cảng', () => {
    const data: ManifestData = {
      ...manifest,
      loadPortData: { name: '上海', nameEn: 'SHANGHAI' },
      uploadPortData: { name: '勿拉湾', nameEn: 'BELAWAN' },
    }
    // Dict không tra được gì ⇒ tên chỉ có thể đến từ API ⇒ KHÔNG phải `nameEn`.
    const payload = buildHeaderPayload(data, noDict)
    expect(payload.start_port_nam).toBe('上海')
    expect(payload.start_port_nam).not.toBe('SHANGHAI')
    expect(payload.dischrg_port_nam).toBe('勿拉湾')
    expect(payload.dischrg_port_nam).not.toBe('BELAWAN')
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
  const payload = buildContainerPayload(container, ctx, 'BILL-123')

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
    // Dict của site chỉ chứa chuỗi "20"/"GP" còn `vC`/`cType` là mã số ⇒
    // KHÔNG đoán.
    expect(payload.cntr_size_cod).toBe('')
    expect(payload.cntr_type_cod).toBe('')
  })

  it('ghi `bill_no` theo tham số truyền vào, KHÔNG uppercase', () => {
    expect(payload.bill_no).toBe('BILL-123')
    expect(buildContainerPayload(container, ctx, 'bill-123').bill_no).toBe('bill-123')
  })

  it('mã 货主箱标志: true = "Y", false = "N", không rõ = ""', () => {
    expect(buildContainerPayload({ self: true }, ctx, 'B').soc_id).toBe('Y')
    expect(buildContainerPayload({ self: false }, ctx, 'B').soc_id).toBe('N')
    expect(buildContainerPayload({ self: null }, ctx, 'B').soc_id).toBe('')
    expect(buildContainerPayload({}, ctx, 'B').soc_id).toBe('')
  })

  it('dùng dict của site cho 尺寸 / 箱型 khi tra được', () => {
    const withDict: MappingContext = {
      ...ctx,
      findCntrSize: () => '20',
      findCntrType: () => 'GP',
    }
    const payloadWithDict = buildContainerPayload(container, withDict, 'BILL-123')
    expect(payloadWithDict.cntr_size_cod).toBe('20')
    expect(payloadWithDict.cntr_type_cod).toBe('GP')
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

  it('giữ nguyên body header (key đã chữ thường sẵn)', () => {
    const payload = buildHeaderPayload(manifest, ctx)
    expect(lowerKeys(payload)).toEqual(payload)
  })
})
