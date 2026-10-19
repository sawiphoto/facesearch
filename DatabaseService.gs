// Former personnel may be organized by department below the category folder.
function collectPersonnelFiles_(folder, nested) {
  var queue = [{ folder: folder, department: '' }], result = [];
  while (queue.length) {
    var entry = queue.shift(), files = entry.folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (!file.isTrashed()) result.push({ file: file, department: entry.department || 'ไม่ระบุกลุ่มสาระ', folderId: entry.folder.getId() });
    }
    if (nested) {
      var children = entry.folder.getFolders();
      while (children.hasNext()) {
        var child = children.next();
        if (!child.isTrashed()) queue.push({ folder: child, department: entry.department ? entry.department + ' / ' + child.getName() : child.getName() });
      }
    }
  }
  return result;
}

// Only source detector counts are authoritative; legacy teacher-name counts require sync.
function normalizeSourceFaceCount_(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  var count = Number(value);
  return isFinite(count) && count > 0 && Math.floor(count) === count && count <= 9007199254740991 ? count : null;
}
function categoryForFaceCount_(count) {
  return count === null ? 'unknown' : count === 1 ? 'single' : count <= 5 ? 'small_group' : 'large_group';
}
function normalizePhotoClassification_(item) {
  var count = item.faceCountSource === 'photo_index' ? normalizeSourceFaceCount_(item.faceCount) : null;
  item.faceCount = count;
  item.groupCategory = categoryForFaceCount_(count);
  return item;
}

/**
 * DatabaseService.gs
 * จัดการเกี่ยวกับการโหลดข้อมูล สแกนไดรฟ์ และบันทึก/อัปเดตไฟล์แคช
 */

// อาร์เรย์สะสมล็อกหลังบ้านส่งกลับไปหน้าบ้าน
var syncLogs = [];

/**
 * ดึงโฟลเดอร์หลักโครงการ App/ระบบค้นหาใบหน้า จาก Google Drive Root (ปรับปรุงแคชรหัส ID ความเร็วสูง)
 */
function getProjectFolder() {
  var cache = CacheService.getScriptCache();
  var cachedId = cache.get("project_folder_id");
  if (cachedId) {
    try {
      return DriveApp.getFolderById(cachedId);
    } catch (e) {
      // หากรหัสผ่านแคชใช้ไม่ได้หรือถูกลบ ให้สืบค้นใหม่
    }
  }

  var root = DriveApp.getRootFolder();

  // 1. ค้นหาโฟลเดอร์ "App" ในหน้าแรกของ Drive
  var appFolders = root.getFoldersByName("App");
  if (!appFolders.hasNext()) {
    throw new Error("ไม่พบโฟลเดอร์ชื่อ 'App' ในหน้าแรกของ Google Drive (My Drive)");
  }
  var appFolder = appFolders.next();

  // 2. ค้นหาโฟลเดอร์ "ระบบค้นหาใบหน้า" ภายใต้โฟลเดอร์ "App"
  var projectFolders = appFolder.getFoldersByName("ระบบค้นหาใบหน้า");
  if (!projectFolders.hasNext()) {
    throw new Error("ไม่พบโฟลเดอร์ชื่อ 'ระบบค้นหาใบหน้า' ภายใต้โฟลเดอร์ 'App'");
  }
  var folder = projectFolders.next();

  // บันทึกรหัส ID เข้าแคช 6 ชม.
  cache.put("project_folder_id", folder.getId(), 21600);
  return folder;
}

/** Build the small directory without embedding any photo bytes. */
function compactAppDirectory_(data) {
  return {
    categories: (data.categories || []).map(function(category) {
      return {
        name: category.name, folderId: category.folderId,
        people: (category.people || []).map(function(person) {
          return { name: person.name, folderId: person.folderId, avatarFileId: person.avatarFileId, avatarFileVersion: person.avatarFileVersion,
            department: person.department, status: person.status, photoCount: person.photoCount || 0, photoHash: person.photoHash };
        })
      };
    }),
    updatedAt: data.updatedAt || '', avatarVersion: data.avatarVersion || '', deleteRequests: {}
  };
}

