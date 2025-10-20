import fs from "node:fs";
import path from "node:path";
import {
  ensureDirectory,
  runCommand,
} from "../utils/index.js";
import { scopedLogger } from "../logging.js";

const log = scopedLogger("ngixi-zigwin32gen");

/**
 * Build ngixi-zigwin32gen.
 * 
 * This function expects the repository to already be cloned and checked out
 * to the correct version/branch by the repo-manager.
 * 
 * @param {Object} options - Build options
 * @param {string} options.repoRoot - Path to the cloned repository
 * @param {string} options.artifactsRoot - Path where build artifacts should be installed
 * @param {boolean} [options.force=false] - Force rebuild even if artifacts exist
 * @returns {Promise<Object>} Build result { ok, name, skipped? }
 */
export async function build(options) {
  const { repoRoot, artifactsRoot, force = false } = options;

  if (!repoRoot) {
    throw new Error("buildNgixiZigwin32gen requires a repoRoot path");
  }
  if (!artifactsRoot) {
    throw new Error("buildNgixiZigwin32gen requires an artifactsRoot path");
  }

  ensureDirectory(artifactsRoot);

  log.info({ repoRoot, artifactsRoot, force }, "starting ngixi-zigwin32gen build");

  // Check if artifacts already exist (skip build unless force=true)
  if (!force && checkZigwin32ArtifactsExist(artifactsRoot)) {
    log.info({ artifactsRoot }, "zigwin32 artifacts already exist, skipping build");
    return { ok: true, name: 'ngixi-zigwin32gen', skipped: true };
  }

  log.info({ artifactsRoot }, "building ngixi-zigwin32gen with zig build");
  const buildResult = runCommand("zig", ["build", "--prefix", artifactsRoot], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (!buildResult.ok) {
    const msg = buildResult.stderr || buildResult.stdout || "unknown error";
    throw new Error(`Failed to build ngixi-zigwin32gen:\n${msg}`);
  }

  log.info({ artifactsRoot }, "ngixi-zigwin32gen build completed successfully");
  
  return { ok: true, name: 'ngixi-zigwin32gen' };
}

/**
 * Check if zigwin32 artifacts already exist.
 * Looks for key generated files to determine if a build can be skipped.
 * 
 * @param {string} artifactsRoot - Artifacts directory
 * @returns {boolean} True if artifacts exist and appear complete
 */
function checkZigwin32ArtifactsExist(artifactsRoot) {
  // Check for key generated files
  const keyFiles = [
    path.join(artifactsRoot, "win32.zig"),
    path.join(artifactsRoot, "build.zig"),
  ];
  
  return keyFiles.every(file => fs.existsSync(file));
}
