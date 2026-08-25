Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

# Draws the app mark: an original four-point spark in Claude's coral palette,
# with "Learning Claude" beneath it. Everything stays inside the maskable safe
# zone (a centred circle of ~78% diameter) so no launcher crops the wordmark.
function New-Mark([int]$S) {
  $bmp = New-Object System.Drawing.Bitmap($S, $S)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  # background: warm coral gradient
  $rect = New-Object System.Drawing.Rectangle(0, 0, $S, $S)
  $c1 = [System.Drawing.Color]::FromArgb(226, 140, 104)
  $c2 = [System.Drawing.Color]::FromArgb(158, 71, 40)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, [single]125)
  $g.FillRectangle($bg, $rect)

  # radial glow behind the spark — fades to nothing so it leaves no visible seam
  $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gr = $S * 0.42
  $glowPath.AddEllipse([single]($S*0.5 - $gr), [single]($S*0.40 - $gr), [single]($gr*2), [single]($gr*2))
  $glow = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
  $glow.CenterColor = [System.Drawing.Color]::FromArgb(64, 255, 255, 255)
  $glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
  $g.FillPath($glow, $glowPath)

  # --- the spark ---------------------------------------------------------
  $cx = $S * 0.5
  $cy = $S * 0.40
  $R  = $S * 0.205          # arm length
  $w  = $R * 0.30           # waist: how deeply the sides curve inward

  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddBezier([single]$cx, [single]($cy-$R), [single]($cx+$w*0.16), [single]($cy-$w),
               [single]($cx+$w), [single]($cy-$w*0.16), [single]($cx+$R), [single]$cy)
  $p.AddBezier([single]($cx+$R), [single]$cy, [single]($cx+$w), [single]($cy+$w*0.16),
               [single]($cx+$w*0.16), [single]($cy+$w), [single]$cx, [single]($cy+$R))
  $p.AddBezier([single]$cx, [single]($cy+$R), [single]($cx-$w*0.16), [single]($cy+$w),
               [single]($cx-$w), [single]($cy+$w*0.16), [single]($cx-$R), [single]$cy)
  $p.AddBezier([single]($cx-$R), [single]$cy, [single]($cx-$w), [single]($cy-$w*0.16),
               [single]($cx-$w*0.16), [single]($cy-$w), [single]$cx, [single]($cy-$R))
  $p.CloseFigure()
  $g.FillPath([System.Drawing.Brushes]::White, $p)

  # two small companion sparks for a sense of motion
  function Add-MiniSpark($gx, $gy, $r, $alpha) {
    $q = New-Object System.Drawing.Drawing2D.GraphicsPath
    $k = $r * 0.32
    $q.AddBezier([single]$gx, [single]($gy-$r), [single]($gx+$k*0.16), [single]($gy-$k),
                 [single]($gx+$k), [single]($gy-$k*0.16), [single]($gx+$r), [single]$gy)
    $q.AddBezier([single]($gx+$r), [single]$gy, [single]($gx+$k), [single]($gy+$k*0.16),
                 [single]($gx+$k*0.16), [single]($gy+$k), [single]$gx, [single]($gy+$r))
    $q.AddBezier([single]$gx, [single]($gy+$r), [single]($gx-$k*0.16), [single]($gy+$k),
                 [single]($gx-$k), [single]($gy+$k*0.16), [single]($gx-$r), [single]$gy)
    $q.AddBezier([single]($gx-$r), [single]$gy, [single]($gx-$k), [single]($gy-$k*0.16),
                 [single]($gx-$k*0.16), [single]($gy-$k), [single]$gx, [single]($gy-$r))
    $q.CloseFigure()
    $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, 255, 255, 255))
    $g.FillPath($b, $q)
  }
  Add-MiniSpark ($cx + $R*1.02) ($cy - $R*0.72) ($R*0.20) 205
  Add-MiniSpark ($cx - $R*0.95) ($cy + $R*0.80) ($R*0.14) 150

  # --- wordmark ----------------------------------------------------------
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment     = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

  $font = New-Object System.Drawing.Font("Segoe UI", [single]($S*0.093),
            [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $box = New-Object System.Drawing.RectangleF(0, [single]($S*0.665), [single]$S, [single]($S*0.14))
  $g.DrawString("Learning", $font, [System.Drawing.Brushes]::White, $box, $sf)

  $box2 = New-Object System.Drawing.RectangleF(0, [single]($S*0.775), [single]$S, [single]($S*0.14))
  $g.DrawString("Claude", $font, [System.Drawing.Brushes]::White, $box2, $sf)

  $g.Dispose()
  return $bmp
}

# render once at high resolution, then downscale so both sizes stay identical
$master = New-Mark 512
$master.Save((Join-Path $root "icon-512.png"), [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "saved icon-512.png"

$small = New-Object System.Drawing.Bitmap(192, 192)
$gs = [System.Drawing.Graphics]::FromImage($small)
$gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gs.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gs.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gs.DrawImage($master, 0, 0, 192, 192)
$gs.Dispose()
$small.Save((Join-Path $root "icon-192.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$small.Dispose()
$master.Dispose()
Write-Output "saved icon-192.png"