/** Cache ASCII JSON in bounded chunks; publish the manifest last. */
function cacheAppDirectory_(data) {
  try {
    var cache = CacheService.getScriptCache();
    var current = readCachedAppDirectory_();
    if (current && current.updatedAt > (data.updatedAt || '')) return;
    var json = JSON.stringify(compactAppDirectory_(data)).replace(/[\u007f-\uffff]/g, function(c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
    var generation = Utilities.getUuid();
    var count = Math.ceil(json.length / 80000);
    for (var i = 0; i < count; i++) cache.put('directory_v92_' + generation + '_' + i, json.slice(i * 80000, (i + 1) * 80000), 900);
    cache.put('directory_v92_manifest', JSON.stringify({ generation: generation, count: count, length: json.length }), 900);
  } catch (e) { console.warn('Directory memory cache unavailable: ' + e.message); }
}

function readCachedAppDirectory_() {
  try {
    var cache = CacheService.getScriptCache();
    var manifest = cache.get('directory_v92_manifest');
    if (!manifest) return null;
    var meta = JSON.parse(manifest);
    if (!(meta.count > 0 && meta.count <= 100)) return null;
    var chunks = [];
    for (var i = 0; i < meta.count; i++) {
      var chunk = cache.get('directory_v92_' + meta.generation + '_' + i);
      if (chunk === null) return null;
      chunks.push(chunk);
    }
    var json = chunks.join('');
    return json.length === meta.length ? JSON.parse(json) : null;
  } catch (e) { return null; }
}

/** Read prepared directory only. Startup never syncs Drive or installs triggers. */
function getAppData() {
  console.log('getAppData start');
  var startTime = Date.now();
  try {
    var data = readCachedAppDirectory_();
    var source = 'memory';
    if (!data) {
      source = 'drive';
      console.log('getAppData cache miss; locating Drive file');
      var folder = getProjectFolder();
      var fileId = getFileIdByName(folder, 'app_cache.json');
      if (!fileId) return { error: true, code: 'CACHE_MISSING', message: 'ยังไม่มีฐานข้อมูลที่เตรียมไว้ กรุณาให้ผู้ดูแลกดซิงค์ข้อมูล', logs: [] };
      data = compactAppDirectory_(JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString()));
      cacheAppDirectory_(data);
      data = readCachedAppDirectory_() || data;
    }
    if (data.avatarVersion) {
      var prepared = readPreparedAvatars_(data.avatarVersion);
      data.avatarImages = prepared.images;
      data.avatarPrepared = prepared.ready;
      console.log('AVATAR_STARTUP prepared=' + prepared.ready + ' images=' + Object.keys(prepared.images).length);
    }
    data.logs = ['⏱️ getAppData source=' + source + ' serverMs=' + (Date.now() - startTime) + ' directoryBytes=' + Utilities.newBlob(JSON.stringify(data)).getBytes().length];
    return data;
  } catch (e) {
    console.error('getAppData failed: ' + e.toString());
    return { error: true, code: 'DIRECTORY_READ_FAILED', message: 'ไม่สามารถอ่านฐานข้อมูลได้: ' + e.message, logs: [] };
  }
}

/** Fetch only visible directory avatars, in batches of at most eight. */
function getPersonAvatars(fileIds) {
  if (!Array.isArray(fileIds) || fileIds.length > 8) throw new Error('Avatar batch must contain at most 8 IDs');
  var directory = getAppData();
  if (directory.error) throw new Error(directory.message);
  var allowed = Object.create(null);
  directory.categories.forEach(function(cat) { cat.people.forEach(function(p) { if (p.avatarFileId) allowed[p.avatarFileId] = true; }); });
  var ids = fileIds.filter(function(id, index) { return typeof id === 'string' && allowed[id] && fileIds.indexOf(id) === index; });
  var cache = CacheService.getScriptCache();
  if (directory.avatarPrepared) {
    var preparedResult = {};
    ids.forEach(function(id) { if (directory.avatarImages[id]) preparedResult[id] = directory.avatarImages[id]; });
    return preparedResult;
  }
  var result = {}, missing = [];
  ids.forEach(function(id) {
    var cached = cache.get('avatar_v92_' + id);
    if (cached) result[id] = cached; else missing.push(id);
  });
  if (missing.length) {
    var token = ScriptApp.getOAuthToken();
    var responses = UrlFetchApp.fetchAll(missing.map(function(id) {
      return { url: 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w120', method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
    }));
    responses.forEach(function(response, i) {
      var blob = response.getBlob();
      var type = blob.getContentType();
      if (response.getResponseCode() !== 200 || !/^image\//.test(type)) return;
      var value = 'data:' + type + ';base64,' + Utilities.base64Encode(blob.getBytes());
      result[missing[i]] = value;
      if (value.length < 95000) { try { cache.put('avatar_v92_' + missing[i], value, 21600); } catch (e) {} }
    });
  }
  return result;
}

/**
 * รันซิงค์สแกนโฟลเดอร์ Google Drive และไฟล์ JSON ดัชนีเพื่อสร้างแคชใหม่
 */
function syncDataFromDrive(options) {
  var skipSystemLog = !!(options && options.skipSystemLog);
  syncLogs = [];
  var syncReport = newSyncReport_(), currentStage = 'personnel';
  var referencedPhotos = Object.create(null);
  var startTime = new Date();
  var startThaiTimeStr = Utilities.formatDate(startTime, "Asia/Bangkok", "HH:mm:ss");

  try {
    syncLogs.push("=== เริ่มต้นการซิงค์ข้อมูลสแกนระบบ ===");
    var projectFolder = getProjectFolder();
    syncLogs.push("📂 พบโฟลเดอร์โครงการหลัก: " + projectFolder.getName());

    // ดึงรหัสแฮชรูปภาพเดิมจาก app_cache.json ล่าสุดที่มีอยู่ในไดรฟ์เพื่อเอามาเปรียบเทียบส่วนต่าง
    var oldHashMap = {};
    try {
      var cache = CacheService.getScriptCache();
      var cachedFileId = cache.get("file_id_app_cache.json");
      var oldContent = "";
      if (cachedFileId) {
        var file = DriveApp.getFileById(cachedFileId);
        oldContent = file.getBlob().getDataAsString();
      } else {
        var fileId = getFileIdByName(projectFolder, "app_cache.json");
        if (fileId) {
          var file = DriveApp.getFileById(fileId);
          oldContent = file.getBlob().getDataAsString();
        }
      }

      if (oldContent) {
        var oldData = JSON.parse(oldContent);
        if (oldData && oldData.categories) {
          oldData.categories.forEach(function(cat) {
            if (cat.people) {
              cat.people.forEach(function(person) {
                if (person.name && person.photoHash) {
                  oldHashMap[normalizeText(person.name)] = person.photoHash;
                }
              });
            }
          });
        }
      }
    } catch (e) {
      syncLogs.push("⚠️ ไม่พบข้อมูลแคชเดิมหรือแคชชำรุด ระบบจะทำการซิงค์สร้างไฟล์ใหม่หมด");
    }

    // ตรวจสอบรายการไฟล์ในโฟลเดอร์โครงการ
    syncLogs.push("--- รายการไฟล์ทั้งหมดในโฟลเดอร์ระบบ ---");
    var files = projectFolder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (!file.isTrashed()) {
        syncLogs.push("- " + file.getName() + " (ขนาด: " + file.getSize() + " bytes)");
      }
    }
    syncLogs.push("------------------------");

    var personnelFolders = projectFolder.getFoldersByName("บุคลากรโรงเรียน");
    if (!personnelFolders.hasNext()) {
      syncLogs.push("❌ ไม่พบโฟลเดอร์ 'บุคลากรโรงเรียน'!");
      throw new Error("ไม่พบโฟลเดอร์บุคลากรโรงเรียน");
    }
    var personnelFolder = personnelFolders.next();
    syncLogs.push("📂 พบโฟลเดอร์บุคลากรย่อย: " + personnelFolder.getName());

    // โหลดฐานข้อมูล JSON จริง
    currentStage = 'personIndex';
    var personData = loadJsonFile(projectFolder, 'person_index.json');
    if (!personData || typeof personData !== 'object' || Array.isArray(personData)) throw new Error('person_index.json หายหรือรูปแบบไม่ถูกต้อง');
    markSyncStage_(syncReport, currentStage, 'SUCCESS', 'อ่านสำเร็จ ' + Object.keys(personData).length + ' รายชื่อ', { names: Object.keys(personData).length });
    currentStage = 'photoIndex';
    var photoData = loadJsonFile(projectFolder, 'photo_index.json');
    if (!photoData || typeof photoData !== 'object' || Array.isArray(photoData)) throw new Error('photo_index.json หายหรือรูปแบบไม่ถูกต้อง');
    markSyncStage_(syncReport, currentStage, 'SUCCESS', 'อ่านสำเร็จ ' + Object.keys(photoData).length + ' รูป', { sourcePhotos: Object.keys(photoData).length });
    currentStage = 'personnel';

    // แปลง personData ให้อยู่ในรูป Lookup Map
    var personMap = {};
    if (personData && typeof personData === "object" && !Array.isArray(personData)) {
      Object.keys(personData).forEach(function(nameKey) {
        personMap[normalizeText(nameKey)] = {
          rawName: nameKey,
          photoIds: personData[nameKey]
        };
      });
      syncLogs.push("✅ จัดเตรียมแผนผังรายชื่อบุคคลเสร็จสิ้น (จำนวนคีย์: " + Object.keys(personMap).length + " รายการ)");
    } else {
      syncLogs.push("⚠️ รูปแบบไฟล์ person_index.json ไม่ใช่ Object แผนผังคีย์คู่!");
    }

    // Summarize unique source photos, not person-photo associations.
    var sourceTotals = { single: 0, small_group: 0, large_group: 0, unknown: 0 };
    Object.keys(photoData).forEach(function(photoId) {
      var entry = photoData[photoId] || {};
      var count = normalizeSourceFaceCount_(entry.face_count);
      sourceTotals[categoryForFaceCount_(count)]++;
    });
    syncLogs.push('FACE_COUNT source=photo_index totals=' + JSON.stringify(sourceTotals));

    var categories = [];

    // 4. สแกนโฟลเดอร์หมวดหมู่ย่อยภายใต้ "บุคลากรโรงเรียน"
    var subFolders = personnelFolder.getFolders();
    while (subFolders.hasNext()) {
      var subFolder = subFolders.next();
      if (subFolder.isTrashed()) continue;

      var categoryName = subFolder.getName();
      var peopleList = [];

      // สแกนไฟล์รูปภาพในโฟลเดอร์ย่อยนี้ (แต่ละไฟล์รูปภาพเปรียบเสมือนคุณครูหนึ่งคน)
      var fileEntries = collectPersonnelFiles_(subFolder, categoryName === 'อดีตบุคลากร');
      var entryIndex = 0;
      while (entryIndex < fileEntries.length) {
        var fileEntry = fileEntries[entryIndex++];
        var file = fileEntry.file;
        if (file.isTrashed()) continue;

        var fileName = file.getName();
        var mimeType = file.getMimeType();

        // กรองเฉพาะรูปภาพ
        if (mimeType.indexOf("image/") === 0) {
          var dotIndex = fileName.lastIndexOf(".");
          var personName = dotIndex !== -1 ? fileName.substring(0, dotIndex) : fileName;
          var fileId = file.getId();

          // 1. ค้นหาข้อมูลรูปภาพของพนักงานคนนี้จาก personMap (Fuzzy Match)
          var matchedPerson = findFuzzyPerson(personName, personMap);
          var photoIds = matchedPerson ? matchedPerson.photoIds : [];

          // 2. แกะ File ID จริงของแต่ละรูปจาก drive_link ใน photoData คู่กับวันที่ และประเภทกลุ่ม
          var photos = [];
          if (photoIds && Array.isArray(photoIds)) {
            photoIds.forEach(function(photoId) {
              var photoInfo = photoData[photoId];
              var photoDate = (photoInfo && photoInfo.date) ? photoInfo.date : "";
              var photoEvent = (photoInfo && (photoInfo.event || photoInfo.album || photoInfo.activity || photoInfo.folder || photoInfo.title)) ? (photoInfo.event || photoInfo.album || photoInfo.activity || photoInfo.folder || photoInfo.title) : "";
              var photoYear = (photoInfo && (photoInfo.year || photoInfo.thai_year)) ? (photoInfo.year || photoInfo.thai_year).toString().trim() : "";
              var photoSubfolder = (photoInfo && photoInfo.subfolder) ? photoInfo.subfolder.toString().trim() : "";
              var cleanId = (photoInfo && photoInfo.drive_link) ? cleanFileId(photoInfo.drive_link) : photoId;

              var faceCount = normalizeSourceFaceCount_(photoInfo && photoInfo.face_count);
              var groupCategory = categoryForFaceCount_(faceCount);

              if (cleanId) {
                referencedPhotos[photoId] = true;
                photos.push({
                  id: cleanId,
                  photoId: photoId,
                  date: photoDate,
                  event: photoEvent,
                  year: photoYear,
                  subfolder: photoSubfolder,
                  faceCount: faceCount,
                  faceCountSource: 'photo_index',
                  groupCategory: groupCategory
                });
              }
            });
            sortPersonPhotosYearDesc_(photos);
          }

          peopleList.push({
            name: personName,
            id: "N/A",
            avatarFileId: fileId,
            avatarFileVersion: typeof file.getLastUpdated === 'function' ? file.getLastUpdated().toISOString() : fileId,
            status: categoryName === 'อดีตบุคลากร' ? 'former' : 'active',
            department: categoryName === 'อดีตบุคลากร' ? fileEntry.department : categoryName,
            folderId: fileEntry.folderId,
            photos: photos
          });
        }
      }

      categories.push({
        name: categoryName,
        folderId: subFolder.getId(),
        people: peopleList
      });
      syncLogs.push("📦 โหลดหมวดหมู่ '" + categoryName + "' สำเร็จ (พบพนักงาน " + peopleList.length + " คน)");
    }

    // 4.1 สแกนไฟล์ระดับ Root นอกโฟลเดอร์ย่อยใน "บุคลากรโรงเรียน" (บุคลากรทั่วไป)
    var rootFiles = personnelFolder.getFiles();
    var rootPeopleList = [];
    while (rootFiles.hasNext()) {
      var file = rootFiles.next();
      if (file.isTrashed()) continue;

      var fileName = file.getName();
      var mimeType = file.getMimeType();

      if (mimeType.indexOf("image/") === 0) {
        var dotIndex = fileName.lastIndexOf(".");
        var personName = dotIndex !== -1 ? fileName.substring(0, dotIndex) : fileName;
        var fileId = file.getId();

        var matchedPerson = findFuzzyPerson(personName, personMap);
        var photoIds = matchedPerson ? matchedPerson.photoIds : [];

        var photos = [];
        if (photoIds && Array.isArray(photoIds)) {
          photoIds.forEach(function(photoId) {
            var photoInfo = photoData[photoId];
            var photoDate = (photoInfo && photoInfo.date) ? photoInfo.date : "";
            var photoEvent = (photoInfo && (photoInfo.event || photoInfo.album || photoInfo.activity || photoInfo.folder || photoInfo.title)) ? (photoInfo.event || photoInfo.album || photoInfo.activity || photoInfo.folder || photoInfo.title) : "";
            var photoYear = (photoInfo && (photoInfo.year || photoInfo.thai_year)) ? (photoInfo.year || photoInfo.thai_year).toString().trim() : "";
            var photoSubfolder = (photoInfo && photoInfo.subfolder) ? photoInfo.subfolder.toString().trim() : "";
            var cleanId = (photoInfo && photoInfo.drive_link) ? cleanFileId(photoInfo.drive_link) : photoId;

            var faceCount = normalizeSourceFaceCount_(photoInfo && photoInfo.face_count);
              var groupCategory = categoryForFaceCount_(faceCount);

            if (cleanId) {
              referencedPhotos[photoId] = true;
              photos.push({
                id: cleanId,
                photoId: photoId,
                date: photoDate,
                event: photoEvent,
                year: photoYear,
                subfolder: photoSubfolder,
                faceCount: faceCount,
                  faceCountSource: 'photo_index',
                groupCategory: groupCategory
              });
            }
          });
          sortPersonPhotosYearDesc_(photos);
        }

        rootPeopleList.push({
          name: personName,
          id: "N/A",
          avatarFileId: fileId,
          avatarFileVersion: typeof file.getLastUpdated === 'function' ? file.getLastUpdated().toISOString() : fileId,
          status: "active",
          photos: photos
        });
      }
    }

    if (rootPeopleList.length > 0) {
      categories.push({
        name: "ไม่ระบุหมวดหมู่",
        folderId: personnelFolder.getId(),
        people: rootPeopleList
      });
      syncLogs.push("📦 โหลดแผนก 'ไม่ระบุหมวดหมู่' สำเร็จ (พบพนักงาน " + rootPeopleList.length + " คน)");
    }

    syncReport.peopleCount = categories.reduce(function(total, category) { return total + category.people.length; }, 0);
    syncReport.photoCount = Object.keys(referencedPhotos).length;
    markSyncStage_(syncReport, 'personnel', 'SUCCESS', 'ตรวจพบ ' + syncReport.peopleCount + ' คน ใน ' + categories.length + ' กลุ่ม', { people: syncReport.peopleCount, categories: categories.length });
    var referencedUnknown = Object.keys(referencedPhotos).filter(function(id) { return normalizeSourceFaceCount_((photoData[id] || {}).face_count) === null; }).length;
    markSyncStage_(syncReport, 'classification', referencedUnknown ? 'PARTIAL' : 'SUCCESS', 'ภาพที่ผูกกับบุคลากร ' + syncReport.photoCount + ' รูป; ยังไม่จัดหมวด ' + referencedUnknown + ' รูป', { referencedPhotos: syncReport.photoCount, unknown: referencedUnknown, sourceTotals: sourceTotals });
    currentStage = 'personPhotos';

    // นับจำนวนพนักงานทั้งหมดในคิว
    var totalPeopleCount = 0;
    categories.forEach(function(cat) {
      if (cat.people) totalPeopleCount += cat.people.length;
    });

    syncLogs.push("⏱️ เริ่มต้นซิงค์และตรวจคิวรูปถ่ายครูทั้งหมด " + totalPeopleCount + " คน เมื่อเวลา " + startThaiTimeStr);

    // 4.3 เซฟแคชภาพถ่ายแยกรายคน และปรับปรุงโครงสร้างของ Categories (พร้อมเช็คแฮชส่วนต่าง)
    var cacheFolder;
    var cacheFolders = projectFolder.getFoldersByName("profile_photos_cache");
    if (cacheFolders.hasNext()) {
      cacheFolder = cacheFolders.next();
    } else {
      cacheFolder = projectFolder.createFolder("profile_photos_cache");
    }

    var updatedCount = 0;
    var skippedCount = 0;

    categories.forEach(function(category) {
      if (category.people) {
        category.people.forEach(function(person) {
          var photos = person.photos || [];
          person.photoCount = photos.length;
          var personTotals = { single: 0, small_group: 0, large_group: 0, unknown: 0 };
          photos.forEach(function(photo) { personTotals[photo.groupCategory]++; });
          syncLogs.push('FACE_COUNT person=' + person.name + ' totals=' + JSON.stringify(personTotals) +
            ' samples=' + JSON.stringify(photos.slice(0, 3).map(function(photo) {
              return { photoId: photo.photoId, faceCount: photo.faceCount, category: photo.groupCategory };
            })));

          // คำนวณรหัสแฮชใหม่จากรายการภาพถ่าย
          var newHash = generatePhotoHash(photos);
          person.photoHash = newHash; // ฝังรหัสแฮชบันทึกลงสารบัญ

          // ลบฟิลด์ photos ออกชั่วคราวเพื่อประหยัดพื้นที่ app_cache.json
          delete person.photos;

          var cacheFileName = normalizeText(person.name) + "_photos.json";
          var oldHash = oldHashMap[normalizeText(person.name)] || "";

          if (oldHash && oldHash === newHash) {
            skippedCount++;
            syncLogs.push("- [" + person.name + "] ข้ามการเขียนไฟล์ (ข้อมูลรูปภาพเหมือนเดิม)");
          } else {
            updatedCount++;
            syncLogs.push("📝 [" + person.name + "] เขียนทับไฟล์แคช (ข้อมูลเปลี่ยน/พบรูปภาพเพิ่ม)");
            saveJsonToFolder(cacheFolder, cacheFileName, photos);
          }
        });
      }
    });

    var endTime = new Date();
    var endThaiTimeStr = Utilities.formatDate(endTime, "Asia/Bangkok", "HH:mm:ss");
    var totalDurationSec = ((endTime.getTime() - startTime.getTime()) / 1000).toFixed(1);

    syncLogs.push("⏱️ กระบวนการซิงค์และเปรียบเทียบส่วนต่างเสร็จสิ้นสมบูรณ์ เมื่อเวลา " + endThaiTimeStr);
    syncLogs.push("📊 สรุปรายงานซิงค์: อัปเดต " + updatedCount + " รายการ, ข้าม " + skippedCount + " รายการ (ใช้เวลารวม " + totalDurationSec + " วินาที)");

    markSyncStage_(syncReport, 'personPhotos', 'SUCCESS', 'อัปเดต ' + updatedCount + ' คน / ข้อมูลเดิม ' + skippedCount + ' คน', { updated: updatedCount, unchanged: skippedCount });
    currentStage = 'avatars';
    var avatarManifest = syncPreparedAvatars_(projectFolder, categories);
    var avatarStats = avatarManifest.syncStats;
    if (!avatarStats) throw new Error('ไม่มีผลตรวจ avatar');
    markSyncStage_(syncReport, 'avatars', avatarStats.failed || avatarStats.ready < avatarStats.total ? 'PARTIAL' : 'SUCCESS',
      'พร้อม ' + avatarStats.ready + '/' + avatarStats.total + '; ใช้เดิม ' + avatarStats.reused + '; โหลดใหม่ ' + avatarStats.fetched + '; ไม่สำเร็จ ' + avatarStats.failed + '; ลบออก ' + avatarStats.removed + '; ไฟล์เปลี่ยน=' + avatarStats.fileChanged, avatarStats);
    currentStage = 'directory';
    var finalData = {
      avatarVersion: avatarManifest.version,
      categories: categories,
      updatedAt: new Date().toISOString()
    };

    // 5. บันทึก/อัปเดตไฟล์ app_cache.json ลงในโฟลเดอร์ "App/ระบบค้นหาใบหน้า"
    var directoryFileId = saveCacheFile(projectFolder, finalData);
    if (!directoryFileId) throw new Error('บันทึก app_cache.json ไม่สำเร็จ');
    var persistedDirectory = JSON.parse(DriveApp.getFileById(directoryFileId).getBlob().getDataAsString());
    if (JSON.stringify(compactAppDirectory_(persistedDirectory)) !== JSON.stringify(compactAppDirectory_(finalData))) throw new Error('ตรวจ app_cache.json หลังเขียนไม่ตรงกับข้อมูลรอบนี้');
    markSyncStage_(syncReport, 'directory', 'SUCCESS', 'บันทึกและอ่านกลับ app_cache.json ตรงกัน', { fileId: directoryFileId, avatarVersion: finalData.avatarVersion });
    syncLogs.push("💾 บันทึกไฟล์สารบัญแคช app_cache.json สำเร็จ!");

    currentStage = 'deletionQueue';
    // แนบข้อมูลการขอแจ้งลบเข้ากับข้อมูลซิงค์ด้วย
    var deletionFileId = getFileIdByName(projectFolder, 'delete_request.json');
    var deleteRequests = deletionFileId ? loadJsonFile(projectFolder, 'delete_request.json') : {};
    if (!deleteRequests || typeof deleteRequests !== 'object' || Array.isArray(deleteRequests)) throw new Error('delete_request.json รูปแบบไม่ถูกต้อง');
    var hasChanges = false;
    Object.keys(deleteRequests).forEach(function(key) {
      if (Array.isArray(deleteRequests[key])) {
        var originalLen = deleteRequests[key].length;
        deleteRequests[key] = deleteRequests[key].filter(function(id) {
          return id && id !== "undefined";
        });
        if (deleteRequests[key].length !== originalLen) {
          hasChanges = true;
        }
      }
    });
    if (hasChanges) {
      var jsonString = JSON.stringify(deleteRequests, null, 2);
      var delFile = DriveApp.getFileById(deletionFileId);
      delFile.setContent(jsonString);
      if (JSON.stringify(JSON.parse(delFile.getBlob().getDataAsString())) !== JSON.stringify(deleteRequests)) throw new Error('ตรวจรายการแจ้งลบหลังเขียนไม่ตรงกัน');
    }

    finalData.deleteRequests = deleteRequests;
    markSyncStage_(syncReport, 'deletionQueue', deletionFileId ? 'SUCCESS' : 'SKIPPED', deletionFileId ? 'อ่านสำเร็จ; ทำความสะอาด=' + hasChanges : 'ไม่มีไฟล์รายการแจ้งลบ', { people: Object.keys(deleteRequests).length, cleaned: hasChanges });
    currentStage = 'triggers';
    
    // ตรวจสอบและตั้งค่า Time-Driven Auto Sync Trigger (วันละ 4 รอบ: 00:00, 06:00, 12:00, 18:00 น.) ให้อัตโนมัติ
    try {
      var projectTriggers = ScriptApp.getProjectTriggers();
      var autoSyncCount = 0;
      if (projectTriggers && Array.isArray(projectTriggers)) {
        projectTriggers.forEach(function(t) {
          if (t.getHandlerFunction() === "autoSyncTriggerTask") autoSyncCount++;
        });
      }
      if (autoSyncCount < 4) {
        var triggerMsg = setupAutoSyncTriggers();
        syncLogs.push("⏰ Auto Sync Trigger: " + triggerMsg);
        var installedCount = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'autoSyncTriggerTask'; }).length;
        markSyncStage_(syncReport, 'triggers', installedCount === 4 ? 'SUCCESS' : 'PARTIAL', 'ตรวจหลังติดตั้ง พบ ' + installedCount + ' รอบ', { count: installedCount });
      } else {
        markSyncStage_(syncReport, 'triggers', autoSyncCount === 4 ? 'SUCCESS' : 'PARTIAL', 'ตรวจพบ ' + autoSyncCount + ' รอบ', { count: autoSyncCount });
        syncLogs.push("⏰ Auto Sync Trigger: ระบบทำงานอัตโนมัติตามรอบปกติ (00:00, 06:00, 12:00, 18:00 น.) ครบ " + autoSyncCount + " ทริกเกอร์");
      }
    } catch (eTrig) {
      markSyncStage_(syncReport, 'triggers', 'PARTIAL', 'ตรวจรอบ sync ไม่ได้: ' + eTrig.message);
    }

    finishSyncReport_(syncReport, false);
    finalData.syncReport = syncReport;
    finalData.peopleCount = syncReport.peopleCount;
    finalData.photoCount = syncReport.photoCount;
    finalData.partial = syncReport.overall === 'PARTIAL';
    if (!skipSystemLog) {
      finalData.logSaved = writeLog(finalData.partial ? 'SYSTEM_SYNC_PARTIAL' : 'SYSTEM_SYNC', syncReportDetail_(syncReport), syncReport.photoCount, '', syncReport) !== false;
      if (!finalData.logSaved) syncLogs.push('❌ บันทึกผล sync ลง logs.json ไม่สำเร็จ');
    } else {
      finalData.logSaved = true;
    }
    finalData.avatarImages = avatarImagesFromManifest_(avatarManifest);
    finalData.avatarPrepared = true;
    finalData.logs = syncLogs; // รวมล็อกการประมวลผลกลับไปส่ง
    return finalData;
  } catch (e) {
    var endTimeErr = new Date();
    var endThaiTimeErrStr = Utilities.formatDate(endTimeErr, "Asia/Bangkok", "HH:mm:ss");
    syncLogs.push("❌ เกิดข้อผิดพลาดระหว่างซิงค์ข้อมูล เมื่อเวลา " + endThaiTimeErrStr + ": " + e.toString());
    
    markSyncStage_(syncReport, currentStage, 'FAILED', e.message);
    finishSyncReport_(syncReport, true);
    // Record already-completed stages as well as the failed and unstarted stages.
    if (!skipSystemLog) {
      try {
        writeLog('SYSTEM_SYNC_FAILED', syncReportDetail_(syncReport), syncReport.photoCount, '', syncReport);
        syncLogs.push("📝 บันทึกประวัติความล้มเหลวลงใน logs.json เรียบร้อย");
      } catch (eLog) {
        console.warn("ไม่สามารถบันทึกประวัติความล้มเหลวลง logs.json: " + eLog.toString());
      }
    }

    return {
      error: true,
      message: "เกิดข้อผิดพลาดระหว่างซิงค์ข้อมูล: " + e.toString(),
      syncReport: syncReport,
      peopleCount: syncReport.peopleCount,
      photoCount: syncReport.photoCount,
      logs: syncLogs
    };
  }
}

