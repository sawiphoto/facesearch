const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const values=new Map(), calls=[];let disk=null,writes=0,reads=0,uuid=0,fail=false;
const cache={get:k=>values.get(k)??null,put(k,v){assert(Buffer.byteLength(v)<=100000);values.set(k,v);},remove:k=>values.delete(k)};
const ctx={console,syncLogs:[],Date,Utilities:{getUuid:()=>String(++uuid),newBlob:s=>({getBytes:()=>[...Buffer.from(s)]}),base64Encode:b=>Buffer.from(b).toString('base64')},
  CacheService:{getScriptCache:()=>cache},ScriptApp:{getOAuthToken:()=> 'test'},
  UrlFetchApp:{fetchAll(requests){calls.push(requests);return requests.map(r=>({getResponseCode:()=>fail?403:200,getBlob:()=>({getContentType:()=>fail?'text/html':'image/png',getBytes:()=>[1,2,3]})}));}},
  loadJsonFile:()=>disk,saveJsonToFolder:(_,name,data)=>{assert.equal(name,'avatar.json');writes++;disk=JSON.parse(JSON.stringify(data));},
  generatePhotoHash:data=>crypto.createHash('md5').update(JSON.stringify(data)).digest('hex'),getProjectFolder:()=>({}),getFileIdByName:()=> 'avatars',
  DriveApp:{getFileById:()=>({getBlob:()=>({getDataAsString:()=>{reads++;return JSON.stringify(disk);}})})}
};vm.createContext(ctx);vm.runInContext(fs.readFileSync('AvatarService.gs','utf8'),ctx);
let categories=[{name:'ภาษาไทย',people:[{name:'ครูหนึ่ง',avatarFileId:'one',avatarFileVersion:'v1'},{name:'ครูสอง',avatarFileId:'two',avatarFileVersion:'v1'}]}];
function sync(){return ctx.syncPreparedAvatars_({},categories);}
let first=sync();assert.equal(writes,1);assert.equal(calls.length,1);assert.equal(calls[0].length,2);assert.equal(Object.keys(first.entries).length,2);
assert.equal(sync().version,first.version);assert.equal(writes,1);assert.equal(calls.length,1,'unchanged sync must not fetch again');
categories[0].people[0].name='ครูหนึ่งใหม่';categories[0].name='คณิตศาสตร์';
let renamed=sync();assert.equal(writes,2);assert.equal(calls.length,1,'rename/move uses same bytes');assert.equal(renamed.entries.one.people[0].category,'คณิตศาสตร์');
categories[0].people.push({name:'ครูสาม',avatarFileId:'three',avatarFileVersion:'v1'});sync();assert.equal(calls.at(-1).length,1);assert(calls.at(-1)[0].url.includes('three'));
categories[0].people[0].avatarFileVersion='v2';fail=true;let failed=sync();assert.equal(failed.entries.one.version,'v1');assert(failed.entries.one.image,'failed replacement preserves old image');
const failureWrites=writes;sync();assert.equal(writes,failureWrites,'failed unchanged content not rewritten');
fail=false;let replaced=sync();assert.equal(replaced.entries.one.version,'v2');assert.notEqual(replaced.version,renamed.version);
categories[0].people[0].avatarFileId='replacement';sync();assert(!disk.entries.one);assert(disk.entries.replacement.image);
categories[0].people.splice(1,1);let removed=sync();assert(!removed.entries.two);
assert.equal(Object.keys(ctx.readPreparedAvatars_(removed.version).images).length,2);assert.equal(reads,0,'warm memory avoids Drive read');
const meta=JSON.parse(values.get('avatars_v97_manifest'));values.delete('avatars_v97_'+meta.generation+'_0');
assert.equal(ctx.readPreparedAvatars_(removed.version).ready,true);assert.equal(reads,1,'evicted cache reads durable file');
assert.equal(ctx.readPreparedAvatars_('wrong-version').ready,false);
// Large map must be chunked, then reassembled intact.
const large={version:'large',entries:{}};for(let i=0;i<30;i++)large.entries['id'+i]={image:'data:image/png;base64,'+'A'.repeat(9000)};
ctx.cachePreparedAvatars_(large);assert.equal(Object.keys(ctx.readPreparedAvatars_('large').images).length,30);
// Frontend applies all bytes before rendering, persists by version, and tolerates storage denial.
const html=fs.readFileSync('Index.html','utf8'),a=html.indexOf('    var avatarValues = {}'),b=html.indexOf('    function observeVisibleAvatars',a);
const storage=new Map(),front={console,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout:()=>0,clearTimeout:()=>{}};
vm.createContext(front);vm.runInContext(html.slice(a,b),front);
front.applyPreparedAvatars({avatarVersion:removed.version,avatarPrepared:true,avatarImages:ctx.avatarImagesFromManifest_(removed)});
assert.equal(Object.keys(front.avatarValues).length,2);assert.equal(front.avatarsPrepared,true);
const img={dataset:{avatarId:'replacement'}};front.queueVisibleAvatar(img);assert(img.src.startsWith('data:image/png;base64,'));assert.equal(front.avatarQueue.length,0);
front.avatarValues={};front.applyPreparedAvatars({avatarVersion:removed.version});assert.equal(Object.keys(front.avatarValues).length,2,'refresh restores complete bytes');
front.localStorage.setItem=()=>{throw Error('blocked')};front.applyPreparedAvatars({avatarVersion:'new',avatarPrepared:true,avatarImages:{new:'data:image/png;base64,AQID'}});assert(front.avatarValues.new);assert(!front.avatarValues.replacement,'removed/replaced IDs cannot linger');
const missing={dataset:{avatarId:'missing'}};front.queueVisibleAvatar(missing);assert.equal(front.avatarQueue.length,0,'missing prepared image must not start another batch');
console.log('PASS avatar new/unchanged/rename/move/same-ID change/replacement/removal/failure preservation, durable cache eviction, chunks, all-image browser persistence and denied storage');
// The actual directory endpoint returns prepared bytes in its existing single response.
vm.runInContext(fs.readFileSync('DatabaseService.gs','utf8'),ctx);
ctx.getProjectFolder=()=>({});ctx.getFileIdByName=(_,name)=>name==='app_cache.json'?'directory':'avatars';
ctx.DriveApp={getFileById:id=>({getBlob:()=>({getDataAsString:()=>JSON.stringify(id==='directory'?{categories,avatarVersion:removed.version,updatedAt:'2026-10-10T00:00:00Z'}:disk)})})};
values.clear();const beforeRequests=calls.length;
const response=ctx.getAppData();assert(!response.error,JSON.stringify(response));assert.equal(response.avatarPrepared,true);assert.equal(Object.keys(response.avatarImages).length,2);
assert.equal(calls.length,beforeRequests,'startup must not fetch thumbnails');
assert(!JSON.stringify(ctx.compactAppDirectory_(response)).includes('data:image'),'app_cache metadata must not duplicate bytes');
const again=ctx.getAppData();assert.equal(again.avatarPrepared,true);assert.equal(Object.keys(again.avatarImages).length,2);
console.log('PASS getAppData single prepared-image response, warm directory/avatar cache and metadata-only app_cache');
