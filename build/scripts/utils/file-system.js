import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { scopedLogger } from '../logging.js';

const log = scopedLogger('file-system');

/**
 * Ensures a directory exists, creating it recursively if needed.
 * @param {string} targetPath - The directory path to ensure
 * @returns {string} The ensured directory path
 * @throws {Error} If targetPath is not provided
 */
export function ensureDirectory(targetPath) {
  if (!targetPath) {
    throw new Error('ensureDirectory requires a path argument');
  }
  if (!existsSync(targetPath)) {
    log.debug({ targetPath }, 'creating directory');
    mkdirSync(targetPath, { recursive: true });
  }
  return targetPath;
}

/**
 * Ensures a subdirectory exists within a base path.
 * @param {string} basePath - The base directory path
 * @param {...string} segments - Path segments to join
 * @returns {string} The ensured subdirectory path
 */
export function ensureSubdirectory(basePath, ...segments) {
  const resolved = path.join(basePath, ...segments);
  return ensureDirectory(resolved);
}
