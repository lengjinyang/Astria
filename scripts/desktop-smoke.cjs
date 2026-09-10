'use strict';
const path = require('node:path');
const fs = require('node:fs');
module.exports = async function smoke(window, catalog, app) {
  const exportDirectory = path.resolve('.cache/smoke-exports'); fs.mkdirSync(exportDirectory,{recursive:true});
  const { dialog } = require('electron');
  dialog.showSaveDialog = async (_window, options) => ({ canceled:false, filePath:path.join(exportDirectory,path.basename(options.defaultPath)) });
  dialog.showOpenDialog = async (_window,options) => ({ canceled:false, filePaths:[options?.filters?.[0]?.name==='视频' ? fixture : options?.filters?.[0]?.name==='字幕' ? path.resolve('.cache/media/features.srt') : exportDirectory] });
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
    if((p.presenter?.gl || p.presenter?.context)?.getContextAttributes().desynchronized)throw Error('Video canvas bypasses synchronized composition');
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
    if (${!!process.env.ASTRIA_FEATURE_SMOKE}) {
      const features=window.playerFeatures;
      await features.refreshTracks();
      const tracks=await p.call('tracks');
      if(!tracks.some(t=>t.type==='sub'&&t.external))throw Error('Local subtitles not discovered');
      const pixels=()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.drawImage(p.currentFrameCanvas,0,0,320,180);return ctx.getImageData(0,0,320,180).data;};
      const withSub=pixels(),subSelect=document.getElementById('subtitleTrack');
      subSelect.value='no';await subSelect.onchange();await new Promise(r=>setTimeout(r,250));
      const withoutSub=pixels();let subtitlePixels=0;for(let i=320*120*4;i<withSub.length;i+=4)if(Math.abs(withSub[i]-withoutSub[i])>15)subtitlePixels++;
      if(subtitlePixels<50)throw Error('GPU subtitle change not displayed');
      subSelect.value=String(tracks.find(t=>t.type==='sub'&&t.external).id);await subSelect.onchange();
      if(tracks.filter(t=>t.type==='audio').length<2)throw Error('Audio fixture missing tracks');
      const aid=tracks.filter(t=>t.type==='audio')[1].id;
      await p.call('configureTrack','aid',aid);await p.call('configureTrack','audio-delay',.15);
      await p.call('configureTrack','sub-delay',-.1);await p.call('configureTrack','sub-scale',1.2);
      await features.refreshTracks();
      const subtitleScale=document.getElementById('subtitleScale');
      if(subtitleScale.value!=='120')throw Error('Subtitle percentage display failed');
      subtitleScale.value='105';await subtitleScale.onchange();
      if(Math.abs((await p.call('trackSettings'))['sub-scale']-1.05)>.001)throw Error('Subtitle percentage conversion failed');
      if(!(await p.call('tracks')).some(t=>t.type==='audio'&&t.id===aid&&t.selected))throw Error('Audio selection failed');
      await window.desktopAPI.setAlwaysOnTop(true);await window.desktopAPI.setAlwaysOnTop(false);
      click('speedResetBtn');const beforeSpeed=p.playbackRate;document.activeElement.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'c',bubbles:true}));
      if(p.playbackRate<=beforeSpeed)throw Error('C speed shortcut failed');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'x',bubbles:true}));
      if(Math.abs(p.playbackRate-beforeSpeed)>.001)throw Error('X speed shortcut failed');
      click('comparisonOpen');await wait(()=>features.comparison?.readyState>=2 && document.body.classList.contains('comparing'));
      p.seek(.7);await wait(()=>!p.seeking && Math.abs(features.comparison.currentTime-p.currentTime)<.1).catch(error=>{throw Error('B sync '+JSON.stringify({time:features.comparison.currentTime,seeking:features.comparison.seeking,ready:features.comparison.readyState})+' '+error.message)});
      const slider=document.getElementById('comparisonPosition');slider.value='1.5';slider.dispatchEvent(new Event('input'));await wait(()=>!features.comparison.seeking&&Math.abs(features.comparison.currentTime-1.5)<.06);if(Math.abs(Number(document.getElementById('comparisonOffset').value)/24-(1.5-p.currentTime))>.06)throw Error('B timeline offset mismatch');
      const offset=document.getElementById('comparisonOffset');offset.value='6';offset.dispatchEvent(new Event('change'));
      await wait(()=>!features.comparison.seeking&&Math.abs(features.comparison.currentTime-p.currentTime-.25)<.06);
      await p.play();await wait(()=>p.currentTime>1.2&&!features.comparison.paused);
      p.pause();await wait(()=>p.paused&&features.comparison.paused&&!features.comparison.seeking&&Math.abs(features.comparison.currentTime-p.currentTime-.25)<.06);
      p.step(1);await wait(()=>!p.seeking&&!features.comparison.seeking&&Math.abs(features.comparison.currentTime-p.currentTime-.25)<.06);
      offset.value='-240';offset.dispatchEvent(new Event('change'));await wait(()=>document.querySelector('.comparison-view').dataset.outOfRange==='true'&&features.comparison.paused);
      offset.value='0';offset.dispatchEvent(new Event('change'));
      await features.closeComparison();
      for(const mode of ['waveform','rgb-waveform','parade','histogram','vectorscope']){const select=document.getElementById('scopeMode');select.value=mode;select.dispatchEvent(new Event('change'));if(document.querySelector('.scope-panel').hidden)throw Error('Scope hidden');}
      document.querySelector('.scope-panel button').click();
      console.log('PLAYBACK_FEATURES_PASS');
    }
    const color=document.getElementById('colorPresetSelect'); color.value='bright';color.dispatchEvent(new Event('change',{bubbles:true}));
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
  if (process.env.ASTRIA_FEATURE_SMOKE) {
    await window.webContents.executeJavaScript(`if(document.getElementById('pixelInspectorBtn').classList.contains('active'))document.getElementById('pixelInspectorBtn').click();window.__astriaPlayback.pause();`);
    const beforeBounds=window.getBounds(),wasMaximized=window.isMaximized();
    for(const entering of [true,false]) {
      const point=await window.webContents.executeJavaScript(`(()=>{const r=document.getElementById('viewerStage').getBoundingClientRect();return {x:Math.round(r.x+r.width*.4),y:Math.round(r.y+r.height*.45)}})()`);
      for(const clickCount of [1,2]) {
        window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount,...point});
        window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount,...point});
        await new Promise(r=>setTimeout(r,clickCount===1?100:70));
        if(clickCount===1){
          if(await window.webContents.executeJavaScript('window.__astriaPlayback.paused'))throw Error('Single click did not respond within 100ms');
          await new Promise(r=>setTimeout(r,200));
        }
      }
      await new Promise(r=>setTimeout(r,400));
      const state=await window.webContents.executeJavaScript(`({fullscreen:document.body.classList.contains('window-fullscreen'),paused:window.__astriaPlayback.paused})`);
      if(state.fullscreen||!state.paused||window.isMaximized()!==(entering?!wasMaximized:wasMaximized))throw Error('Real double-click changed playback or failed maximize '+JSON.stringify(state));
      const bounds=window.getBounds();
      if(!entering && (window.isMaximized()!==wasMaximized||Object.keys(bounds).some(key=>Math.abs(bounds[key]-beforeBounds[key])>2)))throw Error('Maximize failed to restore window '+JSON.stringify({beforeBounds,bounds,wasMaximized,maximized:window.isMaximized()}));
    }
    await window.webContents.executeJavaScript(`(async()=>{
      const p=window.__astriaPlayback;const pause=ms=>new Promise(r=>setTimeout(r,ms));
      document.getElementById('colorPresetSelect').value='original';document.getElementById('colorPresetSelect').dispatchEvent(new Event('change'));
      p.seek(.75);await pause(200);
      p.muted=false;p.volume=.53;if(!document.querySelector('.playback-feedback').textContent.includes('53%'))throw Error('Volume feedback missing');
      document.getElementById('comparisonOpen').click();
      for(let i=0;i<100&&!document.body.classList.contains('comparing');i++)await pause(50);
      if(!document.body.classList.contains('comparing'))throw Error('Second comparison failed');
      const a=document.getElementById('viewerStage').getBoundingClientRect(),b=document.querySelector('.comparison-view').getBoundingClientRect();
      if(Math.abs(a.right-b.left)>2||Math.abs(a.height-b.height)>2||Math.abs(a.top-b.top)>2)throw Error('Comparison geometry mismatch');
      const select=document.getElementById('scopeMode');select.value='histogram';select.dispatchEvent(new Event('change'));
      const canvas=document.querySelector('.scope-panel canvas'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let colored=0;for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-data[i+2])>15)colored++;
      if(colored<100)throw Error('Histogram has no RGB data');
      document.getElementById('reviewMenu').open=true;document.getElementById('subtitleTool').open=true;
      for(const id of ['colorViewTool','guideViewTool','comparisonTool','scopeTool']){
        const details=document.getElementById(id);details.open=false;
        const action=details.querySelector('.review-inline-actions button, .review-inline-actions select');
        if(!action || !action.checkVisibility())throw Error('Inline action hidden in closed '+id);
      }

      if(!document.querySelector('#reviewMenu #subtitleTrack')||!document.querySelector('#reviewMenu #audioTrack'))throw Error('Track tools outside menu');
      if(!document.querySelector('#reviewMenu #scopeMode')||!document.querySelector('#reviewMenu #comparisonOpen'))throw Error('Analysis tools not in review menu');
      if(!document.querySelector('.comparison-controls #comparisonOffset')||!document.querySelector('.comparison-controls #comparisonClose'))throw Error('Comparison actions not inline');
      window.playerFeatures.notice('位置提示');const hud=document.querySelector('.playback-feedback').getBoundingClientRect(),dock=document.querySelector('.bottom-dock').getBoundingClientRect();if(hud.bottom>dock.top||dock.top-hud.bottom>140)throw Error('Feedback misplaced');
      await pause(200);
    })()`);
    fs.mkdirSync(path.resolve('out'),{recursive:true});
    fs.writeFileSync(path.resolve('out/playback-features.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.getElementById('reviewMenu').open=false;document.querySelector('[data-scope=parade]').click();`);
    await new Promise(r=>setTimeout(r,200));
    fs.writeFileSync(path.resolve('out/playback-parade.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('[data-scope=vectorscope]').click();if(document.querySelector('[data-scope=vectorscope]').getAttribute('aria-pressed')!=='true')throw Error('Scope tab selection failed');`);
    await new Promise(r=>setTimeout(r,200));
    fs.writeFileSync(path.resolve('out/playback-vectorscope.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`(()=>{
      if(document.querySelector('.scope-panel').dataset.renderer!=='gpu')throw Error('GPU scope path inactive');
      const renderer=window.createScopeGpu(),input=document.createElement('canvas');input.width=32;input.height=32;
      const c=input.getContext('2d');c.fillStyle='#808080';c.fillRect(0,0,32,32);
      const read=(mode)=>{const result=renderer.render(input,mode,128,128,1.5),copy=document.createElement('canvas');copy.width=copy.height=128;const ctx=copy.getContext('2d');ctx.drawImage(result,0,0);return ctx.getImageData(0,0,128,128).data;};
      let data=read(3);if(data[(64*128+64)*4+3]<100)throw Error('Neutral vector not centered');
      c.fillStyle='#ff0000';c.fillRect(0,0,32,32);data=read(3);
      let hit=false;for(let y=4;y<12;y++)for(let x=47;x<55;x++){const i=(y*128+x)*4;if(data[i]>data[i+1]+100&&data[i+3]>100)hit=true;}
      if(!hit)throw Error('Red vector position/color incorrect');
      c.fillStyle='#ffffff';c.fillRect(0,0,32,32);data=read(0);
      let top=0,bottom=0;for(let x=0;x<128;x++){top+=data[x*4+3];bottom+=data[(127*128+x)*4+3];}if(top<1000||bottom!==0)throw Error('Waveform white orientation incorrect');
      const snapshot=result=>{const copy=document.createElement('canvas');copy.width=copy.height=128;const ctx=copy.getContext('2d');ctx.drawImage(result,0,0);return ctx.getImageData(0,0,128,128).data;};
      renderer.render(input,3,128,128,1.5,1);
      const before=renderer.getStats();
      const cached=snapshot(renderer.render(input,3,128,128,2,1));
      const after=renderer.getStats();
      if(after.uploads!==before.uploads||after.accumulations!==before.accumulations||after.cacheHits!==before.cacheHits+1)throw Error('Gain cache recomputed density');
      const fresh=snapshot(renderer.render(input,3,128,128,2,2));
      if(cached.some((v,i)=>v!==fresh[i]))throw Error('Cached trace changed pixels');
      const updated=renderer.getStats();
      if(updated.allocations!==before.allocations||updated.uploads!==after.uploads+1)throw Error('Texture reuse failed');
      const uiBefore=window.playerFeatures.scopePerformance;
      const gain=document.getElementById('scopeGain');gain.value='2';gain.dispatchEvent(new Event('input'));
      const uiAfter=window.playerFeatures.scopePerformance;
      if(uiAfter.accumulations!==uiBefore.accumulations||uiAfter.cacheHits!==uiBefore.cacheHits+1)throw Error('Paused UI cache missed');
      console.log('SCOPE_GPU_CACHE_PASS '+JSON.stringify(updated));
      console.log('SCOPE_GPU_PASS');
    })()`);

    await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.scope-panel button').click();
      document.getElementById('reviewMenu').open=true;
      document.getElementById('scopeTool').open=true;
      document.getElementById('scopeOpen').click();
      if(document.querySelector('.scope-panel').hidden || document.getElementById('scopeMode').value!=='vectorscope')throw Error('Scope mode not restored');
      if(document.getElementById('reviewMenu').open || document.getElementById('scopeTool').open)throw Error('Scope launcher did not close');
      if(localStorage.getItem('astria.scope.lastMode')!=='vectorscope')throw Error('Scope preference not persisted');
    })()`);
    await window.webContents.executeJavaScript(`window.playerFeatures.closeComparison();document.getElementById('reviewMenu').open=false;document.querySelector('.scope-panel button').click();`);
    console.log('PLAYBACK_FEATURES_VISUAL_PASS');
    await require('./release-ui-smoke.cjs')(window);
  }
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