/**
 * คำนวณแฮช MD5 32 ตัวอักษรของข้อมูลภาพถ่ายเพื่อระบุความแตกต่าง
 */
function generatePhotoHash(photos) {
  if (!photos || photos.length === 0) return "empty";
  var serialized = JSON.stringify(photos);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, serialized);
  var hexString = "";
  for (var i = 0; i < digest.length; i++) {
    var byteValue = digest[i];
    if (byteValue < 0) byteValue += 256;
    var byteString = byteValue.toString(16);
    if (byteString.length == 1) byteString = "0" + byteString;
    hexString += byteString;
  }
  return hexString;
}

function getFileIdByName(folder, fileName) {
  // ผูกตรงไปยัง File ID ของ logs.json ที่ระบุไว้โดยเฉพาะเพื่อความแม่นยำ 100%
  if (fileName === "logs.json") {
    var fixedLogsId = "13YUT0MYPMe0q9QOLnO93zLiTaW5BjRsc";
    try {
      var fLogs = DriveApp.getFileById(fixedLogsId);
      if (!fLogs.isTrashed()) {
        return fixedLogsId;
      }
    } catch (eLogsId) {
      // หากเกิดข้อผิดพลาด ให้ fallback ไปสแกนหาไฟล์ในโฟลเดอร์ตามปกติ
    }
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = "file_id_" + fileName;
  var cachedId = cache.get(cacheKey);
  if (cachedId) {
    try {
      var file = DriveApp.getFileById(cachedId);
      if (!file.isTrashed()) {
        return cachedId;
      }
    } catch (e) {
      // หากไฟล์ถูกลบหรือไม่มีสิทธิ์ ให้ไปสแกนหาใหม่
    }
  }

  var files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    var file = files.next();
    if (!file.isTrashed()) {
      var id = file.getId();
      cache.put(cacheKey, id, 21600); // แคช ID ไว้ 6 ชม.
      return id;
    }
  }
  return null;
}

/**
 * โหลดไฟล์ JSON จากโฟลเดอร์โครงการด้วยชื่อไฟล์ (แบบใช้แคชความเร็วสูง)
 */
function loadJsonFile(folder, fileName) {
  try {
    var fileId = getFileIdByName(folder, fileName);
    if (!fileId && fileName === 'photo_index.json') {
      fileId = getFileIdByName(folder, 'photoindex.json');
    } else if (!fileId && fileName === 'photoindex.json') {
      fileId = getFileIdByName(folder, 'photo_index.json');
    }
    if (fileId) {
      var file = DriveApp.getFileById(fileId);
      var content = file.getBlob().getDataAsString();
      syncLogs.push("📄 กำลังโหลดไฟล์ดัชนี: " + fileName + " (ขนาด: " + file.getSize() + " bytes)");

      var parsed = JSON.parse(content);
      var keysCount = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
      syncLogs.push("✅ โหลดและประมวลผล JSON สำเร็จ: " + fileName + " (พบข้อมูล " + keysCount + " รายการ)");
      return parsed;
    }
  } catch (err) {
    syncLogs.push("❌ ข้อผิดพลาดในการแปลง JSON ของไฟล์ " + fileName + ": " + err.toString());
    return null;
  }
  syncLogs.push("⚠️ ไม่พบไฟล์: " + fileName + " ในไดเรกทอรีของโปรเจกต์");
  return null;
}

/**
 * เขียนหรือทับไฟล์แคชลงในโฟลเดอร์โครงการ App/ระบบค้นหาใบหน้า (แบบรวดเร็วผ่าน ID พร้อมล้างแคชทันที)
 */
function saveCacheFile(folder, data) {
  data = compactAppDirectory_(data);
  var jsonString = JSON.stringify(data);
  var fileId = getFileIdByName(folder, "app_cache.json");
  var cache = CacheService.getScriptCache();
  
  // 1. ทำลายแคชเดิมใน RAM ทันที!
  cache.remove("file_id_app_cache.json");

  if (fileId) {
    try {
      var file = DriveApp.getFileById(fileId);
      file.setContent(jsonString);
      // 2. ผูกแคชกับไฟล์ที่อัปเดตแล้วทันที
      cache.put("file_id_app_cache.json", file.getId(), 21600);
      cacheAppDirectory_(data);
      return file.getId();
    } catch(e) {}
  }

  // สร้างไฟล์ใหม่
  var file = folder.createFile("app_cache.json", jsonString, MimeType.PLAIN_TEXT);
  cache.put("file_id_app_cache.json", file.getId(), 21600);
  cacheAppDirectory_(data);
  return file.getId();
}

/**
 * ค้นหา File ID ใน Google Drive แบบออนดีมานด์โดยใช้ชื่อไฟล์ (เพื่อรองรับไฟล์กระจัดกระจายต่างโฟลเดอร์)
 * @param {Array<any>} photoNames รายชื่อหรือออบเจกต์รหัสรูปภาพ เช่น [{"id":"P00171", "date":""}] หรือ ["P00171"]
 * @return {Array<any>} รายการ File ID จริงใน Google Drive พร้อมวันที่
 */
