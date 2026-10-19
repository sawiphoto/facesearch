const fs=require('fs'),assert=require('assert');
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_PATH||'C:/Users/hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:1905,height:931}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const html=fs.readFileSync('Index.html','utf8');
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1/')?r.fulfill({contentType:'text/html',body:html}):r.abort());
  await page.addInitScript(()=>{
   const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
   const people=Array.from({length:120},(_,i)=>({name:'ครู '+i,avatarFileId:'avatar-'+i,photoCount:0}));
   const images=Object.fromEntries(people.map(p=>[p.avatarFileId,image]));
   window.avatarCalls=0;
   window.google={script:{get run(){let success;const run={withSuccessHandler(fn){success=fn;return run;},withFailureHandler(){return run;},
    getAppData(){window.deliverDirectory=()=>success({categories:[{name:'ทดสอบ',people}],avatarVersion:'v1',avatarPrepared:true,avatarImages:images,updatedAt:'2026-10-10T00:00:00Z'});if(!location.search)window.deliverDirectory();},
    getPersonAvatars(){window.avatarCalls++;throw Error('Prepared mode must not request thumbnails');},
    getDeleteRequests(){success({});},registerSession(){},logPageLoad(){},pingSession(){},logSessionEnd(){},removeSession(){}
   };return run;}}};
  });
  await page.goto('http://127.0.0.1/');
  await page.waitForFunction(()=>Object.keys(avatarValues).length===120);
  assert.equal(await page.locator('#teacher-avatars-row img').count(),120);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('#teacher-avatars-row img')).some(img=>img.src.startsWith('data:image/png')&&img.naturalWidth===1));
  await page.evaluate(()=>{const row=document.getElementById('teacher-avatars-row');row.scrollLeft=row.scrollWidth;});
  await page.waitForFunction(()=>document.querySelector('#teacher-avatars-row img[data-avatar-id="avatar-119"]').src.startsWith('data:image/png'));
  assert.equal(await page.evaluate(()=>window.avatarCalls),0);
  // Fresh document restores all bytes before the withheld server request completes.
  await page.goto('http://127.0.0.1/?hold=1');
  await page.waitForFunction(()=>directoryReady&&Object.keys(avatarValues).length===120);
  assert.equal(await page.evaluate(()=>window.avatarCalls),0);
  for(const viewport of [{width:1905,height:931},{width:393,height:851}]){
   await page.setViewportSize(viewport);
   assert.equal(await page.locator('#teacher-avatars-row img').count(),120);
   assert.equal(await page.evaluate(()=>avatarsPrepared),true);
  }
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS 120 prepared avatars in initial response, visible image decoding, far-scroll without batch calls, cached refresh before server, desktop/mobile');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
