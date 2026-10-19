const test = require('node:test');
const assert = require('node:assert');

// Mock function representing getTargetPhotoForDriveFolder (v9.9.12)
function getTargetPhotoForDriveFolder(appState, lastClickedPhotoId) {
  if (!appState.allRawPhotos || appState.allRawPhotos.length === 0) return null;

  var currentEventFilter = (appState.filterMonth && appState.filterMonth.startsWith('EVENT:'))
    ? appState.filterMonth.substring(6).trim()
    : null;

  var activeList = (appState.filteredPhotos && appState.filteredPhotos.length > 0)
    ? appState.filteredPhotos
    : appState.allRawPhotos;

  // 1. หากผู้ใช้เลือกรูปภาพอยู่: ตรวจสอบว่าภาพที่เลือกอยู่ใน activeList หรือไม่
  if (appState.selectedPhotos && appState.selectedPhotos.length > 0) {
    for (var s = appState.selectedPhotos.length - 1; s >= 0; s--) {
      var selId = appState.selectedPhotos[s];
      for (var a = 0; a < activeList.length; a++) {
        if (activeList[a].id === selId) return activeList[a];
      }
    }
  }

  // 2. หากมีภาพที่เพิ่งคลิกล่าสุด และภาพนั้นอยู่ใน activeList
  if (lastClickedPhotoId) {
    for (var b = 0; b < activeList.length; b++) {
      if (activeList[b].id === lastClickedPhotoId) return activeList[b];
    }
  }

  // 3. หากกำลังกรองดูกิจกรรมใดกิจกรรมหนึ่งอยู่ ให้ยึดภาพของกิจกรรมนั้น
  if (currentEventFilter) {
    for (var c = 0; c < activeList.length; c++) {
      var p = activeList[c];
      if ((p._eventKey && p._eventKey.trim() === currentEventFilter) || (p.event && p.event.trim() === currentEventFilter)) {
        return p;
      }
    }
    for (var c2 = 0; c2 < appState.allRawPhotos.length; c2++) {
      var p2 = appState.allRawPhotos[c2];
      if ((p2._eventKey && p2._eventKey.trim() === currentEventFilter) || (p2.event && p2.event.trim() === currentEventFilter)) {
        return p2;
      }
    }
  }

  // 4. ภาพแรกที่กำลังแสดงผลอยู่ใน 6 ช่องบนหน้าจอ (renderedPhotoIds)
  if (appState.renderedPhotoIds && appState.renderedPhotoIds.length > 0) {
    var firstRenderedId = appState.renderedPhotoIds[0];
    for (var d = 0; d < activeList.length; d++) {
      if (activeList[d].id === firstRenderedId) return activeList[d];
    }
  }

  // 5. ภาพแรกของรายการที่กรองไว้ (filteredPhotos)
  if (appState.filteredPhotos && appState.filteredPhotos.length > 0) {
    return appState.filteredPhotos[0];
  }

  // 6. ภาพแรกสุดของบุคลากรนี้
  return appState.allRawPhotos[0];
}

// Mock backend function representing getPhotoParentFolder (v9.9.12)
function mockGetPhotoParentFolder(fileId, eventName, mockDrive, mockCache) {
  var cleanEvent = (eventName || "").trim();

  // 1. ตรวจสอบแคชด้วยชื่อกิจกรรม (ถ้ามี)
  if (cleanEvent) {
    try {
      var eventCacheKey = "folder_event_v9912_" + encodeURIComponent(cleanEvent);
      var cachedEvent = mockCache.get(eventCacheKey);
      if (cachedEvent) {
        var parsedEvent = JSON.parse(cachedEvent);
        if (parsedEvent && parsedEvent.folderId) {
          return { ok: true, folderId: parsedEvent.folderId, folderName: parsedEvent.folderName, fromCache: true };
        }
      }
    } catch (ce) {}
  }

  // 2. หากมี fileId ให้ตรวจสอบ parent folder ของไฟล์
  var directParent = null;
  if (fileId && typeof fileId === 'string' && fileId.trim() !== '') {
    try {
      var file = mockDrive.getFileById(fileId);
      if (file) {
        var parents = file.getParents();
        if (parents && parents.hasNext()) {
          directParent = parents.next();

          if (!cleanEvent || directParent.getName() === cleanEvent) {
            var res1 = { ok: true, folderId: directParent.getId(), folderName: directParent.getName(), fromCache: false };
            if (cleanEvent) mockCache.put("folder_event_v9912_" + encodeURIComponent(cleanEvent), JSON.stringify(res1));
            return res1;
          }

          var grandParents = directParent.getParents ? directParent.getParents() : { hasNext: () => false };
          while (grandParents.hasNext()) {
            var gp = grandParents.next();
            if (gp.getName() === cleanEvent) {
              var res2 = { ok: true, folderId: gp.getId(), folderName: gp.getName(), fromCache: false };
              mockCache.put("folder_event_v9912_" + encodeURIComponent(cleanEvent), JSON.stringify(res2));
              return res2;
            }
          }
        }
      }
    } catch (fe) {}
  }

  // 3. หากมี cleanEvent แต่ parent ของไฟล์ยังไม่ใช่ cleanEvent ให้ค้นหาโฟลเดอร์ชื่อ cleanEvent โดยตรงบน Drive
  if (cleanEvent && mockDrive.getFoldersByName) {
    try {
      var folders = mockDrive.getFoldersByName(cleanEvent);
      while (folders.hasNext()) {
        var f = folders.next();
        var res3 = { ok: true, folderId: f.getId(), folderName: f.getName(), fromCache: false };
        mockCache.put("folder_event_v9912_" + encodeURIComponent(cleanEvent), JSON.stringify(res3));
        return res3;
      }
    } catch (se) {}
  }

  // 4. Fallback: หากหา cleanEvent ไม่พบ แต่มี directParent ของไฟล์ ให้ใช้ directParent
  if (directParent) {
    return { ok: true, folderId: directParent.getId(), folderName: directParent.getName(), fromCache: false };
  }

  return { ok: false, error: 'ไม่พบโฟลเดอร์ของกิจกรรมนี้บน Google Drive' };
}

