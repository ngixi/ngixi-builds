import fs from 'node:fs';
import path from 'node:path';

import { scopedLogger } from '../logging.js';
import { cloneGitRepository, checkoutGitRef, updateGitSubmodules } from './git-operations.js';
import { ensureDirectory } from './file-system.js';

const log = scopedLogger('repo-manager');

/**
 * Prepares a Git repository for building.
 * Handles cloning, version/branch checkout, and submodule initialization.
 * 
 * This centralizes all Git operations that were previously duplicated across build workers.
 * 
 * @param {Object} options - Repository preparation options
 * @param {Object} options.config - Dependency configuration from buildConfig.json
 * @param {string} options.depName - Name of the dependency being prepared
 * @param {string} options.gitRoot - Root directory for Git repositories
 * @param {boolean} [options.force=false] - Force clean re-clone
 * @param {boolean} [options.shallow=true] - Perform shallow clone (--depth 1)
 * @param {boolean} [options.initSubmodules=false] - Initialize Git submodules after checkout
 * @returns {Object} Result object with { ok, repoRoot, version, branch, skipped }
 */
export async function prepareRepository(options) {
  const {
    config,
    depName,
    gitRoot,
    force = false,
    shallow = true,
    initSubmodules = false,
  } = options;

  // Validate inputs
  if (!config) {
    throw new Error(`prepareRepository: config is required for ${depName}`);
  }
  if (!depName) {
    throw new Error('prepareRepository: depName is required');
  }
  if (!gitRoot) {
    throw new Error('prepareRepository: gitRoot is required');
  }
  if (!config.git || !config.git.url) {
    throw new Error(`prepareRepository: ${depName} config is missing git.url`);
  }

  ensureDirectory(gitRoot);

  // Determine repository path
  const sanitizedName = depName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const repoRoot = path.resolve(gitRoot, sanitizedName);

  log.info(
    {
      depName,
      repoUrl: config.git.url,
      repoRoot,
      force,
      shallow,
      initSubmodules,
    },
    'preparing repository'
  );

  // Handle force flag - remove existing repository
  if (force && fs.existsSync(repoRoot)) {
    log.info({ repoRoot }, 'force flag enabled - removing existing repository');
    fs.rmSync(repoRoot, { recursive: true, force: true });
    log.info({ repoRoot }, 'existing repository removed');
  }

  // Clone repository
  const cloneResult = cloneGitRepository({
    repoUrl: config.git.url,
    destination: repoRoot,
    shallow,
  });

  if (!cloneResult.ok && !cloneResult.skipped) {
    const msg = cloneResult.stderr || cloneResult.stdout || 'unknown error';
    throw new Error(`Failed to clone ${depName} repository: ${msg}`);
  }

  log.info(
    { repoRoot, reused: cloneResult.skipped },
    'repository ready'
  );

  // Determine what to checkout (tag or branch)
  const hasDefaultVersion = config.defaultVersion !== null && config.defaultVersion !== undefined;
  const hasBranch = config.branch !== null && config.branch !== undefined;

  let checkoutRef = null;
  let isBranch = false;

  if (hasDefaultVersion) {
    // Prefer default version (tag)
    checkoutRef = config.defaultVersion;
    isBranch = false;
    log.info({ ref: checkoutRef }, 'will checkout tag/version');
  } else if (hasBranch) {
    // Use branch if defaultVersion is not specified
    checkoutRef = config.branch;
    isBranch = true;
    log.info({ ref: checkoutRef }, 'will checkout branch');
  } else {
    throw new Error(
      `${depName}: either defaultVersion or branch must be specified in config`
    );
  }

  // Checkout the reference (tag or branch)
  if (checkoutRef) {
    const trimmedRef = typeof checkoutRef === 'string' ? checkoutRef.trim() : '';
    
    // Build fallback refs (try with/without 'v' prefix for tags)
    const fallbackRefs = [];
    if (!isBranch && trimmedRef) {
      fallbackRefs.push(
        trimmedRef.startsWith('v') 
          ? trimmedRef.slice(1) 
          : `v${trimmedRef}`
      );
    }

    const checkoutResult = checkoutGitRef({
      repoPath: repoRoot,
      primaryRef: trimmedRef,
      fallbackRefs,
    });

    if (!checkoutResult.ok) {
      const detail = checkoutResult.errors
        ?.map(e => `  · ${e.ref} ${e.type} ${e.step}${e.output ? `\n    ${e.output}` : ''}`)
        .join('\n') || 'unknown error';
      throw new Error(
        `Failed to checkout ${depName} reference "${checkoutRef}".\nAttempts:\n${detail}`
      );
    }

    log.info(
      {
        ref: checkoutResult.ref,
        refType: checkoutResult.type,
        depName,
      },
      'checked out reference'
    );
  }

  // Initialize submodules if requested
  if (initSubmodules) {
    log.info({ depName }, 'initializing git submodules');
    const submoduleResult = updateGitSubmodules({ repoPath: repoRoot });
    
    if (!submoduleResult.ok) {
      const msg = submoduleResult.stderr || submoduleResult.stdout || 'unknown error';
      throw new Error(`Failed to initialize ${depName} submodules:\n${msg}`);
    }
    
    log.info({ depName }, 'git submodules initialized');
  }

  log.info({ depName, repoRoot }, 'repository preparation complete');

  return {
    ok: true,
    repoRoot,
    version: hasDefaultVersion ? config.defaultVersion : null,
    branch: hasBranch ? config.branch : null,
    skipped: cloneResult.skipped,
  };
}

/**
 * Get the expected repository path for a dependency.
 * This can be used to check if a repository exists before preparing it.
 * 
 * @param {string} gitRoot - Root directory for Git repositories
 * @param {string} depName - Name of the dependency
 * @returns {string} Expected repository path
 */
export function getRepositoryPath(gitRoot, depName) {
  const sanitizedName = depName.replace(/[^a-zA-Z0-9._-]/g, '-');
  return path.resolve(gitRoot, sanitizedName);
}
