const {app,BrowserWindow}=require('electron');
const path=require('node:path');const {pathToFileURL}=require('node:url');
app.setPath('userData',path.resolve('.cache/clean-mode-smoke-profile'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1100,height:760,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 try {
 await win.loadFile(path.resolve('index.html'));
 const url=pathToFileURL(path.resolve('.cache/media/h264.mp4')).href;
 console.log('CLEAN_MODE_PASS',await win.webContents.executeJavaScript(`(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),click=id=>document.getElementById(id).click();
 await wait(300);
 const blob=await(await fetch(${JSON.stringify(url)})).blob(),dt=new DataTransfer();
 dt.items.add(new File([blob],'clean-check.mp4',{type:'video/mp4'}));
 const input=document.getElementById('videoInput');input.files=dt.files;input.dispatchEvent(new Event('change'));await wait(900);
 const visibility=document.getElementById('controlsVisibilitySelect');visibility.value='auto';visibility.dispatchEvent(new Event('change'));
 const clean=()=>document.body.classList.contains('clean-mode');
 if(!clean())click('cleanModeBtn');
 const track=document.getElementById('timelineTrack');
 for(const [host,kind] of [['markerLayer','timeline-marker'],['annotationMarkerLayer','annotation-timeline-marker']]) {
   const marker=document.createElement('div');marker.className=kind;marker.style.left='50%';document.getElementById(host).append(marker);
   const t=track.getBoundingClientRect(),m=marker.getBoundingClientRect();
   if(Math.abs(m.y+m.height/2-t.y-t.height/2)>1 || Math.abs(m.x+m.width/2-t.x-t.width/2)>1)throw Error('Timeline marker not centered');
   marker.remove();
 }
 const settings=document.getElementById('transportSettings');settings.open=true;await wait(100);
 const r=document.querySelector('.transport-settings-popover').getBoundingClientRect();
 if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)throw Error('Settings escaped viewport '+JSON.stringify(r.toJSON()));
 settings.open=false;
 if(getComputedStyle(document.getElementById('toastStack')).display==='none')throw Error('Feedback hidden');
 const resource=document.createElement('aside');resource.className='resource-browser';document.body.append(resource);
 if(getComputedStyle(resource).display!=='none')throw Error('Browser visible in clean mode');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true}));
 if(clean()||document.activeElement.id!=='bookmarkSearch')throw Error('Search did not leave clean mode');
 document.activeElement.blur();click('cleanModeBtn');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true}));
 if(clean()||document.body.classList.contains('panel-collapsed'))throw Error('Panel shortcut failed');
 if(getComputedStyle(resource).display==='none')throw Error('Browser was not restored');resource.remove();
 click('cleanModeBtn');
 document.dispatchEvent(new PointerEvent('pointerdown',{clientX:100,clientY:5,bubbles:true}));await wait(180);
 if(!document.body.classList.contains('clean-window-controls-visible'))throw Error('Top controls did not reveal');
 document.activeElement.blur();
 document.dispatchEvent(new PointerEvent('pointerdown',{clientX:100,clientY:200,bubbles:true}));await wait(1200);
 if(document.body.classList.contains('clean-window-controls-visible'))throw Error('Top controls did not hide while paused');
 document.dispatchEvent(new PointerEvent('pointerdown',{clientX:100,clientY:5,bubbles:true}));await wait(180);
 document.body.classList.add('desktop-runtime');
 const player=document.querySelector('video');player.loop=true;await player.play();
 const exitBounds=document.getElementById('cleanModeExitBtn').getBoundingClientRect();
 const dragBounds=document.querySelector('.clean-drag-region').getBoundingClientRect();
 if(dragBounds.right>exitBounds.left || exitBounds.width<36 || exitBounds.height<32)throw Error('Exit button overlaps native drag region');
 document.getElementById('cleanWindowMinimizeBtn').focus();await wait(2300);
 if(!document.body.classList.contains('clean-controls-visible'))throw Error('Focused window controls disappeared');
 player.pause();
 return {settingsWithinViewport:true,feedback:true,resourceVisibility:true,search:true,panelShortcut:true,keyboardFocus:true};
 })()`));
 app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
