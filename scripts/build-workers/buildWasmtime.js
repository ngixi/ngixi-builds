import fs from "node:fs";
import path from "node:path";
import {
  ensureDirectory,
  runCargo,
  runCommand,
} from "../utils/index.js";
import { scopedLogger } from "../logging.js";

const log = scopedLogger("wasmtime");

/**
 * Build Wasmtime runtime.
 * 
 * This function expects the repository to already be cloned and checked out
 * to the correct version/branch by the repo-manager.
 * 
 * @param {Object} options - Build options
 * @param {string} options.repoRoot - Path to the cloned Wasmtime repository
 * @param {string} options.artifactsRoot - Path where build artifacts should be installed
 * @param {boolean} [options.force=false] - Force rebuild even if artifacts exist
 * @returns {Promise<Object>} Build result { ok, name, version, skipped? }
 */
export async function build(options) {
  const { repoRoot, artifactsRoot, force = false } = options;

  if (!repoRoot) {
    throw new Error("buildWasmtime requires a repoRoot path");
  }
  if (!artifactsRoot) {
    throw new Error("buildWasmtime requires an artifactsRoot path");
  }

  ensureDirectory(artifactsRoot);

  log.info({ repoRoot, artifactsRoot, force }, "starting Wasmtime build");

  // Check if artifacts already exist (skip build unless force=true)
  if (!force && checkWasmtimeArtifactsExist(artifactsRoot)) {
    log.info({ artifactsRoot }, "Wasmtime artifacts already exist, skipping build");
    return { ok: true, name: 'Wasmtime', skipped: true };
  }

  // Clean any stale build artifacts from previous builds in different directories
  cleanStaleBuildArtifacts(repoRoot);
  
  buildWasmtimeRustCAPI(repoRoot);
  verifyRustArtifacts(repoRoot);
  configureWasmtimeCAPI(repoRoot, artifactsRoot);
  buildWasmtimeCAPI(repoRoot);
  installWasmtimeCAPI(repoRoot, artifactsRoot);
  copyRuntimeArtifacts(repoRoot, artifactsRoot);
  
  log.info({ artifactsRoot }, "Wasmtime build completed successfully");
  
  return { ok: true, name: 'Wasmtime' };
}

function buildWasmtimeRustCAPI(cwd) {
  log.info("building Rust C API crate (cargo build --release -p wasmtime-c-api)");
  const result = runCargo(["build", "--release", "-p", "wasmtime-c-api"], { cwd, stdio: "inherit" });
  if (!result.ok) fail("Rust C API build", result);
}

function cleanStaleBuildArtifacts(cwd) {
  const cmakeBuildDir = path.join(cwd, "target", "c-api");
  
  if (fs.existsSync(cmakeBuildDir)) {
    log.info({ cmakeBuildDir }, "cleaning stale CMake build directory to avoid path conflicts");
    fs.rmSync(cmakeBuildDir, { recursive: true, force: true });
    log.info("stale build artifacts cleaned");
  }
}

function verifyRustArtifacts(cwd) {
  const dll = path.join(cwd, "target", "release", "wasmtime.dll");
  const lib = path.join(cwd, "target", "release", "wasmtime.lib");
  if (!fs.existsSync(dll) || !fs.existsSync(lib)) {
    log.error({ dll, lib }, "missing Rust build artifacts");
    throw new Error("[wasmtime] missing Rust build artifacts — Cargo did not produce the runtime.");
  }
  log.info({ dll, lib }, "verified Rust artifacts exist");
}

function configureWasmtimeCAPI(cwd, installPrefix) {
  log.info({ installPrefix }, "configuring C API with CMake (cmake configure)");
  const args = [
    "-S", "crates/c-api", 
    "-B", "target/c-api", 
    `-DCMAKE_INSTALL_PREFIX=${installPrefix}`,
    "-G", "Ninja"  // Use Ninja generator for faster builds
  ];
  runCMakeOrThrow(
    args,
    cwd,
    "Failed to configure Wasmtime C API with CMake"
  );
}

function buildWasmtimeCAPI(cwd) {
  log.info("building C API with CMake (cmake --build target/c-api --config Release)");
  runCMakeOrThrow(
    ["--build", "target/c-api", "--config", "Release"],
    cwd,
    "Failed to build Wasmtime C API"
  );
}

function installWasmtimeCAPI(cwd, installPrefix) {
  log.info({ installPrefix }, "installing C API artifacts");
  runCMakeOrThrow(
    ["--install", "target/c-api", "--config", "Release"],
    cwd,
    "Failed to install Wasmtime C API artifacts"
  );
}

function copyRuntimeArtifacts(cwd, installPrefix) {
  const srcDll = path.join(cwd, "target", "release", "wasmtime.dll");
  const srcLib = path.join(cwd, "target", "release", "wasmtime.lib");
  const destLib = path.join(installPrefix, "lib");
  ensureDirectory(destLib);

  log.info({ destLib }, "copying runtime DLL and LIB to artifacts");
  fs.copyFileSync(srcDll, path.join(destLib, "wasmtime.dll"));
  fs.copyFileSync(srcLib, path.join(destLib, "wasmtime.lib"));
}

function runCMakeOrThrow(args, cwd, msg) {
  // First try with inherit to show output in real-time
  const result = runCommand("cmake", args, { cwd, stdio: "inherit" });
  if (!result.ok) {
    // If it fails, run again with pipe to capture output for error reporting
    log.warn("CMake command failed, re-running to capture output...");
    const captureResult = runCommand("cmake", args, { cwd, stdio: "pipe" });
    fail(msg, captureResult);
  }
}

function fail(label, result) {
  const output = result.stderr || result.stdout || (result.error ? result.error.message : "");
  const code = typeof result.status === "number" ? ` (exit code ${result.status})` : "";
  const err = result.error instanceof Error ? result.error : undefined;
  log.error({ label, status: result.status, output, err }, "Wasmtime build step failed");
  throw new Error(`[wasmtime] ${label} failed${code}\n${output}`);
}

/**
 * Check if Wasmtime artifacts already exist.
 * Looks for key headers and libraries to determine if a build can be skipped.
 * 
 * @param {string} artifactsRoot - Artifacts directory
 * @returns {boolean} True if artifacts exist and appear complete
 */
function checkWasmtimeArtifactsExist(artifactsRoot) {
  const includeDir = path.join(artifactsRoot, "include");
  const libDir = path.join(artifactsRoot, "lib");
  
  // Check for key headers
  const keyHeaders = [
    path.join(includeDir, "wasmtime.h"),
    path.join(includeDir, "wasm.h"),
  ];
  
  // Check for key libraries (Windows-specific)
  const keyLibs = process.platform === "win32" 
    ? [
        path.join(libDir, "wasmtime.dll"),
        path.join(libDir, "wasmtime.lib"),
      ]
    : [
        path.join(libDir, "libwasmtime.so"),
        path.join(libDir, "libwasmtime.a"),
      ];
  
  // All key files must exist
  const allFiles = [...keyHeaders, ...keyLibs];
  return allFiles.every(file => fs.existsSync(file));
}
