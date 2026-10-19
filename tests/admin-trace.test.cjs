const fs = require('fs'), vm = require('vm'), assert = require('assert');
const { chromium } = require('C:/Users/hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

function backend() {
  const values = new Map();
  let text = '[{"id":"drive-file-1234567890123456"}]';
  const ctx = { console: { log() {}, error() {}, warn() {} },
    CacheService: { getScriptCache: () => ({ get: key => key.startsWith('photo_trace_') ? values.get(key) : 'cached-id', put: (key, val) => values.set(key, val) }) },
    DriveApp: { getFileById: () => ({ getBlob: () => ({ getDataAsString: () => text }) }) }
  };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync('DatabaseService.gs', 'utf8'), ctx);
  ctx.normalizeText = s => s;
  const id = 'trace-1234567890123456';
  const result = ctx.getPersonPhotosWithTrace('ครู', id, true);
  assert(result.ok); assert.equal(result.photos.length, 1);
  assert(result.trace.some(line => line.stage === 'READ_OK'));
  assert(result.trace.some(line => line.stage === 'PARSE_OK'));
  assert.equal(ctx.getPersonPhotoTrace(id).at(-1).stage, 'RETURN');
  text = '{bad';
  const failure = ctx.getPersonPhotosWithTrace('ครู', id, true);
  assert.equal(failure.ok, false); assert(failure.trace.at(-1).detail.includes('failedAt=PARSE_START'));
  assert.throws(() => ctx.getPersonPhotoTrace('bad'), /Invalid trace/);
  console.log('PASS trace packets, checkpoint cache, JSON failure phase and ID validation');
}
async function browser() {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1905, height: 931 } });
    const html = fs.readFileSync('Index.html', 'utf8');
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1/') ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    await page.addInitScript(() => {
      sessionStorage.setItem('admin_mode', 'true');
      const photos = Array.from({ length: 6 }, (_, i) => ({ id: 'photo-12345678901234567890-' + i, date: '2026-10-02', faceCountSource: 'photo_index', faceCount: i % 3 === 0 ? 1 : i % 3 === 1 ? 3 : 8 }));
      window.google = { script: { get run() {
        let success; const runner = { withSuccessHandler(fn) { success = fn; return runner; }, withFailureHandler() { return runner; },
          getAppData() { success({ categories: [{ name: 'ทดสอบ', people: [{ name: 'ครูทดสอบ', photoCount: 6 }] }] }); },
          getDeleteRequests() { success({}); }, registerSession() {}, logPageLoad() {}, pingSession() {}, logSessionEnd() {}, removeSession() {},
          runPhotoJob() { const deliver = () => success({ state: 'READY', result: { ok: true, photos, trace: [{ stage: 'READ_OK', detail: 'อ่านไฟล์สำเร็จ', ms: 5 }, { stage: 'PARSE_OK', detail: 'count=6', ms: 6 }] } }); if (window.holdPhotos) window.deliverPhotos = deliver; else deliver(); },
          getPhotoJobStatus() { window.tracePolls = (window.tracePolls || 0) + 1; success({ state: 'RUNNING' }); }
        }; return runner;
      } } };
    });
    await page.goto('http://127.0.0.1/');
    await page.evaluate(() => selectPerson(appState.categories[0].people[0]));
    assert(await page.locator('#debug-panel').isVisible());
    const logs = await page.locator('#debug-logs').innerText();
    for (const expected of ['server READ_OK', 'server PARSE_OK', 'รับรายการภาพแล้ว', 'จัดหมวดและเรียงวันที่สำเร็จ', 'นับหมวดสำเร็จ', 'กรองรายการสำเร็จ', 'สร้างกรอบ 3 panel', 'ขอ thumbnail']) assert(logs.includes(expected), expected);
    assert.equal(await page.locator('#gallery-3panel-grid .photo-card-masonry').count(), 6);
    assert.equal(await page.evaluate(() => appState.resolvedPhotos.length), 6);
    await page.evaluate(() => {
      window.classifiedPhotos = appState.resolvedPhotos.map(p => Object.assign({}, p));
      resolveAndRenderPhotos(window.classifiedPhotos.concat([{ id: 'unknown-photo', faceCount: 1, date: '2026-10-02' }]));
    });
    assert(await page.locator('#classification-notice').isVisible());
    assert((await page.locator('#classification-notice').innerText()).includes('1 ภาพ'));
    assert.deepEqual(await page.evaluate(() => ['single','small','large'].map(g => document.getElementById('badge-' + g).innerText)), ['2','2','2']);
    assert.equal(await page.locator('#gallery-3panel-grid [data-category="unknown"]').count(), 0);
    await page.setViewportSize({ width: 393, height: 851 });
    assert(await page.locator('#classification-notice').isVisible());
    await page.setViewportSize({ width: 1905, height: 931 });
    await page.evaluate(() => resolveAndRenderPhotos(window.classifiedPhotos));
    assert(!(await page.locator('#classification-notice').isVisible()));
    await page.evaluate(() => {
      window.savedCategories=appState.categories;
      appState.categories=[{name:'อดีตบุคลากร',people:[{name:'เก่าไทย',department:'ภาษาไทย'},{name:'เก่าบริหาร',department:'ผู้บริหาร'}]}];
      appState.activeCategory='อดีตบุคลากร';renderCategoryPills();renderTeacherAvatars();
    });
    assert(await page.locator('#former-department-wrap').isVisible());
    assert.equal(await page.locator('#teacher-avatars-row .avatar-item').count(),2);
    await page.locator('#former-department').selectOption('ภาษาไทย');
    assert.equal(await page.locator('#teacher-avatars-row .avatar-item').count(),1);
    assert((await page.locator('#teacher-avatars-row').innerText()).includes('เก่าไทย'));
    await page.evaluate(() => {appState.activeCategory='ALL';renderCategoryPills();renderTeacherAvatars();});
    assert(!(await page.locator('#former-department-wrap').isVisible()));
    await page.evaluate(() => {appState.categories=window.savedCategories;renderCategoryPills();renderTeacherAvatars();});
    assert.equal(await page.locator('#photo-dialog.active').count(), 0);
    await page.evaluate(() => { window.holdPhotos = true; selectPerson({ name: 'ครูที่กำลังรอ', photoCount: 6 }); });
    await page.waitForFunction(() => window.tracePolls > 0, { timeout: 12000 });
    assert((await page.locator('#debug-logs').innerText()).includes('รองานเดิมต่อ'));
    assert.equal(await page.locator('#photo-dialog.active').count(), 1);
    fs.mkdirSync('temp_teacher_pull/tests', { recursive: true });
    await page.screenshot({ path: 'temp_teacher_pull/tests/v94-wait-desktop.png' });
    await page.evaluate(() => document.getElementById('debug-panel').style.display = 'none');
    await page.setViewportSize({ width: 393, height: 851 });
    await page.screenshot({ path: 'temp_teacher_pull/tests/v94-wait-mobile.png' });
    assert(await page.locator('#photo-cancel').isVisible());
    await page.setViewportSize({ width: 1905, height: 931 });
    await page.evaluate(() => document.getElementById('debug-panel').style.display = '');
    await page.evaluate(() => window.deliverPhotos());
    assert.equal(await page.locator('#photo-dialog.active').count(), 0);
    await page.evaluate(() => { window.previousCards = Array.from(document.querySelectorAll('#gallery-3panel-grid .photo-card-masonry')); });
    await page.evaluate(() => {
      selectPerson({ name: 'ครูที่ยังเชื่อมต่อไม่ได้', photoCount: 6 });
      const timeoutAt = photoTask.started + 20001;
      window.realNow = Date.now; Date.now = () => timeoutAt;
    });
    await page.waitForFunction(() => !photoTask);
    await page.evaluate(() => { Date.now = window.realNow; window.deliverPhotos(); });
    assert(await page.evaluate(() => window.previousCards.every((card, index) => card === document.querySelectorAll('#gallery-3panel-grid .photo-card-masonry')[index])));
    assert.equal(await page.evaluate(() => appState.selectedPerson.name), 'ครูที่กำลังรอ');
    assert(await page.locator('#photo-retry').isVisible());
    assert.equal(await page.locator('#photo-spinner').isVisible(), false);
    await page.evaluate(() => document.getElementById('debug-panel').style.display = 'none');
    await page.screenshot({ path: 'temp_teacher_pull/tests/v94-failure-desktop.png' });
    await page.setViewportSize({ width: 393, height: 851 });
    await page.screenshot({ path: 'temp_teacher_pull/tests/v94-failure-mobile.png' });
    assert(await page.locator('#photo-dismiss').isVisible());
    await page.evaluate(() => { cancelPhotoLoad(); document.getElementById('debug-panel').style.display = ''; });
    await page.evaluate(() => {
      clearDebugLogs(); appendToDebugPanel('<img src=x onerror=alert(1)>', 'error');
      for (let i = 0; i < 700; i++) appendToDebugPanel('test ' + i);
    });
    assert.equal(await page.locator('#debug-logs > div').count(), 600);
    assert.equal(await page.locator('#debug-logs img').count(), 0);
    console.log('PASS visible admin trace, full JSON-to-gallery stages, six slots, downloads, overlay and bounded text-only logs');
  } finally { await browser.close(); }
}
backend(); browser().catch(err => { console.error(err); process.exitCode = 1; });
