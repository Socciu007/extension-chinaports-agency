export function buildHeaderForm(): void {
  const items: Array<[string, string, string?]> = [
    ['BILL_NBR', '提单号', 'input'],
    ['E_SHIP_NAM', '船名', 'input'],
    ['OUT_VOYAGE_NO', '航次', 'input'],
    ['TRUST_COD', '承运人代码', 'select'],
    ['PAY_WAY_ID', '付款方式', 'select'],
    ['DR_TYPE_STR', '交货条款', 'select'],
    ['START_PORT_NAM', '收货地（装货港）', 'input'],
    ['START_PORT_COD', '收货地代码', 'input'],
    ['DISCHRG_PORT_NAM', '卸货港', 'input'],
    ['DEST_PORT_NAM', '交货地', 'input'],
    ['E_SHIPPER_NAM', '发货人名称', 'input'],
    ['SHIPPER_ADD_STR', '发货人地址', 'input'],
    ['SHIPPER_COUNTRY_COD', '国家代码', 'input'],
    ['SHIPPER_TE_STR', '电话', 'input'],
    ['E_CONSIGNEE_NAM', '收货人名称', 'input'],
    ['E_NOTIFY_NAM', '通知人名称', 'input'],
  ]

  const html = items
    .map(([prop, label, kind]) => {
      const control =
        kind === 'select'
          ? `<div class="el-select"><div class="el-select__wrapper"><input id="el-id-x-${prop}" readonly /></div></div>`
          : `<input id="el-id-x-${prop}" />`
      return `<div class="el-form-item EntryOfManifestInformation">
        <label class="el-form-item__label" for="el-id-x-${prop}">${label}</label>
        ${control}
      </div>`
    })
    .join('')

  document.body.innerHTML = `
    <button class="el-button">新增舱单信息</button>
    <div class="el-dialog" style="display: block;">
      <div class="el-dialog__body">
        <div class="el-form">${html}</div>
      </div>
      <div class="el-dialog__footer">
        <button class="el-button">取消</button>
        <button class="el-button el-button--primary">确定</button>
      </div>
    </div>
    <div class="el-select-dropdown">
      <div class="el-select-dropdown__item">MAEU</div>
      <div class="el-select-dropdown__item">FOB</div>
      <div class="el-select-dropdown__item">0</div>
      <div class="el-select-dropdown__item">1</div>
      <div class="el-select-dropdown__item">上海</div>
    </div>`
}
