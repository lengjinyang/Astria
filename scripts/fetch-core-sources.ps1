$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$sourceLock = Get-Content native/source-lock.json -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force .cache/sources,.cache/toolchain | Out-Null
foreach ($entry in $sourceLock.PSObject.Properties) {
  $name = $entry.Name
  $archive = Join-Path (Resolve-Path .cache) ($name + '.zip')
  if (!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest $entry.Value.url -OutFile $archive }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value.sha256) { throw "Source checksum mismatch: $name" }
  $destination = if ($name -eq 'llvm') { '.cache/toolchain' } elseif ($name -eq 'dependencies') { '.cache/libmpv' } else { '.cache/sources' }
  Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
}
$compilerBin = '.cache/toolchain/llvm-mingw-20260826-ucrt-x86_64/bin'
Copy-Item "$compilerBin/clang-23.exe" "$compilerBin/clang-cl.exe" -Force
Copy-Item "$compilerBin/ld.lld.exe" "$compilerBin/lld-link.exe" -Force
node scripts/prepare-libmpv-sdk.cjs
if ($LASTEXITCODE -ne 0) { throw 'SDK preparation failed' }