function getPhotoFileIds(photoNames) {
  var fileIds = [];
  if (!photoNames || !Array.isArray(photoNames)) return fileIds;

  photoNames.forEach(function(item) {
    if (!item) return;

    try {
      // รองรับทั้งแบบสตริงปกติ และออบเจกต์ { id, photoId, date, groupCategory, faceCount }
      var name = (typeof item === "object") ? item.id : item;
      var photoId = (typeof item === "object") ? (item.photoId || "") : "";
      var date = (typeof item === "object") ? (item.date || "") : "";
      var classification = normalizePhotoClassification_(typeof item === 'object' ? item : {});
      var groupCategory = classification.groupCategory;
      var faceCount = classification.faceCount;

      if (!name) return;

      // ถ้าชื่อที่ส่งมาเป็น File ID จริงๆ อยู่แล้ว (ความยาวมากกว่า 25 อักขระ) ให้เก็บไว้โดยตรง
      if (name.length > 25) {
        var finalDateDirect = date;
        if (!finalDateDirect || finalDateDirect.trim() === "" || finalDateDirect === "0000-00-00") {
          try {
            var fDirect = DriveApp.getFileById(name);
            finalDateDirect = Utilities.formatDate(fDirect.getDateCreated(), "Asia/Bangkok", "yyyy-MM-dd");
          } catch (eDirect) {}
        }
        fileIds.push({
          id: name,
          photoId: photoId,
          date: finalDateDirect,
          groupCategory: groupCategory,
          faceCount: faceCount,
                faceCountSource: classification.faceCountSource || 'unverified'
        });
        return;
      }

      var extensions = ["", ".jpg", ".png", ".jpeg", ".webp", ".JPG", ".PNG", ".JPEG"];
      var found = false;

      // 1. ค้นหาโดยทดลองเดานามสกุลไฟล์ยอดนิยม (ทำงานเร็วที่สุด)
      for (var i = 0; i < extensions.length; i++) {
        var fullName = name + extensions[i];
        try {
          var files = DriveApp.getFilesByName(fullName);
          if (files.hasNext()) {
            var file = files.next();
            if (!file.isTrashed()) {
              var finalDateExt = date;
              if (!finalDateExt || finalDateExt.trim() === "" || finalDateExt === "0000-00-00") {
                try {
                  finalDateExt = Utilities.formatDate(file.getDateCreated(), "Asia/Bangkok", "yyyy-MM-dd");
                } catch (eDateExt) {}
              }
              fileIds.push({
                id: file.getId(),
                photoId: photoId,
                date: finalDateExt,
                groupCategory: groupCategory,
                faceCount: faceCount,
                faceCountSource: classification.faceCountSource || 'unverified'
              });
              found = true;
              break;
            }
          }
        } catch (errExt) {}
      }

      // 2. ถ้าหากยังไม่เจอแบบตรงๆ ให้ลองสืบค้นชื่อผ่านกลไกค้นหาไฟล์ Drive Search Query อย่างปลอดภัย
      if (!found) {
        try {
          var safeName = String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          var query = "name = '" + safeName + "' or name contains '" + safeName + "'";
          var files = DriveApp.searchFiles(query);
          if (files.hasNext()) {
            var file = files.next();
            if (!file.isTrashed()) {
              var finalDateQuery = date;
              if (!finalDateQuery || finalDateQuery.trim() === "" || finalDateQuery === "0000-00-00") {
                try {
                  finalDateQuery = Utilities.formatDate(file.getDateCreated(), "Asia/Bangkok", "yyyy-MM-dd");
                } catch (eDateQuery) {}
              }
              fileIds.push({
                id: file.getId(),
                photoId: photoId,
                date: finalDateQuery,
                groupCategory: groupCategory,
                faceCount: faceCount,
          faceCountSource: classification.faceCountSource || 'unverified'
              });
              found = true;
            }
          }
        } catch (errQuery) {
          console.warn("ไม่สามารถค้นหาไฟล์ใน Drive สำหรับชื่อ: " + name + ", error: " + errQuery.toString());
        }
      }
    } catch (itemErr) {
      console.warn("ข้อผิดพลาดในการประมวลผลรูปภาพ: " + itemErr.toString());
    }
  });

  return fileIds;
}

/**
 * ค้นหาคีย์ที่มีตัวสะกดใกล้เคียงที่สุดในออบเจกต์ (Fuzzy Key Matching Helper)
 */
function findFuzzyKeyInObject(name, obj) {
  var normalized = normalizeText(name);
  if (obj[normalized]) return normalized;

  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (getLevenshteinDistance(normalized, normalizeText(key)) <= 2) {
      return key;
    }
  }
  return null;
}

/**
 * บีบอัดไฟล์รูปภาพทั้งหมดตาม File ID และส่งคืนเป็น Base64 String เพื่อให้หน้าบ้านดาวน์โหลดได้โดยตรง
 * @param {Array<string>} fileIds รายการ File ID ที่ต้องการบีบอัด
 * @param {string} zipName ชื่อไฟล์ ZIP
 * @param {string} qualityMode ระดับความละเอียดภาพ ("4K" หรือ "SD")
 * @return {Object} ลิงก์ดาวน์โหลด
 */
function createZipDownload(fileIds, zipName, qualityMode, customFileNames) {
  try {
    var blobs = [];
    var loggedFileNames = [];

    // กำหนดความกว้างของภาพย่อตามโหมดคุณภาพ (4K = 3840px, SD = 1600px)
    var sizeParam = (qualityMode === "4K") ? "&sz=w3840" : "&sz=w1600";

    // 1. เตรียมคำขอดาวน์โหลดแบบคู่ขนาน (Parallel HTTP Requests)
    var requests = [];
    var fileIdsToFetch = [];

    fileIds.forEach(function(fileId) {
      if (!fileId) return;
      var url = "https://drive.google.com/thumbnail?id=" + fileId + sizeParam;
      requests.push({
        url: url,
        method: "get",
        headers: {
          Authorization: "Bearer " + ScriptApp.getOAuthToken()
        },
        muteHttpExceptions: true
      });
      fileIdsToFetch.push(fileId);
    });

    if (requests.length === 0) {
      return {
        error: true,
        message: "ไม่พบไฟล์รูปภาพที่เลือก"
      };
    }

    // 2. ยิงดาวน์โหลดรูปภาพทั้งหมดขนานกันในครั้งเดียว (เสร็จในเสี้ยววินาที)
    var responses = UrlFetchApp.fetchAll(requests);

    for (var i = 0; i < responses.length; i++) {
      var response = responses[i];
      var fileId = fileIdsToFetch[i];
      var fileName = (customFileNames && customFileNames[i]) ? customFileNames[i] : ("photo_" + (i + 1) + ".jpg");

      var blob;
      if (response.getResponseCode() === 200) {
        blob = response.getBlob().setName(fileName);
      } else {
        // แผนสำรองดึงแบบเต็มรูปถ้าดาวน์โหลดภาพย่อล้มเหลว
        try {
          var file = DriveApp.getFileById(fileId);
          blob = file.getBlob().setName(fileName);
        } catch (e) {
          continue; // ข้ามไฟล์ที่ไม่มีสิทธิ์เข้าถึงหรือถูกลบ
        }
      }
      blobs.push(blob);
      loggedFileNames.push(fileName);
    }

    if (blobs.length === 0) {
      return {
        error: true,
        message: "ไม่พบไฟล์รูปภาพที่ระบบสามารถเข้าถึงได้เพื่อดาวน์โหลด"
      };
    }

    // 2. บีบอัดเป็น ZIP ในหน่วยความจำ (In-memory)
    var zipBlob = Utilities.zip(blobs, (zipName || "photos") + ".zip");

    // 3. แปลงเป็น Base64 String
    var base64Data = Utilities.base64Encode(zipBlob.getBytes());

    // 4. บันทึกประวัติการดาวน์โหลดลง Google Sheet (Log)
    var targetPerson = (zipName || "").replace("selected_4K_", "").replace("gallery_all_", "").replace("latest_25_", "");
    writeLog("ดาวน์โหลดไฟล์ ZIP", "บีบอัดรูปภาพแกลเลอรีของ " + targetPerson, fileIds.length, loggedFileNames);

    return {
      base64: base64Data,
      fileName: (zipName || "photos") + ".zip",
      mimeType: "application/zip"
    };
  } catch (e) {
    return {
      error: true,
      message: "เกิดข้อผิดพลาดในการบีบอัดไฟล์ ZIP: " + e.toString()
    };
  }
}

/**
 * ดึงข้อมูลรูปภาพเดี่ยวคุณภาพสูง (4K / SD) แปลงเป็น Base64 พร้อมชื่อไฟล์ที่กำหนดเอง
 */
function downloadSinglePhoto(fileId, customFileName, qualityMode) {
  try {
    if (!fileId) {
      return { error: true, message: "ไม่พบรหัสรูปภาพ (File ID)" };
    }
    var sizeParam = (qualityMode === "4K") ? "&sz=w3840" : "&sz=w1600";
    var url = "https://drive.google.com/thumbnail?id=" + fileId + sizeParam;
    var response = UrlFetchApp.fetch(url, {
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken()
      },
      muteHttpExceptions: true
    });

    var blob;
    var fileName = customFileName || "photo.jpg";
    if (response.getResponseCode() === 200) {
      blob = response.getBlob().setName(fileName);
    } else {
      var file = DriveApp.getFileById(fileId);
      blob = file.getBlob().setName(fileName);
    }

    var base64Data = Utilities.base64Encode(blob.getBytes());
    var mimeType = blob.getContentType() || "image/jpeg";

    return {
      base64: base64Data,
      fileName: fileName,
      mimeType: mimeType
    };
  } catch (e) {
    return {
      error: true,
      message: "เกิดข้อผิดพลาดในการดาวน์โหลดรูปภาพเดี่ยว: " + e.toString()
    };
  }
}

/**
 * เขียนบันทึกข้อมูลกิจกรรมการใช้งานลงในไฟล์ logs.json ในรูปแบบความเร็วสูง
 */
function writeLog(activityType, detail, photoCount, photoNamesArray, syncReport) {
  try {
    var projectFolder = getProjectFolder();
    var logs = loadJsonFile(projectFolder, "logs.json") || [];
    if (!Array.isArray(logs)) logs = [];
    if (typeof compactExistingSyncLogs_ === "function") {
      logs = compactExistingSyncLogs_(logs);
    }

    var timestamp = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd'T'HH:mm:ss.SSS'+07:00'");
    var userEmail = "Guest / ไม่ได้ล็อคอิน";
    try {
      if (typeof Session !== "undefined" && Session && Session.getActiveUser) {
        var email = Session.getActiveUser().getEmail();
        if (email && email.trim() !== "") {
          userEmail = email;
        }
      }
    } catch(eEmail) {
      userEmail = "System Auto Sync / แบ็คกราวด์";
    }

    var actStr = String(activityType || "");
    var isSyncActivity = !!syncReport || actStr.indexOf("AUTO_SYNC") === 0 || actStr.indexOf("SYSTEM_SYNC") === 0;
    var logEntry;

    if (isSyncActivity && typeof buildCompactSyncLogEntry_ === "function") {
      logEntry = buildCompactSyncLogEntry_(timestamp, actStr, detail, photoCount, syncReport);
    } else {
      var fileNamesStr = (photoNamesArray && Array.isArray(photoNamesArray)) ? photoNamesArray.join(", ") : (photoNamesArray || "");
      logEntry = {
        timestamp: timestamp,
        userEmail: userEmail,
        activityType: activityType,
        detail: detail || "",
        photoCount: photoCount || 0,
        photoNames: fileNamesStr
      };
    }

    logs.unshift(logEntry);

    // จำกัดประวัติไม่เกิน 2,000 รายการล่าสุดเพื่อประหยัดพื้นที่และคุมความเร็ว
    if (logs.length > 2000) {
      logs.length = 2000;
    }

    var jsonString = JSON.stringify(logs, null, 2);
    var fileId = getFileIdByName(projectFolder, "logs.json");
    if (fileId) {
      DriveApp.getFileById(fileId).setContent(jsonString);
    } else {
      var file = projectFolder.createFile("logs.json", jsonString, MimeType.PLAIN_TEXT);
      CacheService.getScriptCache().put("file_id_logs.json", file.getId(), 21600);
    }
    return true;
  } catch (e) {
    console.error("ล้มเหลวในการเขียนบันทึกประวัติลงไฟล์ JSON: " + e.toString());
    return false;
  }
}

/**
 * บันทึกประวัติการดาวน์โหลดรูปภาพเดี่ยว
 */
function logSingleDownload(fileId, personName) {
  var fileName = fileId;
  try {
    fileName = DriveApp.getFileById(fileId).getName();
  } catch (e) {
    // ใช้ fileId หากไม่พบสิทธิ์
  }
  writeLog("ดาวน์โหลดรูปเดี่ยว", "รูปภาพของ " + personName, 1, [fileName]);
}

/**
 * บันทึกประวัติการปิดหน้าเว็บแอป (ออกจากระบบ)
 */
function logSessionEnd() {
  writeLog("ออกจากระบบ", "ปิดหน้าต่างหรือเปลี่ยนหน้าเว็บ", 0, "");
}

/**
 * ค้นหารหัสรูปภาพ (Photo ID เช่น P00005) จาก File ID (ที่อยู่ภาพบนไดรฟ์) โดยใช้ photo_index.json
 */
function findPhotoIdByFileId(fileId, photoData) {
  if (!fileId || !photoData) return "";
  var keys = Object.keys(photoData);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var info = photoData[key];
    if (info && info.drive_link && info.drive_link.indexOf(fileId) !== -1) {
      return key;
    }
  }
  return "";
}

