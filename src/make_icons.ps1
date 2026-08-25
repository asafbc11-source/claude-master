Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

function Make-Icon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $c1 = [System.Drawing.Color]::FromArgb(224, 122, 82)
  $c2 = [System.Drawing.Color]::FromArgb(158, 71, 40)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, [single]55)
  $g.FillRectangle($brush, $rect)
  # subtle star burst dots
  $white = [System.Drawing.Brushes]::White
  $font = New-Object System.Drawing.Font("Segoe UI", [single]($size * 0.44), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rectF = New-Object System.Drawing.RectangleF(0, [single](-$size * 0.02), [single]$size, [single]$size)
  $g.DrawString([string][char]0x05E7, $font, $white, $rectF, $sf)  # Hebrew letter Qof
  $small = New-Object System.Drawing.Font("Segoe UI", [single]($size * 0.11), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $rectF2 = New-Object System.Drawing.RectangleF(0, [single]($size * 0.30), [single]$size, [single]$size)
  $g.DrawString("*", $small, $white, $rectF2, $sf)
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("saved " + $path)
}

Make-Icon 512 (Join-Path $root "icon-512.png")
Make-Icon 192 (Join-Path $root "icon-192.png")
