import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import { scopedLogger } from '../logging.js';
import { resolveCommand, runCommand, runPyenv } from './command-runner.js';

const require = createRequire(import.meta.url);
const log = scopedLogger('platform-checks');

/**
 * Checks for Windows SDK 10.0.22631 or newer and adds it to PATH, INCLUDE, and LIB.
 * @returns {Object} Check result with ok, version, path, binPath, includePaths, libPaths
 */
export function checkWindowsSDK() {
  log.info('checking for Windows SDK 10.0.22631.x or newer');

  if (process.platform !== 'win32') {
    return { ok: true, skipped: true, reason: 'not on Windows' };
  }

  // Query registry for Windows SDK root path
  const regQuery = runCommand('C:\\Windows\\System32\\reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots'], {
    stdio: 'pipe',
    shell: false,
  });

  if (!regQuery.ok) {
    return {
      ok: false,
      reason: 'Windows SDK not found in registry',
      hint: 'Install Windows SDK 10.0.22631 or newer from https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/',
    };
  }

  // Parse KitsRoot10 path from registry
  const match = regQuery.stdout.match(/KitsRoot10\s+REG_SZ\s+(.+)/);
  if (!match) {
    return {
      ok: false,
      reason: 'Could not parse KitsRoot10 from registry',
      hint: 'Install Windows SDK 10.0.22631 or newer',
    };
  }

  const sdkRoot = match[1].trim();
  log.debug({ sdkRoot }, 'found Windows SDK root');

  // Check bin folder for installed SDK versions
  const binDir = path.join(sdkRoot, 'bin');
  if (!existsSync(binDir)) {
    return {
      ok: false,
      reason: 'Windows SDK bin directory not found',
      path: binDir,
      hint: 'Reinstall Windows SDK',
    };
  }

  // List all 10.* version folders
  const fs = require('node:fs');
  const versions = fs
    .readdirSync(binDir)
    .filter(v => v.match(/^10\.\d+\.\d+\.\d+$/))
    .sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
      }
      return 0;
    });

  log.debug({ versions }, 'found Windows SDK versions');

  if (versions.length === 0) {
    return {
      ok: false,
      reason: 'No Windows SDK versions found in bin directory',
      hint: 'Install Windows SDK 10.0.22631 or newer',
    };
  }

  const latestVersion = versions[versions.length - 1];
  const versionParts = latestVersion.split('.').map(Number);
  const buildNumber = versionParts[2];

  if (buildNumber < 22631) {
    return {
      ok: false,
      version: latestVersion,
      reason: `Windows SDK ${latestVersion} is older than required 10.0.22631`,
      hint: 'Update Windows SDK to 10.0.22631 or newer',
    };
  }

  // Add the x64 bin path to PATH for current session
  const sdkBinPath = path.join(binDir, latestVersion, 'x64');
  if (!existsSync(sdkBinPath)) {
    return {
      ok: false,
      version: latestVersion,
      reason: `Windows SDK x64 bin directory not found: ${sdkBinPath}`,
      hint: 'Reinstall Windows SDK',
    };
  }

  // Add to PATH if not already present
  const currentPath = process.env.PATH || '';
  if (!currentPath.includes(sdkBinPath)) {
    process.env.PATH = `${sdkBinPath}${path.delimiter}${currentPath}`;
    log.info({ version: latestVersion, binPath: sdkBinPath }, 'added Windows SDK bin to PATH');
  } else {
    log.debug({ version: latestVersion, binPath: sdkBinPath }, 'Windows SDK bin already in PATH');
  }

  // Add Windows SDK include paths to INCLUDE environment variable for C/C++ headers
  const includeDir = path.join(sdkRoot, 'Include');
  const includePaths = [];
  
  if (existsSync(includeDir)) {
    const sdkUmInclude = path.join(includeDir, latestVersion, 'um');
    const sdkSharedInclude = path.join(includeDir, latestVersion, 'shared');
    const sdkUcrtInclude = path.join(includeDir, latestVersion, 'ucrt');
    const sdkWinrtInclude = path.join(includeDir, latestVersion, 'winrt');
    
    if (existsSync(sdkUmInclude)) includePaths.push(sdkUmInclude);
    if (existsSync(sdkSharedInclude)) includePaths.push(sdkSharedInclude);
    if (existsSync(sdkUcrtInclude)) includePaths.push(sdkUcrtInclude);
    if (existsSync(sdkWinrtInclude)) includePaths.push(sdkWinrtInclude);
    
    if (includePaths.length > 0) {
      const currentInclude = process.env.INCLUDE || '';
      const includePathsStr = includePaths.join(';');
      
      if (!currentInclude.includes(sdkUmInclude)) {
        process.env.INCLUDE = includePathsStr + (currentInclude ? ';' + currentInclude : '');
        log.info({ includePaths }, 'added Windows SDK include paths to INCLUDE');
      } else {
        log.debug({ includePaths }, 'Windows SDK include paths already in INCLUDE');
      }
    }
  }
  
  // Add Windows SDK library paths to LIB environment variable for CMake and other build tools
  const libDir = path.join(sdkRoot, 'Lib');
  const libPaths = [];
  
  if (existsSync(libDir)) {
    const sdkLibPath = path.join(libDir, latestVersion, 'um', 'x64');
    const sdkUcrtPath = path.join(libDir, latestVersion, 'ucrt', 'x64');
    
    if (existsSync(sdkLibPath)) libPaths.push(sdkLibPath);
    if (existsSync(sdkUcrtPath)) libPaths.push(sdkUcrtPath);
    
    if (libPaths.length > 0) {
      const currentLib = process.env.LIB || '';
      const libPathsStr = libPaths.join(';');
      
      // Add to LIB if not already present
      if (!currentLib.includes(sdkLibPath)) {
        process.env.LIB = libPathsStr + (currentLib ? ';' + currentLib : '');
        log.info({ libPaths }, 'added Windows SDK library paths to LIB');
      } else {
        log.debug({ libPaths }, 'Windows SDK library paths already in LIB');
      }
    }
  }

  log.info({ version: latestVersion, path: sdkRoot }, 'Windows SDK check passed');
  return { 
    ok: true, 
    version: latestVersion, 
    path: sdkRoot,
    binPath: sdkBinPath,
    includePaths: includePaths.length > 0 ? includePaths : undefined,
    libPaths: libPaths.length > 0 ? libPaths : undefined
  };
}

