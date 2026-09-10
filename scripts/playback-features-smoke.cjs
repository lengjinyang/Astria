'use strict';
// Requires ffmpeg on PATH. Run the native regression in a child process so a
// subtitle allocator crash is reported as a failing test, not a hanging run.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const media = path.join(root, '.cache/media/features.mp4');
const subtitle = path.join(root, '.cache/media/features.srt');
const manual = path.join(root, '.cache/media/manual-test.vtt');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function nativeRegression() {
  const { MpvPlayer } = require('../native/runtime/win32-x64/astria_mpv.node');
  for (let iteration = 0; iteration < 3; iteration++) {
    const player = new MpvPlayer({ mode: 'software' });
    const present = async () => { let frame; for(let n=0;n<10;n++){player.pollEvents();frame=player.renderFrame(640,360).rgba;await wait(30);}return frame; };
    try {
      player.open(media);
      await present();
      player.seek(.5);
      await present();
      assert(player.tracks().some(t => t.type === 'sub' && t.external && t.selected));
      const enabled = await present();
      player.configureTrack('sid', 'no');
      const disabled = await present();
      let changedPixels = 0;
      for (let i = 640 * 240 * 4; i < enabled.length; i += 4) {
        if (Math.abs(enabled[i] - disabled[i]) > 15) changedPixels++;
      }
      assert(changedPixels > 100, 'Subtitle selection did not change rendered pixels');
      player.configureTrack('aid', '2');
      player.configureTrack('audio-delay', '.15');
      player.configureTrack('sub-delay', '-.2');
      player.configureTrack('sub-scale', '1.2');
      assert(player.tracks().some(t => t.type === 'audio' && t.id === 2 && t.selected));
      const info = player.getInfo();
      assert(Math.abs(info['audio-delay'] - .15) < 1e-6);
      assert(Math.abs(info['sub-delay'] + .2) < 1e-6);
      assert(Math.abs(info['sub-scale'] - 1.2) < 1e-6);
      player.addSubtitle(manual);
      await wait(150);
      assert(player.tracks().some(t => t.external && t.selected && t['external-filename'] === manual));
      player.renderFrame(640, 360);
      console.log('SUBTITLE_NATIVE_PASS', { iteration, changedPixels });
    } finally { player.destroy(); }
  }
}

if (process.argv.includes('--native')) {
  nativeRegression().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  fs.mkdirSync(path.dirname(media), { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-c:a', 'aac', media], { stdio: 'inherit' });
  fs.writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:03,000\n字幕自动识别 · Subtitle test\n');
  fs.writeFileSync(manual, 'WEBVTT\n\n00:00.000 --> 00:03.000\n手动字幕 · Manual subtitle\n');
  execFileSync(process.execPath, [__filename, '--native'], { cwd: root, stdio: 'inherit', timeout: 15000 });
  execFileSync(require('electron'), ['.', '--smoke-test'], {
    cwd: root, stdio: 'inherit', timeout: 90000,
    env: { ...process.env, ASTRIA_SMOKE_MEDIA: media, ASTRIA_FEATURE_SMOKE: '1' }
  });
}
