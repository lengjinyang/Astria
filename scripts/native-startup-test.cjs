'use strict';
const assert = require('node:assert/strict');
if (!process.argv.includes('--worker')) {
  // Isolate driver failures/hangs so native startup has a bounded regression.
  require('node:child_process').execFileSync(process.execPath, [__filename, '--worker'], { stdio: 'inherit', timeout: 15000 });
} else {
  const { MpvPlayer } = require('../native/runtime/win32-x64/astria_mpv.node');
  (async () => {
    for (let iteration = 0; iteration < 3; iteration++) {
      const abandoned = new MpvPlayer({ mode: 'shared-texture', deferInitialization: true });
      const pending = abandoned.initialize();
      abandoned.destroy();
      await assert.rejects(pending, /destroyed during initialization/);
      abandoned.destroy();
      const next = new MpvPlayer({ mode: 'shared-texture', deferInitialization: true });
      try {
        await next.initialize();
        assert.match(next.getInfo()['mpv-version'], /^mpv (?:v)?0\.41\.0/);
      } finally { next.destroy(); }
    }
    console.log('NATIVE_STARTUP_TEST_PASSED initialization cancellation, cleanup, reopen');
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
