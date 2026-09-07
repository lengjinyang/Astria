'use strict';
const { execFileSync } = require('node:child_process');
const formats = require('../media-formats.js');
// Squirrel does not implement electron-builder's fileAssociations option.
// Register OpenWith entries, leaving the user's default application choice intact.
module.exports = function squirrelAssociations(argv) {
  if (process.platform !== 'win32') return;
  const install = argv.some(arg => arg === '--squirrel-install' || arg === '--squirrel-updated');
  const uninstall = argv.includes('--squirrel-uninstall');
  if (!install && !uninstall) return;
  const root = 'HKCU\\Software\\Classes', progId = 'Astria.Media';
  const reg = args => execFileSync('reg.exe', args, { windowsHide:true, stdio:'ignore' });
  const remove = args => { try { reg(['delete', ...args, '/f']); } catch { /* already absent */ } };
  if (install) {
    reg(['add',`${root}\\${progId}`,'/ve','/d','Astria Media','/f']);
    reg(['add',`${root}\\${progId}\\DefaultIcon`,'/ve','/d',`"${process.execPath}",0`,'/f']);
    reg(['add',`${root}\\${progId}\\shell\\open\\command`,'/ve','/d',`"${process.execPath}" "%1"`,'/f']);
  } else remove([`${root}\\${progId}`]);
  for (const extension of formats.associated) {
    const key = `${root}\\.${extension}\\OpenWithProgids`;
    if (install) reg(['add',key,'/v',progId,'/t','REG_NONE','/f']);
    else remove([key,'/v',progId]);
  }
};
