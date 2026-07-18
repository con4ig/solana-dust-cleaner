Add-Type -AssemblyName System.Drawing

$srcPath = "c:\Users\Szymon\Desktop\Solana_dust_cleaner\src\app\icon.png"
$destPath = "c:\Users\Szymon\Desktop\Solana_dust_cleaner\public\og-image.png"

# Create target directory if not exists
$destDir = Split-Path $destPath
if (!(Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force
}

# Load source image
$srcImg = [System.Drawing.Image]::FromFile($srcPath)

# Target dimensions
$targetWidth = 1200
$targetHeight = 630

# Create new black bitmap
$bmp = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
$g = [System.Drawing.Graphics]::FromImage($bmp)

# Fill background with black
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
$g.FillRectangle($brush, 0, 0, $targetWidth, $targetHeight)

# Calculate centered dimensions for source image (e.g. max height of 350px)
$maxHeight = 350
$scale = $maxHeight / $srcImg.Height
if (($srcImg.Width * $scale) -gt ($targetWidth - 100)) {
    $scale = ($targetWidth - 100) / $srcImg.Width
}

$drawWidth = [int]($srcImg.Width * $scale)
$drawHeight = [int]($srcImg.Height * $scale)

$x = [int](($targetWidth - $drawWidth) / 2)
$y = [int](($targetHeight - $drawHeight) / 2)

# Draw image with high quality settings
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$g.DrawImage($srcImg, $x, $y, $drawWidth, $drawHeight)

# Save image
$bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Clean up
$g.Dispose()
$bmp.Dispose()
$srcImg.Dispose()
$brush.Dispose()

Write-Host "Successfully generated clean OG image at: $destPath"
