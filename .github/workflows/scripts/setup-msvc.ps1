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
                $msvcLibPath = Join-Path $msvcVersion.FullName "lib\x64"
                $msvcIncludePath = Join-Path $msvcVersion.FullName "include"
                $atlmfcIncludePath = Join-Path $msvcVersion.FullName "atlmfc\include"
                $atlmfcLibPath = Join-Path $msvcVersion.FullName "atlmfc\lib\x64"
                
                Write-Host "MSVC compiler found at: $msvcBinPath"
                Write-Host "MSVC libraries at: $msvcLibPath"
                Write-Host "MSVC includes at: $msvcIncludePath"
                
                # Add to PATH for this session
                $env:PATH = "$msvcBinPath;$env:PATH"
                
                # Add MSVC lib and include paths
                $env:LIB = "$msvcLibPath;$env:LIB"
                $env:INCLUDE = "$msvcIncludePath;$env:INCLUDE"
                
                # Add ATL/MFC if available
                if (Test-Path $atlmfcIncludePath) {
                    Write-Host "ATL/MFC includes at: $atlmfcIncludePath"
                    $env:INCLUDE = "$atlmfcIncludePath;$env:INCLUDE"
                }
                if (Test-Path $atlmfcLibPath) {
                    Write-Host "ATL/MFC libraries at: $atlmfcLibPath"
                    $env:LIB = "$atlmfcLibPath;$env:LIB"
                }
                
                Write-Host "MSVC environment configured successfully"
                Write-Host "cl.exe location: $(Get-Command cl.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)"
                
                # Export for GitHub Actions
                if ($env:GITHUB_PATH) {
                    Add-Content -Path $env:GITHUB_PATH -Value $msvcBinPath
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

Write-Host "ERROR: Could not locate MSVC tools"
exit 1
