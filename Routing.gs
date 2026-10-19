/**
 * Routing.gs
 * จัดการเรื่องเส้นทางและการเรนเดอร์หน้าจอ HTML Web App
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ระบบค้นหาใบหน้า - Academic Personnel Database')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
