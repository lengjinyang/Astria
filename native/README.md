# Windows x64 playback core

Astria owns the bridge in `mpv/src/mpv_addon.cc`. The WGL/D3D11 sharing code
originates from electron-mpv-video commit `4944079` (MIT). No npm player wrapper
is used at runtime. Electron is pinned to 40.10.5; the bridge uses N-API and is
rebuilt against those Electron headers for every package build.

## Startup initialization

Desktop sessions construct `MpvPlayer` with `deferInitialization: true` and await
`initialize()` before attaching callbacks or issuing playback commands. On Windows,
mpv and WGL/D3D11 initialization run in a N-API worker. The hidden HWND is created
and destroyed on the main thread; the worker releases the GL context before the
render thread takes ownership. Closing a session waits for initialization to settle
before releasing native resources. The default constructor remains synchronous for
existing build tooling.

Loading the addon and its DLL dependencies still happens synchronously. The renderer
can prepare a saved playback poster while initialization is in progress. File-launch
windows can reveal a cached poster after the complete playback shell is laid out.
Controls stay disabled until the decoded frame is ready. Without a poster, the window
waits for the decoded frame. Both paths keep HTML opaque, show the native window
at zero opacity, allow two renderer animation frames, and then set native opacity
to one. There is no screenshot readback or timer-driven native fade. Deferred
workspace work and autoplay are released after the opacity commit. Launch state
includes duration and source dimensions; older saved states use the poster ratio.

Startup trace `window.shown` now describes the zero-opacity native show;
`window.full-opacity` is the user-visible reveal. Compare full-opacity times
between versions rather than the earlier native-show timestamp.

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

`core-patches/astria_ass_alloc.h` bridges public ASS style/event string ownership:
the bundled libass allocates in legacy `msvcrt.dll`, whereas mpv uses UCRT.
These strings must be allocated and freed with libass's allocator. SDK preparation
patches the seven allocation/free sites in `ass_mp.c`, `sd_ass.c` and
`osd_libass.c` and verifies the dependency's CRT before applying the bridge.
Changing libass to a UCRT build requires updating this bridge and rebuilding mpv.
Run `npm run check:playback` to exercise actual subtitle rendering and destruction.
The software render target is opaque RGB0 (returned to JavaScript as RGBA with
alpha 255). This avoids an unsupported straight/premultiplied-alpha conversion
in FFmpeg 6 when blending subtitles. GPU and software paths both render subtitles.
Set `ASTRIA_MPV_LOG=1` for verbose core diagnostics during local troubleshooting.

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
