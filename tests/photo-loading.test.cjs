const fs = require('fs'), vm = require('vm'), assert = require('assert');
const html = fs.readFileSync('Index.html', 'utf8');
function frontend() {
  let now = 1000, nextTimer = 0, nextId = 0, resumes = 0;
  const timers = new Map(), requests = [], checks = [], logs = [];
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { style: {}, classList: { add() {}, remove() {} }, textContent: '' }); return elements.get(id); };
  const old = { name: 'ครูเดิม', photoCount: 1, photos: [{ id: 'old' }] };
  const ctx = { Date: { now: () => now }, crypto: { randomUUID: () => 'job-1234567890123456-' + (++nextId) },
    document: { getElementById: element }, photoTraceTimes: {}, photoLog: (...args) => logs.push(args),
    readAdminMode: () => true, appState: { selectedPerson: old },
    loadVisibleAvatarBatch: () => resumes++,
    commitPersonGallery(person) { ctx.appState.selectedPerson = person; },
    setInterval(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearInterval: id => timers.delete(id),
    google: { script: { get run() { let success, failure; const r = {
      withSuccessHandler(fn) { success = fn; return r; }, withFailureHandler(fn) { failure = fn; return r; },
      runPhotoJob(name, id) { requests.push({ name, id, success, failure }); },
      getPhotoJobStatus(name, id) { checks.push({ name, id, success, failure }); }
    }; return r; } } }
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('    var photoTask = null;'), html.indexOf('    function resolveAndRenderPhotos(')), ctx);
  const advance = ms => { now += ms; [...timers.values()].forEach(fn => fn()); };
  const result = { ok: true, photos: [{ id: 'new' }], trace: [] };
  const person = { name: 'ครูใหม่', photoCount: 6653 };
  ctx.selectPerson(person); ctx.selectPerson(person);
  assert.equal(requests.length, 1); assert(ctx.backgroundPaused()); assert.equal(ctx.appState.selectedPerson, old);
  assert.equal(element('photo-count-number').textContent, '1');
  advance(9000); assert.equal(element('photo-count-number').textContent, '45');
  advance(1000); assert.equal(checks.length, 1); checks.at(-1).success({ state: 'UNKNOWN' });
  assert.equal(requests.length, 2); assert.equal(element('photo-count-number').textContent, '50');
  advance(9000); assert.equal(element('photo-count-number').textContent, '95');
  advance(999); assert.equal(element('photo-count-number').textContent, '99');
  advance(1); assert(!ctx.backgroundPaused()); assert.equal(ctx.appState.selectedPerson, old);
  assert(element('photo-title').textContent.includes('ยังเปิดคลังภาพ')); assert.equal(element('photo-actions').style.display, 'flex');
  requests[0].success({ state: 'READY', result }); assert.equal(ctx.appState.selectedPerson, old);
  ctx.selectPerson(person); assert.equal(checks.at(-1).id, requests[1].id);
  checks.at(-1).success({ state: 'READY', result }); assert.equal(ctx.appState.selectedPerson, person); assert.equal(requests.length, 2);
  assert.equal(element('photo-count-number').textContent, '100');
  assert.equal(element('photo-progress-fill').style.width, '100%');
  const waiting = { name: 'งานที่ยังอ่าน', photoCount: 3 };
  ctx.selectPerson(waiting); const held = requests.at(-1); advance(10000);
  checks.at(-1).success({ state: 'RUNNING' }); assert.equal(requests.at(-1), held);
  held.success({ state: 'READY', result }); assert.equal(ctx.appState.selectedPerson, waiting);
  const cancelled = { name: 'ยกเลิก', photoCount: 3 }; ctx.selectPerson(cancelled); const late = requests.at(-1);
  ctx.cancelPhotoLoad(); late.success({ state: 'READY', result }); assert.equal(ctx.appState.selectedPerson, waiting);
  assert(resumes >= 4);
  const invalid = { name: 'ข้อมูลเสีย', photoCount: 3 }; ctx.selectPerson(invalid);
  requests.at(-1).success({ state: 'READY', result: { ok: false, error: 'bad JSON' } });
  assert.equal(ctx.appState.selectedPerson, waiting); advance(20000); assert(!ctx.backgroundPaused());
  const slow = { name: 'งานอ่านสามสิบวินาที', photoCount: 10000 };
  ctx.selectPerson(slow); const slowRequest = requests.at(-1);
  advance(10000); checks.at(-1).success({ state: 'RUNNING' });
  advance(10000); assert(!ctx.backgroundPaused());
  const manual = { ...slow }; ctx.selectPerson(manual); checks.at(-1).success({ state: 'RUNNING' });
  advance(9000); slowRequest.success({ state: 'READY', result });
  assert.equal(ctx.appState.selectedPerson, manual, 'explicit retry can accept completion of the original running job');
  console.log('PASS 10+10 seconds, single retry, deduplication, preserved gallery, late result, cancel, RUNNING wait, READY reuse and invalid reply');
}
function backend() {
  const values = new Map(); let version = 'v1', reads = 0, lockAvailable = true, released = 0;
  const cache = { get: key => values.get(key) ?? null, put(key, value, ttl) { assert.equal(ttl, 300); assert(Buffer.byteLength(value) <= 100000); values.set(key, value); }, remove: key => values.delete(key) };
  const ctx = { console, CacheService: { getScriptCache: () => cache }, LockService: { getScriptLock: () => ({ tryLock: () => lockAvailable, releaseLock: () => released++ }) } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync('DatabaseService.gs', 'utf8'), ctx);
  ctx.getAppData = () => ({ categories: [{ people: [{ name: 'ครู', photoHash: version }] }] });
  ctx.getPersonPhotosWithTrace = () => { reads++; return { ok: true, photos: Array.from({ length: 6653 }, (_, i) => ({ id: 'drive-id-' + i, date: '2026-10-02', label: 'ทดสอบ' })), trace: [] }; };
  const id = 'job-1234567890123456';
  assert.equal(ctx.runPhotoJob('ครู', id, true).result.photos.length, 6653);
  assert.equal(ctx.getPhotoJobStatus('ครู', id).result.photos.length, 6653);
  assert.equal(ctx.runPhotoJob('ครู', id, true).state, 'READY'); assert.equal(reads, 1); assert.equal(released, 2);
  version = 'v2'; assert.equal(ctx.getPhotoJobStatus('ครู', id).state, 'EXPIRED');
  ctx.runPhotoJob('ครู', id, true); assert.equal(reads, 2);
  values.delete('photo_job_' + id + '_0'); assert.equal(ctx.getPhotoJobStatus('ครู', id).state, 'UNKNOWN');
  ctx.runPhotoJob('ครู', id, true); assert.equal(reads, 3);
  values.set('photo_job_' + id, JSON.stringify({ name: 'ครู', version: ctx.photoJobVersion_('ครู'), state: 'RUNNING', created: Date.now() }));
  assert.equal(ctx.runPhotoJob('ครู', id, true).state, 'RUNNING'); assert.equal(reads, 3);
  lockAvailable = false; assert.equal(ctx.runPhotoJob('ครู', id, true).state, 'BUSY'); lockAvailable = true;
  values.clear(); ctx.getPersonPhotosWithTrace = () => ({ ok: false, error: 'DEADLINE_EXCEEDED' });
  assert.equal(ctx.runPhotoJob('ครู', id, true).state, 'ERROR'); assert.equal(ctx.getPhotoJobStatus('ครู', id).state, 'ERROR');
  assert.throws(() => ctx.runPhotoJob('ครู', 'bad', true), /Invalid job ID/);
  console.log('PASS chunked 6653-item result, five-minute TTL, READY reuse, sync invalidation, eviction, lock and read error');
}
function v102ImagePipelineTests() {
  // 1. Backend proxy validation & authorization tests
  const cacheMap = new Map();
  const mockCache = {
    get: k => cacheMap.get(k) ?? null,
    put: (k, v) => cacheMap.set(k, v),
    remove: k => cacheMap.delete(k)
  };
  let urlFetchResp = null;
  let driveBlobBytes = [0xFF, 0xD8, 0xFF, 0xE0, ...new Array(80).fill(0x10)];
  let driveMime = 'image/jpeg';
  const backendCtx = {
    console,
    CacheService: { getScriptCache: () => mockCache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: { getOAuthToken: () => 'mock-token' },
    Utilities: {
       computeDigest: (algo, str) => Array.from(Buffer.from(String(str))),
       DigestAlgorithm: { MD5: 'MD5' },
       base64Encode: bytes => Buffer.from(bytes).toString('base64')
    },
    UrlFetchApp: {
      fetch: () => urlFetchResp
    },
    DriveApp: {
      getFileById: () => ({
        isTrashed: () => false,
        getThumbnail: () => ({
          getBytes: () => driveBlobBytes,
          getContentType: () => driveMime
        }),
        getBlob: () => ({
          getBytes: () => driveBlobBytes,
          getContentType: () => driveMime
        })
      })
    }
  };
  vm.createContext(backendCtx);
  vm.runInContext(fs.readFileSync('DatabaseService.gs', 'utf8'), backendCtx);

  // Seed allowed photos for teacher 'ครูเอ'
  backendCtx.cacheAllowedPersonPhotos_('ครูเอ', [{ id: 'valid_photo_id_12345' }, { id: 'html_trap_id_1234567' }]);

  // Unauthorized fileId for 'ครูเอ' must be rejected when person list is known
  backendCtx.getPersonPhotos = () => [];
  const unauthRes = backendCtx.getPhotoThumbnailBase64('other_person_file_999', 'ครูเอ');
  assert.equal(unauthRes.ok, false);
  assert.equal(unauthRes.status, 'FORBIDDEN');

  // HTML disguised as HTTP 200 on UrlFetchApp must be rejected by magic-byte check and fall back to DriveApp valid JPEG
  const htmlBytes = Array.from(Buffer.from('<!DOCTYPE html><html><head><title>Google Drive - Sign in</title></head><body>Please sign in to view this file</body></html>'));
  urlFetchResp = {
    getResponseCode: () => 200,
    getBlob: () => ({
      getBytes: () => htmlBytes,
      getContentType: () => 'text/html'
    })
  };
  const fallbackRes = backendCtx.getPhotoThumbnailBase64('valid_photo_id_12345', 'ครูเอ');
  assert.equal(fallbackRes.ok, true);
  assert.equal(fallbackRes.status, 'OK');
  assert.equal(fallbackRes.source, 'PROXY_DRIVEAPP');
  assert(fallbackRes.dataUrl.startsWith('data:image/jpeg;base64,'));

  // When both UrlFetchApp and DriveApp return HTML/non-image, proxy must return ok:false, status:'NOT_IMAGE'
  driveBlobBytes = htmlBytes;
  driveMime = 'text/html';
  const badRes = backendCtx.getPhotoThumbnailBase64('html_trap_id_1234567', 'ครูเอ');
  assert.equal(badRes.ok, false);
  assert.equal(badRes.status, 'UNAVAILABLE');
  assert(badRes.reason.includes('HTML_PAYLOAD'));

  // 2. Frontend 5-Pillar State Machine, Cache, Queue, Deduplication & Lightbox tests
  const cards = new Map();
  const domById = new Map();
  const makeCard = fileId => {
    const cardAttrs = { 'data-load-state': 'loading', 'data-id': fileId };
    const imgAttrs = { 'data-retry-count': '0', 'data-file-id': fileId };
    const imgEl = {
      _src: '',
      complete: true,
      naturalWidth: 800,
      naturalHeight: 600,
      dataset: { loadRoute: 'DIRECT_DRIVE', renderToken: '1', startedAt: '1000' },
      style: { opacity: '0' },
      classList: { add() {}, remove() {}, toggle() {} },
      getAttribute: k => imgAttrs[k] ?? null,
      setAttribute: (k, v) => { imgAttrs[k] = String(v); },
      removeAttribute: k => { delete imgAttrs[k]; }
    };
    Object.defineProperty(imgEl, 'src', {
      get() { return this._src; },
      set(val) {
        this._src = val;
        if (val && this._autoLoadOnSet && typeof feCtx.onGalleryImageLoaded === 'function') {
          feCtx.onGalleryImageLoaded(this);
        }
      }
    });
    const errTextEl = { textContent: '' };
    const cardEl = {
      id: 'photo-card-' + fileId,
      getAttribute: k => cardAttrs[k] ?? null,
      setAttribute: (k, v) => { cardAttrs[k] = String(v); },
      querySelector: sel => {
        if (sel === 'img.photo-img-natural' || sel === 'img') return imgEl;
        if (sel === '.photo-error-label') return errTextEl;
        return null;
      },
      _img: imgEl,
      _errText: errTextEl
    };
    imgEl.parentNode = cardEl;
    imgEl.closest = () => cardEl;
    cards.set(fileId, cardEl);
    domById.set('photo-card-' + fileId, cardEl);
    return cardEl;
  };

  const lbImg = { src: '', style: {}, classList: { add() {}, remove() {} } };
  const lbLoader = { style: { display: 'none' } };
  domById.set('lightbox-img', lbImg);
  domById.set('lightbox-loader', lbLoader);
  domById.set('lightbox-counter', { innerText: '' });
  domById.set('lightbox-caption', { innerHTML: '' });
  domById.set('lightbox-prev-btn', { disabled: false });
  domById.set('lightbox-next-btn', { disabled: false });
  domById.set('lightbox-zoom-icon', { className: '' });

  let proxyRpcCalls = [];
  let imageVerifyBehavior = () => ({ ok: true, width: 400, height: 300 });
  let fakeNow = 1000;

  function MockImage() {
    this.naturalWidth = 400;
    this.naturalHeight = 300;
    const self = this;
    Object.defineProperty(this, 'src', {
      set(val) {
        this._src = val;
        if (!val) return;
        const outcome = imageVerifyBehavior(val);
        if (outcome.ok) {
          self.naturalWidth = outcome.width || 400;
          self.naturalHeight = outcome.height || 300;
          if (self.onload) self.onload();
        } else {
          self.naturalWidth = 0;
          if (self.onerror) self.onerror();
        }
      },
      get() { return this._src; }
    });
  }

  const feCtx = {
    window: {},
    console,
    Date: { now: () => (++fakeNow) },
    Math,
    Number,
    String,
    Object,
    Array,
    parseInt,
    Image: MockImage,
    photoTraceId: 'trace-102',
    setTimeout: () => 1,
    clearTimeout: () => {},
    encodeURIComponent,
    document: {
      getElementById: id => domById.get(id) || null,
      body: { style: {}, contains: () => true }
    },
    photoLog: () => {},
    formatThaiDate: d => d || '',
    appState: {
      selectedPerson: { name: 'ครูเอ' },
      renderedPhotoIds: [],
      filteredPhotos: [
        { id: 'owner_direct_photo_01', event: 'งานวันครู', date: '2026-01-16' },
        { id: 'ext_403_photo_id_0002', event: 'งานกีฬาสี', date: '2026-02-10' },
        { id: 'bad_proxy_photo_id_03', event: 'งานวิชาการ', date: '2026-03-01' }
      ],
      galleryRenderToken: 1,
      galleryPage: 0,
      galleryPageCount: 1
    },
    google: {
      script: {
        get run() {
          let onSuccess, onFailure;
          const runner = {
            withSuccessHandler(fn) { onSuccess = fn; return runner; },
            withFailureHandler(fn) { onFailure = fn; return runner; },
            getPhotoThumbnailBase64(fileId, personName) {
              proxyRpcCalls.push({ fileId, personName, onSuccess, onFailure });
            }
          };
          return runner;
        }
      }
    }
  };
  vm.createContext(feCtx);
  const startIdx = html.indexOf('    // V10.2 SHARED IMAGE CACHE, PROXY QUEUE & TELEMETRY');
  const endIdx = html.indexOf('    function navigateLightbox(direction)');
  vm.runInContext(html.slice(startIdx, endIdx), feCtx);

  // Scenario 1: Owner account direct Drive load succeeds (retry-count="0", state="ready", cached)
  const card1 = makeCard('owner_direct_photo_01');
  feCtx.startCardPhotoLoad(card1, { id: 'owner_direct_photo_01' }, false);
  feCtx.onGalleryImageLoaded(card1._img);
  assert.equal(card1.getAttribute('data-load-state'), 'ready');
  assert.equal(card1._img.dataset.loadRoute, 'DIRECT_DRIVE');
  assert.equal(card1._img.getAttribute('data-retry-count'), '0');
  assert.equal(feCtx.getVerifiedPhotoCache('owner_direct_photo_01').url, 'https://drive.google.com/thumbnail?id=owner_direct_photo_01&sz=w400');

  // Scenario 2: External account direct Drive fails -> immediate Proxy fallback (no LH3/Drive retry loop!)
  const card2 = makeCard('ext_403_photo_id_0002');
  feCtx.startCardPhotoLoad(card2, { id: 'ext_403_photo_id_0002' }, false);
  card2._img._autoLoadOnSet = true;
  feCtx.onGalleryImageError(card2._img);
  assert.equal(card2._img.getAttribute('data-retry-count'), '1', 'Must go straight to proxy on 1st failure');
  assert.equal(card2.getAttribute('data-load-state'), 'loading', 'Must remain in loading skeleton while proxy fetches');
  assert.equal(feCtx.photoProxyRequiredSet['ext_403_photo_id_0002'], true, 'Must remember fileId requires proxy in session');
  assert.equal(proxyRpcCalls.length, 1);
  assert.equal(proxyRpcCalls[0].fileId, 'ext_403_photo_id_0002');

  // Resolve proxy with valid Base64 image
  const mockDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/';
  proxyRpcCalls[0].onSuccess({ ok: true, status: 'OK', source: 'PROXY_URLFETCH', mimeType: 'image/jpeg', dataUrl: mockDataUrl });
  assert.equal(card2.getAttribute('data-load-state'), 'ready');
  assert(card2._img.dataset.loadRoute.startsWith('SERVER_PROXY'));
  assert.equal(card2._img.src, mockDataUrl);
  assert.equal(feCtx.getVerifiedPhotoCache('ext_403_photo_id_0002').url, mockDataUrl);

  // Scenario 3: Revisit same photo in session -> instant cache reuse without network or proxy RPC
  const rpcCountBeforeRevisit = proxyRpcCalls.length;
  const card2Revisit = makeCard('ext_403_photo_id_0002');
  card2Revisit._img._autoLoadOnSet = true;
  feCtx.startCardPhotoLoad(card2Revisit, { id: 'ext_403_photo_id_0002' }, false);
  assert.equal(proxyRpcCalls.length, rpcCountBeforeRevisit, 'Revisit must use sharedPhotoCache with 0 new RPC calls');
  assert.equal(card2Revisit.getAttribute('data-load-state'), 'ready');
  assert(card2Revisit._img.dataset.loadRoute.startsWith('CACHE_HIT'));
  assert.equal(card2Revisit._img.src, mockDataUrl);

  // Scenario 4: Click photo card to open Lightbox -> uses already-loaded card/cached image immediately
  feCtx.currentLightboxIndex = 1;
  feCtx.currentLightboxPhoto = feCtx.appState.filteredPhotos[1]; // ext_403_photo_id_0002
  feCtx.renderLightboxCurrentPhoto();
  assert.equal(lbImg.src, mockDataUrl, 'Lightbox must immediately display cached/card proxy image');
  assert.equal(lbLoader.style.display, 'none', 'Lightbox loader must be hidden immediately when card image is ready');

  // Scenario 5: Proxy returns non-image / error -> card shows explicit error state + retry button works
  const card3 = makeCard('bad_proxy_photo_id_03');
  feCtx.startCardPhotoLoad(card3, { id: 'bad_proxy_photo_id_03' }, false);
  card3._img._autoLoadOnSet = true;
  feCtx.onGalleryImageError(card3._img);
  assert.equal(proxyRpcCalls.length, 2);
  proxyRpcCalls[1].onSuccess({ ok: false, status: 'UNAVAILABLE', reason: 'HTML_PAYLOAD', message: 'ไม่สามารถดึงข้อมูลภาพที่แสดงผลได้' });
  assert.equal(card3.getAttribute('data-load-state'), 'error', 'Card must enter error state when proxy fails');
  assert.equal(feCtx.getVerifiedPhotoCache('bad_proxy_photo_id_03'), null, 'Failed proxy response must never be cached');

  // Click Retry button on card3 -> resets state and succeeds when image loads
  feCtx.retryPhotoCardLoad('bad_proxy_photo_id_03');
  assert.equal(card3.getAttribute('data-load-state'), 'ready', 'Manual retry reloads and transitions to ready when valid');

  // Scenario 6: Rapid page/teacher switch cancels queued stale requests + concurrency queue (max 2) + deduplication + LRU bound
  proxyRpcCalls = [];
  feCtx.appState.galleryRenderToken = 2;
  let dedupCallbacks = 0;
  feCtx.requestPhotoFromProxy('concurrent_photo_id_a', 'ครูเอ', 'high', 2, () => dedupCallbacks++);
  feCtx.requestPhotoFromProxy('concurrent_photo_id_a', 'ครูเอ', 'high', 2, () => dedupCallbacks++); // duplicate!
  feCtx.requestPhotoFromProxy('concurrent_photo_id_b', 'ครูเอ', 'high', 2, () => {});
  feCtx.requestPhotoFromProxy('queued_stale_photo_c', 'ครูเอ', 'low', 2, () => {});
  assert.equal(proxyRpcCalls.length, 2, 'MAX_CONCURRENT_PROXY=2 must only dispatch 2 concurrent RPCs and deduplicate concurrent_photo_id_a');

  // Switch page/teacher (bumpGalleryRenderToken increments token to 3) -> queued_stale_photo_c (token 2) must be cancelled before dispatch
  feCtx.bumpGalleryRenderToken();
  proxyRpcCalls[0].onSuccess({ ok: true, status: 'OK', dataUrl: mockDataUrl });
  assert.equal(dedupCallbacks, 2, 'Both deduplicated callers for concurrent_photo_id_a must receive the result');
  proxyRpcCalls[1].onSuccess({ ok: true, status: 'OK', dataUrl: mockDataUrl });
  assert.equal(proxyRpcCalls.length, 2, 'Stale queued item queued_stale_photo_c must be cancelled and not dispatched');

  // Verify LRU bound (MAX_BASE64_CACHE_ITEMS = 36)
  for (let i = 0; i < 45; i++) {
    feCtx.setVerifiedPhotoCache('lru_item_photo_id_' + String(i).padStart(3, '0'), 'data:image/jpeg;base64,AAA' + i, 'SERVER_PROXY');
  }
  const base64Count = Object.keys(feCtx.sharedPhotoCache).filter(k => feCtx.sharedPhotoCache[k].isBase64).length;
  assert(base64Count <= 36, 'Base64 cache must not exceed 36 items (actual: ' + base64Count + ')');
  assert.equal(feCtx.getVerifiedPhotoCache('lru_item_photo_id_000'), null, 'Oldest Base64 entries must be evicted by LRU');
  assert.equal(feCtx.getVerifiedPhotoCache('lru_item_photo_id_044').url, 'data:image/jpeg;base64,AAA44', 'Newest Base64 entries must remain in cache');

  console.log('PASS v10.2 all 6 scenarios: direct load, fast proxy fallback, cache reuse, instant lightbox, error/retry UI, queue/dedup/stale-cancel/LRU');
}
function v103YearSortingTests() {
  // 1. Frontend hierarchy + sorting test (including p52124 from สอบธรรมศึกษาปี63 with year="2563" and Drive upload date="2026-10-08")
  const sortCtx = {
    console,
    Math,
    Number,
    String,
    Object,
    Array,
    parseInt,
    isNaN,
    isFinite,
    photoLog: () => {},
    formatThaiMonthYear: ym => ym || '',
    formatThaiDate: d => d || '',
    updateYearPickerOptions: () => {},
    updateMonthPickerOptions: () => {},
    applyPhotoFiltersAndRender: () => {},
    updateDownloadButton: () => {},
    document: {
      getElementById: () => ({ hidden: false, textContent: '', innerText: '' })
    },
    appState: {
      allRawPhotos: [],
      resolvedPhotos: [],
      photoHierarchy: null,
      filterYear: 'ALL'
    }
  };
  vm.createContext(sortCtx);
  const startSortIdx = html.indexOf('    function resolveAndRenderPhotos(photos)');
  const endSortIdx = html.indexOf('    function updateYearPickerOptions(hierarchy)');
  vm.runInContext(html.slice(startSortIdx, endSortIdx), sortCtx);

  const samplePhotos = [
    { id: 'drive_p52124_2563_id01', photoId: 'p52124', event: 'สอบธรรมศึกษาปี63', year: '2563', date: '2026-10-08', faceCount: 1, faceCountSource: 'photo_index' },
    { id: 'drive_photo_2565_id002', photoId: 'p10002', event: 'วันไหว้ครู 2565', year: '2565', date: '2026-10-07', faceCount: 3, faceCountSource: 'photo_index' },
    { id: 'drive_photo_2568_id003', photoId: 'p30003', event: 'วันวิชาการ 2568', year: '2568', date: '2025-08-20', faceCount: 8, faceCountSource: 'photo_index' },
    { id: 'drive_photo_2569_sep04', photoId: 'p40004', event: 'กย 24 ประเมิน PA ครู', year: '2569', date: '2026-10-06', faceCount: 1, faceCountSource: 'photo_index' },
    { id: 'drive_photo_2567_id005', photoId: 'p20005', event: 'กีฬาสี 2567', year: '2567', date: '2024-11-15', faceCount: 2, faceCountSource: 'photo_index' },
    { id: 'drive_photo_2569_oct06', photoId: 'p40006', event: 'ตค 08 การอบรมพัฒนาครู', year: '2569', date: '2026-10-08', faceCount: 1, faceCountSource: 'photo_index' }
  ];

  sortCtx.resolveAndRenderPhotos(samplePhotos);
  const sortedIds = sortCtx.appState.resolvedPhotos.map(p => p.photoId);
  assert.deepEqual(
    sortedIds,
    ['p40006', 'p40004', 'p30003', 'p20005', 'p10002', 'p52124'],
    'Photos must sort strictly by Thai Year descending (2569 Oct -> 2569 Sep -> 2568 -> 2567 -> 2565 -> 2563 p52124)'
  );

  // 2. Backend sortPersonPhotosYearDesc_ verification
  const beCtx = {
    console,
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) }
  };
  vm.createContext(beCtx);
  vm.runInContext(fs.readFileSync('DatabaseService.gs', 'utf8'), beCtx);

  const backendList = [
    { id: 'drive_p52124_2563_id01', photoId: 'p52124', event: 'สอบธรรมศึกษาปี63', year: '2563', date: '2026-10-08' },
    { id: 'drive_photo_2569_oct06', photoId: 'p40006', event: 'ตค 08 การอบรมพัฒนาครู', year: '2569', date: '2026-09-24' },
    { id: 'drive_photo_2567_id005', photoId: 'p20005', event: 'กีฬาสี 2567', year: '2567', date: '2026-10-06' }
  ];
  beCtx.sortPersonPhotosYearDesc_(backendList);
  assert.deepEqual(
    backendList.map(p => p.photoId),
    ['p40006', 'p20005', 'p52124'],
    'Backend sortPersonPhotosYearDesc_ must place 2569 -> 2567 -> 2563 regardless of Drive upload date'
  );

  console.log('PASS v10.3 year-first photo sorting (2569 -> 2568 -> 2567 -> 2565 -> 2563 p52124) on frontend and backend');
}
frontend(); backend(); v102ImagePipelineTests(); v103YearSortingTests();


