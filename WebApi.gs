/** Signed read-only bridge for the Next.js personnel gallery. No viewer OAuth token is accepted. */
function doPost(e) {
  try {
    var raw=e&&e.postData&&e.postData.contents;
    if(typeof raw!=='string'||raw.length>16000)throw Error('INVALID_REQUEST');
    var verified=webVerifyPhotoRequest_(JSON.parse(raw));
    var data=webPhotoDispatch_(verified.action,verified.payload||{});
    return ContentService.createTextOutput(JSON.stringify({ok:true,data:data})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    console.warn('PHOTO_WEB_API rejected: '+String(err.message).slice(0,100));
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:'PHOTO_REQUEST_FAILED'})).setMimeType(ContentService.MimeType.JSON);
  }
}
function webVerifyPhotoRequest_(envelope) {
  var props=PropertiesService.getScriptProperties(),secret=props.getProperty('NEXT_PHOTO_GATEWAY_SECRET');
  if(!secret||!/^[a-f0-9]{64}$/i.test(secret))throw Error('GATEWAY_NOT_CONFIGURED');
  if(!envelope||typeof envelope.body!=='string'||typeof envelope.signature!=='string'||!/^[a-f0-9]{64}$/.test(envelope.signature))throw Error('INVALID_SIGNATURE');
  var expected=Utilities.computeHmacSha256Signature(envelope.body,secret,Utilities.Charset.UTF_8).map(function(b){return('0'+((b+256)%256).toString(16)).slice(-2)}).join('');
  var diff=0;for(var i=0;i<64;i++)diff|=expected.charCodeAt(i)^envelope.signature.charCodeAt(i);if(diff)throw Error('INVALID_SIGNATURE');
  var body=JSON.parse(envelope.body),now=Date.now();
  if(body.version!==1||!Number.isFinite(body.issuedAt)||Math.abs(now-body.issuedAt)>120000||!/^\w[\w-]{15,79}$/.test(body.nonce||'')||!/^[-a-zA-Z0-9_]{10,100}$/.test(body.actor||''))throw Error('INVALID_ENVELOPE');
  if(['directory','personPhotos','thumbnail','avatar','folder'].indexOf(body.action)===-1)throw Error('ACTION_NOT_ALLOWED');
  var lock=LockService.getScriptLock();lock.waitLock(5000);
  try {
    var all=props.getProperties(),key='photo_web_nonce_'+body.nonce,count=0;
    Object.keys(all).forEach(function(k){if(k.indexOf('photo_web_nonce_')===0){if(Number(all[k])<=now)props.deleteProperty(k);else count++}});
    if(props.getProperty(key)||count>=500)throw Error('REPLAY_OR_BUSY');
    props.setProperty(key,String(now+300000));
    if(!props.getProperty(key))throw Error('NONCE_STORE_FAILED');
  }finally{lock.releaseLock()}
  return body;
}
function webPhotoDirectory_() {
  var directory=readCachedAppDirectory_();
  if(!directory){var folder=getProjectFolder(),id=getFileIdByName(folder,'app_cache.json');if(!id)throw Error('DIRECTORY_NOT_READY');directory=compactAppDirectory_(JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString()))}
  var people=[];(directory.categories||[]).forEach(function(cat){(cat.people||[]).forEach(function(p){if(p.status==='former'||cat.name==='อดีตบุคลากร')return;people.push({name:p.name,department:p.department||cat.name,status:p.status||'active',photoCount:p.photoCount||0,avatarFileId:p.avatarFileId||''})})});return people;
}
function webPhotoPerson_(name) {
  if(typeof name!=='string'||!name||name.length>180)throw Error('INVALID_PERSON');
  var found=webPhotoDirectory_().filter(function(p){return p.name===name});if(found.length!==1)throw Error('PERSON_NOT_FOUND');return found[0];
}
function webPhotoDispatch_(action,p) {
  if(action==='directory')return webPhotoDirectory_();
  var person=webPhotoPerson_(p.name);
  if(action==='avatar'){
    if(p.fileId!==person.avatarFileId)throw Error('FILE_NOT_ALLOWED');
    var avatars=getPersonAvatars([p.fileId]);if(!avatars[p.fileId])throw Error('AVATAR_UNAVAILABLE');return {dataUrl:avatars[p.fileId]};
  }
  if(action==='thumbnail'||action==='folder'){
    if(!/^[a-zA-Z0-9_-]{20,60}$/.test(p.fileId||'')||!isPhotoAllowedForPerson_(p.fileId,person.name))throw Error('FILE_NOT_ALLOWED');
    if(action==='thumbnail'){var thumb=getPhotoThumbnailBase64(p.fileId,person.name);if(!thumb.ok)throw Error('THUMBNAIL_UNAVAILABLE');return {dataUrl:thumb.dataUrl}}
    var photos=getPersonPhotos(person.name),photo=photos.filter(function(x){return x.id===p.fileId})[0];if(!photo)throw Error('FILE_NOT_ALLOWED');
    var folder=getPhotoParentFolder(p.fileId,photo.event||'',String(photo.year||''));if(!folder.ok)throw Error('FOLDER_UNAVAILABLE');return {ok:true,folderId:folder.folderId};
  }
  if(action!=='personPhotos')throw Error('ACTION_NOT_ALLOWED');
  var page=Number(p.page||1),group=p.group||'all';
  if(!Number.isInteger(page)||page<1||page>100000||['all','single','small_group','large_group'].indexOf(group)===-1)throw Error('INVALID_FILTER');
  if(p.year&&!/^(2[56]\d{2}|unknown)$/.test(p.year)||p.month&&!/^\d{4}-(0\d|1[0-2])$/.test(p.month)||typeof p.event==='string'&&p.event.length>500)throw Error('INVALID_FILTER');
  var photos=getPersonPhotos(person.name);
  webBuildPhotoHierarchyIndex_(photos);photos.sort(webComparePhotosByYearAndDateDesc_);
  var yearCounts={},months={},events={},counts={single:0,small_group:0,large_group:0,unknown:0};
  function yearKey(x){var y=String(x._thaiYear||'');return /^2[56]\d{2}$/.test(y)?y:'unknown'}
  photos.forEach(function(x){var y=yearKey(x);yearCounts[y]=(yearCounts[y]||0)+1});
  var yearPhotos=photos.filter(function(x){return !p.year||yearKey(x)===p.year});
  yearPhotos.forEach(function(x){if(x._monthKey){var m=months[x._monthKey]||(months[x._monthKey]={value:x._monthKey,label:x._thaiMonthName,count:0});m.count++}});
  var monthPhotos=yearPhotos.filter(function(x){return !p.month||x._monthKey===p.month});
  monthPhotos.forEach(function(x){if(x._eventKey){var v=events[x._eventKey]||(events[x._eventKey]={value:x._eventKey,label:x._eventName||x.event,count:0});v.count++}});
  var filtered=monthPhotos.filter(function(x){return !p.event||x._eventKey===p.event});filtered.forEach(function(x){counts[x.groupCategory]=(counts[x.groupCategory]||0)+1});
  var selected=[],pageCount;
  if(group==='all'){
    var queues=['single','small_group','large_group'].map(function(g){return filtered.filter(function(x){return x.groupCategory===g})});
    pageCount=Math.max.apply(null,queues.map(function(q){return Math.ceil(q.length/2)}));page=Math.min(page,Math.max(1,pageCount));
    queues.forEach(function(q){selected=selected.concat(q.slice((page-1)*2,page*2))});
  }else{filtered=filtered.filter(function(x){return x.groupCategory===group});pageCount=Math.ceil(filtered.length/6);page=Math.min(page,Math.max(1,pageCount));selected=filtered.slice((page-1)*6,page*6)}
  return {photos:selected.map(function(x){return {id:x.id,year:x._thaiYear||'',month:x._monthKey||'',event:x._eventName||x.event||'',eventKey:x._eventKey||'',group:x.groupCategory}}),total:filtered.length,page:page,pageCount:pageCount,counts:counts,years:Object.keys(yearCounts).sort().reverse().map(function(y){return {value:y,count:yearCounts[y]}}),months:Object.keys(months).sort().reverse().map(function(k){return months[k]}),events:Object.keys(events).sort().map(function(k){return events[k]})};
}
