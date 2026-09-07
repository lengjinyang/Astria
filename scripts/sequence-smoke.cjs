const path=require('node:path'),fs=require('node:fs');
module.exports=async function sequenceSmoke(window,catalog,app,descriptor){
  const first=await window.webContents.executeJavaScript(`(async()=>{
    const p=window.__astriaPlayback;
    const wait=(condition,label)=>new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>condition()?resolve():Date.now()-start>8000?reject(new Error(p.error?.message||('Sequence timeout '+label+' '+JSON.stringify({time:p.currentTime,ready:p.readyState,seeking:p.seeking,paused:p.paused,fps:p.media?.fps,frames:p.media?.totalFrames,duration:p.duration,scrub:window.__astriaScrubTest?.snapshot()})))):setTimeout(tick,20);tick();});
    await wait(()=>p.readyState>=2,'ready');p.pause();await wait(()=>p.paused,'pause');
    const fps=document.querySelector('#fpsInput');fps.value='24';fps.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(()=>p.media.fps===24&&p.readyState>=2&&!p.seeking&&p.paused,'fps-24');
    const scrub=window.__astriaScrubTest;scrub.trace.length=0;scrub.begin();scrub.target(3);
    await wait(()=>scrub.snapshot().presentedFrame===3,'scrub-forward');scrub.target(1);await wait(()=>scrub.snapshot().presentedFrame===1,'scrub-backward');await scrub.end();
    if(!scrub.trace.every((frame,index)=>!index||Math.abs(frame-scrub.trace[index-1])===1)||scrub.snapshot().displayFrame!==null||!p.paused)throw Error('Sequence scrub failed');
    p.seek(1/24);await wait(()=>!p.seeking&&Math.abs(p.currentTime-1/24)<.001,'valid-frame');
    const valid=(await p.captureFrame()).toDataURL();
    p.seek(2/24);await wait(()=>!p.seeking&&Math.abs(p.currentTime-2/24)<.001,'missing-frame');
    const missing=(await p.captureFrame()).toDataURL();
    if(valid!==missing||!document.querySelector('.missing-frame-notice').textContent.includes('1003'))throw Error('Missing-frame hold failed');
    document.querySelector('#addBookmarkBtn').click();
    fps.value='48';fps.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(()=>p.media.fps===48&&p.readyState>=2&&!p.seeking,'fps-48');
    if(!p.paused||Math.abs(p.duration-4/48)>.001)throw Error('FPS mapping or pause preservation failed');
    await new Promise(resolve=>setTimeout(resolve,600));
    return {mediaId:p.media.mediaId,bookmarks:document.querySelectorAll('.bookmark-card').length};
  })()`);
  const added=path.join(path.dirname(descriptor.path),'shot_1005.png');
  fs.copyFileSync(descriptor.path,added);
  try{
    const next=await catalog.describe(descriptor.path);if(next.mediaId!==first.mediaId)throw Error('Unstable sequence ID');
    window.webContents.send('vfx:open-video-from-system',next);
    const restored=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{const p=window.__astriaPlayback;if(p.readyState>=2&&p.media.totalFrames===5)resolve({fps:p.media.fps,source:p.media.sourceFrameOffset,bookmarks:document.querySelectorAll('.bookmark-card').length});else if(Date.now()-start>8000)reject(new Error('Restore timeout'));else setTimeout(tick,25)};tick();})`);
    if(restored.fps!==48||restored.source!==1001||restored.bookmarks!==first.bookmarks)throw Error('Sequence workspace restore failed '+JSON.stringify(restored));
    console.log('SEQUENCE_PASS',JSON.stringify(restored));
  }finally{fs.unlinkSync(added);}
  app.quit();
};