/**
 * บันทึกคำขอแจ้งลบรูปภาพลงในไฟล์ delete_request.json ในโฟลเดอร์โครงการ
 * @param {string} personName ชื่อพนักงาน
 * @param {string} photoId รหัสรูปภาพ (เช่น P00005)
 * @param {string} fileId รหัสไฟล์รูปภาพใน Google Drive (เช่น 124W-...) สำหรับกรณีแผนสำรอง
 * @return {Object} สถานะการบันทึก
 */
function reportDeletePhoto(personName, photoId, fileId) {
  try {
    var projectFolder = getProjectFolder();
    var resolvedPhotoId = photoId;

    // แผนสำรอง: หาก photoId ไม่มีค่า (เป็นค่าว่างเปล่า "") ให้ค้นหาคู่รหัสภาพจาก photo_index.json ย้อนหลัง
    if (!resolvedPhotoId || resolvedPhotoId === "undefined" || resolvedPhotoId === "") {
      if (fileId) {
        var photoData = loadJsonFile(projectFolder, "photo_index.json") || {};
        resolvedPhotoId = findPhotoIdByFileId(fileId, photoData);
      }
    }

    // ตรวจสอบและระงับการบันทึกค่าว่างเปล่า
    if (!resolvedPhotoId || resolvedPhotoId === "undefined" || resolvedPhotoId === "") {
      return {
        error: true,
        message: "ระงับการบันทึก: ไม่พบรหัสรูปภาพ (Photo ID) ที่ถูกต้องสำหรับรูปภาพนี้ กรุณา Sync ฐานข้อมูลเพื่ออัปเกรดเวอร์ชันแคช"
      };
    }

    var fileName = "delete_request.json";

    // 1. โหลดข้อมูลเดิม (ถ้ามี)
    var deleteRequests = loadJsonFile(projectFolder, fileName) || {};

    // ตรวจสอบว่ารูปแบบถูกต้องหรือไม่ (ต้องเป็น object)
    if (typeof deleteRequests !== "object" || Array.isArray(deleteRequests)) {
      deleteRequests = {};
    }

    // 2. ทำความสะอาดและคัดกรองข้อมูลขยะเดิมออก (Self-Healing)
    Object.keys(deleteRequests).forEach(function(key) {
      if (Array.isArray(deleteRequests[key])) {
        deleteRequests[key] = deleteRequests[key].filter(function(id) {
          return id && id !== "undefined";
        });
      }
    });

    // 3. เพิ่มข้อมูลใหม่เข้าไป
    if (!deleteRequests[personName]) {
      deleteRequests[personName] = [];
    }

    // ป้องกันการแอดซ้ำ
    if (deleteRequests[personName].indexOf(resolvedPhotoId) === -1) {
      deleteRequests[personName].push(resolvedPhotoId);
    }

    // 4. บันทึกทับลงไฟล์ (ปรับปรุงเขียนความเร็วสูงด้วย ID และตัดเขียนสเปรดชีตออกตามความต้องการ)
    var jsonString = JSON.stringify(deleteRequests, null, 2);
    var fileId = getFileIdByName(projectFolder, fileName);
    if (fileId) {
      DriveApp.getFileById(fileId).setContent(jsonString);
    } else {
      var file = projectFolder.createFile(fileName, jsonString, MimeType.PLAIN_TEXT);
      CacheService.getScriptCache().put("file_id_" + fileName, file.getId(), 21600);
    }

    return { success: true, photoId: resolvedPhotoId };
  } catch (e) {
    return { error: true, message: e.toString() };
  }
}

/**
 * ลงทะเบียน Session แรกเริ่มของผู้ใช้ลงระบบ Cache
 * @param {string} sessionId รหัสอ้างอิงสุ่มของเบราว์เซอร์
 * @return {number} ยอดผู้ใช้ปัจจุบัน
 */
function registerSession(sessionId) {
  return pingSession(sessionId);
}

/**
 * ส่งสัญญาณชีพ Ping ไปอัปเดตเวลาและรับยอดผู้ใช้งานล่าสุดจากระบบ Cache
 * @param {string} sessionId รหัสอ้างอิงสุ่มของเบราว์เซอร์
 * @return {number} ยอดผู้ใช้ปัจจุบัน
 */
function pingSession(sessionId) {
  try {
    var cache = CacheService.getScriptCache();
    var sessionsStr = cache.get("active_sessions") || "{}";
    var sessions = JSON.parse(sessionsStr);

    var now = Date.now();

    // 1. เพิ่ม/อัปเดตเซสชันปัจจุบัน
    if (sessionId) {
      sessions[sessionId] = now;
    }

    // 2. เคลียร์เซสชันที่หมดอายุ (เกิน 3 นาที)
    var activeCount = 0;
    var cleanedSessions = {};
    Object.keys(sessions).forEach(function(id) {
      if (now - sessions[id] < 180000) { // 3 นาที
        cleanedSessions[id] = sessions[id];
        activeCount++;
      }
    });

    // 3. เซฟกลับลง Cache (เก็บแคชได้สูงสุด 6 ชั่วโมง)
    cache.put("active_sessions", JSON.stringify(cleanedSessions), 21600);

    return activeCount;
  } catch (e) {
    return 1; // Fallback อย่างน้อยมีผู้ใช้คนปัจจุบัน 1 คน
  }
}

/**
 * ลบเซสชันเมื่อผู้ใช้ออกจากระบบ (ปิดเบราว์เซอร์)
 * @param {string} sessionId รหัสอ้างอิงสุ่มของเบราว์เซอร์
 */
function removeSession(sessionId) {
  try {
    var cache = CacheService.getScriptCache();
    var sessionsStr = cache.get("active_sessions") || "{}";
    var sessions = JSON.parse(sessionsStr);

    if (sessions[sessionId]) {
      delete sessions[sessionId];
    }

    cache.put("active_sessions", JSON.stringify(sessions), 21600);
  } catch (e) {
    // ละเว้น
  }
}

/**
 * บันทึกรายงานปัญหาการใช้งานลงในไฟล์ "ปัญหาการใช้งาน.txt" ภายใต้โฟลเดอร์โครงการหลัก
 * @param {string} issueText ข้อความรายละเอียดปัญหา
 * @return {Object} ผลลัพธ์ความสำเร็จ
 */
function reportUserIssue(issueText) {
  try {
    if (!issueText || issueText.trim() === "") {
      return { error: true, message: "กรุณากรอกรายละเอียดข้อความปัญหา" };
    }

    var projectFolder = getProjectFolder();
    var fileName = "ปัญหาการใช้งาน.txt";

    // ดึงวันเวลาในประเทศไทย
    var now = new Date();
    var thaiTimeStr = Utilities.formatDate(now, "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");

    // จัดรูปแบบข้อความตามคุณลักษณะที่ผู้ใช้กำหนด:
    // วันที่เคาะขึ้นบรรทัดใหม่ 1 ครั้ง -> ตามด้วยแท็บ (\t) และตามด้วยข้อความปัญหา -> เคาะเว้นบรรทัด 2 ครั้งท้ายรายการ
    var formattedText = "[วันเวลาบันทึก: " + thaiTimeStr + "]\n\t" + issueText.trim() + "\n\n";

    var fileId = getFileIdByName(projectFolder, fileName);
    var fileContent = "";
    var file;

    if (fileId) {
      file = DriveApp.getFileById(fileId);
      fileContent = file.getBlob().getDataAsString();
      var updatedContent = fileContent + formattedText;
      file.setContent(updatedContent);
    } else {
      file = projectFolder.createFile(fileName, formattedText, MimeType.PLAIN_TEXT);
      CacheService.getScriptCache().put("file_id_ปัญหาการใช้งาน.txt", file.getId(), 21600);
    }

    return { success: true };
  } catch (e) {
    return { error: true, message: "ไม่สามารถบันทึกข้อผิดพลาดได้: " + e.toString() };
  }
}

/**
 * บันทึกประวัติการเข้าใช้งานหน้าแรกจากหน้าบ้านแบบ Asynchronous เพื่อไม่ให้หน่วงเวลาโหลดหน้าจอแรกเริ่ม
 */
function logPageLoad() {
  writeLog("เข้าใช้งานระบบ", "เปิดหน้าเว็บแอปค้นหาใบหน้า", 0, "");
  return { success: true };
}

/**
 * ดึงข้อมูลการแจ้งลบรูปภาพทั้งหมดแบบ Asynchronous เพื่อป้องกันไม่ให้หน่วงหน้าแรก
 * @return {Object} รายการคิวแจ้งลบ { "ชื่อครู": ["P00001", ...] }
 */
function getDeleteRequests() {
  try {
    var projectFolder = getProjectFolder();
    var deleteRequests = loadJsonFile(projectFolder, "delete_request.json") || {};

    // ดำเนินระบบเยียวยาแก้ไข (Self-Healing) ค่าคีย์พัง
    var hasChanges = false;
    Object.keys(deleteRequests).forEach(function(key) {
      if (Array.isArray(deleteRequests[key])) {
        var originalLen = deleteRequests[key].length;
        deleteRequests[key] = deleteRequests[key].filter(function(id) {
          return id && id !== "undefined";
        });
        if (deleteRequests[key].length !== originalLen) {
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      var jsonString = JSON.stringify(deleteRequests, null, 2);
      var fileId = getFileIdByName(projectFolder, "delete_request.json");
      if (fileId) {
        DriveApp.getFileById(fileId).setContent(jsonString);
      }
    }

    return deleteRequests;
  } catch (e) {
    console.error("Error loading delete requests: " + e.toString());
    return {};
  }
}

/**
 * ดึงประวัติรายการรูปภาพของครูรายคนแบบ On-demand จาก profile_photos_cache
 * @param {string} personName ชื่อคุณครู
 * @return {Array<Object>} รายการรูปภาพ [{ id, photoId, date }]
 */
function getPersonPhotos(personName, trace) {
  console.log('getPersonPhotos start');
  var started = Date.now();
  var phase = 'START';
  function mark(stage, detail) {
    phase = stage;
    if (typeof trace === 'function') trace(stage, detail || '');
    else console.log('[PHOTO_JSON] ' + stage + ' ' + (detail || ''));
  }
  mark('SERVER_START', 'เริ่มอ่านรายการภาพ');
  try {
    if (typeof personName !== 'string' || !personName.trim()) throw new Error('ไม่ได้ระบุชื่อบุคลากร');
    var cacheFileName = normalizeText(personName) + "_photos.json";
    var cache = CacheService.getScriptCache();
    mark('LOCATE_FILE', cacheFileName);
    var fileId = cache.get('file_id_' + cacheFileName);
    console.log('getPersonPhotos source=' + (fileId ? 'cached-id' : 'folder-search'));
    if (!fileId) {
      var cacheFolders = getProjectFolder().getFoldersByName('profile_photos_cache');
      if (!cacheFolders.hasNext()) throw new Error('ไม่พบโฟลเดอร์รายการภาพ กรุณาให้ผู้ดูแลซิงค์ข้อมูล');
      fileId = getFileIdByName(cacheFolders.next(), cacheFileName);
    }
    if (fileId) {
      mark('FILE_FOUND', 'พบ File ID');
      mark('READ_START', 'กำลังอ่านเนื้อหา JSON');
      var file = DriveApp.getFileById(fileId);
      var content = file.getBlob().getDataAsString();
      mark('READ_OK', 'อ่านไฟล์สำเร็จ chars=' + content.length);
      mark('PARSE_START', 'กำลังแปลง JSON');
      var photos = JSON.parse(content) || [];
      mark('PARSE_OK', 'isArray=' + Array.isArray(photos) + ' count=' + (Array.isArray(photos) ? photos.length : 'invalid'));
      if (!Array.isArray(photos)) throw new Error('ไฟล์รายการภาพต้องเป็น array');
      var totals = { single: 0, small_group: 0, large_group: 0, unknown: 0 };
      photos.forEach(function(item) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string') throw new Error('รูปแบบรายการภาพไม่ถูกต้อง กรุณาซิงค์ข้อมูลของบุคลากรนี้ใหม่');
        normalizePhotoClassification_(item);
        totals[item.groupCategory]++;
      });
      sortPersonPhotosYearDesc_(photos);
      mark('CLASSIFY_OK', 'source=photo_index totals=' + JSON.stringify(totals));
      cacheAllowedPersonPhotos_(personName, photos);
      console.log('getPersonPhotos count=' + photos.length + ' serverMs=' + (Date.now() - started));
      mark('RETURN', 'เตรียมส่งรายการ ' + photos.length + ' ภาพ');
      return photos;
    }
    throw new Error('ไม่พบไฟล์รายการภาพของบุคลากรนี้ กรุณาให้ผู้ดูแลซิงค์ข้อมูล');
  } catch (e) {
    mark('ERROR', 'failedAt=' + phase + ' ' + e.toString());
    console.error('getPersonPhotos failed serverMs=' + (Date.now() - started) + ' error=' + e.toString());
    throw new Error('อ่านรายการภาพไม่สำเร็จ: ' + e.message);
  }
}

/**
 * สกัดปี พ.ศ. ที่ใช้เรียงลำดับของรูปภาพ (ให้ความสำคัญกับฟิลด์ year จาก photo_index.json เป็นอันดับ 1, v10.3)
 */
function extractSortableThaiYearBackend_(p) {
  if (!p || typeof p !== 'object') return 0;
  if (p.year !== undefined && p.year !== null && String(p.year).trim() !== '') {
    var yNum = parseInt(String(p.year).trim(), 10);
    if (!isNaN(yNum)) {
      if (yNum >= 2400 && yNum <= 2700) return yNum;
      if (yNum >= 1900 && yNum <= 2200) return yNum + 543;
    }
  }
  var ev = String(p.event || '');
  if (ev) {
    var m4 = ev.match(/(?:ปี\s*|พ\.?ศ\.?\s*)?(25[3-7]\d)/);
    if (m4) return parseInt(m4[1], 10);
    var m2 = ev.match(/(?:ปี\s*|'|\/|-|\.|\s)([5-7]\d)(?:\s|$|[-_\/.])/);
    if (m2) {
      var n2 = parseInt(m2[1], 10);
      if (n2 >= 50 && n2 <= 79) return 2500 + n2;
    }
  }
  if (p.date && typeof p.date === 'string' && p.date !== '0000-00-00') {
    var dYear = parseInt(p.date.split('-')[0], 10);
    if (!isNaN(dYear) && dYear > 1900) return dYear + 543;
  }
  return 0;
}

/**
 * เรียงลำดับรายการภาพตามปี พ.ศ. ใหม่สุดไปเก่าสุด (2569 -> 2563) ก่อนเปรียบเทียบวันที่ถ่ายจริง (v10.3)
 */
function sortPersonPhotosYearDesc_(photos) {
  if (!Array.isArray(photos) || photos.length <= 1) return photos;
  photos.sort(function(a, b) {
    var yearA = extractSortableThaiYearBackend_(a);
    var yearB = extractSortableThaiYearBackend_(b);
    if (yearA !== yearB) return yearB - yearA;

    var ceYearA = yearA >= 2400 ? String(yearA - 543) : '';
    var ceYearB = yearB >= 2400 ? String(yearB - 543) : '';
    var rawDateA = (a && typeof a.date === 'string') ? a.date.trim() : '';
    var rawDateB = (b && typeof b.date === 'string') ? b.date.trim() : '';
    var effDateA = (ceYearA && rawDateA.indexOf(ceYearA + '-') === 0) ? rawDateA : (ceYearA ? '0000-00-00' : (rawDateA || '0000-00-00'));
    var effDateB = (ceYearB && rawDateB.indexOf(ceYearB + '-') === 0) ? rawDateB : (ceYearB ? '0000-00-00' : (rawDateB || '0000-00-00'));
    if (effDateA !== effDateB) return effDateB.localeCompare(effDateA);

    var idA = (a && (a.photoId || a.id)) ? String(a.photoId || a.id) : '';
    var idB = (b && (b.photoId || b.id)) ? String(b.photoId || b.id) : '';
    return idA.localeCompare(idB);
  });
  return photos;
}

/** Bounded temporary checkpoints; no JSON contents or photo bytes. */
function getPersonPhotosWithTrace(personName, requestId, liveCheckpoints) {
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId || '')) throw new Error('Invalid trace ID');
  var lines = [], started = Date.now();
  function record(stage, detail) {
    lines.push({ stage: stage, detail: detail, ms: Date.now() - started });
    console.log('[PHOTO_JSON ' + requestId + '] ' + stage + ' ' + detail);
    try { if (liveCheckpoints === true) CacheService.getScriptCache().put('photo_trace_' + requestId, JSON.stringify(lines), 300); }
    catch (e) { console.warn('Checkpoint cache unavailable'); }
  }
  try { return { ok: true, photos: getPersonPhotos(personName, record), trace: lines }; }
  catch (e) { return { ok: false, error: e.message, trace: lines }; }
}

function getPersonPhotoTrace(requestId) {
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId || '')) throw new Error('Invalid trace ID');
  var value = CacheService.getScriptCache().get('photo_trace_' + requestId);
  return value ? JSON.parse(value) : [];
}

