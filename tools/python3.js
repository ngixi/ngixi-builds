import { scopedLogger } from '../scripts/logging.js';
import { resolveCommand, runCommand } from '../scripts/utils/command-runner.js';

const log = scopedLogger('tools.python3');

/**
 * Configures Python 3.
 * Ensures Python 3 is available on PATH.
 * 
 * @returns {Promise<Object>} Configuration result with ok, version, path, cleanup
 */
export async function configureTool() {
  log.info('configuring Python 3');
  
  // Try to find python3, python, or py on PATH
  let pythonPath = resolveCommand('python3');
  
  if (!pythonPath) {
    pythonPath = resolveCommand('python');
  }
  
  if (!pythonPath) {
    pythonPath = resolveCommand('py');
  }
  
  if (!pythonPath) {
    return {
      ok: false,
      reason: 'Python 3 not found on PATH',
      hint: 'Install Python 3 from https://www.python.org/ or via Microsoft Store',
    };
  }
  
  log.info({ pythonPath }, 'Python found, verifying version');
  
  // Check version
  const versionResult = runCommand(pythonPath, ['--version'], { stdio: 'pipe' });
  
  if (!versionResult.ok) {
    return {
      ok: false,
      reason: 'Failed to get Python version',
      path: pythonPath,
    };
  }
  
  // Parse version (format: "Python 3.x.y")
  const versionMatch = versionResult.stdout.match(/Python\s+(3\.\d+\.\d+)/i);
  
  if (!versionMatch) {
    return {
      ok: false,
      reason: 'Could not parse Python version',
      path: pythonPath,
      output: versionResult.stdout,
    };
  }
  
  const version = versionMatch[1];
  
  log.info({ version, path: pythonPath }, 'Python 3 configured successfully');
  
  return {
    ok: true,
    version,
    path: pythonPath,
    cleanup: () => {
      // No cleanup needed - Python was already on PATH
    },
  };
}
