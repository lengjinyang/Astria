const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
app.setPath('userData', path.resolve('.cache/browser-smoke-profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show:false, webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false } });
  try {
    await window.loadFile(path.resolve('index.html'));
    const url = pathToFileURL(path.resolve('.cache/media/h264.mp4')).href;
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const player=AstriaPlayback.create();
      const loaded=new Promise((resolve,reject)=>{player.addEventListener('loadeddata',resolve,{once:true});player.addEventListener('error',reject,{once:true});setTimeout(()=>reject(new Error('MP4 timeout')),5000)});
      player.open({url:${JSON.stringify(url)},name:'h264.mp4'});await loaded;
      await player.play();player.pause();const frame=await player.captureFrame();
      const result={browser:!window.desktopAPI,htmlVideo:player.surface.tagName==='VIDEO',width:frame.width,height:frame.height};
      player.destroy();return result;
    })()`);
    if (!result.browser || !result.htmlVideo || result.width !== 320) throw new Error(JSON.stringify(result));
    console.log('BROWSER_MP4_PASS', JSON.stringify(result)); app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
