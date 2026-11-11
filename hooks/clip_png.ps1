# Reads a diagram picture as JSON on stdin (from png.ts), draws it as a PNG and puts it on the clipboard.
# Cells sit on a character grid: text, box-drawing pieces drawn as real lines, or filled blocks.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$pic = [Console]::In.ReadToEnd() | ConvertFrom-Json

$S = 2                       # pixels per point: draw at twice the size so the picture stays sharp
$cw = 8.4 * $S               # cell width
$lh = 18 * $S                # cell height
$pad = 12 * $S
$W = [int][math]::Ceiling($pad * 2 + $pic.cols * $cw)
$H = [int][math]::Ceiling($pad * 2 + $pic.rows * $lh)

$bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
# grayscale smoothing: ClearType needs an opaque background, this picture is transparent
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$px = [System.Drawing.GraphicsUnit]::Pixel
$font = New-Object System.Drawing.Font('Consolas', (13.5 * $S), $px)
$wide = New-Object System.Drawing.Font('Microsoft JhengHei', (13 * $S), $px)
$fmt = [System.Drawing.StringFormat]::GenericTypographic

$brushes = @{}
$pens = @{}
function Brush($color, $alpha) {
  $key = "$color/$alpha"
  if (-not $brushes.ContainsKey($key)) {
    $c = [System.Drawing.ColorTranslator]::FromHtml($color)
    $brushes[$key] = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb([int](255 * $alpha), $c))
  }
  $brushes[$key]
}
function LinePen($color, $style) {
  $key = "$color/$style"
  if (-not $pens.ContainsKey($key)) {
    $c = [System.Drawing.ColorTranslator]::FromHtml($color)
    $width = if ($style -eq 2) { 2.4 * $S } else { 1.2 * $S }
    $p = New-Object System.Drawing.Pen $c, $width
    if ($style -eq 1) { $p.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dot }
    $pens[$key] = $p
  }
  $pens[$key]
}

foreach ($c in $pic.cells) {
  $x0 = $pad + $c.x * $cw
  $y0 = $pad + $c.y * $lh
  if ($null -ne $c.b) {
    # box piece: a line from the cell centre to each side it reaches (1 up, 2 down, 4 left, 8 right)
    $p = LinePen $c.c $c.s
    $cx = $x0 + $cw / 2
    $cy = $y0 + $lh / 2
    if ($c.b -band 1) { $g.DrawLine($p, $cx, $y0, $cx, $cy) }
    if ($c.b -band 2) { $g.DrawLine($p, $cx, $cy, $cx, $y0 + $lh) }
    if ($c.b -band 4) { $g.DrawLine($p, $x0, $cy, $cx, $cy) }
    if ($c.b -band 8) { $g.DrawLine($p, $cx, $cy, $x0 + $cw, $cy) }
  } elseif ($null -ne $c.f) {
    $g.FillRectangle((Brush $c.c $c.f), $x0, ($y0 + 3 * $S), ($cw + 0.5), ($lh - 6 * $S))
  } else {
    $f = if ($c.w -eq 2) { $wide } else { $font }
    $g.DrawString($c.t, $f, (Brush $c.c 1), $x0, ($y0 + 1.5 * $S), $fmt)
  }
}

# Two formats: "PNG" keeps the transparency (Office, browsers, most chat apps read it),
# the plain bitmap is for apps that only read that one. It cannot be transparent, so it gets
# the terminal background instead of turning black.
$png = New-Object System.IO.MemoryStream
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$flat = New-Object System.Drawing.Bitmap $W, $H
$fg = [System.Drawing.Graphics]::FromImage($flat)
$fg.Clear([System.Drawing.ColorTranslator]::FromHtml($pic.bg))
$fg.DrawImage($bmp, 0, 0, $W, $H)
$fg.Dispose()
$data = New-Object System.Windows.Forms.DataObject
$data.SetData('PNG', $false, $png)
$data.SetImage($flat)
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
$flat.Dispose()
$g.Dispose()
$bmp.Dispose()
