import { scopedLogger } from '../scripts/logging.js';
import { resolveCommand, runCommand } from '../scripts/utils/command-runner.js';
import { compareVersions, defaultVersionParser } from '../scripts/utils/version-utils.js';

const log = scopedLogger('tools.cmake');

/**
 * Configures CMake build system.
 * 
 * @returns {Promise<Object>} Configuration result with ok, version, path, cleanup
 */
export async function configureTool() {
  const minimumVersion = '3.16.0';
  
  log.info('configuring CMake');
  
  const cmakePath = resolveCommand('cmake');
  
  if (!cmakePath) {
    return {
      ok: false,
      reason: 'cmake not found on PATH',
      hint: 'Install CMake from https://cmake.org/download/',
    };
  }

  const versionResult = runCommand('cmake', ['--version'], { stdio: 'pipe' });
  
  if (!versionResult.ok) {
    return {
      ok: false,
      reason: 'Failed to get cmake version',
      path: cmakePath,
    };
  }

  const version = defaultVersionParser(versionResult.stdout);
  
  if (!version) {
    return {
      ok: false,
      reason: 'Could not parse cmake version',
      path: cmakePath,
    };
  }

  if (compareVersions(version, minimumVersion) < 0) {
    return {
      ok: false,
      version,
      reason: `CMake ${version} is older than required ${minimumVersion}`,
      hint: `Update CMake to ${minimumVersion} or newer`,
      path: cmakePath,
    };
  }

  log.info({ version, path: cmakePath }, 'CMake configured successfully');

  return {
    ok: true,
    version,
    path: cmakePath,
    cleanup: () => {},
  };
}
