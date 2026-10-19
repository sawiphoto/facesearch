const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_PATH || 'C:/Users/hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

function backendTests() {
  const values = new Map();
  let reads = 0, fetches = 0, uuid = 0;
  let disk = { categories: [{ name: 'กลุ่มทดสอบ', folderId: 'folder', people: Array.from({ length: 130 }, (_, i) => ({ name: 'ครู ' + i, avatarFileId: 'avatar' + i, photoCount: i, photoHash: 'hash' + i, avatarBase64: 'A'.repeat(50000), photos: ['photo'] })) }], updatedAt: '2026-10-02T00:00:00Z' };
  const cache = { get: key => values.get(key) ?? null, put(key, value) { assert(Buffer.byteLength(value) < 100000); values.set(key, value); }, remove: key => values.delete(key) };
  const file = { getId: () => 'cache-file', setContent: text => { disk = JSON.parse(text); }, getBlob() { reads++; return { getDataAsString: () => JSON.stringify(disk) }; } };
  const blob = text => ({ getBytes: () => [...Buffer.from(text)] });
  const ctx = { console, CacheService: { getScriptCache: () => cache }, Utilities: { getUuid: () => String(++uuid), newBlob: blob, base64Encode: bytes => Buffer.from(bytes).toString('base64') }, DriveApp: { getFileById: () => file }, ScriptApp: { getProjectTriggers() { throw Error('Startup touched triggers'); }, getOAuthToken: () => 'test-token' }, UrlFetchApp: { fetchAll(requests) { fetches++; return requests.map(() => ({ getResponseCode: () => 200, getBlob: () => ({ getContentType: () => 'image/png', getBytes: () => [1, 2, 3] }) })); } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('DatabaseService.gs', 'utf8'), ctx);
  ctx.getProjectFolder = () => ({});
  ctx.getFileIdByName = () => 'cache-file';
  ctx.syncDataFromDrive = () => { throw Error('Startup attempted sync'); };
  const cold = ctx.getAppData();
  assert(!cold.error); assert(!JSON.stringify(cold).includes('avatarBase64')); assert(!JSON.stringify(cold).includes('photos'));
  assert(Buffer.byteLength(JSON.stringify(cold)) < 30000); assert.equal(reads, 1);
  assert(ctx.getAppData().logs[0].includes('source=memory')); assert.equal(reads, 1);
  const meta = JSON.parse(values.get('directory_v92_manifest'));
  values.delete('directory_v92_' + meta.generation + '_0');
  assert(!ctx.getAppData().error); assert.equal(reads, 2);
  const next = { categories: [{ name: 'ใหม่', people: [{ name: 'ครูใหม่', avatarFileId: 'new-avatar', photoCount: 10 }] }], updatedAt: '2026-10-02T01:00:00Z' };
  ctx.saveCacheFile({}, next);
  assert.equal(ctx.getAppData().categories[0].name, 'ใหม่');
  ctx.cacheAppDirectory_(cold); assert.equal(ctx.getAppData().categories[0].name, 'ใหม่');
  assert(ctx.getPersonAvatars(['new-avatar', 'unauthorized']).hasOwnProperty('new-avatar')); assert.equal(fetches, 1);
  assert.equal(Object.keys(ctx.getPersonAvatars(['unauthorized'])).length, 0); assert.equal(fetches, 1);
  ctx.getPersonAvatars(['new-avatar']); assert.equal(fetches, 1);
  assert.throws(() => ctx.getPersonAvatars(Array(9).fill('new-avatar')));
  values.clear(); ctx.getFileIdByName = () => null;
  assert.equal(ctx.getAppData().code, 'CACHE_MISSING');
  ctx.cacheAppDirectory_({ categories: [{ name: 'หลายส่วน', people: Array.from({ length: 1200 }, (_, i) => ({ name: 'ครูทดสอบภาษาไทย'.repeat(5) + i, avatarFileId: 'a' + i })) }], updatedAt: '2026-10-02T02:00:00Z' });
  assert(JSON.parse(values.get('directory_v92_manifest')).count > 1);
  assert.equal(ctx.readCachedAppDirectory_().categories[0].people.length, 1200);
  console.log('PASS backend cold/warm/chunk eviction/multi-chunk/missing cache/sync invalidation/older-writer guard/avatar whitelist and cache');
}

async function frontendTests() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const html = fs.readFileSync('Index.html', 'utf8');
    const data = { categories: [{ name: 'ทดสอบ', folderId: 'folder', people: Array.from({ length: 130 }, (_, i) => ({ name: 'ครู ' + i, avatarFileId: 'avatar' + i, photoCount: 0 })) }], updatedAt: '2026-10-02T00:00:00Z' };
    async function newPage(blockStorage, cached) {
      const page = await browser.newPage({ viewport: { width: 393, height: 736 } });
      await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1/') ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
      await page.addInitScript(({ blockStorage, cached }) => {
        window.testRpc = []; window.testAvatars = [];
        if (cached) localStorage.setItem('face-directory-v92', JSON.stringify({ savedAt: Date.now(), data: cached }));
        if (blockStorage) ['localStorage', 'sessionStorage'].forEach(name => Object.defineProperty(window, name, { get() { throw Error('SecurityError: storage blocked'); } }));
        const originalTimer = window.setTimeout;
        window.setTimeout = function(fn, ms, ...args) { if (ms === 30000) window.testTimeout = fn; return originalTimer(fn, ms, ...args); };
        Object.defineProperty(window, 'google', { value: { script: { get run() {
          let success = () => {}, failure = () => {};
          const runner = {
            withSuccessHandler(fn) { success = fn; return runner; },
            withFailureHandler(fn) { failure = fn; return runner; },
            getAppData() { window.testRpc.push({ success, failure }); },
            getPersonAvatars(ids) { window.testAvatars.push(ids); const result = {}; ids.forEach(id => result[id] = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="purple"/></svg>')); success(result); },
            getDeleteRequests() { success({}); },
            logPageLoad() {}, registerSession() { success(1); }, pingSession() { success(1); }, removeSession() {}, logSessionEnd() {}
          };
          return runner;
        } } } });
      }, { blockStorage, cached });
      await page.goto('http://127.0.0.1/test');
      return page;
    }
    // Start with browser storage blocked, then deliver a directory response.
    const page = await newPage(true, null);
    await page.evaluate(() => {
      window.google.script.run; // Ensure API discovery has no storage dependency.
    });
    assert.equal(await page.evaluate(() => testRpc.length), 1);
    await page.evaluate(data => testRpc[0].success(data), data);
    await page.waitForFunction(() => document.querySelectorAll('.avatar-item').length === 130);
    assert.equal(await page.locator('.loading-overlay.active').count(), 0);
    await page.waitForFunction(() => testAvatars.length > 0);
    assert(await page.evaluate(() => testAvatars.flat().length < 20 && testAvatars.every(ids => ids.length <= 8)));
    await page.evaluate(() => {
      requestAppDirectory(); testTimeout();
      if (document.getElementById('directory-retry').style.display === 'none') throw Error('Retry hidden');
      testRpc[1].success({ categories: [] });
      if (appState.categories.length !== 1) throw Error('Late result replaced directory');
      requestAppDirectory(); testRpc[2].success({ categories: [{ name: 'สด', people: [] }] });
      if (appState.categories[0].name !== 'สด') throw Error('Retry did not update');
    });
    await page.close();
    const cachedPage = await newPage(false, data);
    assert.equal(await cachedPage.locator('.avatar-item').count(), 130);
    assert.equal(await cachedPage.locator('.loading-overlay.active').count(), 0);
    await cachedPage.evaluate(() => {
      appState.selectedPerson = { name: 'ครู 0', photos: [{ id: 'p' }] };
      appState.selectedPhotos = ['p'];
      showLoading(true, 'กำลังโหลดรูปภาพ');
      testRpc[0].success({ categories: [{ name: 'อัปเดต', people: [{ name: 'ครู 0', avatarFileId: 'avatar0' }] }] });
      if (appState.selectedPerson.photos[0].id !== 'p' || appState.selectedPhotos[0] !== 'p') throw Error('Background refresh reset selection');
      if (!document.getElementById('loading-overlay').classList.contains('active')) throw Error('Refresh dismissed another operation');
      showLoading(false);
      appState.allRawPhotos = ['single', 'small_group', 'large_group'].flatMap(g => Array.from({ length: 3 }, (_, i) => ({ id: g + i, groupCategory: g, date: '2026-09-01' })));
      document.getElementById('empty-state').style.display = 'none';
      applyPhotoFiltersAndRender(true);
    });
    for (const [width, height] of [[393, 736], [360, 640], [1905, 931], [844, 390]]) {
      await cachedPage.setViewportSize({ width, height });
      const rects = await cachedPage.locator('.photo-card-masonry').evaluateAll(cards => cards.map(card => { const r = card.getBoundingClientRect(); return { h: r.height, bottom: r.bottom }; }));
      assert.equal(rects.length, 6); assert(rects.every(r => r.h > 0 && r.bottom <= height));
      assert(Math.max(...rects.map(r => r.h)) - Math.min(...rects.map(r => r.h)) < 1);
    }
    console.log('PASS frontend blocked storage/startup/visible-avatar batches/timeout/retry/stale callback/browser cache/background selection');
    await cachedPage.close();
  } finally { await browser.close(); }
}

(async () => { backendTests(); await frontendTests(); })().catch(error => { console.error(error); process.exit(1); });