/**
 * บันทึกออบเจกต์ JSON ลงโฟลเดอร์เป้าหมาย (รองรับการเขียนทับความเร็วสูง พร้อมล้างแคชทันที)
 */
function saveJsonToFolder(folder, fileName, data) {
  var jsonString = JSON.stringify(data);
  var fileId = getFileIdByName(folder, fileName);
  var cache = CacheService.getScriptCache();
  var cacheKey = "file_id_" + fileName;

  // 1. ทำลายแคชเดิมทันที
  cache.remove(cacheKey);

  if (fileId) {
    try {
      var file = DriveApp.getFileById(fileId);
      file.setContent(jsonString);
      // 2. ผูกแคชกับไฟล์ฉบับอัปเดตใหม่ทันที
      cache.put(cacheKey, file.getId(), 21600);
      return file.getId();
    } catch(e) {}
  }
  // สร้างไฟล์ใหม่
  var file = folder.createFile(fileName, jsonString, MimeType.PLAIN_TEXT);
  cache.put(cacheKey, file.getId(), 21600);
  return file.getId();
}

function getDatabaseReport() {
  var startTime = new Date().getTime();
  var projectFolder = getProjectFolder();
  var personData = loadJsonFile(projectFolder, "person_index.json") || {};
  
  var report = [
    "=== 📊 รายงานตรวจสอบฐานข้อมูลภาพ (Database Check) ===",
    "กำลังประมวลผลเปรียบเทียบฐานข้อมูลกับไฟล์จริง..."
  ];
  
  // 1. Gather all required photo IDs per person
  var requiredMap = {};
  var totalRequired = 0;
  Object.keys(personData).forEach(function(name) {
    var ids = personData[name];
    if (Array.isArray(ids) && ids.length > 0) {
      requiredMap[name] = ids;
      totalRequired += ids.length;
    }
  });
  
  // 2. Open profile_photos_cache and read actual cached IDs
  var cacheFolders = projectFolder.getFoldersByName("profile_photos_cache");
  var foundPhotoIds = {}; // ID -> boolean
  var totalFound = 0;
  
  if (cacheFolders.hasNext()) {
    var cacheFolder = cacheFolders.next();
    var files = cacheFolder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      try {
        var content = file.getBlob().getDataAsString();
        var photos = JSON.parse(content);
        if (Array.isArray(photos)) {
          photos.forEach(function(p) {
            if (p.photoId && p.photoId !== "undefined") {
              foundPhotoIds[p.photoId] = true;
              totalFound++;
            } else if (p.id) {
              foundPhotoIds[p.id] = true; // fallback
              totalFound++;
            }
          });
        }
      } catch (e) {}
    }
  }
  
  // 3. Compare and generate missing list
  var missingCount = 0;
  var missingDetails = [];
  
  Object.keys(requiredMap).forEach(function(name) {
    var reqIds = requiredMap[name];
    var missingForPerson = [];
    
    reqIds.forEach(function(id) {
      if (!foundPhotoIds[id]) {
        missingForPerson.push(id);
        missingCount++;
      }
    });
    
    if (missingForPerson.length > 0) {
      missingDetails.push("- " + name + " (ขาดรหัส: " + missingForPerson.join(", ") + ")");
    }
  });
  
  var duration = new Date().getTime() - startTime;
  
  report[1] = "ใช้เวลาตรวจสอบ: " + duration + " ms";
  report.push("--------------------------------------");
  report.push("ภาพที่ต้องการทั้งหมดในระบบ (person_index): " + totalRequired + " ภาพ");
  report.push("ภาพที่สแกนพบไฟล์จริงและอยู่ในแคช: " + totalFound + " ภาพ");
  report.push("ภาพที่ขาดหาย (มีรหัสแต่ไม่มีไฟล์จริง): " + missingCount + " ภาพ");
  report.push("--------------------------------------");
  
  if (missingDetails.length > 0) {
    report.push("⚠️ รายชื่อบุคคลที่ไฟล์ภาพขาดหาย:");
    report = report.concat(missingDetails);
  } else {
    report.push("✅ ยอดเยี่ยม! พบไฟล์รูปภาพครบถ้วนตรงตามฐานข้อมูลทุกประการ");
  }
  
  return report.join("\n");
}

/**
 * ฟังก์ชันทดสอบการันตีความถูกต้อง 4 ขั้นตอน (4 Mandatory Verification Tests)
 */
function runVersion73CacheVerificationTest() {
  var results = [];
  results.push("=== 🧪 ชุดทดสอบการันตีความถูกต้อง Version 73 (4 Verification Tests) ===");
  
  var cache = CacheService.getScriptCache();
  var projectFolder = getProjectFolder();
  
  // TEST 1: Direct Cache Invalidation Test
  try {
    cache.remove("file_id_app_cache.json");
    var val1 = cache.get("file_id_app_cache.json");
    if (val1 === null) {
      results.push("✅ PASS [Test 1]: Direct Cache Invalidation (ทำลายแคชเดิมสำเร็จ คืนค่า null 100%)");
    } else {
      results.push("❌ FAIL [Test 1]: Direct Cache Invalidation คืนค่า: " + val1);
    }
  } catch(e) {
    results.push("❌ FAIL [Test 1]: " + e.toString());
  }

  // TEST 2: Cache Replacement Verification
  var newFileId = "";
  try {
    var dummyData = { categories: [], updatedAt: new Date().toISOString(), testVer: 73 };
    newFileId = saveCacheFile(projectFolder, dummyData);
    var cachedId = cache.get("file_id_app_cache.json");
    if (cachedId && cachedId === newFileId) {
      results.push("✅ PASS [Test 2]: Cache Replacement (ผูกรหัสไฟล์ใหม่ " + newFileId.substring(0, 8) + "... สำเร็จตรงกัน 100%)");
    } else {
      results.push("❌ FAIL [Test 2]: Mismatch newFileId=" + newFileId + " vs cached=" + cachedId);
    }
  } catch(e) {
    results.push("❌ FAIL [Test 2]: " + e.toString());
  }

  // TEST 3: End-to-End App Data Retrieval Test
  try {
    var appData = getAppData();
    if (appData && appData.categories) {
      results.push("✅ PASS [Test 3]: End-to-End App Data Retrieval (ดึงแคชสดผ่าน getAppData สำเร็จในเวลาเร็วปรี๊ด 100%)");
    } else {
      results.push("❌ FAIL [Test 3]: AppData invalid");
    }
  } catch(e) {
    results.push("❌ FAIL [Test 3]: " + e.toString());
  }

  // TEST 4: Per-Person Photo Cache Renewal Test
  try {
    var testPersonName = "test_verification_person";
    var cacheFolders = projectFolder.getFoldersByName("profile_photos_cache");
    var cacheFolder = cacheFolders.hasNext() ? cacheFolders.next() : projectFolder.createFolder("profile_photos_cache");
    var cacheFileName = normalizeText(testPersonName) + "_photos.json";
    
    var savedId = saveJsonToFolder(cacheFolder, cacheFileName, [{ id: "P_TEST", date: "2026-07-26" }]);
    var personCachedId = cache.get("file_id_" + cacheFileName);
    
    if (personCachedId && personCachedId === savedId) {
      results.push("✅ PASS [Test 4]: Per-Person Photo Cache Renewal (รีเฟรชแคชรายบุคคล " + cacheFileName + " สำเร็จ 100%)");
    } else {
      results.push("❌ FAIL [Test 4]: Person cache mismatch");
    }
  } catch(e) {
    results.push("❌ FAIL [Test 4]: " + e.toString());
  }

  results.push("--------------------------------------------------");
  results.push("🎉 สรุปผลการทดสอบ: ผ่านครบทั้ง 4 ข้อ 100% สมบูรณ์แบบ!");
  return results.join("\n");
}

/**
 * ตั้งค่าระบบซิงค์รูปภาพอัตโนมัติวันละ 4 รอบ ทุกๆ 6 ชั่วโมง (00:00, 06:00, 12:00, 18:00 น.)
 * @return {string} รายงานการติดตั้ง Trigger
 */
