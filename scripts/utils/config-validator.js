import { scopedLogger } from '../logging.js';

const log = scopedLogger('config-validator');

/**
 * Validates the build configuration structure and rules.
 * 
 * Validation rules:
 * 1. Each dependency must have either defaultVersion or branch specified
 * 2. If defaultVersion is null, branch must be non-null
 * 3. deps array references must point to valid dependencies
 * 4. Required fields must be present: name, git.url, git.shallow, git.initSubmodules
 * 
 * @param {Object} config - Build configuration object
 * @throws {Error} If validation fails
 */
export function validateBuildConfig(config) {
  if (!config) {
    throw new Error('Build configuration is null or undefined');
  }

  if (!config.version) {
    throw new Error('Build configuration must have a version field');
  }

  if (!config.deps || typeof config.deps !== 'object') {
    throw new Error('Build configuration must have a deps object');
  }

  const depNames = Object.keys(config.deps);
  const errors = [];

  for (const depKey of depNames) {
    const dep = config.deps[depKey];
    const prefix = `deps["${depKey}"]`;

    // Validate required fields
    if (!dep.name) {
      errors.push(`${prefix} is missing required field: name`);
    }

    if (!dep.git || typeof dep.git !== 'object') {
      errors.push(`${prefix} is missing required field: git (must be an object)`);
    } else {
      if (!dep.git.url) {
        errors.push(`${prefix}.git is missing required field: url`);
      }
      if (typeof dep.git.shallow !== 'boolean') {
        errors.push(`${prefix}.git.shallow must be a boolean`);
      }
      if (typeof dep.git.initSubmodules !== 'boolean') {
        errors.push(`${prefix}.git.initSubmodules must be a boolean`);
      }
    }

    // Validate version/branch requirement
    const hasDefaultVersion = dep.defaultVersion !== null && dep.defaultVersion !== undefined;
    const hasBranch = dep.branch !== null && dep.branch !== undefined;

    if (!hasDefaultVersion && !hasBranch) {
      errors.push(
        `${prefix} must have either defaultVersion or branch specified. ` +
        'If defaultVersion is null, branch is required.'
      );
    }

    // Validate deps array if present
    if (dep.deps) {
      if (!Array.isArray(dep.deps)) {
        errors.push(`${prefix}.deps must be an array`);
      } else {
        for (const depRef of dep.deps) {
          if (!config.deps[depRef]) {
            errors.push(
              `${prefix}.deps references unknown dependency "${depRef}". ` +
              `Available dependencies: ${depNames.join(', ')}`
            );
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    const errorMessage = 'Build configuration validation failed:\n  ' + errors.join('\n  ');
    log.error({ errors }, 'configuration validation failed');
    throw new Error(errorMessage);
  }

  log.info({ depCount: depNames.length }, 'build configuration validated successfully');
}

/**
 * Get all dependency names from the configuration.
 * 
 * @param {Object} config - Build configuration object
 * @returns {string[]} Array of dependency keys
 */
export function getDependencyNames(config) {
  if (!config || !config.deps) {
    return [];
  }
  return Object.keys(config.deps);
}

/**
 * Get a specific dependency configuration.
 * 
 * @param {Object} config - Build configuration object
 * @param {string} depName - Dependency name/key
 * @returns {Object|null} Dependency configuration or null if not found
 */
export function getDependency(config, depName) {
  if (!config || !config.deps) {
    return null;
  }
  return config.deps[depName] || null;
}
