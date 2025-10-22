import { scopedLogger } from '../scripts/logging.js';
import { resolveCommand, runCommand } from '../scripts/utils/command-runner.js';
import { compareVersions, defaultVersionParser } from '../scripts/utils/version-utils.js';
import { existsSync } from 'node:fs';
import path from 'node:path';

const log = scopedLogger('tools.ninja');

/**
 * Configures Ninja build system.
 * Ensures it's available and meets version requirements.
 * Does NOT use depot_tools wrapper - finds real ninja.exe and prioritizes it in PATH.
 * 
 * @returns {Promise<Object>} Configuration result with ok, version, path, cleanup
 */
export async function configureTool() {
  const minimumVersion = '1.12.0';
  
  log.info('configuring Ninja build system');
  
  // Find ALL ninja executables on PATH
  const allNinjas = findAllNinjaExecutables();
  
  if (allNinjas.length === 0) {
    return {
      ok: false,
      reason: 'ninja not found on PATH',
      hint: 'Install Ninja 1.12 or newer from https://ninja-build.org/',
    };
  }

  log.debug({ allNinjas }, 'found ninja executables on PATH');

  // Filter out depot_tools wrappers (.BAT files)
  const realNinjas = allNinjas.filter(p => {
    const isDepotTools = p.includes('depot_tools');
    const isBatchFile = p.toLowerCase().endsWith('.bat') || p.toLowerCase().endsWith('.cmd');
    // We want real executables, NOT depot_tools wrappers
    return !(isDepotTools && isBatchFile);
  });
  
  if (realNinjas.length === 0) {
    return {
      ok: false,
      reason: 'Only found depot_tools ninja wrapper (ninja.BAT), need real ninja.exe',
      hint: 'Install standalone Ninja from https://ninja-build.org/ or via package manager',
      foundPaths: allNinjas,
    };
  }

  const ninjaPath = realNinjas[0]; // Use first real ninja found
  log.info({ ninjaPath }, 'using real ninja.exe (not depot_tools wrapper)');

  // Check version
  const versionResult = runCommand(ninjaPath, ['--version'], { stdio: 'pipe' });
  
  if (!versionResult.ok) {
    return {
      ok: false,
      reason: 'Failed to get ninja version',
      path: ninjaPath,
    };
  }

  const version = defaultVersionParser(versionResult.stdout);
  
  if (!version) {
    return {
      ok: false,
      reason: 'Could not parse ninja version',
      path: ninjaPath,
    };
  }

  // Check minimum version
  if (compareVersions(version, minimumVersion) < 0) {
    return {
      ok: false,
      version,
      reason: `Ninja ${version} is older than required ${minimumVersion}`,
      hint: `Update Ninja to ${minimumVersion} or newer`,
      path: ninjaPath,
    };
  }

  // IMPORTANT: Ensure this ninja's directory is at the FRONT of PATH
  // This ensures CMake finds the real ninja.exe, not depot_tools wrapper
  const ninjaDir = path.dirname(ninjaPath);
  const currentPath = process.env.PATH || '';
  const pathParts = currentPath.split(path.delimiter);
  
  // Remove any existing occurrences of this directory
  const filteredPaths = pathParts.filter(p => p !== ninjaDir);
  
  // Put ninja directory at the FRONT
  process.env.PATH = ninjaDir + path.delimiter + filteredPaths.join(path.delimiter);
  
  log.info({ ninjaDir, version, path: ninjaPath }, 'Ninja configured successfully and prioritized in PATH');

  return {
    ok: true,
    version,
    path: ninjaPath,
    cleanup: () => {
      // Cleanup handled by tool-loader (restores entire environment)
    },
  };
}

/**
 * Find all ninja executables on PATH (including .BAT files on Windows)
 * @returns {string[]} Array of absolute paths to ninja executables
 */
function findAllNinjaExecutables() {
  const isWindows = process.platform === 'win32';
  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(path.delimiter).filter(Boolean);
  const ninjaExecutables = [];

  for (const dir of pathDirs) {
    // Check for ninja.exe on Windows, ninja on Unix
    const exeExtensions = isWindows ? ['.exe', '.bat', '.cmd'] : [''];
    
    for (const ext of exeExtensions) {
      const ninjaPath = path.join(dir, `ninja${ext}`);
      
      try {
        if (existsSync(ninjaPath)) {
          ninjaExecutables.push(ninjaPath);
        }
      } catch (err) {
        // Ignore errors (permission issues, etc.)
      }
    }
  }

  return ninjaExecutables;
}

