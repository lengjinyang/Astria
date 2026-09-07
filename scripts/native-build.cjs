'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'native/runtime/win32-x64');
function build() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Astria 桌面构建目前仅支持 Windows x64');
  const electron = require('../node_modules/electron/package.json').version;
  if (electron !== '40.10.5') throw new Error('Electron 必须固定为 40.10.5');
  const vswhere = path.join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio/Installer/vswhere.exe');
  const installation = execFileSync(vswhere, ['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'], { encoding: 'utf8' }).trim();
  if (!installation) throw new Error('缺少 Visual Studio C++ x64 工具链');
  const redistRoot = path.join(installation,'VC/Redist/MSVC');
  const redistVersion = fs.readdirSync(redistRoot).filter(name => /^14\./.test(name)).sort().at(-1);
  const redist = path.join(redistRoot,redistVersion,'x64/Microsoft.VC143.CRT');
  for (const name of fs.readdirSync(redist).filter(name => name.endsWith('.dll'))) fs.copyFileSync(path.join(redist,name),path.join(runtime,name));
  for (const file of ['native/mpv/include/mpv/client.h','native/mpv/mpv.lib','native/runtime/win32-x64/libmpv-2.dll']) {
    if (!fs.existsSync(path.join(root,file))) throw new Error(`播放核心构建输入缺失：${file}`);
  }
  execFileSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'),'rebuild','--directory=native/mpv','--target=40.10.5','--arch=x64','--dist-url=https://electronjs.org/headers'], { cwd: root, stdio:'inherit' });
  fs.copyFileSync(path.join(root,'native/mpv/build/Release/astria_mpv.node'), path.join(runtime,'astria_mpv.node'));
  require('./check-runtime.cjs')(runtime);
  const manifestPath = path.join(runtime,'runtime-manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath,'utf8')) : { mpv:'0.41.0',electron:'40.10.5',architecture:'x64',license:'LGPL-2.1-or-later',files:{} };
  for (const name of fs.readdirSync(runtime).filter(name => /\.(?:dll|node)$/i.test(name))) {
    manifest.files[name] = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(runtime,name))).digest('hex');
  }
  fs.writeFileSync(path.join(runtime,'runtime-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  verify(runtime);
}
function verify(directory) {
  execFileSync(process.execPath, ['-e', `require(${JSON.stringify(__filename)}).verifyLoaded(process.argv[1])`, directory], { stdio:'inherit' });
}
function verifyLoaded(directory) {
  const core = require(path.join(directory,'astria_mpv.node'));
  const player = new core.MpvPlayer({ mode:'software' });
  try {
    const info = player.getInfo();
    if (!/^mpv (?:v)?0\.41\.0(?:\s|$)/.test(info['mpv-version'] || '')) throw new Error(`播放核心版本不符：${info['mpv-version']}`);
    if (!info['mpv-configuration']?.includes('-Dgpl=false')) throw new Error('拒绝打包未声明 LGPL 配置的 mpv');
    console.log('Native runtime loaded:', info['mpv-version'], 'LGPL', directory);
  } finally { player.destroy(); }
}
if (require.main === module) build();
module.exports = { build, verify, verifyLoaded };
