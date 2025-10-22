import { scopedLogger } from '../scripts/logging.js';
import { resolveCommand, runCommand } from '../scripts/utils/command-runner.js';
import { existsSync } from 'node:fs';
import path from 'node:path';

const log = scopedLogger('tools.depot-tools');

/**
 * Configures Chromium depot_tools.
 * Checks if gclient is available, if not clones depot_tools to .git.temp and adds to PATH.
 * 
 * @returns {Promise<Object>} Configuration result with ok, version, path, cleanup
 */
export async function configureTool() {
  log.info('configuring Chromium depot_tools');
  
  // Try to find gclient on PATH
  const gclientPath = resolveCommand('gclient');
  
  if (gclientPath) {
    // depot_tools already available, verify it works
    log.info({ gclientPath }, 'gclient found on PATH, verifying');
    
    const versionResult = runCommand(gclientPath, ['--version'], { stdio: 'pipe' });
    
    if (versionResult.ok) {
      // Extract version (format: "gclient version 32")
      const versionMatch = versionResult.stdout.match(/version\s+(\d+)/i);
      const version = versionMatch ? versionMatch[1] : 'unknown';
      
      log.info({ version, path: gclientPath }, 'depot_tools configured successfully (already on PATH)');
      
      return {
        ok: true,
        version,
        path: gclientPath,
        cleanup: () => {
          // No cleanup needed - was already on PATH
        },
      };
    }
  }

  // depot_tools not found, need to clone it
  log.info('gclient not found on PATH, cloning depot_tools to .git.temp');
  
  const depotToolsDir = path.join(process.cwd(), '.git.temp', 'depot_tools');
  
  // Check if already cloned
  if (existsSync(depotToolsDir)) {
    log.info({ depotToolsDir }, 'depot_tools already cloned, reusing');
  } else {
    log.info({ depotToolsDir }, 'cloning depot_tools from Chromium repository');
    
    const cloneResult = runCommand('git', [
      'clone',
      'https://chromium.googlesource.com/chromium/tools/depot_tools.git',
      depotToolsDir
    ], { stdio: 'inherit' });
    
    if (!cloneResult.ok) {
      return {
        ok: false,
        reason: 'Failed to clone depot_tools',
        hint: 'Check network connectivity to chromium.googlesource.com',
      };
    }
    
    log.info({ depotToolsDir }, 'depot_tools cloned successfully');
  }
  
  // Verify gclient exists in cloned depot_tools
  const gclientBat = path.join(depotToolsDir, 'gclient.bat');
  if (!existsSync(gclientBat)) {
    return {
      ok: false,
      reason: 'gclient.bat not found in cloned depot_tools',
      path: depotToolsDir,
    };
  }
  
  // Add depot_tools to PATH (at the front)
  const currentPath = process.env.PATH || '';
  process.env.PATH = depotToolsDir + path.delimiter + currentPath;
  
  log.info({ depotToolsDir }, 'added depot_tools to PATH');
  
  // Get version
  const versionResult = runCommand(gclientBat, ['--version'], { stdio: 'pipe' });
  const versionMatch = versionResult.ok ? versionResult.stdout.match(/version\s+(\d+)/i) : null;
  const version = versionMatch ? versionMatch[1] : 'unknown';
  
  log.info({ version, path: depotToolsDir }, 'depot_tools configured successfully (cloned)');
  
  return {
    ok: true,
    version,
    path: depotToolsDir,
    cleanup: () => {
      // Cleanup handled by tool-loader (restores entire environment)
    },
  };
}
