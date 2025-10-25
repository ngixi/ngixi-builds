# Find and add MSVC tools to PATH

# Try to find vswhere.exe (installed with VS 2017+)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"

if (Test-Path $vswhere) {
    Write-Host "Found vswhere.exe, locating Visual Studio installation..."
    
    # Find the latest VS installation
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    
    if ($vsPath) {
        Write-Host "Visual Studio found at: $vsPath"
        
        # Find the MSVC version
        $vcToolsPath = Join-Path $vsPath "VC\Tools\MSVC"
        if (Test-Path $vcToolsPath) {
            $msvcVersion = Get-ChildItem $vcToolsPath | Sort-Object Name -Descending | Select-Object -First 1
            
            if ($msvcVersion) {
                $msvcBinPath = Join-Path $msvcVersion.FullName "bin\Hostx64\x64"
                Write-Host "MSVC compiler found at: $msvcBinPath"
                
                # Add to PATH for this session
                $env:PATH = "$msvcBinPath;$env:PATH"
                
                # Also add Windows SDK
                $windowsSdkPath = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
                if (Test-Path $windowsSdkPath) {
                    $sdkVersion = Get-ChildItem $windowsSdkPath | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object Name -Descending | Select-Object -First 1
                    if ($sdkVersion) {
                        $sdkBinPath = Join-Path $sdkVersion.FullName "x64"
                        Write-Host "Windows SDK found at: $sdkBinPath"
                        $env:PATH = "$sdkBinPath;$env:PATH"
                    }
                }
                
                Write-Host "PATH updated successfully"
                Write-Host "cl.exe location: $(Get-Command cl.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)"
                
                # Export PATH for GitHub Actions
                if ($env:GITHUB_PATH) {
                    Add-Content -Path $env:GITHUB_PATH -Value $msvcBinPath
                    if ($sdkBinPath) {
                        Add-Content -Path $env:GITHUB_PATH -Value $sdkBinPath
                    }
                    Write-Host "Added to GitHub Actions PATH"
                }
                
                exit 0
            }
        }
    }
}

Write-Host "ERROR: Could not locate MSVC tools"
exit 1