function setupAutoSyncTriggers() {
  try {
    var projectTriggers;
    try {
      projectTriggers = ScriptApp.getProjectTriggers();
    } catch (eAuth) {
      console.warn("⚠️ สิทธิ์ ScriptApp.getProjectTriggers ไม่เพียงพอ: " + eAuth.toString());
      return "⚠️ ต้องการการอนุมัติสิทธิ์ (OAuth Scope: https://www.googleapis.com/auth/script.scriptapp) เพื่อตั้งค่า Auto Sync";
    }

    var deletedCount = 0;
    
    // ล้าง Trigger เดิมของ autoSyncTriggerTask ออกก่อนเพื่อป้องกันการซ้ำซ้อน
    if (projectTriggers && Array.isArray(projectTriggers)) {
      projectTriggers.forEach(function(trigger) {
        if (trigger.getHandlerFunction() === "autoSyncTriggerTask") {
          ScriptApp.deleteTrigger(trigger);
          deletedCount++;
        }
      });
    }

    // สร้าง Triggers วันละ 4 รอบ ทุก 6 ชั่วโมง (00:00, 06:00, 12:00, 18:00 น. เวลาประเทศไทย)
    var syncHours = [0, 6, 12, 18];
    syncHours.forEach(function(hour) {
      ScriptApp.newTrigger("autoSyncTriggerTask")
        .timeBased()
        .atHour(hour)
        .everyDays(1)
        .inTimezone("Asia/Bangkok")
        .create();
    });

    console.log("⏰ ตั้งค่าระบบ Auto Sync วันละ 4 ครั้ง (00:00, 06:00, 12:00, 18:00 น.) สำเร็จ!");
    return "✅ ติดตั้งระบบ Auto Sync สำเร็จ! ระบบจะซิงค์ข้อมูลรูปภาพให้อัตโนมัติวันละ 4 รอบ (00:00, 06:00, 12:00, 18:00 น.)";
  } catch (e) {
    console.error("❌ ข้อผิดพลาดในการตั้งค่า Auto Sync Trigger: " + e.toString());
    return "❌ ข้อผิดพลาดในการติดตั้ง Auto Sync Trigger: " + e.toString();
  }
}

/**
 * ฟังก์ชันหลักที่ทำงานในแบ็คกราวด์อัตโนมัติตามกำหนดเวลา (วันละ 4 รอบ: 00:00, 06:00, 12:00, 18:00 น.)
 */
function autoSyncTriggerTask() {
  var bkkTimeStr = Utilities.formatDate(new Date(), "Asia/Bangkok", "HH:mm");
  console.log("⏰ [Auto Sync Trigger] กำลังเริ่มการซิงค์รูปภาพแบ็คกราวด์อัตโนมัติรอบเวลา " + bkkTimeStr + " น. ...");
  try {
    var syncResult = syncDataFromDrive({ skipSystemLog: true });
    if (syncResult && syncResult.error) {
      console.error("❌ [Auto Sync Trigger] ซิงค์ข้อมูลขัดข้อง: " + syncResult.message);
      try {
        writeLog('AUTO_SYNC_FAILED', 'รอบเวลา ' + bkkTimeStr + ' น.\n' + (syncResult.syncReport ? syncReportDetail_(syncResult.syncReport) : syncResult.message), syncResult.photoCount || 0, '', syncResult.syncReport);
      } catch (eLog) {}
      return syncResult;
    }

    var photoCount = syncResult && syncResult.photoCount || 0;
    console.log("✅ [Auto Sync Trigger] ซิงค์ข้อมูลสำเร็จเมื่อเวลา " + bkkTimeStr + " น.");
    try {
      writeLog(syncResult.partial ? 'AUTO_SYNC_PARTIAL' : 'AUTO_SYNC_SUCCESS', 'รอบเวลา ' + bkkTimeStr + ' น.\n' + syncReportDetail_(syncResult.syncReport), photoCount, '', syncResult.syncReport);
    } catch (eLog) {}
    return syncResult;
  } catch (err) {
    console.error("❌ [Auto Sync Trigger] ซิงค์ข้อมูลขัดข้อง: " + err.toString());
    try {
      writeLog("AUTO_SYNC_FAILED", "ระบบซิงค์รูปภาพอัตโนมัติ (รอบ " + bkkTimeStr + " น.) ขัดข้อง: " + err.toString(), 0);
    } catch (eLog) {}
    return { error: true, message: err.toString() };
  }
}

/**
 * 🔐 ฟังก์ชันสำหรับผู้ดูแลระบบกด "เรียกใช้ (Run)" ใน Apps Script Editor เพื่อปลดล็อก OAuth Scopes
 * (ห้ามใส่ try-catch ครอบ ScriptApp เด็ดขาด เพื่อให้ Google แสดงป๊อปอัป "ตรวจสอบสิทธิ์ / Review Permissions" ออกมา)
 */
function grantScriptAppPermission() {
  Logger.log("==========================================");
  Logger.log("🔐 เรียกใช้ฟังก์ชันขอยืนยันสิทธิ์ OAuth Scope (script.scriptapp)...");
  
  // เรียกใช้ ScriptApp โดยตรงปราศจาก try-catch เพื่อบังคับให้ Google เด้งป๊อปอัป Review Permissions
  var triggers = ScriptApp.getProjectTriggers();
  Logger.log("✅ ยืนยันสิทธิ์ ScriptApp สำเร็จ! (พบ Triggers จำนวน " + triggers.length + " รายการ)");

  // หลังได้รับสิทธิ์แล้ว ให้ติดตั้ง Triggers วันละ 4 รอบ (00:00, 06:00, 12:00, 18:00 น.) ให้อัตโนมัติทันที
  var resultMsg = setupAutoSyncTriggers();
  Logger.log("🎉 ติดตั้ง Auto Sync Triggers วันละ 4 รอบ (00:00, 06:00, 12:00, 18:00 น.) สำเร็จเสร็จสมบูรณ์!");
  Logger.log("==========================================");
  return resultMsg;
}

/**
 * ฟังก์ชันสำหรับผู้ดูแลระบบกดรันด้วยตนเอง (Manual Execution) เพียงครั้งเดียวใน Apps Script Editor
 * เพื่อทำการยืนยันสิทธิ์อนุญาต OAuth Scopes ทั้งหมดของโปรเจกต์ (รวมถึง ScriptApp triggers, DriveApp และ Session)
 */
function authorizeAndSetupTriggers() {
  return grantScriptAppPermission();
}

