Add-Type -AssemblyName System.Drawing

$assetDirectory = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null

function New-RoundedPath([int]$size, [int]$padding, [int]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $edge = $size - $padding
  $path.AddArc($padding, $padding, $diameter, $diameter, 180, 90)
  $path.AddArc($edge - $diameter, $padding, $diameter, $diameter, 270, 90)
  $path.AddArc($edge - $diameter, $edge - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($padding, $edge - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-AstriaBitmap([int]$outputSize) {
  $supersample = 4
  $size = $outputSize * $supersample
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $unit = $size / 256.0
  $path = New-RoundedPath $size ([int](8 * $unit)) ([int](52 * $unit))
  $background = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 32, 39, 53))
  $graphics.FillPath($background, $path)

  # Direction I: three frame slices, matching the approved 40 / 66 icon proportions.
  $mark = New-Object System.Drawing.Drawing2D.GraphicsPath
  $markSize = 240.0 * 40 / 66
  $markOrigin = (256 - $markSize) / 2
  $slices = @(
    @(5, 40, 27, 29, 27, 92, 5, 81),
    @(36, 24, 58, 13, 58, 87, 36, 98),
    @(67, 8, 89, 19, 89, 71, 67, 82)
  )
  foreach ($slice in $slices) {
    $points = for ($pointIndex = 0; $pointIndex -lt $slice.Count; $pointIndex += 2) {
      [System.Drawing.PointF]::new(
        [single](($markOrigin + $slice[$pointIndex] * $markSize / 100) * $unit),
        [single](($markOrigin + $slice[$pointIndex + 1] * $markSize / 100) * $unit)
      )
    }
    $mark.AddPolygon([System.Drawing.PointF[]]$points)
  }
  $ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 200, 209, 237))
  $graphics.FillPath($ink, $mark)

  $target = New-Object System.Drawing.Bitmap($outputSize, $outputSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $targetGraphics = [System.Drawing.Graphics]::FromImage($target)
  $targetGraphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $targetGraphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $targetGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $targetGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $targetGraphics.DrawImage($bitmap, 0, 0, $outputSize, $outputSize)

  $targetGraphics.Dispose()
  $ink.Dispose()
  $mark.Dispose()
  $background.Dispose()
  $path.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  return $target
}

$pngPath = Join-Path $assetDirectory 'icon.png'
$pngBitmap = New-AstriaBitmap 256
$pngBitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBitmap.Dispose()

$frames = @()
foreach ($frameSize in @(16, 20, 24, 32, 40, 48, 64, 96, 128, 256)) {
  $frameBitmap = New-AstriaBitmap $frameSize
  $memory = New-Object System.IO.MemoryStream
  $frameBitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
  $frames += [PSCustomObject]@{ Size = $frameSize; Bytes = $memory.ToArray() }
  $memory.Dispose()
  $frameBitmap.Dispose()
}

$icoPath = Join-Path $assetDirectory 'icon.ico'
$stream = [System.IO.File]::Create($icoPath)
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($frame in $frames) {
  $dimension = if ($frame.Size -ge 256) { 0 } else { $frame.Size }
  $writer.Write([Byte]$dimension)
  $writer.Write([Byte]$dimension)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$frame.Bytes.Length)
  $writer.Write([UInt32]$offset)
  $offset += $frame.Bytes.Length
}
foreach ($frame in $frames) { $writer.Write($frame.Bytes) }
$writer.Dispose()
$stream.Dispose()

Write-Output "Generated multi-resolution Astria icons: $pngPath and $icoPath"
