# libmpv migration validation

Windows x64 development build, 2026-09-07. Electron 40.10.5,
mpv v0.41.0 built with `-Dgpl=false`; bundled FFmpeg reports LGPL 2.1+.

Completed checks:

- `npm run check`: JavaScript syntax checks passed.
- Native addon loads, verifies actual mpv version and LGPL build option.
- Runtime dependency closure: 39 `.node`/DLL files, no missing imported DLLs.
- Content probing with an MP4 renamed to an unknown extension succeeds.
- Decode/frame samples: H.264/MP4, ProRes/MOV, DNxHR/MXF, 10-bit HEVC/PQ,
  H.264/M2TS, WMV2/WMV; continuous EXR/DPX and gapped PNG sequences.
- Actual Electron playback on shared textures and software/WebGL2 output:
  pause/play, exact seek, decoder forward/back step, speed, mute/volume,
  original-size capture, LUT/LUMA, pixel inspection, bookmark thumbnails,
  rectangle annotation, PNG export and Contact Sheet export.
- Sequence check: source frame 1001, missing 1003 held from previous frame,
  missing-frame overlay, 24→48 FPS duration adjustment preserving pause,
  stable identity after frame 1005 is added, bookmark and FPS restore.
- Browser HTMLVideo adapter MP4 playback and capture passed.
- electron-builder unpacked app and NSIS installer built; packaged native
  runtime location is verified in a fresh child process. The packaged Astria.exe
  also completed the ProRes shared-texture UI smoke scenario (exit 0).
- Visual inspection caught and fixed shared-texture vertical inversion and
  hidden-bookmark focus scrolling the entire viewport after Electron upgrade.

The smoke scenario was rerun only to diagnose and verify concrete failures
during migration, and once for the software backend. It uses isolated user
data and generated small fixtures, not the user's workspaces.

Remaining acceptance limits:

- No clean Windows VM/Sandbox is available on this machine. Installing and
  running on a clean Windows x64 machine without mpv/FFmpeg is still pending.
- HDR/EXR behavior is best-effort metadata interpretation, not an OCIO or
  calibrated display certification. Software and GPU output are separate
  implementations of the SDR target; exact per-pixel matching is not claimed.
- Forge packaging hooks and associations are implemented; the produced
  installer in this validation is electron-builder NSIS.
- VFR frame counts remain estimates; decoder stepping is authoritative.

Artifacts: `out/builder/Astria-Setup-0.8.8.exe`,
`out/builder/win-unpacked/Astria.exe`, `out/mpv-smoke.png`.
Build and LGPL replacement instructions: `native/README.md`.
