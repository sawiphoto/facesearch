const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {ctx,photoData}=require('./face-count.test.cjs');
const logs=[];ctx.writeLog=(...args)=>{logs.push(args);return true;};
photoData.P3.face_count=2;
let result=ctx.syncDataFromDrive();assert(!result.error,JSON.stringify(result));
assert.equal(result.syncReport.overall,'SUCCESS');assert.equal(result.photoCount,3,'unique referenced images, not changed-person count');assert.equal(result.peopleCount,6);
assert(Object.values(result.syncReport.stages).every(stage=>stage.status==='SUCCESS'));
assert.equal(logs.at(-1)[0],'SYSTEM_SYNC');assert.equal(logs.at(-1)[2],3);assert.equal(logs.at(-1)[4].peopleCount,6);
const countBeforeAuto=logs.length;
ctx.autoSyncTriggerTask();
assert.equal(logs.length,countBeforeAuto+1,'autoSyncTriggerTask must write only 1 log entry (no duplicate SYSTEM_SYNC)');
assert.equal(logs.at(-1)[0],'AUTO_SYNC_SUCCESS');assert.equal(logs.at(-1)[2],3);assert(logs.at(-1)[1].includes('Avatar: สำเร็จ'));
ctx.syncPreparedAvatars_=()=>({version:'test',entries:{},syncStats:{total:6,ready:5,reused:5,fetched:0,failed:1,removed:0,fileChanged:false}});
result=ctx.syncDataFromDrive();assert.equal(result.syncReport.overall,'PARTIAL');assert.equal(result.syncReport.stages.avatars.status,'PARTIAL');
assert.equal(result.syncReport.stages.avatars.counts.ready,5);assert.equal(logs.at(-1)[0],'SYSTEM_SYNC_PARTIAL');
ctx.autoSyncTriggerTask();assert.equal(logs.at(-1)[0],'AUTO_SYNC_PARTIAL');
photoData.P3.face_count=0;result=ctx.syncDataFromDrive();assert.equal(result.syncReport.stages.classification.status,'PARTIAL');
const loader=ctx.loadJsonFile;
ctx.loadJsonFile=(folder,name)=>name==='photo_index.json'?null:loader(folder,name);
result=ctx.syncDataFromDrive();assert.equal(result.error,true);assert.equal(result.syncReport.overall,'FAILED');
assert.equal(result.syncReport.stages.photoIndex.status,'FAILED');assert.equal(result.syncReport.stages.avatars.status,'NOT_RUN');assert.equal(logs.at(-1)[0],'SYSTEM_SYNC_FAILED');
ctx.autoSyncTriggerTask();assert.equal(logs.at(-1)[0],'AUTO_SYNC_FAILED');assert.equal(logs.at(-1)[4].overall,'FAILED');
ctx.loadJsonFile=loader;
const oldSave=ctx.saveCacheFile;ctx.saveCacheFile=()=>null;
result=ctx.syncDataFromDrive();assert(result.error);assert.equal(result.syncReport.stages.directory.status,'FAILED');ctx.saveCacheFile=oldSave;
assert.equal(result.photoCount,3,'failure after enumeration retains its known totals');
ctx.ScriptApp.getProjectTriggers=()=>{throw Error('denied');};
result=ctx.syncDataFromDrive();assert.equal(result.syncReport.stages.triggers.status,'PARTIAL');
// Exercise the actual persistence function, not only a mocked log collector.
const db=fs.readFileSync('DatabaseService.gs','utf8');
vm.runInContext(db.slice(db.indexOf('function writeLog('),db.indexOf('function logSingleDownload(')),ctx);
let saved;
ctx.getProjectFolder=()=>({});ctx.loadJsonFile=()=>[
  {timestamp:'2026-10-19T06:49:16.000+07:00',activityType:'AUTO_SYNC_SUCCESS',detail:'รอบเวลา 06:48 น.',photoCount:3,syncReport:result.syncReport},
  {timestamp:'2026-10-19T06:49:15.000+07:00',activityType:'SYSTEM_SYNC_PARTIAL',detail:'ซิงค์บางส่วน',photoCount:3,syncReport:result.syncReport}
];
ctx.getFileIdByName=()=> 'log-file';
ctx.DriveApp.getFileById=()=>({setContent:text=>{saved=JSON.parse(text);}});
assert.equal(ctx.writeLog('AUTO_SYNC_PARTIAL','รอบเวลา 06:48 น.\ntest detail',3,'',result.syncReport),true);
assert.equal(saved.length,2,'legacy duplicate SYSTEM_SYNC entry with same syncReport.id must be deduplicated');
assert.equal(JSON.stringify(saved[0],null,2).split('\n').length,10,'compact sync log entry must be exactly 10 lines');
assert.equal(saved[0].syncReport,undefined,'verbose syncReport object must not be persisted in logs.json');
assert(saved[0].system.includes('Auto Sync บางส่วน'));
assert.equal(JSON.stringify(saved[1],null,2).split('\n').length,10,'legacy sync log entry must also be compacted to 10 lines');
ctx.DriveApp.getFileById=()=>({setContent:()=>{throw Error('write denied');}});
assert.equal(ctx.writeLog('SYSTEM_SYNC','test',3),false,'log write failure must be observable');
console.log('PASS complete/partial/failed stage reports, unique totals, auto summary, failed input/write, unstarted stages, trigger check and 10-line compact JSON log persistence');

