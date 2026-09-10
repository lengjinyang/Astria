# Astria playback dependencies

The Astria N-API bridge is maintained in `native/mpv`. Its shared-texture
implementation derives from **electron-mpv-video commit 4944079**, copyright
2026 electron-mpv-video contributors, under the MIT license reproduced in
`licenses/electron-mpv-video-MIT.txt`.

The desktop player dynamically links **mpv 0.41.0**. Only an LGPL build with
`-Dgpl=false` is permitted. FFmpeg must also exclude GPL, nonfree and version3
components. A download name or current upstream build script is not proof
of the contents of an older binary. Packaging validates the actual loaded mpv
version and requires a complete runtime directory.

mpv and FFmpeg are separate works under LGPL-2.1-or-later when built with these
restrictions. Upstream sources and license texts:

- https://github.com/mpv-player/mpv/tree/v0.41.0
- https://github.com/FFmpeg/FFmpeg
- https://github.com/haasn/libplacebo

Runtime DLLs and `astria_mpv.node` are distributed outside ASAR under
`resources/mpv`. Users may replace the DLLs with ABI-compatible builds,
including modified builds, without rebuilding or signing the Astria JavaScript.
Keep the DLL names and x64 architecture, and replace dependencies together.
The bridge source and its build instructions must accompany a distribution.
No application integrity check prohibits replacing these dynamic libraries.

The bundled mpv DLL is built by Astria from v0.41.0, with an LGPL software
color-output extension and ASS string allocator bridge in native/core-patches. Its dependency DLLs originate
from the SHA-256-pinned Paxton-PKJ/libmpv Windows archive, built at commit
4aec8f7e9e4cff9e2d997ca8574b220d9de1c432. That archive's mpv 0.38.0 is not used.
The actual FFmpeg license query returns LGPL version 2.1 or later; its build
configuration includes --disable-gpl and --disable-version3. The displayed
FFmpeg string 4aec8f7 refers to the outer build repository, whose archived
workflow selects FFmpeg n6.1.1, rather than an FFmpeg source commit.

See native/source-lock.json, native/README.md and the archived dependency
workflow for source versions, hashes, modifications and rebuilding.

Additional runtime components include FreeType 2.14.3 (FTL), HarfBuzz 14.2.1
(MIT), FriBidi 1.0.16 (LGPL-2.1+), GLib 2.88.1 (LGPL-2.1+), Graphite2 (MIT),
libpng 1.6.58 (libpng license), zlib 1.3.2 (zlib license), bzip2 1.0.8 (BSD-like),
xz/liblzma 5.8.3 (0BSD and public-domain components), Brotli (MIT), PCRE2 (BSD),
libiconv and libintl (LGPL), shaderc (Apache-2.0), GCC runtime DLLs (GPL with
GCC Runtime Library Exception), winpthreads (MIT-compatible), and Microsoft
Visual C++ Redistributable DLLs under Microsoft's redistributable terms.

The LGPL component source archives are included under licenses/sources.
Astria bridge source, LGPL changes and build scripts accompany those archives.
The unchanged transitive LGPL sources are GLib 2.88.1, FriBidi 1.0.16,
libiconv 1.19 and gettext-runtime 1.0. Permissive dependency licenses and
GCC's Runtime Library Exception are reproduced in licenses. Shaderc embeds
SPIR-V/glslang components whose notices are included there as well.

Portions of this software are copyright © 2026 The FreeType Project
(https://www.freetype.org). All rights reserved.

Microsoft Visual C++ runtime files are redistributed under the Visual Studio
2022 redistributable terms; see the included Microsoft redistributable list.
