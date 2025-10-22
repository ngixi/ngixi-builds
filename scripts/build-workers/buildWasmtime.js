import fs from "node:fs";
import path from "node:path";
import { platform } from "node:os";
import {
  ensureDirectory,
  runCargo,
  runCommand,
} from "../utils/index.js";
import { scopedLogger } from "../logging.js";

const log = scopedLogger("wasmtime");

/**
 * Get platform-specific file extensions for Wasmtime artifacts
 * @returns {Object} Object with dll, lib, and staticLib extensions
 */
function getPlatformExtensions() {
  const os = platform();
  
  if (os === 'win32') {
    return {
      dll: '.dll',
      lib: '.lib',
      staticLib: '.lib',
      dllName: 'wasmtime.dll',
      libName: 'wasmtime.lib',
      staticLibName: 'wasmtime.lib'
    };
  } else if (os === 'darwin') {
    return {
      dll: '.dylib',
      lib: '.dylib',
      staticLib: '.a',
      dllName: 'libwasmtime.dylib',
      libName: 'libwasmtime.dylib',
      staticLibName: 'libwasmtime.a'
    };
  } else {
    // Linux and others
    return {
      dll: '.so',
      lib: '.so',
      staticLib: '.a',
      dllName: 'libwasmtime.so',
      libName: 'libwasmtime.so',
      staticLibName: 'libwasmtime.a'
    };
  }
}

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
  
  // Clean Cargo cache and lock file to prevent dependency version conflicts
  log.info("cleaning Cargo build cache to prevent symbol conflicts");
  const cleanResult = runCargo(["clean"], { cwd, stdio: "inherit" });
  if (!cleanResult.ok) {
    log.warn("cargo clean failed, continuing anyway");
  }
  
  // Update Cargo.lock to ensure dependency consistency
  log.info("updating Cargo.lock to resolve dependency conflicts");
  const updateResult = runCargo(["update"], { cwd, stdio: "inherit" });
  if (!updateResult.ok) {
    log.warn("cargo update failed, continuing with existing lock file");
  }
  
  // Set up environment for Cargo
  const env = { ...process.env };
  
  // Build arguments - start with base command
  const buildArgs = ["build", "--release", "-p", "wasmtime-c-api"];
  
  // Reduce codegen-units to prevent compiler crashes and improve stability
  // Also reduce optimization level slightly to avoid aggressive optimizations that can cause crashes
  let rustFlags = '-C codegen-units=1';
  
  // On Linux, use system linker without forcing specific linker to avoid crashes
  if (platform() === 'linux') {
    log.info("using default system linker on Linux for maximum stability");
    // Don't force any specific linker - let Rust choose the most stable option
    // The previous linker selection was causing SIGSEGV crashes
    
    // Add link-arg to increase stack size (helps prevent crashes during linking)
    rustFlags += ' -C link-arg=-Wl,-z,stack-size=8388608';
  }
  
  // Set RUSTFLAGS if we have any
  if (rustFlags) {
    env.RUSTFLAGS = rustFlags;
    log.info({ rustFlags }, "using custom Rust compiler flags");
  }
  
  // Limit parallel jobs to reduce memory pressure (helps prevent SIGSEGV)
  // Use 1 job for maximum stability, or 2 if system has enough memory
  buildArgs.push("-j", "1");
  log.info("limiting parallel jobs to 1 to prevent memory exhaustion and compiler crashes");
  
  const result = runCargo(buildArgs, { cwd, env, stdio: "inherit" });
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
  const exts = getPlatformExtensions();
  const dll = path.join(cwd, "target", "release", exts.dllName);
  const lib = path.join(cwd, "target", "release", exts.libName);
  
  if (!fs.existsSync(dll)) {
    log.error({ dll, expected: exts.dllName }, "missing Rust shared library artifact");
    throw new Error(`[wasmtime] missing Rust build artifacts — Cargo did not produce ${exts.dllName}`);
  }
  
  // On some platforms, shared lib and import lib might be the same file
  if (exts.dllName !== exts.libName && !fs.existsSync(lib)) {
    log.error({ lib, expected: exts.libName }, "missing Rust import library artifact");
    throw new Error(`[wasmtime] missing Rust build artifacts — Cargo did not produce ${exts.libName}`);
  }
  
  log.info({ dll, lib }, "verified Rust artifacts exist");
}

function configureWasmtimeCAPI(cwd, installPrefix) {
  log.info({ installPrefix }, "configuring C API with CMake (cmake configure)");
  
  const os = platform();
  const args = [
    "-S", "crates/c-api", 
    "-B", "target/c-api", 
    `-DCMAKE_INSTALL_PREFIX=${installPrefix}`,
    "-G", "Ninja",  // Use Ninja generator for faster builds
  ];
  
  // Add platform-specific compiler settings
  if (os === 'win32') {
    args.push("-DCMAKE_C_COMPILER=cl.exe");
    args.push("-DCMAKE_CXX_COMPILER=cl.exe");
  } else {
    // On Unix-like systems, use default compilers (usually gcc/g++ or clang/clang++)
    // CMake will find them automatically
  }
  
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
  const exts = getPlatformExtensions();
  const srcDll = path.join(cwd, "target", "release", exts.dllName);
  const srcLib = path.join(cwd, "target", "release", exts.libName);
  const destLib = path.join(installPrefix, "lib");
  ensureDirectory(destLib);

  log.info({ destLib, dllName: exts.dllName, libName: exts.libName }, "copying runtime library artifacts");
  
  // Copy shared library
  fs.copyFileSync(srcDll, path.join(destLib, exts.dllName));
  
  // Copy import library if different from shared library
  if (exts.dllName !== exts.libName && fs.existsSync(srcLib)) {
    fs.copyFileSync(srcLib, path.join(destLib, exts.libName));
  }
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
  
  // Check for key libraries (platform-specific)
  const exts = getPlatformExtensions();
  const keyLibs = [
    path.join(libDir, exts.dllName),
  ];
  
  // Add import library if it's different from shared library (Windows)
  if (exts.dllName !== exts.libName) {
    keyLibs.push(path.join(libDir, exts.libName));
  }
  
  // All key files must exist
  const allFiles = [...keyHeaders, ...keyLibs];
  const exists = allFiles.every(file => fs.existsSync(file));
  
  if (!exists) {
    const missing = allFiles.filter(file => !fs.existsSync(file));
    log.debug({ missing }, "some artifacts are missing");
  }
  
  return exists;
}
