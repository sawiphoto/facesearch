const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const source = fs.readFileSync('DatabaseService.gs','utf8');
const ctx = { console, Utilities: { getUuid:()=>crypto.randomUUID(), DigestAlgorithm: { MD5:'md5' }, computeDigest: (_,s) => [...crypto.createHash('md5').update(s).digest()], formatDate: () => '12:00:00' } };
vm.createContext(ctx); vm.runInContext(source,ctx); vm.runInContext(fs.readFileSync('Helper.gs','utf8'),ctx);
vm.runInContext(fs.readFileSync('SyncReport.gs','utf8'),ctx);
ctx.syncPreparedAvatars_=()=>({version:'avatars-test',entries:{},syncStats:{total:0,ready:0,reused:0,fetched:0,failed:0,removed:0,fileChanged:false}});
ctx.avatarImagesFromManifest_=()=>({});
for(const [value,group] of [[1,'single'],[2,'small_group'],[5,'small_group'],[6,'large_group'],[20,'large_group'],['3','small_group'],[' 8 ','large_group']]) {
  const p=ctx.normalizePhotoClassification_({faceCount:value,faceCountSource:'photo_index',groupCategory:'single'});
  assert.equal(p.groupCategory,group); assert.equal(p.faceCount,Number(value));
}
for(const value of [undefined,null,0,-1,1.5,'',' ','bad',true,{},[],Infinity,'1.5','1e2',Number.MAX_SAFE_INTEGER+1]) {
  assert.equal(ctx.normalizePhotoClassification_({faceCount:value,faceCountSource:'photo_index'}).groupCategory,'unknown');
}
assert.equal(ctx.normalizePhotoClassification_({faceCount:1,groupCategory:'single'}).groupCategory,'unknown','old teacher-name counts must not appear as detected single');
const iterator = values => { let i=0; return {hasNext:()=>i<values.length,next:()=>values[i++]}; };
const avatar = name => ({getName:()=>name+'.jpg',getMimeType:()=> 'image/jpeg',getId:()=>name,isTrashed:()=>false});
const folder = (name, files=[], children=[]) => ({isTrashed:()=>false,getName:()=>name,getId:()=>name,getFiles:()=>iterator(files),getFolders:()=>iterator(children),getFoldersByName:n=>iterator(children.filter(f=>f.getName()===n))});
const cacheFolder=folder('profile_photos_cache');
const department=folder('แผนก',[avatar('ครูหนึ่ง')]);
const personnel=folder('บุคลากรโรงเรียน',[avatar('ครูสอง')],[department]);
const project=folder('โครงการ',[],[personnel,cacheFolder]);
const values=new Map(), written=new Map(); let directory=null,writes=0;
ctx.CacheService={getScriptCache:()=>({get:k=>values.get(k)||null})};
ctx.ScriptApp={getProjectTriggers:()=>Array.from({length:4},()=>({getHandlerFunction:()=> 'autoSyncTriggerTask'}))};
ctx.DriveApp={getFileById:()=>({getBlob:()=>({getDataAsString:()=>JSON.stringify(directory)})})};
ctx.getProjectFolder=()=>project;
ctx.getFileIdByName=()=>directory?'directory':null;
ctx.writeLog=()=>{};
ctx.saveCacheFile=(_,data)=>{directory=JSON.parse(JSON.stringify(data));return 'directory';};
ctx.saveJsonToFolder=(_,name,photos)=>{writes++; written.set(name,JSON.parse(JSON.stringify(photos)));};
const photoData={P1:{face_count:1,drive_link:'drive-one',date:'2026-10-09'},P2:{face_count:20,drive_link:'drive-two'},P3:{face_count:0,drive_link:'drive-three'}};
ctx.loadJsonFile=(_,name)=>name==='photo_index.json'?photoData:name==='person_index.json'?{'ครูหนึ่ง':['P1','P2','P3'],'ครูสอง':['P2']}:{};
function sync(){ const result=ctx.syncDataFromDrive(); assert(!result.error,JSON.stringify(result)); return result; }
sync(); assert.equal(writes,2);
let first=written.get('ครูหนึ่ง_photos.json'), second=written.get('ครูสอง_photos.json');
assert.equal(first[0].groupCategory,'single'); assert.equal(first[1].groupCategory,'large_group'); assert.equal(first[2].groupCategory,'unknown');
assert.equal(second[0].groupCategory,'large_group','shared photo has same count in root and department');
const oldHash=directory.categories[0].people[0].photoHash;
sync(); assert.equal(writes,2,'unchanged source must skip rewrites');
photoData.P1.face_count=8; sync(); assert.equal(writes,3); assert.equal(written.get('ครูหนึ่ง_photos.json')[0].groupCategory,'large_group');
assert.notEqual(directory.categories[0].people[0].photoHash,oldHash,'count-only change invalidates version');
assert.equal(written.get('ครูหนึ่ง_photos.json').length,3,'no duplicate photos after repeated sync');
const former=folder('อดีตบุคลากร',[avatar('ครูเก่ารวม')],[folder('ภาษาไทย',[avatar('ครูเก่าไทย')],[folder('ย้าย',[avatar('ครูเก่าย้าย')])]),folder('ผู้บริหาร',[avatar('ครูเก่าบริหาร')])]);
personnel.getFolders=()=>iterator([department,former]);
const oldLoad=ctx.loadJsonFile;
ctx.loadJsonFile=(f,name)=>name==='person_index.json'?Object.assign({},oldLoad(f,name),{'ครูเก่าไทย':['P2'],'ครูเก่าย้าย':['P1']}):oldLoad(f,name);
const formerResult=sync().categories.find(cat=>cat.name==='อดีตบุคลากร');
assert.equal(formerResult.people.length,4);
assert.deepEqual(formerResult.people.map(p=>p.department).sort(),['ภาษาไทย','ภาษาไทย / ย้าย','ผู้บริหาร','ไม่ระบุกลุ่มสาระ'].sort());
assert(formerResult.people.every(p=>p.status==='former'));
assert.equal(written.get('ครูเก่าไทย_photos.json')[0].groupCategory,'large_group');
const compact=ctx.compactAppDirectory_({categories:[formerResult]});
assert.equal(compact.categories[0].people[1].department,'ภาษาไทย');
assert.equal(ctx.collectPersonnelFiles_(former,false).length,1,'normal categories remain one level');
// Run the exact frontend normalization block against the same cases.
const html=fs.readFileSync('Index.html','utf8');
const start=html.indexOf('      photos.forEach(function(p) {',html.indexOf("photoLog('เริ่มจัดหมวด/เรียงวันที่'"));
const end=html.indexOf('      });',start)+9;
const photos=[{faceCount:1,faceCountSource:'photo_index'},{faceCount:5,faceCountSource:'photo_index'},{faceCount:6,faceCountSource:'photo_index'},{faceCount:0,faceCountSource:'photo_index'},{faceCount:1}];
vm.runInNewContext(html.slice(start,end),{photos});
assert.deepEqual(photos.map(p=>p.groupCategory),['single','small_group','large_group','unknown','unknown']);
console.log('PASS count boundaries, invalid data, old provenance, both sync branches, shared photo, count-only hash invalidation, repeat sync, frontend parity');
module.exports={ctx,photoData,project};
