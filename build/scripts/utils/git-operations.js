import { existsSync } from 'node:fs';
import path from 'node:path';

import { scopedLogger } from '../logging.js';
import { runCommand } from './command-runner.js';
import { ensureDirectory } from './file-system.js';

const log = scopedLogger('git-operations');

/**
 * Clones a Git repository to the specified destination.
 * @param {Object} options - Clone options
 * @param {string} options.repoUrl - The repository URL
 * @param {string} options.destination - The destination path
 * @param {boolean} options.shallow - Whether to perform a shallow clone (default: true)
 * @param {Function} options.runner - Command runner function (default: runCommand)
 * @param {string[]} options.extraArgs - Additional git clone arguments
 * @returns {Object} Clone result with ok, skipped, path, and other details
 */
export function cloneGitRepository(options) {
  const { repoUrl, destination, shallow = true, runner = runCommand, extraArgs = [] } = options;

  if (!repoUrl) {
    throw new Error('cloneGitRepository requires a repoUrl');
  }
  if (!destination) {
    throw new Error('cloneGitRepository requires a destination path');
  }

  const parent = path.dirname(destination);
  ensureDirectory(parent);

  if (existsSync(destination)) {
    log.info({ destination }, 'repository already exists, skipping clone');
    return {
      skipped: true,
      reason: 'already cloned',
      path: destination,
      ok: true,
    };
  }

  const args = ['clone', repoUrl, destination, ...extraArgs];

  if (shallow) {
    args.splice(1, 0, '--depth', '1');
  }

  log.info({ repoUrl, destination, shallow }, 'cloning git repository');
  const result = runner('git', args);

  return {
    ...result,
    skipped: false,
    path: destination,
  };
}

/**
 * Updates Git submodules in a repository.
 * @param {Object} options - Update options
 * @param {string} options.repoPath - The repository path
 * @param {boolean} options.recursive - Whether to update recursively (default: false)
 * @param {Function} options.runner - Command runner function (default: runCommand)
 * @param {string[]} options.extraArgs - Additional git submodule arguments
 * @returns {Object} Update result
 */
export function updateGitSubmodules(options) {
  const { repoPath, recursive = false, runner = runCommand, extraArgs = [] } = options;

  if (!repoPath) {
    throw new Error('updateGitSubmodules requires a repository path');
  }

  const args = ['-C', repoPath, 'submodule', 'update', '--init'];
  if (recursive) {
    args.push('--recursive');
  }
  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  log.info({ repoPath, recursive }, 'updating git submodules');
  return runner('git', args);
}

/**
 * Checks out a specific Git reference (tag or branch).
 * @param {Object} options - Checkout options
 * @param {string} options.repoPath - The repository path
 * @param {string} options.primaryRef - The primary reference to checkout
 * @param {string[]} options.fallbackRefs - Fallback references to try
 * @param {Function} options.runner - Command runner function (default: runCommand)
 * @returns {Object} Checkout result with ok, ref, type, or errors
 */
export function checkoutGitRef(options) {
  const { repoPath, primaryRef, fallbackRefs = [], runner = runCommand } = options;

  if (!repoPath) {
    throw new Error('checkoutGitRef requires a repository path');
  }

  const candidates = collectUniqueRefs(primaryRef, fallbackRefs);

  if (candidates.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: 'no reference provided',
    };
  }

  log.info({ repoPath, primaryRef, fallbackCount: fallbackRefs.length }, 'checking out git reference');
  const errors = [];

  for (const ref of candidates) {
    const trimmedRef = ref.trim();
    if (!trimmedRef) {
      continue;
    }

    const tagFetch = runner('git', ['-C', repoPath, 'fetch', '--depth', '1', 'origin', 'tag', trimmedRef]);
    if (tagFetch.ok) {
      const tagCheckout = attemptCheckoutVariants(runner, repoPath, trimmedRef, true);
      if (tagCheckout.ok) {
        return {
          ok: true,
          ref: trimmedRef,
          type: 'tag',
        };
      }
      errors.push({
        ref: trimmedRef,
        type: 'tag',
        step: 'checkout',
        output: tagCheckout.output,
      });
    } else {
      errors.push({
        ref: trimmedRef,
        type: 'tag',
        step: 'fetch',
        output: collectOutput(tagFetch),
      });
    }

    const branchFetch = runner('git', ['-C', repoPath, 'fetch', '--depth', '1', 'origin', trimmedRef]);
    if (branchFetch.ok) {
      const branchCheckout = runner('git', ['-C', repoPath, 'checkout', trimmedRef]);
      if (branchCheckout.ok) {
        return {
          ok: true,
          ref: trimmedRef,
          type: 'branch',
        };
      }
      errors.push({
        ref: trimmedRef,
        type: 'branch',
        step: 'checkout',
        output: collectOutput(branchCheckout),
      });
    } else {
      errors.push({
        ref: trimmedRef,
        type: 'branch',
        step: 'fetch',
        output: collectOutput(branchFetch),
      });
    }
  }

  return {
    ok: false,
    errors,
  };
}

/**
 * Collects unique Git references from primary and fallback refs.
 * @param {string|string[]} primary - Primary reference(s)
 * @param {string|string[]} fallback - Fallback reference(s)
 * @returns {string[]} Array of unique references
 */
function collectUniqueRefs(primary, fallback) {
  const refs = [];
  const seen = new Set();

  const enqueue = value => {
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        enqueue(entry);
      }
      return;
    }
    const stringValue = String(value).trim();
    if (!stringValue || seen.has(stringValue)) {
      return;
    }
    seen.add(stringValue);
    refs.push(stringValue);
  };

  enqueue(primary);
  enqueue(fallback);

  return refs;
}

/**
 * Attempts to checkout a Git reference with different variants.
 * @param {Function} runner - Command runner function
 * @param {string} repoPath - Repository path
 * @param {string} ref - Reference to checkout
 * @param {boolean} isTag - Whether the reference is a tag
 * @returns {Object} Checkout result
 */
function attemptCheckoutVariants(runner, repoPath, ref, isTag) {
  const variants = isTag ? [`tags/${ref}`, ref] : [ref];
  const outputs = [];

  for (const variant of variants) {
    const args = ['-C', repoPath, 'checkout'];
    if (isTag) {
      args.push('--detach');
    }
    args.push(variant);
    const result = runner('git', args);
    if (result.ok) {
      return {
        ok: true,
        output: collectOutput(result),
      };
    }
    outputs.push(collectOutput(result));
  }

  return {
    ok: false,
    output: outputs.filter(Boolean).join('\n'),
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
