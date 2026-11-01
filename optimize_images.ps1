Add-Type -AssemblyName System.Drawing

$sourceDir = $PSScriptRoot
if (-not $sourceDir) { $sourceDir = Get-Location }
$destDir = Join-Path $sourceDir "web_images"

if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir | Out-Null
}

$jpegEncoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]75)

$files = Get-ChildItem -Path $sourceDir -File -Filter "*.jpg" | Where-Object { $_.DirectoryName -ne $destDir }

$count = 0
foreach ($file in $files) {
    $destFile = Join-Path $destDir $file.Name
    if (Test-Path $destFile) {
        continue
    }

    $img = [System.Drawing.Image]::FromFile($file.FullName)
    
    $maxWidth = 1280
    $maxHeight = 1280
    $ratioX = $maxWidth / $img.Width
    $ratioY = $maxHeight / $img.Height
    $ratio = [Math]::Min($ratioX, $ratioY)
    
    if ($ratio -lt 1.0) {
        $newWidth = [int]($img.Width * $ratio)
        $newHeight = [int]($img.Height * $ratio)
    } else {
        $newWidth = $img.Width
        $newHeight = $img.Height
    }
    
    $bitmap = New-Object System.Drawing.Bitmap($newWidth, $newHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    $graphics.DrawImage($img, 0, 0, $newWidth, $newHeight)
    
    $bitmap.Save($destFile, $jpegEncoder, $encoderParams)
    
    $graphics.Dispose()
    $bitmap.Dispose()
    $img.Dispose()
    
    $count++
    if ($count % 10 -eq 0) {
        Write-Output "Optimized $count / $($files.Count) images..."
    }
}

Write-Output "Done! Optimized $count images to web_images/"
