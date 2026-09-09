'use strict';
const path = require('node:path');
const fs = require('node:fs');
module.exports = async function smoke(window, catalog, app) {
  const exportDirectory = path.resolve('.cache/smoke-exports'); fs.mkdirSync(exportDirectory,{recursive:true});
  const { dialog } = require('electron');
  dialog.showSaveDialog = async (_window, options) => ({ canceled:false, filePath:path.join(exportDirectory,path.basename(options.defaultPath)) });
  dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[exportDirectory] });
  const fixture = path.resolve(process.env.ASTRIA_SMOKE_MEDIA || '.cache/media/h264.mp4');
  if (!fs.existsSync(fixture)) throw new Error('烟雾素材不存在，请设置 ASTRIA_SMOKE_MEDIA');
  const descriptor = await catalog.describe(fixture);
  await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>window.__astriaReady?resolve():Date.now()-start>5000?reject(new Error('UI initialization timeout')):setTimeout(tick,25);tick();})`);
  await window.webContents.executeJavaScript(`(() => { const select=document.querySelector('#startupModeSelect');select.value='classic';select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  window.webContents.send('vfx:open-video-from-system', descriptor);
  if (descriptor.mediaKind === 'sequence') return require('./sequence-smoke.cjs')(window,catalog,app,descriptor);
  if(process.env.ASTRIA_COLOR_AUDIT) {
    await window.webContents.executeJavaScript(`new Promise(resolve=>{const tick=()=>window.__astriaPlayback.readyState>=2?resolve():setTimeout(tick,20);tick()})`);
    await window.webContents.executeJavaScript(`window.__astriaPlayback.pause();const c=document.getElementById("colorPresetSelect");c.value="original";c.dispatchEvent(new Event("change"));`);
    let baselinePixel;
    for(const mode of [false,true,false,true]) {
      await window.webContents.executeJavaScript(`if(document.body.classList.contains('clean-mode')!==${mode})document.getElementById(${mode}?'cleanModeBtn':'cleanModeExitBtn').click()`);
      await new Promise(r=>setTimeout(r,500));
      const shot=await window.webContents.capturePage();const size=shot.getSize();
      const pixel=shot.crop({x:Math.floor(size.width/3),y:Math.floor(size.height/3),width:1,height:1}).toBitmap();
      baselinePixel ||= [...pixel];
      if([...pixel].some((value,index)=>Math.abs(value-baselinePixel[index])>2))throw Error('Mode changed displayed color '+JSON.stringify({mode,pixel:[...pixel],baselinePixel}));
      console.log('MODE_COLOR_PASS',mode,[...pixel]);
    }
  }
  const result = await window.webContents.executeJavaScript(`(async () => {
    const p = window.__astriaPlayback;
    const wait = (condition, timeout=12000) => new Promise((resolve,reject) => {
      const start=Date.now(); const tick=()=>condition()?resolve():Date.now()-start>timeout?reject(new Error(p.error?.message || 'Smoke timeout '+JSON.stringify({ready:p.readyState,time:p.currentTime,seeking:p.seeking,paused:p.paused,media:p.media}))):setTimeout(tick,30); tick();
    });
    await wait(()=>p.readyState >= 2); p.pause(); await wait(()=>p.paused);
    p.seek(0.5); await wait(()=>!p.seeking && Math.abs(p.currentTime-.5)<.06);
    const scrub=window.__astriaResponsiveSeekTest,startFrame=Math.round(p.currentTime*scrub.snapshot().fps);
    scrub.trace.length=0;scrub.seek(startFrame+2);scrub.seek(startFrame+6);
    await wait(()=>!scrub.snapshot().inFlight&&scrub.snapshot().pendingFrame===null);
    if(!scrub.trace.includes(startFrame+2)||scrub.trace.at(-1)!==startFrame+6)throw new Error('Scrub overlay did not update while dragging '+JSON.stringify(scrub.trace));
    const before=p.currentTime; let playedDuringStep=false; const markStepPlay=()=>{playedDuringStep=true};p.addEventListener('playing',markStepPlay);
    p.step(1); await wait(()=>!p.seeking && p.currentTime>before);
    p.step(-1); await wait(()=>!p.seeking && Math.abs(p.currentTime-before)<.01);await new Promise(resolve=>setTimeout(resolve,80));p.removeEventListener('playing',markStepPlay);
    if(playedDuringStep||!p.paused||document.querySelector('#playBtn').classList.contains('playing'))throw new Error('Frame step exposed transient playback state');
    p.playbackRate=1.5; p.volume=.4; p.muted=true;
    await p.play(); await wait(()=>!p.paused); p.pause(); await wait(()=>p.paused);
    const frame=await p.captureFrame();
    if(p.presenter?.gl?.getContextAttributes().desynchronized)throw Error('Video canvas bypasses synchronized composition');
    const click=id=>document.getElementById(id).click();
    if(document.body.classList.contains('clean-mode'))click('cleanModeBtn');
    for(let iteration=0;iteration<3;iteration++) {
      click('cleanModeBtn');
      if(!document.querySelector('.mode-presentation-canvas.visible'))throw Error('Mode transition has no retained frame');
      await new Promise(resolve=>setTimeout(resolve,80));
      if(!document.body.classList.contains('clean-mode') || p.readyState<2)throw Error('Clean mode lost presentation');
      const windowState = await window.desktopAPI.getWindowState();
      if(!windowState.maximized && !windowState.fullscreen) {
        const picture=document.querySelector('#mediaSurface').getBoundingClientRect();
        const viewer=document.querySelector('#viewerStage').getBoundingClientRect();
        if(Math.abs(picture.width-viewer.width)>2 || Math.abs(picture.height-viewer.height)>2)throw Error('Clean mode did not fit picture');
      }
      await wait(()=>!document.querySelector('.mode-presentation-canvas.visible'));
      click('cleanModeExitBtn');
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    const color=document.getElementById('colorPresetSelect'); color.value='unity-neutral';color.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,250));
    click('lumaBtn'); click('lumaBtn'); click('addBookmarkBtn');
    await wait(()=>document.querySelector('.bookmark-thumb'));
    click('pixelInspectorBtn');
    const stage=document.querySelector('#viewerStage'),rect=stage.getBoundingClientRect();
    stage.dispatchEvent(new PointerEvent('pointermove',{clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,bubbles:true}));
    await wait(()=>document.querySelector('#pixelInspectorHud').classList.contains('show'));
    const pixel=document.querySelector('#pixelInspectorHud').classList.contains('show');
    click('exportAnnotatedFrameBtn');click('contactSheetBtn');click('generateContactSheetBtn');
    await wait(()=>!document.querySelector('#generateContactSheetBtn').disabled,15000);
    const contactClosed=!document.querySelector('#contactSheetModal').classList.contains('open');
    const result={ready:frame.width===p.videoWidth && frame.height===p.videoHeight, width:frame.width,height:frame.height,
      canvas:document.querySelector('#video').tagName==='CANVAS',desktopAPI:!!window.desktopAPI,
      timeline:document.querySelector('.timeline-panel').getBoundingClientRect().bottom<=innerHeight,
      controls:!!document.querySelector('#playBtn'),mediaKind:p.media.mediaKind,backend:p.backend,pixel,contactClosed,
      sourceFpsApplied:Math.abs(Number(document.querySelector('#fpsInput').value)-(p.media.sourceFps||p.media.fps||24))<.001,
      hardwareDecoder:p.media.hardwareDecoder||'none'};
    if(!result.ready||!result.canvas||!result.timeline||!pixel||!contactClosed||!result.sourceFpsApplied)throw new Error(JSON.stringify(result));
    return result;
  })()`);
  console.log('VFX_SMOKE_TEST', JSON.stringify(result));
  const point = await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-quick-tool="rectangle"]').click();
    const r=document.querySelector('#annotationCanvas').getBoundingClientRect();
    return {x:Math.round(r.x+r.width*.4),y:Math.round(r.y+r.height*.4)};
  })()`);
  window.webContents.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point});
  window.webContents.sendInputEvent({type:'mouseMove',x:point.x+70,y:point.y+45,button:'right'});
  window.webContents.sendInputEvent({type:'mouseUp',x:point.x+70,y:point.y+45,button:'right',clickCount:1});
  await new Promise(resolve => setTimeout(resolve,100));
  const annotated = await window.webContents.executeJavaScript(`(() => {
    const count=document.querySelectorAll('#annotationList .annotation-frame').length;
    document.querySelector('#exportAnnotatedFrameBtn').click();
    return document.querySelector('#annotationList').textContent.includes('批注');
  })()`);
  if (!annotated) throw new Error('Annotation interaction failed');
  await new Promise(resolve => setTimeout(resolve, 350));
  const output = path.resolve('out/mpv-smoke.png'); fs.mkdirSync(path.dirname(output), { recursive:true });
  console.log('LAYOUT', await window.webContents.executeJavaScript(`JSON.stringify(['#viewerStage','#mediaSurface','#video','#colorViewCanvas'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,x:r.x,y:r.y,width:r.width,height:r.height};}))`));
  fs.writeFileSync(output, (await window.webContents.capturePage()).toPNG());
  app.quit();
};
