# Find and add Windows SDK to PATH

Write-Host "Searching for Windows SDK..."

# Check both possible SDK locations
$sdkPaths = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10",
    "${env:ProgramFiles}\Windows Kits\10"
)

foreach ($basePath in $sdkPaths) {
    if (Test-Path $basePath) {
        Write-Host "Found Windows SDK base path: $basePath"
        
        # Find the latest SDK version in bin directory
        $binPath = Join-Path $basePath "bin"
        if (Test-Path $binPath) {
            $sdkVersion = Get-ChildItem $binPath | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object Name -Descending | Select-Object -First 1
            
            if ($sdkVersion) {
                $sdkBinPath = Join-Path $sdkVersion.FullName "x64"
                Write-Host "Windows SDK version: $($sdkVersion.Name)"
                Write-Host "SDK binaries at: $sdkBinPath"
                
                # Add to PATH
                $env:PATH = "$sdkBinPath;$env:PATH"
                
                # Find lib path
                $libPath = Join-Path $basePath "Lib\$($sdkVersion.Name)\um\x64"
                $ucrtPath = Join-Path $basePath "Lib\$($sdkVersion.Name)\ucrt\x64"
                
                if (Test-Path $libPath) {
                    Write-Host "SDK libraries at: $libPath"
                    $env:LIB = "$libPath;$ucrtPath;$env:LIB"
                }
                
                # Find include paths
                $includeBase = Join-Path $basePath "Include\$($sdkVersion.Name)"
                if (Test-Path $includeBase) {
                    $umInclude = Join-Path $includeBase "um"
                    $ucrtInclude = Join-Path $includeBase "ucrt"
                    $sharedInclude = Join-Path $includeBase "shared"
                    $winrtInclude = Join-Path $includeBase "winrt"
                    $cppwinrtInclude = Join-Path $includeBase "cppwinrt"
                    
                    Write-Host "SDK includes at: $includeBase"
                    $env:INCLUDE = "$umInclude;$ucrtInclude;$sharedInclude;$winrtInclude;$cppwinrtInclude;$env:INCLUDE"
                }
                
                Write-Host "Windows SDK environment configured successfully"
                
                # Export for GitHub Actions
                if ($env:GITHUB_PATH) {
                    Add-Content -Path $env:GITHUB_PATH -Value $sdkBinPath
                }
                if ($env:GITHUB_ENV) {
                    Add-Content -Path $env:GITHUB_ENV -Value "LIB=$env:LIB"
                    Add-Content -Path $env:GITHUB_ENV -Value "INCLUDE=$env:INCLUDE"
                }
                
                exit 0
            }
        }
    }
}

Write-Host "ERROR: Could not locate Windows SDK"
exit 1
