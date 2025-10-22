import { existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { scopedLogger } from '../scripts/logging.js';
import { resolveCommand, runCommand } from '../scripts/utils/command-runner.js';
import { prependToPath, appendToEnv } from './tool-loader.js';

const log = scopedLogger('tools.msvc');

/**
 * Configures MSVC (Microsoft Visual C++) compiler.
 * Windows-only. Finds Visual Studio installation and adds cl.exe to PATH.
 * 
 * @returns {Promise<Object>} Configuration result with ok, version, path, cleanup
 */
export async function configureTool() {
  if (process.platform !== 'win32') {
    return { ok: true, skipped: true, reason: 'not on Windows' };
  }

  const minimumVersion = '19.41';
  
  log.info('configuring MSVC compiler');
  
  // Check if cl.exe is already on PATH
  let clPath = resolveCommand('cl');
  
  if (clPath) {
    log.info({ clPath }, 'cl.exe already on PATH');
    
    // Get version
    const versionResult = runCommand('cl', [], { stdio: 'pipe' });
    const versionMatch = versionResult.stderr?.match(/Version (\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : null;
    
    return {
      ok: true,
      version,
      path: clPath,
      cleanup: () => {},
    };
  }

  log.info('cl.exe not on PATH, searching for Visual Studio installation');

  // Find vswhere.exe
  const vswherePath = findVsWhere();
  if (!vswherePath) {
    return {
      ok: false,
      reason: 'MSVC compiler (cl.exe) not found and vswhere.exe not available',
      hint: 'Install Visual Studio 2022 v17.11 or later with C++ development tools',
    };
  }

  log.info({ vswherePath }, 'found vswhere.exe');

  // Use vswhere to find VS installation
  const vswhereResult = runCommand(
    vswherePath,
    ['-latest', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
    { stdio: 'pipe', shell: false },
  );

  if (!vswhereResult.ok || !vswhereResult.stdout.trim()) {
    return {
      ok: false,
      reason: 'Visual Studio installation not found via vswhere',
      hint: 'Install Visual Studio 2022 with C++ development tools',
    };
  }

  const vsInstallPath = vswhereResult.stdout.trim();
  log.info({ vsInstallPath }, 'found Visual Studio installation');

  // Find cl.exe in VC\Tools\MSVC\*\bin\Hostx64\x64
  const vcToolsPath = path.join(vsInstallPath, 'VC', 'Tools', 'MSVC');
  if (!existsSync(vcToolsPath)) {
    return {
      ok: false,
      reason: 'VC Tools directory not found',
      path: vcToolsPath,
    };
  }

  const msvcVersions = readdirSync(vcToolsPath)
    .filter(v => v.match(/^\d+\.\d+\.\d+/))
    .sort();

  if (msvcVersions.length === 0) {
    return {
      ok: false,
      reason: 'No MSVC version found in VC Tools',
      path: vcToolsPath,
    };
  }

  const latestMsvc = msvcVersions[msvcVersions.length - 1];
  const clDir = path.join(vcToolsPath, latestMsvc, 'bin', 'Hostx64', 'x64');
  const clExePath = path.join(clDir, 'cl.exe');

  if (!existsSync(clExePath)) {
    return {
      ok: false,
      reason: 'cl.exe not found in expected location',
      path: clExePath,
    };
  }

  // Parse MSVC version
  const versionParts = latestMsvc.split('.');
  const version = `${versionParts[0]}.${versionParts[1]}`;

  log.info({ clPath: clExePath, version, clDir }, 'found cl.exe in Visual Studio installation');

  // Add to PATH
  prependToPath(clDir);
  log.info({ clDir }, 'added cl.exe directory to PATH');

  // Add MSVC include paths
  const msvcIncludePath = path.join(vcToolsPath, latestMsvc, 'include');
  if (existsSync(msvcIncludePath)) {
    appendToEnv('INCLUDE', msvcIncludePath);
    log.info({ msvcIncludePath }, 'added MSVC include path to INCLUDE');
  }

  const msvcAtlIncludePath = path.join(vcToolsPath, latestMsvc, 'atlmfc', 'include');
  if (existsSync(msvcAtlIncludePath)) {
    appendToEnv('INCLUDE', msvcAtlIncludePath);
    log.info({ msvcAtlIncludePath }, 'added MSVC ATL include path to INCLUDE');
  }

  // Add MSVC library path
  const msvcLibPath = path.join(vcToolsPath, latestMsvc, 'lib', 'x64');
  if (existsSync(msvcLibPath)) {
    appendToEnv('LIB', msvcLibPath);
    log.info({ msvcLibPath }, 'added MSVC library path to LIB');
  }

  const msvcAtlLibPath = path.join(vcToolsPath, latestMsvc, 'atlmfc', 'lib', 'x64');
  if (existsSync(msvcAtlLibPath)) {
    appendToEnv('LIB', msvcAtlLibPath);
    log.info({ msvcAtlLibPath }, 'added MSVC ATL library path to LIB');
  }

  // Verify it works
  const testResult = runCommand('cl', [], { stdio: 'pipe' });
  if (!testResult.ok) {
    return {
      ok: false,
      reason: 'cl.exe found but failed to execute',
      path: clExePath,
    };
  }

  log.info({ version, path: clExePath }, 'MSVC configured successfully');

  return {
    ok: true,
    version,
    path: clExePath,
    cleanup: () => {
      // Cleanup handled by tool-loader (restores entire environment)
    },
  };
}

/**
 * Find vswhere.exe
 */
function findVsWhere() {
  // Try registry first
  const setupRegQuery = runCommand('C:\\Windows\\System32\\reg.exe', 
    ['query', 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\Setup'], 
    { stdio: 'pipe', shell: false }
  );

  if (setupRegQuery.ok) {
    const match = setupRegQuery.stdout.match(/SharedInstallationPath\s+REG_SZ\s+(.+)/);
    if (match) {
      const sharedDir = match[1].trim();
      const vsRootDir = path.dirname(sharedDir);
      const vswherePath = path.join(vsRootDir, 'Installer', 'vswhere.exe');
      if (existsSync(vswherePath)) {
        return vswherePath;
      }
    }
  }

  // Fallback to Program Files
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vswherePath = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  
  return existsSync(vswherePath) ? vswherePath : null;
}
