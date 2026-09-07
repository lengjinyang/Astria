const formats = require('./media-formats.js');
module.exports = {
  ...require('./package.json').build,
  beforePack: () => require('./scripts/native-build.cjs').build(),
  afterPack: context => require('./scripts/native-build.cjs').verify(require('node:path').join(context.appOutDir, 'resources/mpv')),
  extraResources: [{ from: 'native/runtime/win32-x64', to: 'mpv', filter: ['*.node','*.dll','*.json'] }, { from: 'licenses', to: 'licenses' }],
  fileAssociations: [{ ext: formats.associated, name: 'Astria Media', description: 'Media opened with Astria', icon: 'assets/icon.ico', role: 'Viewer' }]
};
