# Update Zig to latest nightly build

$zigDir = "C:\tools\zig"
$tempZip = "$env:TEMP\zig-nightly.zip"

# Remove existing zig folder
if (Test-Path $zigDir) {
    Write-Host "Removing existing Zig installation..."
    Remove-Item -Recurse -Force $zigDir
}

# Download latest nightly - UPDATE THIS URL FROM https://ziglang.org/download/
$url = "https://ziglang.org/builds/zig-x86_64-windows-0.16.0-dev.1204+389368392.zip"
Write-Host "Downloading latest Zig nightly from $url..."
Invoke-WebRequest -Uri $url -OutFile $tempZip -UseBasicParsing

# Extract to temp location
$tempExtract = "$env:TEMP\zig-extract"
if (Test-Path $tempExtract) {
    Remove-Item -Recurse -Force $tempExtract
}
Write-Host "Extracting..."
Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force

# Move extracted folder to C:\tools\zig
$extractedFolder = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1
Move-Item -Path $extractedFolder.FullName -Destination $zigDir -Force

# Cleanup
Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $tempExtract -ErrorAction SilentlyContinue

Write-Host "Done"
