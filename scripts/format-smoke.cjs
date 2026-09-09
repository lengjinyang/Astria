'use strict';
const path = require('node:path');
const { MediaCatalog } = require('../electron/media-catalog.cjs');
const { MpvPlayer } = require('../native/runtime/win32-x64/astria_mpv.node');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
(async () => {
  const catalog = new MediaCatalog(path.resolve('.cache/format-lists')); await catalog.initialize();
  try {
    for (const name of ['h264.mp4','prores.mov','dnxhr.mxf','hdr.mp4','sample.m2ts','sample.wmv','png/shot_1001.png','exr/shot_1001.exr','dpx/shot_1001.dpx']) {
      const media = await catalog.describe(path.resolve('.cache/media',name));
      const { source } = await catalog.source(media.mediaId,24);
      const player = new MpvPlayer({mode:'software'});
      try {
        player.setFps(24); player.open(source); let loaded=false;
        for(let n=0;n<200;n++) {
          const events=player.pollEvents();const error=events.find(e=>e.error);if(error)throw Error(name+': '+error.error);
          if(events.some(e=>e.type==='playback-restart')){loaded=true;break;}await sleep(10);
        }
        const info=player.getInfo();if(!loaded||!info.width)throw Error(name+': decode timeout');
        const frame=player.renderFrame(info.width,info.height);if(frame.rgba.length!==info.width*info.height*4)throw Error('bad frame');
        const expectedRanges = name === 'png/shot_1001.png' ? [[1003,1003]] : [];
        if(JSON.stringify(media.missingFrameRanges)!==JSON.stringify(expectedRanges))throw Error('missing frame mismatch');
        console.log('FORMAT_PASS',name,info['video-codec'],media.totalFrames,JSON.stringify(media.missingFrameRanges));
      } finally {player.destroy();}
    }
  } finally {await catalog.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
