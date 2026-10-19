/** Persistent small avatar snapshots. Startup reads prepared bytes, never creates them. */
function avatarImagesFromManifest_(manifest) {
  var images = {};
  Object.keys(manifest.entries || {}).forEach(function(id) {
    var image = manifest.entries[id].image;
    if (typeof image === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/.test(image)) images[id] = image;
  });
  return images;
}

function cachePreparedAvatars_(manifest) {
  try {
    var cache = CacheService.getScriptCache(), json = JSON.stringify(avatarImagesFromManifest_(manifest));
    var count = Math.ceil(json.length / 80000);
    if (count > 100) return; // The durable file remains authoritative if memory is too small.
    var generation = Utilities.getUuid();
    for (var i = 0; i < count; i++) cache.put('avatars_v97_' + generation + '_' + i, json.slice(i * 80000, (i + 1) * 80000), 900);
    cache.put('avatars_v97_manifest', JSON.stringify({ version: manifest.version, generation: generation, count: count, length: json.length }), 900);
  } catch (e) { console.warn('AVATAR_CACHE unavailable: ' + e.message); }
}

function readPreparedAvatars_(version) {
  try {
    var cache = CacheService.getScriptCache(), raw = cache.get('avatars_v97_manifest');
    if (raw) {
      var meta = JSON.parse(raw), chunks = [];
      if (meta.version === version && meta.count > 0 && meta.count <= 100) {
        for (var i = 0; i < meta.count; i++) {
          var chunk = cache.get('avatars_v97_' + meta.generation + '_' + i);
          if (chunk === null) break;
          chunks.push(chunk);
        }
        var text = chunks.join('');
        if (chunks.length === meta.count && text.length === meta.length) return { ready: true, images: JSON.parse(text) };
      }
    }
    var id = getFileIdByName(getProjectFolder(), 'avatar.json');
    if (!id) return { ready: false, images: {} };
    var manifest = JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());
    if (manifest.schema !== 1 || manifest.version !== version) return { ready: false, images: {} };
    cachePreparedAvatars_(manifest);
    return { ready: true, images: avatarImagesFromManifest_(manifest) };
  } catch (e) {
    console.warn('AVATAR_READ failed: ' + e.message);
    return { ready: false, images: {} };
  }
}

/** Reconcile roster and file versions every sync; publish only when content changes. */
function syncPreparedAvatars_(folder, categories) {
  var old = loadJsonFile(folder, 'avatar.json') || {};
  var previous = old.schema === 1 && old.entries ? old.entries : {};
  var roster = {}, entries = {}, pending = [], reused = 0, fetched = 0, failures = 0;
  categories.forEach(function(category) {
    (category.people || []).forEach(function(person) {
      var id = person.avatarFileId;
      if (!id) return;
      if (!roster[id]) roster[id] = { version: person.avatarFileVersion || id, people: [] };
      roster[id].people.push({ name: person.name, category: category.name, department: person.department || category.name });
    });
  });
  Object.keys(roster).sort().forEach(function(id) {
    var item = roster[id], prior = previous[id];
    item.people.sort(function(a,b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); });
    entries[id] = { version: prior && prior.version || '', people: item.people, image: prior && prior.image || '' };
    if (prior && prior.version === item.version && prior.image && prior.image.length <= 30000 && avatarImagesFromManifest_({ entries: { one: prior } }).one) reused++;
    else pending.push(id);
  });
  var started = Date.now(), token;
  if (pending.length) token = ScriptApp.getOAuthToken();
  for (var offset = 0; offset < pending.length; offset += 8) {
    if (Date.now() - started > 120000) {
      failures += pending.length - offset;
      syncLogs.push('AVATAR_SYNC budget reached; remaining=' + (pending.length - offset) + ' retry next sync');
      break;
    }
    var ids = pending.slice(offset, offset + 8), batchStart = Date.now();
    try {
      var responses = UrlFetchApp.fetchAll(ids.map(function(id) {
        return { url: 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w64', method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
      }));
      ids.forEach(function(id, i) {
        var response = responses[i], status = response && response.getResponseCode(), blob = response && response.getBlob();
        var type = blob && blob.getContentType();
        if (status !== 200 || !/^image\/(jpeg|png|webp|gif)$/.test(type || '')) {
          failures++; syncLogs.push('AVATAR_SYNC failed id=' + id + ' status=' + status + ' type=' + type + ' preservedPrevious=' + !!entries[id].image); return;
        }
        var image = 'data:' + type + ';base64,' + Utilities.base64Encode(blob.getBytes());
        if (image.length > 30000) {
          failures++; syncLogs.push('AVATAR_SYNC oversized id=' + id + ' bytes=' + image.length + ' preservedPrevious=' + !!entries[id].image); return;
        }
        entries[id].image = image; entries[id].version = roster[id].version; fetched++;
      });
    } catch (e) {
      failures += ids.length; syncLogs.push('AVATAR_SYNC batch error=' + e.message + ' preserved previous images');
    }
    syncLogs.push('AVATAR_SYNC batch=' + ids.length + ' ms=' + (Date.now() - batchStart));
  }
  var version = generatePhotoHash(entries), manifest;
  if (old.schema === 1 && old.version === version) manifest = old;
  else {
    manifest = { schema: 1, version: version, updatedAt: new Date().toISOString(), entries: entries };
    saveJsonToFolder(folder, 'avatar.json', manifest);
  }
  cachePreparedAvatars_(manifest);
  syncLogs.push('AVATAR_SYNC total=' + Object.keys(entries).length + ' reused=' + reused + ' fetched=' + fetched +
    ' failed=' + failures + ' removed=' + Object.keys(previous).filter(function(id) { return !roster[id]; }).length +
    ' fileChanged=' + (manifest !== old) + ' jsonBytes=' + Utilities.newBlob(JSON.stringify(manifest)).getBytes().length);
  manifest.syncStats = { total: Object.keys(entries).length, ready: Object.keys(avatarImagesFromManifest_(manifest)).length,
    reused: reused, fetched: fetched, failed: failures,
    removed: Object.keys(previous).filter(function(id) { return !roster[id]; }).length,
    fileChanged: manifest !== old, jsonBytes: Utilities.newBlob(JSON.stringify(manifest)).getBytes().length };
  return manifest;
}
