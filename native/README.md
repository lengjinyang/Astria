# Windows x64 playback core

Astria owns the bridge in `mpv/src/mpv_addon.cc`. The WGL/D3D11 sharing code
originates from electron-mpv-video commit `4944079` (MIT). No npm player wrapper
is used at runtime. Electron is pinned to 40.10.5; the bridge uses N-API and is
rebuilt against those Electron headers for every package build.

## Rebuild libmpv

Prerequisites: Visual Studio 2022 C++ x64 tools and Windows SDK, Node.js,
Python, Meson 1.9.2 and Ninja 1.13.0. Install the Python packages with:

```powershell
python -m pip install meson==1.9.2 ninja==1.13.0
./scripts/fetch-core-sources.ps1
./scripts/build-libmpv.ps1
npm run native:build
```

Downloads are pinned by SHA-256 in `source-lock.json`. The dependency archive
contains mpv 0.38.0, which is deliberately discarded. Astria builds mpv v0.41.0
with `-Dgpl=false`, disabled scripting/archive/navigation integrations, and
links against the archive's LGPL FFmpeg 6.1.1 and libplacebo 6.338.2 DLLs.
The original dependency build recipe at commit
`4aec8f7e9e4cff9e2d997ca8574b220d9de1c432` is included in `licenses`.

`core-patches/astria_sdr.h` is an LGPL extension of libmpv's software renderer:
it retains float RGB through conversion, applies libplacebo primary adaptation
and BT.2390 tone mapping, then encodes 100-nit Rec.709/BT.1886. The main GPU
path uses mpv's renderer settings. Shared textures are tagged gamma 2.4;
software frames are converted to sRGB for canvas compositing by WebGL2.
Both paths expose an original-dimension compositing canvas to review tools.

The build preparation adds MSVC import libraries for the dependency DLLs and
adapts the resource compiler option to Windows SDK `rc.exe`. The original mpv
source version is unchanged. Generated files live under `.cache`; runtime
files live under `native/runtime/win32-x64` and are copied outside ASAR.

## Packaging

`npm run make:win` uses electron-builder; `npm run make:forge` uses Forge.
Both preflight the toolchain, rebuild the addon, stage Microsoft VC runtime
DLLs, and load the packaged addon to verify version and DLL placement.
Forge uses `resources/win32-x64`; builder uses `resources/mpv`. Neither
runtime path searches an installed mpv or FFmpeg on PATH.

Replacing compatible x64 DLLs in that directory is supported. Rebuilding the
JavaScript application is unnecessary. Distribution still requires notices
and corresponding sources for **all** bundled dependencies; consult the
third-party notices before publishing an installer.
