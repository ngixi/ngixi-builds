import crossSpawn from 'cross-spawn';
import { createRequire } from 'node:module';
import process from 'node:process';
import which from 'which';

import { scopedLogger } from '../logging.js';

const require = createRequire(import.meta.url);
const CROSS_ENV_CANDIDATES = ['cross-env/src/bin/cross-env.js', 'cross-env/dist/bin/cross-env.js', 'cross-env/bin/cross-env.js'];
let cachedCrossEnvBin = null;

const spawnSync = crossSpawn.sync;
const log = scopedLogger('command-runner');

/**
 * Resolves a command to its full path on the system PATH.
 * @param {string} command - The command name to resolve
 * @returns {string|null} The full path to the command, or null if not found
 */
export function resolveCommand(command) {
  const resolved = which.sync(command, { nothrow: true });
  return resolved ?? null;
}

/**
 * Builds an environment object by merging process.env with overrides.
 * @param {Object} overrides - Environment variables to override
 * @returns {Object} The merged environment object
 */
export function buildEnv(overrides = {}) {
  if (!overrides || Object.keys(overrides).length === 0) {
    return process.env;
  }
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value === undefined || value === null ? '' : String(value);
  }
  return env;
}

/**
 * Executes a command synchronously with the given arguments and options.
 * @param {string} command - The command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} options - Execution options (cwd, env, stdio, shell, input)
 * @returns {Object} Execution result with status, stdout, stderr, error, and ok flag
 */
export function runCommand(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = undefined, stdio = 'pipe', shell = false, input = undefined } = options;
  const descriptor = [command, ...(Array.isArray(args) ? args : [])].filter(token => token !== undefined && token !== null).join(' ');
  const startTime = Date.now();

  if (stdio === 'inherit') {
    log.info({ command, args: args.join(' '), cwd }, `executing: ${descriptor}`);
  } else {
    log.debug({ command, args, cwd, stdio, shell }, `executing command: ${descriptor}`);
  }

  const result = spawnSync(command, args, {
    cwd,
    env: env ? buildEnv(env) : process.env,
    stdio,
    shell,
    input,
    encoding: 'utf-8',
  });
  const durationMs = Date.now() - startTime;
  const aggregatedOutput = result.ok ? null : collectOutput(result);
  const err = result.error instanceof Error ? result.error : undefined;
  const isSuccess = result.status === 0 && !result.error;
  if (isSuccess) {
    if (stdio !== 'inherit') {
      log.info(
        {
          command,
          args,
          cwd,
          durationMs,
          status: result.status,
          signal: result.signal,
          error: result.error,
        },
        'command success',
      );
    } else {
      log.info({ command, durationMs }, 'command completed');
    }
  } else {
    log.error(
      {
        command,
        args,
        cwd,
        durationMs,
        status: result.status,
        output: aggregatedOutput,
        err,
        signal: result.signal,
        error: result.error,
      },
      'command failed',
    );
  }
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    command,
    args,
    status: result.status,
    stdout,
    stderr,
    error: result.error ?? null,
    ok: result.status === 0 && !result.error,
  };
}

/**
 * Runs a command with environment variable overrides using cross-env.
 * @param {Object} envOverrides - Environment variables to set
 * @param {string} command - The command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} options - Execution options
 * @returns {Object} Execution result
 */
export function runWithCrossEnv(envOverrides, command, args = [], options = {}) {
  const envAssignments = Object.entries(envOverrides ?? {}).map(([key, value]) => {
    const normalized = value === undefined || value === null ? '' : String(value);
    return `${key}=${normalized}`;
  });
  log.info({ command, envCount: Object.keys(envOverrides ?? {}).length }, 'running command with environment overrides');
  const crossEnvBin = resolveCrossEnvBin();
  const crossEnvArgs = [...envAssignments, command, ...args];
  return runCommand(process.execPath, [crossEnvBin, ...crossEnvArgs], {
    ...options,
    shell: false,
  });
}

/**
 * Runs a Cargo command.
 * @param {string[]} args - Cargo arguments
 * @param {Object} options - Execution options
 * @returns {Object} Execution result
 */
export function runCargo(args = [], options = {}) {
  log.info({ args: args.join(' ') }, 'running cargo command');
  return runCommand('cargo', args, options);
}

/**
 * Runs a pyenv command.
 * @param {string[]} args - Pyenv arguments
 * @param {Object} options - Execution options
 * @returns {Object} Execution result
 */
export function runPyenv(args = [], options = {}) {
  log.info({ args: args.join(' ') }, 'running pyenv command');
  // On Windows, pyenv-win is a batch file that needs shell=true
  const isWindows = process.platform === 'win32';
  return runCommand('pyenv', args, { ...options, shell: isWindows });
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

/**
 * Resolves the path to the cross-env binary.
 * @returns {string} The resolved path
 * @throws {Error} If cross-env cannot be resolved
 */
function resolveCrossEnvBin() {
  if (cachedCrossEnvBin) {
    return cachedCrossEnvBin;
  }
  for (const candidate of CROSS_ENV_CANDIDATES) {
    try {
      cachedCrossEnvBin = require.resolve(candidate);
      return cachedCrossEnvBin;
    } catch (error) {
      // continue searching
    }
  }
  throw new Error('cross-env executable could not be resolved. Did you install dependencies?');
}