test('getTargetPhotoForDriveFolder: prioritizes filtered event photos over stale lastClickedPhotoId from previous event', () => {
  const photoFromOldEvent = { id: 'file_is_2567', event: 'นำเสนอผลงาน IS ปีการศึกษา 2567', _eventKey: 'นำเสนอผลงาน IS ปีการศึกษา 2567_2025-01' };
  const photoFromNewEvent = { id: 'file_queen_67', event: 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67', _eventKey: 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67_2024-00' };

  const appState = {
    allRawPhotos: [photoFromOldEvent, photoFromNewEvent],
    filteredPhotos: [photoFromNewEvent], // User filtered to Queen 67
    selectedPhotos: [], // User hasn't checked any checkbox in the new view
    filterMonth: 'EVENT:วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67_2024-00',
    renderedPhotoIds: ['file_queen_67']
  };

  // Even if lastClickedPhotoId holds the old photo ID from previous event
  const target = getTargetPhotoForDriveFolder(appState, 'file_is_2567');
  assert.strictEqual(target.id, 'file_queen_67');
  assert.strictEqual(target.event, 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67');
});

test('getTargetPhotoForDriveFolder: ignores stale selectedPhotos if they do not belong to active filtered event', () => {
  const photoFromOldEvent = { id: 'file_is_2567', event: 'นำเสนอผลงาน IS ปีการศึกษา 2567', _eventKey: 'นำเสนอผลงาน IS ปีการศึกษา 2567_2025-01' };
  const photoFromNewEvent = { id: 'file_queen_67', event: 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67', _eventKey: 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67_2024-00' };

  const appState = {
    allRawPhotos: [photoFromOldEvent, photoFromNewEvent],
    filteredPhotos: [photoFromNewEvent],
    selectedPhotos: ['file_is_2567'], // stale selection from previous view
    filterMonth: 'EVENT:วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67_2024-00',
    renderedPhotoIds: ['file_queen_67']
  };

  const target = getTargetPhotoForDriveFolder(appState, null);
  assert.strictEqual(target.id, 'file_queen_67');
  assert.strictEqual(target.event, 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67');
});

test('mockGetPhotoParentFolder: searches Google Drive for event folder when file parent does not match event name', () => {
  const cacheStore = {};
  const mockCache = {
    get: (k) => cacheStore[k] || null,
    put: (k, v) => { cacheStore[k] = v; }
  };

  const mockDrive = {
    getFileById: (id) => ({
      getParents: () => ({
        hasNext: () => true,
        next: () => ({
          getId: () => 'folder_is_2567',
          getName: () => 'นำเสนอผลงาน IS ปีการศึกษา 2567', // Stale parent
          getParents: () => ({ hasNext: () => false })
        })
      })
    }),
    getFoldersByName: (name) => {
      if (name === 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67') {
        let done = false;
        return {
          hasNext: () => !done,
          next: () => {
            done = true;
            return {
              getId: () => 'folder_queen_67_correct',
              getName: () => 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67'
            };
          }
        };
      }
      return { hasNext: () => false };
    }
  };

  // Called with a stale fileId and clean eventName
  const res = mockGetPhotoParentFolder('file_is_2567', 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67', mockDrive, mockCache);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.folderId, 'folder_queen_67_correct');
  assert.strictEqual(res.folderName, 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67');
  assert.strictEqual(res.fromCache, false);

  // Subsequent call gets from cache
  const resCached = mockGetPhotoParentFolder(null, 'วันเฉลิมพระชนมพรรษาพระราชินีสุทิดา67', mockDrive, mockCache);
  assert.strictEqual(resCached.ok, true);
  assert.strictEqual(resCached.folderId, 'folder_queen_67_correct');
  assert.strictEqual(resCached.fromCache, true);
});
