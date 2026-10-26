const MANIFEST_URL =
  'https://www.chinaports-agency.com:8870/#/exportBusinessOperations/maintenanceOfManifestData'

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    void chrome.tabs.create({ url: MANIFEST_URL })
  }
})
