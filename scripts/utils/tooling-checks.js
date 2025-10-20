import { scopedLogger } from '../logging.js';
import { resolveCommand, runCommand } from './command-runner.js';
import { compareVersions, defaultVersionParser } from './version-utils.js';

const log = scopedLogger('tooling-checks');

/**
 * Custom error class for aggregating multiple tool check failures.
 */
export class AggregateToolError extends Error {
  constructor(failures, reports) {
    const header = 'One or more tooling checks failed:';
    const details = failures.map(failure => formatFailureLine(failure)).join('\n');
    super(`${header}\n${details}`);
    this.name = 'AggregateToolError';
    this.failures = failures;
    this.reports = reports;
  }
}

/**
 * Ensures all required tools are available and meet version requirements.
 * @param {Array<Object>} toolSpecs - Array of tool specification objects
 * @returns {Array<Object>} Array of check reports
 * @throws {AggregateToolError} If any required tool check fails
 */
export function ensureTooling(toolSpecs) {
  const currentPlatform = process.platform;
  log.info({ toolCount: toolSpecs.length, platform: currentPlatform }, 'checking toolchain requirements');

  // Filter specs based on platform
  const applicableSpecs = toolSpecs.filter(spec => {
    if (!spec.platforms) {
      // No platform restriction, applies to all
      return true;
    }
    // Check if current platform is in the list
    return spec.platforms.includes(currentPlatform);
  });

  log.debug({ total: toolSpecs.length, applicable: applicableSpecs.length }, 'filtered toolchain requirements by platform');

  const reports = applicableSpecs.map(spec => checkTool(spec));
  const failures = reports.filter(report => !report.ok && report.required !== false && !report.skipped);
  if (failures.length > 0) {
    throw new AggregateToolError(failures, reports);
  }
  return reports;
}

/**
 * Checks if a tool is available and meets version requirements.
 * @param {Object} spec - Tool specification object
 * @returns {Object} Check report with ok, version, path, and other details
 */
export function checkTool(spec) {
  const {
    name,
    program,
    versionArgs = ['--version'],
    minimumVersion = null,
    maximumVersion = null,
    parseVersion = defaultVersionParser,
    versionRequired = minimumVersion !== null || maximumVersion !== null,
    env = undefined,
    cwd = undefined,
    description = program,
    required = true,
    hint = null,
    customCheck = null,
    platforms = null,
  } = spec;

  // If a custom check is provided, use it instead
  if (customCheck) {
    log.debug({ name, platforms }, 'using custom check for tool availability');
    const result = customCheck();
    return {
      name,
      program,
      required,
      platforms,
      ...result,
    };
  }

  log.debug({ name, program }, 'checking tool availability');
  const resolvedProgram = resolveCommand(program);
  if (!resolvedProgram) {
    return {
      name,
      program,
      required,
      ok: false,
      version: null,
      path: null,
      reason: `command "${program}" was not found on PATH`,
      hint,
    };
  }

  const execution = runCommand(resolvedProgram, versionArgs, { env, cwd });
  if (!execution.ok) {
    const reason = execution.error ? execution.error.message : `exited with status ${execution.status}`;
    return {
      name,
      program,
      required,
      ok: false,
      version: null,
      path: resolvedProgram,
      reason: `${description} ${reason}`,
      output: collectOutput(execution),
      hint,
    };
  }

  const version = parseVersion(execution.stdout, execution.stderr);
  if (versionRequired && !version) {
    return {
      name,
      program,
      required,
      ok: false,
      version: null,
      path: resolvedProgram,
      reason: `${description} did not report a version in the expected format`,
      output: collectOutput(execution),
      hint,
    };
  }

  if (version && minimumVersion && compareVersions(version, minimumVersion) < 0) {
    return {
      name,
      program,
      required,
      ok: false,
      version,
      path: resolvedProgram,
      reason: `${description} ${version} is older than required minimum ${minimumVersion}`,
      output: collectOutput(execution),
      hint,
    };
  }

  if (version && maximumVersion && compareVersions(version, maximumVersion) > 0) {
    return {
      name,
      program,
      required,
      ok: false,
      version,
      path: resolvedProgram,
      reason: `${description} ${version} is newer than supported maximum ${maximumVersion}`,
      output: collectOutput(execution),
      hint,
    };
  }

  return {
    name,
    program,
    required,
    ok: true,
    version,
    path: resolvedProgram,
    output: collectOutput(execution),
  };
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
 * Formats a failure report into a human-readable string.
 * @param {Object} failure - The failure report
 * @returns {string} Formatted failure message
 */
function formatFailureLine(failure) {
  const parts = [`- ${failure.name}: ${failure.reason}`];
  if (failure.path) {
    parts.push(`  located at ${failure.path}`);
  }
  if (failure.output) {
    parts.push(`  output: ${failure.output}`);
  }
  if (failure.hint) {
    parts.push(`  hint: ${failure.hint}`);
  }
  return parts.join('\n');
}
