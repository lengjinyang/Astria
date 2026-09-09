const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'); const path=require('node:path'); const vm=require('node:vm');
app.setPath('userData',path.resolve('.cache/review-regression-profile'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
 try {
  const source=fs.readFileSync('app.js','utf8');
  const body=source.slice(source.indexOf('  function persistCurrentWorkspaceNow()'),source.indexOf('  async function activateMediaWorkspace'));
  let writes=0;
  const context={state:{currentWorkspaceReady:false,autosave:true,currentMediaKey:'loading'},clearTimeout(){},persistPreferences(){},rememberedPlaybackPosition(){return 0;},persistMediaSnapshot(){writes++;},workspaceData(){return {};},toast(){},els:{notesSaved:{}}};
  vm.createContext(context);vm.runInContext(body+'persistCurrentWorkspaceNow();',context);
  if(writes)throw Error('Loading workspace was saved');
  context.state.currentWorkspaceReady=true;vm.runInContext('persistCurrentWorkspaceNow();',context);
  if(writes!==1)throw Error('Ready workspace was not saved');
  await win.loadFile(path.resolve('index.html'));
  await win.webContents.executeJavaScript(`window.desktopAPI={browseDirectory:async()=>({path:'C:\\\\fixtures',parent:'C:\\\\',entries:Array.from({length:100},(_,i)=>({name:'shot_'+i+'.mp4',path:'C:\\\\fixtures\\\\shot_'+i+'.mp4',directory:false}))})};undefined;`);
  await win.webContents.executeJavaScript(fs.readFileSync('resource-browser.js','utf8'));
  const result=await win.webContents.executeJavaScript(`(async()=>{
   const wait=()=>new Promise(r=>setTimeout(r,50)); let opened;
   videoResourceBrowser.init(path=>{opened=path;videoResourceBrowser.setMedia(path)});
   document.getElementById('toggleResourceBrowser').click(); await wait();
   const search=document.getElementById('resourceSearch'),list=document.getElementById('resourceList');
   search.value='shot_1';search.dispatchEvent(new Event('input'));list.querySelector('button').dispatchEvent(new MouseEvent('dblclick'));await wait();
   if(search.value!=='shot_1')throw Error('Filter reset');
   list.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
   if(!document.activeElement.dataset.path?.endsWith('shot_19.mp4'))throw Error('Keyboard selection failed');
   const selected=document.activeElement.dataset.path;list.dispatchEvent(new Event('scroll'));
   if(document.activeElement.dataset.path!==selected)throw Error('Focus lost');
   document.getElementById('resourceRefresh').click();await wait();
   if(search.value!=='shot_1')throw Error('Refresh reset filter');
   document.getElementById('resourceLocate').click();await wait();
   if(!list.querySelector('.selected')?.dataset.path.endsWith('shot_1.mp4'))throw Error('Locate failed');
   return {filter:true,keyboard:true,focus:true,refresh:true,locate:true};
  })()`);
  console.log('REVIEW_REGRESSION_PASS',JSON.stringify(result));app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});