/**
 * Checks for MSVC 19.41 or Visual Studio 2022 v17.11+ and adds it to PATH, INCLUDE, and LIB.
 * @returns {Object} Check result with ok, version, path, includePath, libPath
 */
export function checkMSVC() {
  log.info('checking for MSVC 19.41 or Visual Studio 2022 v17.11+');

  if (process.platform !== 'win32') {
    return { ok: true, skipped: true, reason: 'not on Windows' };
  }

  // Try to find cl.exe on PATH first
  let clPath = resolveCommand('cl');
  let msvcLibPath = null;
  let msvcIncludePath = null;

  // If not found, search for Visual Studio installation
  if (!clPath) {
    log.info('cl.exe not on PATH, searching for Visual Studio installation');

    // Query registry for Visual Studio setup path
    const setupRegQuery = runCommand('C:\\Windows\\System32\\reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\Setup'], {
      stdio: 'pipe',
      shell: true,
    });

    let vswherePath = null;
    if (setupRegQuery.ok) {
      const match = setupRegQuery.stdout.match(/SharedInstallationPath\s+REG_SZ\s+(.+)/);
      if (match) {
        const sharedDir = match[1].trim();
        const vsRootDir = path.dirname(sharedDir); // Go up one level from "Shared"
        vswherePath = path.join(vsRootDir, 'Installer\\vswhere.exe');
        log.info({ sharedDir, vsRootDir, vswherePath }, 'found vswhere path from registry');
      }
    }

    // Fallback: try common Program Files location
    if (!vswherePath || !existsSync(vswherePath)) {
      const programFilesX86 = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || 'C:\\Program Files (x86)';
      vswherePath = path.join(programFilesX86, 'Microsoft Visual Studio\\Installer\\vswhere.exe');
    }

    if (!existsSync(vswherePath)) {
      log.warn('vswhere.exe not found, cannot auto-detect Visual Studio');
      return {
        ok: false,
        reason: 'MSVC compiler (cl.exe) not found on PATH and vswhere.exe not available',
        hint: 'Install Visual Studio 2022 v17.11 or later with C++ development tools, or run from Developer Command Prompt',
      };
    }

    log.info({ vswherePath }, 'found vswhere.exe');

    // Use shell: false and pass the full path directly (cross-spawn handles spaces properly)
    const vswhereResult = runCommand(
      vswherePath,
      ['-latest', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
      { stdio: 'pipe', shell: false },
    );

    if (vswhereResult.ok && vswhereResult.stdout.trim()) {
      const vsInstallPath = vswhereResult.stdout.trim();
      log.info({ vsInstallPath }, 'found Visual Studio installation');

      // Look for cl.exe in VC\Tools\MSVC\*\bin\Hostx64\x64
      const vcToolsPath = path.join(vsInstallPath, 'VC\\Tools\\MSVC');
      if (existsSync(vcToolsPath)) {
        const fs = require('node:fs');
        const msvcVersions = fs
          .readdirSync(vcToolsPath)
          .filter(v => v.match(/^\d+\.\d+\.\d+/))
          .sort();

        if (msvcVersions.length > 0) {
          const latestMsvc = msvcVersions[msvcVersions.length - 1];
          const clDir = path.join(vcToolsPath, latestMsvc, 'bin\\Hostx64\\x64');
          const clExePath = path.join(clDir, 'cl.exe');

          if (existsSync(clExePath)) {
            clPath = clExePath;
            log.info({ clPath, clDir }, 'found cl.exe in Visual Studio installation');

            // Add cl.exe directory to PATH for this session
            process.env.PATH = `${clDir};${process.env.PATH}`;
            log.info({ clDir }, 'added cl.exe directory to PATH for current session');
            
            // Add MSVC include path to INCLUDE environment variable for C++ headers
            msvcIncludePath = path.join(vcToolsPath, latestMsvc, 'include');
            if (existsSync(msvcIncludePath)) {
              const currentInclude = process.env.INCLUDE || '';
              if (!currentInclude.includes(msvcIncludePath)) {
                process.env.INCLUDE = msvcIncludePath + (currentInclude ? ';' + currentInclude : '');
                log.info({ msvcIncludePath }, 'added MSVC include path to INCLUDE');
              } else {
                log.debug({ msvcIncludePath }, 'MSVC include path already in INCLUDE');
              }
            } else {
              // Path doesn't exist, don't include it in return value
              msvcIncludePath = null;
            }
            
            // Add MSVC ATL include path to INCLUDE environment variable (required for some builds like Dawn)
            const msvcAtlIncludePath = path.join(vcToolsPath, latestMsvc, 'atlmfc\\include');
            if (existsSync(msvcAtlIncludePath)) {
              const currentInclude = process.env.INCLUDE || '';
              if (!currentInclude.includes(msvcAtlIncludePath)) {
                process.env.INCLUDE = (currentInclude ? currentInclude + ';' : '') + msvcAtlIncludePath;
                log.info({ msvcAtlIncludePath }, 'added MSVC ATL include path to INCLUDE');
              } else {
                log.debug({ msvcAtlIncludePath }, 'MSVC ATL include path already in INCLUDE');
              }
            }
            
            // Add MSVC library path to LIB environment variable for CMake and other build tools
            msvcLibPath = path.join(vcToolsPath, latestMsvc, 'lib\\x64');
            if (existsSync(msvcLibPath)) {
              const currentLib = process.env.LIB || '';
              if (!currentLib.includes(msvcLibPath)) {
                process.env.LIB = msvcLibPath + (currentLib ? ';' + currentLib : '');
                log.info({ msvcLibPath }, 'added MSVC library path to LIB');
              } else {
                log.debug({ msvcLibPath }, 'MSVC library path already in LIB');
              }
            } else {
              // Path doesn't exist, don't include it in return value
              msvcLibPath = null;
            }
            
            // Add MSVC ATL library path to LIB environment variable (required for some builds like Dawn)
            const msvcAtlLibPath = path.join(vcToolsPath, latestMsvc, 'atlmfc\\lib\\x64');
            if (existsSync(msvcAtlLibPath)) {
              const currentLib = process.env.LIB || '';
              if (!currentLib.includes(msvcAtlLibPath)) {
                process.env.LIB = (currentLib ? currentLib + ';' : '') + msvcAtlLibPath;
                log.info({ msvcAtlLibPath }, 'added MSVC ATL library path to LIB');
              } else {
                log.debug({ msvcAtlLibPath }, 'MSVC ATL library path already in LIB');
              }
            }
          }
        }
      }
    }

    if (!clPath) {
      return {
        ok: false,
        reason: 'MSVC compiler (cl.exe) not found on PATH or in Visual Studio installation',
        hint: 'Install Visual Studio 2022 v17.11 or later with C++ development tools, or run from Developer Command Prompt',
      };
    }
  }

  // Check MSVC version - cl.exe with no args returns error code but prints version info
  const versionCheck = runCommand(clPath, [], { stdio: 'pipe', shell: false });
  
  // cl.exe outputs version to both stdout and stderr, check both
  const output = `${versionCheck.stdout} ${versionCheck.stderr}`;
  
  // Parse version from output like "Microsoft (R) C/C++ Optimizing Compiler Version 19.41.34120 for x64"
  const versionMatch = output.match(/Version\s+(\d+)\.(\d+)\.(\d+)/);
  if (!versionMatch) {
    return {
      ok: false,
      path: clPath,
      reason: 'Could not parse MSVC version',
      output: output,
    };
  }

  const major = parseInt(versionMatch[1], 10);
  const minor = parseInt(versionMatch[2], 10);
  const version = `${major}.${minor}`;

  if (major < 19 || (major === 19 && minor < 41)) {
    return {
      ok: false,
      version,
      path: clPath,
      reason: `MSVC ${version} is older than required 19.41`,
      hint: 'Update to Visual Studio 2022 v17.11 or later',
    };
  }

  log.info({ version, path: clPath }, 'MSVC check passed');
  return { 
    ok: true, 
    version, 
    path: clPath,
    includePath: msvcIncludePath || undefined,
    libPath: msvcLibPath || undefined
  };
}

/**
 * Checks if the current CPU architecture matches the required architecture.
 * @param {string} requiredArch - The required architecture (default: 'x64')
 * @returns {Object} Check result with ok, arch, requiredArch
 */
export function checkCPUArchitecture(requiredArch = 'x64') {
  log.info({ requiredArch }, 'checking CPU architecture');

  const arch = process.arch;
  const archMap = {
    x64: ['x64', 'amd64', 'x86_64'],
    arm64: ['arm64', 'aarch64'],
    x86: ['x86', 'ia32'],
  };

  const validArchs = archMap[requiredArch] || [requiredArch];
  const isValid = validArchs.includes(arch);

  if (!isValid) {
    return {
      ok: false,
      arch,
      requiredArch,
      reason: `CPU architecture ${arch} does not match required ${requiredArch}`,
      hint: `This build requires ${requiredArch} architecture`,
    };
  }

  log.info({ arch, requiredArch }, 'CPU architecture check passed');
  return { ok: true, arch };
}

/**
 * Ensures Python 3.11+ is available, installing via pyenv if necessary.
 * @returns {Object} Check result with ok, path, installedViaPyenv, version
 */
export function ensurePython3() {
  log.info('ensuring Python 3 is available');

  // Check if pyenv is available first (so we can handle it before checking python)
  const pyenvPath = resolveCommand('pyenv');
  const hasPyenv = !!pyenvPath;

  if (hasPyenv) {
    log.info({ path: pyenvPath }, 'pyenv detected, will use it to manage Python');
  }

  // Try to find python3 directly
  const python3Path = resolveCommand('python3');
  if (python3Path && !hasPyenv) {
    // Only use direct python3 if pyenv is not present, to avoid conflicts
    log.info({ path: python3Path }, 'Python 3 found on PATH');
    return { ok: true, path: python3Path, installedViaPyenv: false };
  }

  // Check if python (not python3) is actually Python 3
  const pythonPath = resolveCommand('python');
  if (pythonPath && !hasPyenv) {
    const versionCheck = runCommand(pythonPath, ['--version'], { stdio: 'pipe' });
    if (versionCheck.ok && versionCheck.stdout.includes('Python 3')) {
      log.info({ path: pythonPath }, 'Python 3 found on PATH as "python"');
      return { ok: true, path: pythonPath, installedViaPyenv: false };
    }
  }

  // If pyenv is not available, fail
  if (!hasPyenv) {
    log.error('Python 3 not found on PATH and pyenv not available');
    return {
      ok: false,
      reason: 'Python 3 is not available and pyenv is not installed',
      hint: 'Install Python 3.11 or newer, or install pyenv from https://github.com/pyenv/pyenv',
    };
  }

  log.info('using pyenv to ensure Python 3 is available');

  // Check pyenv versions (use 'versions' without --bare for Windows compatibility)
  const versionsResult = runPyenv(['versions'], { stdio: 'pipe' });
  if (!versionsResult.ok) {
    log.error({ output: collectOutput(versionsResult) }, 'failed to query pyenv versions');
    return {
      ok: false,
      reason: 'Failed to query pyenv versions',
      hint: 'Ensure pyenv is properly installed',
    };
  }

  // Parse versions - they may have asterisks or spaces, e.g., "* 3.12.5" or "  3.12.5"
  const installedVersions = versionsResult.stdout
    .split('\n')
    .map(v =>
      v
        .trim()
        .replace(/^\*\s*/, '')
        .trim(),
    )
    .filter(Boolean);
  log.debug({ installedVersions }, 'pyenv installed versions');

  // Find the latest stable Python 3.11+ version (exclude alpha/beta/rc)
  const python3Versions = installedVersions.filter(v => v.match(/^3\.(1[1-9]|[2-9]\d)\.\d+$/)); // Only stable versions (no a, b, rc suffixes)

  let targetVersion;
  if (python3Versions.length > 0) {
    targetVersion = python3Versions[python3Versions.length - 1];
    log.info({ version: targetVersion }, 'found suitable Python 3 version in pyenv');
  } else {
    log.info('no suitable Python 3 version found, installing latest via pyenv');

    // Get latest installable version
    const installableResult = runPyenv(['install', '--list'], { stdio: 'pipe' });
    if (!installableResult.ok) {
      log.error({ output: collectOutput(installableResult) }, 'failed to list installable versions');
      return {
        ok: false,
        reason: 'Failed to list pyenv installable versions',
        hint: 'Run "pyenv install --list" manually to debug',
      };
    }

    const installableVersions = installableResult.stdout
      .split('\n')
      .map(v => v.trim())
      .filter(v => v.match(/^\d+\.\d+\.\d+$/))
      .filter(v => v.match(/^3\.(1[1-9]|[2-9]\d)/));

    if (installableVersions.length === 0) {
      log.error('no Python 3.11+ versions available in pyenv');
      return {
        ok: false,
        reason: 'No Python 3.11+ versions available in pyenv',
        hint: 'Update pyenv or install Python 3 manually',
      };
    }

    targetVersion = installableVersions[installableVersions.length - 1];
    log.info({ version: targetVersion }, 'installing Python via pyenv');

    const installResult = runPyenv(['install', targetVersion], { stdio: 'inherit' });
    if (!installResult.ok) {
      log.error({ version: targetVersion, output: collectOutput(installResult) }, 'failed to install Python');
      return {
        ok: false,
        reason: `Failed to install Python ${targetVersion} via pyenv`,
        hint: 'Check pyenv installation and try running "pyenv install ' + targetVersion + '" manually',
      };
    }

    log.info({ version: targetVersion }, 'Python installed successfully');
  }

  // Set local version
  log.info({ version: targetVersion }, 'setting pyenv local version');
  const localResult = runPyenv(['local', targetVersion], { stdio: 'pipe' });
  if (!localResult.ok) {
    log.error({ version: targetVersion, output: collectOutput(localResult) }, 'failed to set pyenv local version');
    return {
      ok: false,
      reason: `Failed to set pyenv local to ${targetVersion}`,
      hint: 'Run "pyenv local ' + targetVersion + '" manually',
    };
  }

  // Verify python is now available by running pyenv which python
  const whichResult = runPyenv(['which', 'python'], { stdio: 'pipe' });
  if (!whichResult.ok) {
    log.error('Python still not found after pyenv setup');
    return {
      ok: false,
      reason: 'Python is still not available after pyenv configuration',
      hint: 'Restart your shell or run "pyenv rehash" and try again',
    };
  }

  const pythonPathFromPyenv = whichResult.stdout.trim();
  log.info({ path: pythonPathFromPyenv, version: targetVersion }, 'Python 3 is now available via pyenv');
  return { ok: true, path: pythonPathFromPyenv, installedViaPyenv: true, version: targetVersion };
}

/**
 * Collects stdout and stderr from an execution result.
 * @param {Object} execution - The execution result object
 * @returns {string} Combined output
 */
function collectOutput(execution) {
  const parts = [];
  if (execution.stdout) {
    parts.push(execution.stdout.trim());
  }
  if (execution.stderr) {
    parts.push(execution.stderr.trim());
  }
  return parts.filter(Boolean).join('\n');
}