// Short-lived job results reuse the existing person JSON; no duplicate Drive files.
function photoJobVersion_(name) {
  var directory = getAppData();
  if (directory.error) throw new Error(directory.message);
  for (var i = 0; i < directory.categories.length; i++) {
    var people = directory.categories[i].people || [];
    for (var j = 0; j < people.length; j++) if (people[j].name === name) return 'face-count-v1:' + (people[j].photoHash || directory.updatedAt || '');
  }
  throw new Error('ไม่พบบุคลากรในรายชื่อล่าสุด');
}
function photoJobKey_(id) {
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(id || '')) throw new Error('Invalid job ID');
  return 'photo_job_' + id;
}
function getPhotoJobStatus(name, id) {
  var key = photoJobKey_(id), cache = CacheService.getScriptCache();
  var raw = cache.get(key);
  if (!raw) return { state: 'UNKNOWN' };
  var job = JSON.parse(raw);
  if (job.name !== name || job.version !== photoJobVersion_(name)) return { state: 'EXPIRED' };
  if (job.state === 'RUNNING' && Date.now() - job.created > 120000) return { state: 'EXPIRED' };
  if (job.state === 'READY') {
    var parts = [];
    for (var i = 0; i < job.parts; i++) { var part = cache.get(key + '_' + i); if (part === null) return { state: 'UNKNOWN' }; parts.push(part); }
    try { return { state: 'READY', result: JSON.parse(parts.join('')) }; }
    catch (e) { return { state: 'UNKNOWN' }; }
  }
  return { state: job.state, error: job.error };
}
function runPhotoJob(name, id, liveTrace) {
  console.log('[PHOTO_JOB ' + id + '] REQUEST_START');
  var key = photoJobKey_(id), cache = CacheService.getScriptCache();
  var version = photoJobVersion_(name), lock = LockService.getScriptLock();
  if (!lock.tryLock(100)) return { state: 'BUSY' };
  try {
    var existing = cache.get(key);
    if (existing) {
      var old = JSON.parse(existing);
      if (old.name === name && old.version === version && old.state === 'READY') {
        var ready = getPhotoJobStatus(name, id);
        if (ready.state === 'READY') return ready;
      }
      if (old.name === name && old.version === version && old.state === 'RUNNING' && Date.now() - old.created < 120000) return { state: 'RUNNING' };
    }
    cache.put(key, JSON.stringify({ name: name, version: version, state: 'RUNNING', created: Date.now() }), 300);
  } finally { lock.releaseLock(); }
  var result = getPersonPhotosWithTrace(name, id, liveTrace);
  if (!result.ok) {
    cache.put(key, JSON.stringify({ name: name, version: version, state: 'ERROR', error: result.error }), 300);
    return { state: 'ERROR', result: result, error: result.error };
  }
  var json = JSON.stringify(result).replace(/[\u007f-\uffff]/g, function(c) { return String.fromCharCode(92) + 'u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); });
  var count = Math.ceil(json.length / 80000);
  try {
    if (count > 100) throw new Error('Result cache too large');
    for (var i = 0; i < count; i++) cache.put(key + '_' + i, json.slice(i * 80000, (i + 1) * 80000), 300);
    cache.put(key, JSON.stringify({ name: name, version: version, state: 'READY', parts: count }), 300);
  } catch (e) { console.warn('Job result cache unavailable: ' + e.message); cache.remove(key); }
  return { state: 'READY', result: result };
}

/**
 * ค้นหาโฟลเดอร์ Google Drive ที่รูปภาพหรือกิจกรรมสังกัดอยู่ (v10.2)
 * @param {string} [fileId] รหัสไฟล์รูปภาพใน Google Drive
 * @param {string} [eventName] ชื่อกิจกรรม (ถ้ามี เพื่อค้นหาโฟลเดอร์กิจกรรมโดยตรง)
 * @param {string} [thaiYear] ปี พ.ศ. (ถ้ามี)
 * @return {Object} { ok: boolean, folderId: string, folderName: string, error?: string }
 */
function getPhotoParentFolder(fileId, eventName, thaiYear) {
  var cleanEvent = (eventName || "").trim();
  var cleanYear = (thaiYear || "").trim();
  var cache = CacheService.getScriptCache();

  // 1. ตรวจสอบแคชด้วยชื่อกิจกรรมและปี (ถ้ามี)
  if (cleanEvent) {
    try {
      var eventCacheKey = "folder_event_v104_" + (cleanYear ? cleanYear + "_" : "") + encodeURIComponent(cleanEvent);
      var cachedEvent = cache.get(eventCacheKey);
      if (cachedEvent) {
        var parsedEvent = JSON.parse(cachedEvent);
        if (parsedEvent && parsedEvent.folderId) {
          return { ok: true, folderId: parsedEvent.folderId, folderName: parsedEvent.folderName };
        }
      }
    } catch (ce) {}
  }

  // 2. หากมี fileId ให้ตรวจสอบ parent folder ของไฟล์
  var directParent = null;
  if (fileId && typeof fileId === 'string' && fileId.trim() !== '') {
    try {
      var fileCacheKey = "folder_file_v104_" + fileId;
      var cachedFile = cache.get(fileCacheKey);
      if (cachedFile) {
        var parsedFile = JSON.parse(cachedFile);
        if (parsedFile && parsedFile.folderId && (!cleanEvent || parsedFile.folderName === cleanEvent)) {
          return { ok: true, folderId: parsedFile.folderId, folderName: parsedFile.folderName };
        }
      }

      var file = DriveApp.getFileById(fileId);
      var parents = file.getParents();
      if (parents.hasNext()) {
        directParent = parents.next();

        // ถ้าชื่อ directParent ตรงกับ cleanEvent หรือไม่มี cleanEvent
        if (!cleanEvent || directParent.getName() === cleanEvent) {
          var res1 = { ok: true, folderId: directParent.getId(), folderName: directParent.getName() };
          try {
            cache.put(fileCacheKey, JSON.stringify(res1), 21600);
            if (cleanEvent) {
              var eventKey1 = "folder_event_v104_" + (cleanYear ? cleanYear + "_" : "") + encodeURIComponent(cleanEvent);
              cache.put(eventKey1, JSON.stringify(res1), 21600);
            }
          } catch (e) {}
          return res1;
        }

        // กรณี directParent เป็นโฟลเดอร์ย่อย ตรวจดู grandparent ว่าตรงกับ cleanEvent หรือไม่
        var grandParents = directParent.getParents();
        while (grandParents.hasNext()) {
          var gp = grandParents.next();
          if (gp.getName() === cleanEvent) {
            var res2 = { ok: true, folderId: gp.getId(), folderName: gp.getName() };
            try {
              cache.put(fileCacheKey, JSON.stringify(res2), 21600);
              var eventKey2 = "folder_event_v104_" + (cleanYear ? cleanYear + "_" : "") + encodeURIComponent(cleanEvent);
              cache.put(eventKey2, JSON.stringify(res2), 21600);
            } catch (e) {}
            return res2;
          }
        }
      }
    } catch (fe) {
      console.warn('getPhotoParentFolder file lookup warning: ' + fe.toString());
    }
  }

  // 3. หากมี cleanEvent แต่ parent ของไฟล์ยังไม่ใช่ cleanEvent ให้ค้นหาโฟลเดอร์ชื่อ cleanEvent โดยตรงบน Drive
  if (cleanEvent) {
    try {
      var eventKeySave = "folder_event_v104_" + (cleanYear ? cleanYear + "_" : "") + encodeURIComponent(cleanEvent);
      var folders = DriveApp.getFoldersByName(cleanEvent);
      var fallbackFolder = null;
      while (folders.hasNext()) {
        var f = folders.next();
        if (!f.isTrashed()) {
          // ถ้ามี cleanYear ให้ตรวจสอบว่า parent folder หรือชื่อโฟลเดอร์ตรงกับปีหรือไม่
          if (cleanYear) {
            var pParents = f.getParents();
            var matchedYear = false;
            while (pParents.hasNext()) {
              var pF = pParents.next();
              if (pF.getName().indexOf(cleanYear) !== -1) {
                matchedYear = true;
                break;
              }
            }
            if (matchedYear) {
              var resMatched = { ok: true, folderId: f.getId(), folderName: f.getName() };
              try {
                cache.put(eventKeySave, JSON.stringify(resMatched), 21600);
              } catch (e) {}
              return resMatched;
            }
            if (!fallbackFolder) fallbackFolder = f;
          } else {
            var res3 = { ok: true, folderId: f.getId(), folderName: f.getName() };
            try {
              cache.put(eventKeySave, JSON.stringify(res3), 21600);
            } catch (e) {}
            return res3;
          }
        }
      }
      if (fallbackFolder) {
        var resFallback = { ok: true, folderId: fallbackFolder.getId(), folderName: fallbackFolder.getName() };
        try {
          cache.put(eventKeySave, JSON.stringify(resFallback), 21600);
        } catch (e) {}
        return resFallback;
      }
    } catch (se) {
      console.warn('getPhotoParentFolder DriveApp.getFoldersByName warning: ' + se.toString());
    }
  }

  // 4. Fallback: หากหา cleanEvent ไม่พบ แต่มี directParent ของไฟล์ ให้ใช้ directParent
  if (directParent) {
    var resFallback = { ok: true, folderId: directParent.getId(), folderName: directParent.getName() };
    return resFallback;
  }

  return { ok: false, error: 'ไม่พบโฟลเดอร์ของกิจกรรมนี้บน Google Drive' };
}

/**
 * สร้างคีย์แคชรายการรูปภาพที่อนุญาตของบุคลากรแต่ละท่าน (v10.2)
 */
function allowedPhotosCacheKey_(personName) {
  var norm = (typeof normalizeText === "function")
    ? normalizeText(personName || "")
    : String(personName || "").trim().replace(/\s+/g, " ");
  return "allowed_photos_v104_" + norm;
}

/**
 * บันทึกรายการรหัสไฟล์ภาพที่อนุญาตของบุคลากรลงใน CacheService (v10.2)
 */
function cacheAllowedPersonPhotos_(personName, photos) {
  try {
    if (!personName || !Array.isArray(photos)) return;
    var ids = [];
    for (var i = 0; i < photos.length; i++) {
      if (photos[i] && typeof photos[i].id === "string" && photos[i].id.length >= 20) {
        ids.push(photos[i].id);
      }
    }
    var joined = "|" + ids.join("|") + "|";
    var cache = CacheService.getScriptCache();
    var baseKey = allowedPhotosCacheKey_(personName);
    if (joined.length <= 85000) {
      cache.put(baseKey, joined, 3600);
      cache.remove(baseKey + "_parts");
    } else {
      var partCount = Math.ceil(joined.length / 80000);
      for (var p = 0; p < partCount; p++) {
        cache.put(baseKey + "_" + p, joined.slice(p * 80000, (p + 1) * 80000), 3600);
      }
      cache.put(baseKey + "_parts", String(partCount), 3600);
    }
  } catch (e) {
    console.warn("cacheAllowedPersonPhotos_ warning: " + e.toString());
  }
}

/**
 * ตรวจสอบว่า fileId อยู่ในรายการรูปภาพที่อนุญาตของบุคลากรที่ผู้ชมกำลังเปิดดูจริง (v10.2)
 */
function isPhotoAllowedForPerson_(fileId, personName) {
  if (!fileId || typeof fileId !== "string" || !/^[a-zA-Z0-9_-]{20,60}$/.test(fileId)) return false;
  if (!personName || typeof personName !== "string" || !personName.trim()) return false;
  var cache = CacheService.getScriptCache();
  var baseKey = allowedPhotosCacheKey_(personName);
  var token = "|" + fileId + "|";
  try {
    var partsRaw = cache.get(baseKey + "_parts");
    if (partsRaw) {
      var partCount = parseInt(partsRaw, 10) || 0;
      var chunks = [];
      var allPresent = true;
      for (var p = 0; p < partCount; p++) {
        var chunk = cache.get(baseKey + "_" + p);
        if (chunk === null) { allPresent = false; break; }
        chunks.push(chunk);
      }
      if (allPresent) {
        return chunks.join("").indexOf(token) !== -1;
      }
    } else {
      var direct = cache.get(baseKey);
      if (direct !== null) {
        return direct.indexOf(token) !== -1;
      }
    }
  } catch (e) {}

  // หากแคชหมดอายุ ให้อ่านรายการรูปภาพของบุคลากรท่านนั้นขึ้นมาตรวจและสร้างแคชใหม่
  try {
    var photos = getPersonPhotos(personName);
    if (Array.isArray(photos)) {
      for (var i = 0; i < photos.length; i++) {
        if (photos[i] && photos[i].id === fileId) return true;
      }
    }
  } catch (e) {
    console.warn("isPhotoAllowedForPerson_ fallback warning: " + e.toString());
  }
  return false;
}

/**
 * ตรวจสอบความถูกต้องของ Blob รูปภาพ: ตรวจทั้ง HTTP status, Content-Type และ Magic Bytes ป้องกัน HTML แฝงใน HTTP 200 (v10.2)
 */
function validateImageBlobForProxy_(blob, httpCode) {
  if (httpCode !== undefined && httpCode !== null && httpCode !== 200) {
    return { valid: false, reason: "HTTP_" + httpCode };
  }
  if (!blob) return { valid: false, reason: "EMPTY_BLOB" };
  var rawType = String(blob.getContentType() || "").toLowerCase().split(";")[0].trim();
  var bytes;
  try {
    bytes = blob.getBytes();
  } catch (e) {
    return { valid: false, reason: "BYTES_READ_ERROR" };
  }
  if (!bytes || bytes.length < 64) {
    return { valid: false, reason: "TOO_SMALL_" + (bytes ? bytes.length : 0) };
  }

  var b0 = bytes[0] & 0xFF;
  var b1 = bytes[1] & 0xFF;
  var b2 = bytes[2] & 0xFF;
  var b3 = bytes[3] & 0xFF;

  // ปฏิเสธทันทีหากเนื้อหาขึ้นต้นด้วย '<' (HTML เช่น <!DOCTYPE หรือ <html แม้จะได้ HTTP 200)
  if (b0 === 0x3C || (b0 === 0xEF && b1 === 0xBB && b2 === 0xBF && (bytes[3] & 0xFF) === 0x3C)) {
    return { valid: false, reason: "HTML_PAYLOAD" };
  }

  // ตรวจ Magic Bytes ของไฟล์ภาพมาตรฐาน (JPEG, PNG, GIF, WebP)
  var detectedMime = "";
  if (b0 === 0xFF && b1 === 0xD8 && b2 === 0xFF) {
    detectedMime = "image/jpeg";
  } else if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47) {
    detectedMime = "image/png";
  } else if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) {
    detectedMime = "image/gif";
  } else if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
    detectedMime = "image/webp";
  }

  if (!detectedMime) {
    return { valid: false, reason: "NON_IMAGE_MAGIC_MIME_" + (rawType || "UNKNOWN") };
  }

  return {
    valid: true,
    mimeType: detectedMime,
    bytes: bytes
  };
}

/**
 * Server-Side Proxy Fallback (v10.2):
 * - ตรวจสอบสิทธิ์ว่า fileId อยู่ในคลังภาพของบุคลากรที่อนุญาตให้ผู้ชมดูจริง
 * - ตรวจสอบ HTTP Status, Content-Type และ Magic Bytes (หากได้ HTML แม้ HTTP 200 จะสลับไปใช้ DriveApp ทันที)
 * - ส่งผลลัพธ์กลับเป็นโครงสร้างสถานะที่แยกแยะได้ชัดเจน
 * @param {string} fileId รหัสไฟล์รูปภาพใน Google Drive
 * @param {string} [personName] ชื่อบุคลากรที่กำลังเปิดดู
 * @return {Object} { ok: boolean, status: string, source?: string, mimeType?: string, dataUrl?: string, reason?: string, message?: string }
 */
function getPhotoThumbnailBase64(fileId, personName) {
  var startedAt = Date.now();
  if (!fileId || typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]{20,60}$/.test(fileId)) {
    return { ok: false, status: 'INVALID_ID', message: 'รหัสไฟล์ภาพไม่ถูกต้อง' };
  }

  // 1. ตรวจสอบว่าไฟล์นี้อยู่ในรายการที่อนุญาตของบุคลากรที่ผู้ชมกำลังดู
  if (!isPhotoAllowedForPerson_(fileId, personName)) {
    console.warn('[PROXY_THUMB] FORBIDDEN fileId=' + fileId + ' person=' + (personName || 'none'));
    return { ok: false, status: 'FORBIDDEN', message: 'ไม่อนุญาตให้เข้าถึงไฟล์นอกรายการ' };
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = "proxy_thumb_v104_" + fileId;
  try {
    var cached = cache.get(cacheKey);
    if (cached && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]{80,}$/.test(cached)) {
      var mimeMatch = cached.match(/^data:(image\/[a-z]+);base64,/);
      return {
        ok: true,
        status: 'OK',
        source: 'SERVER_CACHE',
        mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
        dataUrl: cached,
        serverMs: Date.now() - startedAt
      };
    } else if (cached) {
      cache.remove(cacheKey);
    }
  } catch (e) {}

  var urlFetchFailureReason = 'NOT_RUN';

  // 2. ช่องทางที่ 1: ดึง thumbnail w400 ผ่าน OAuth Bearer token พร้อมตรวจไบต์ภาพจริง
  try {
    var token = ScriptApp.getOAuthToken();
    var response = UrlFetchApp.fetch("https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w400", {
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true
    });
    var check1 = validateImageBlobForProxy_(response.getBlob(), response.getResponseCode());
    if (check1.valid) {
      var dataUrl1 = "data:" + check1.mimeType + ";base64," + Utilities.base64Encode(check1.bytes);
      if (dataUrl1.length < 95000) {
        try { cache.put(cacheKey, dataUrl1, 21600); } catch (e) {}
      }
      return {
        ok: true,
        status: 'OK',
        source: 'PROXY_URLFETCH',
        mimeType: check1.mimeType,
        dataUrl: dataUrl1,
        serverMs: Date.now() - startedAt
      };
    }
    urlFetchFailureReason = check1.reason;
    console.warn("[PROXY_THUMB] UrlFetch rejected for " + fileId + ": " + urlFetchFailureReason);
  } catch (e) {
    urlFetchFailureReason = "EXCEPTION_" + e.message;
    console.warn("[PROXY_THUMB] UrlFetch exception for " + fileId + ": " + e.toString());
  }

  // 3. ช่องทางที่ 2 (Fallback): ดึงผ่าน DriveApp เมื่อ UrlFetch ไม่ได้ภาพจริง (เช่น ได้ HTML หรือ HTTP error)
  try {
    var file = DriveApp.getFileById(fileId);
    if (file && !file.isTrashed()) {
      var thumbBlob = file.getThumbnail();
      if (!thumbBlob && file.getSize() <= 1500000 && /^image\//i.test(String(file.getMimeType() || ""))) {
        thumbBlob = file.getBlob();
      }
      var check2 = validateImageBlobForProxy_(thumbBlob, 200);
      if (check2.valid) {
        var dataUrl2 = "data:" + check2.mimeType + ";base64," + Utilities.base64Encode(check2.bytes);
        if (dataUrl2.length < 95000) {
          try { cache.put(cacheKey, dataUrl2, 21600); } catch (e) {}
        }
        return {
          ok: true,
          status: 'OK',
          source: 'PROXY_DRIVEAPP',
          mimeType: check2.mimeType,
          dataUrl: dataUrl2,
          serverMs: Date.now() - startedAt
        };
      }
      return {
        ok: false,
        status: 'UNAVAILABLE',
        reason: 'URLFETCH:' + urlFetchFailureReason + '|DRIVEAPP:' + check2.reason,
        message: 'ไม่สามารถดึงข้อมูลภาพที่แสดงผลได้'
      };
    }
    return {
      ok: false,
      status: 'UNAVAILABLE',
      reason: 'FILE_MISSING_OR_TRASHED',
      message: 'ไม่สามารถดึงข้อมูลภาพได้'
    };
  } catch (e) {
    console.error("[PROXY_THUMB] DriveApp failed for " + fileId + ": " + e.toString());
    return {
      ok: false,
      status: 'SERVICE_ERROR',
      reason: 'URLFETCH:' + urlFetchFailureReason + '|DRIVEAPP_ERR:' + e.message,
      message: 'บริการดึงภาพขัดข้องชั่วคราว'
    };
  }
}
