$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsInstallation = & $vswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
Import-Module (Join-Path $vsInstallation 'Common7/Tools/Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vsInstallation -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
$env:PATH = ((Resolve-Path '.cache/toolchain/llvm-mingw-20260826-ucrt-x86_64/bin').Path + ';') + "$env:APPDATA/Python/Python314/Scripts;" + $env:PATH
$env:CC = 'clang-cl --target=x86_64-pc-windows-msvc'
$env:CXX = 'clang-cl --target=x86_64-pc-windows-msvc'
$env:CC_LD = 'lld-link'
$env:WINDRES = 'rc'
python -m mesonbuild.mesonmain setup .cache/mpv-clang .cache/sources/mpv-0.41.0 --buildtype=release  -Dgpl=false -Dlibmpv=true -Dcplayer=false -Dtests=false -Dlua=disabled -Djavascript=disabled -Dlibarchive=disabled -Dmanpage-build=disabled -Dhtml-build=disabled -Dpdf-build=disabled -Dvulkan=disabled -Dd3d11=disabled -Dgl=enabled --wrap-mode=nofallback
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python -m mesonbuild.mesonmain compile -C .cache/mpv-clang -j 8
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
New-Item -ItemType Directory -Force native/runtime/win32-x64,native/mpv/include/mpv | Out-Null
Get-ChildItem .cache/libmpv/bin/*.dll | Where-Object Name -ne 'libmpv-2.dll' | Copy-Item -Destination native/runtime/win32-x64 -Force
Copy-Item .cache/mpv-clang/mpv-2.dll native/runtime/win32-x64/libmpv-2.dll -Force
Copy-Item .cache/sources/mpv-0.41.0/include/mpv/*.h native/mpv/include/mpv -Force
$exportNames = & dumpbin.exe /exports native/runtime/win32-x64/libmpv-2.dll | ForEach-Object { if ($_ -match '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(mpv_\w+)') { $matches[1] } }
@('LIBRARY libmpv-2.dll','EXPORTS') + $exportNames | Set-Content native/mpv/mpv.def
& lib.exe /def:native/mpv/mpv.def /out:native/mpv/mpv.lib /machine:x64
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }






