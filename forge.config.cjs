const path = require('node:path');

module.exports = {
  hooks: {
    prePackage: async () => require('./scripts/native-build.cjs').build(),
    postPackage: async (_config, result) => {
      for (const output of result.outputPaths) require('./scripts/native-build.cjs').verify(path.join(output, 'resources', 'win32-x64'));
    }
  },
  packagerConfig: {
    asar: true,
    extraResource: [path.join(__dirname, 'native/runtime/win32-x64'), path.join(__dirname, 'licenses')],
    icon: path.join(__dirname, 'assets', 'icon'),
    executableName: 'Astria',
    appBundleId: 'com.astria.player',
    appCategoryType: 'public.app-category.graphics-design',
    win32metadata: {
      CompanyName: 'Astria',
      FileDescription: 'Professional frame review player for VFX artists',
      InternalName: 'Astria',
      OriginalFilename: 'Astria.exe',
      ProductName: 'Astria'
    },
    ignore: [
      /^\/\.git($|\/)/,
      /^\/\.agents($|\/)/,
      /^\/out($|\/)/,
      /^\/\.cache($|\/)/,
      /^\/native($|\/)/,
      /^\/licenses($|\/)/,
      /^\/VFX_Player_PRD_v0\.1\.md$/
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'astria',
        authors: 'Astria',
        description: 'Professional frame review player for VFX artists',
        setupExe: 'Astria-Setup.exe',
        setupIcon: path.join(__dirname, 'assets', 'icon.ico'),
        noMsi: false
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'darwin']
    }
  ]
};
