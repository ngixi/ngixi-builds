import { scopedLogger } from '../scripts/logging.js';
import { resolveCommand, runCommand } from '../scripts/utils/command-runner.js';
import { compareVersions, defaultVersionParser } from '../scripts/utils/version-utils.js';

const log = scopedLogger('tools.cargo');

/**
 * Configures Rust/Cargo toolchain.
 * 
 * @returns {Promise<Object>} Configuration result with ok, version, path, cleanup
 */
export async function configureTool() {
  const minimumVersion = '1.75.0';
  
  log.info('configuring Rust/Cargo');
  
  const cargoPath = resolveCommand('cargo');
  
  if (!cargoPath) {
    return {
      ok: false,
      reason: 'cargo not found on PATH',
      hint: 'Install Rust toolchain via https://rustup.rs/',
    };
  }

  const versionResult = runCommand('cargo', ['--version'], { stdio: 'pipe' });
  
  if (!versionResult.ok) {
    return {
      ok: false,
      reason: 'Failed to get cargo version',
      path: cargoPath,
    };
  }

  const version = defaultVersionParser(versionResult.stdout);
  
  if (!version) {
    return {
      ok: false,
      reason: 'Could not parse cargo version',
      path: cargoPath,
    };
  }

  if (compareVersions(version, minimumVersion) < 0) {
    return {
      ok: false,
      version,
      reason: `Cargo ${version} is older than required ${minimumVersion}`,
      hint: `Update Rust toolchain: rustup update`,
      path: cargoPath,
    };
  }

  log.info({ version, path: cargoPath }, 'Cargo configured successfully');

  return {
    ok: true,
    version,
    path: cargoPath,
    cleanup: () => {},
  };
}
