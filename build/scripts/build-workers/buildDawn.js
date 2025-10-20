import fs from 'node:fs';
import path from 'node:path';
import { ensureDirectory, runCommand } from '../utils/index.js';
import { scopedLogger } from '../logging.js';

const log = scopedLogger('dawn');

/**
 * Build Google Dawn WebGPU implementation.
 *
 * Dawn is Google's implementation of the WebGPU standard. It provides both
 * native C/C++ APIs and can be used as a WebGPU implementation in browsers.
 *
 * This function expects the repository to already be cloned and checked out
 * to the correct version/branch by the repo-manager.
 *
 * Build process:
 * 1. Fetch dependencies using depot_tools (gclient) or Python script
 * 2. Configure build with CMake
 * 3. Build with Ninja
 * 4. Install headers and libraries to artifacts directory
 *
 * @param {Object} options - Build options
 * @param {string} options.repoRoot - Path to the cloned Dawn repository
 * @param {string} options.artifactsRoot - Path where build artifacts should be installed
 * @param {boolean} [options.force=false] - Force rebuild even if artifacts exist
 * @returns {Promise<Object>} Build result { ok, name, skipped? }
 */
export async function build(options) {
  const { repoRoot, artifactsRoot, force = false } = options;

  if (!repoRoot) {
    throw new Error('buildDawn requires a repoRoot path');
  }
  if (!artifactsRoot) {
    throw new Error('buildDawn requires an artifactsRoot path');
  }

  ensureDirectory(artifactsRoot);

  log.info({ repoRoot, artifactsRoot, force }, 'starting Dawn build');

  // Check if artifacts already exist (skip build unless force=true)
  if (!force && checkDawnArtifactsExist(artifactsRoot)) {
    log.info({ artifactsRoot }, 'Dawn artifacts already exist, skipping build');
    return { ok: true, name: 'Dawn', skipped: true };
  }

  // Fetch Dawn dependencies
  fetchDawnDependencies(repoRoot);

  // Clean any stale build artifacts from previous builds in different directories
  cleanStaleBuildArtifacts(repoRoot);

  // Configure Dawn build with CMake
  const buildDir = path.join(repoRoot, 'out', 'Release');
  configureDawnCMake(repoRoot, buildDir, artifactsRoot);

  // Build Dawn with CMake + Ninja
  buildDawnCMake(repoRoot, buildDir);

  // Install Dawn artifacts (headers and libraries)
  installDawnArtifacts(repoRoot, buildDir);

  // Verify artifacts were created
  verifyDawnArtifacts(artifactsRoot);

  log.info({ artifactsRoot }, 'Dawn build completed successfully');

  return { ok: true, name: 'Dawn' };
}

/**
 * Fetch Dawn dependencies using depot_tools (gclient).
 * Falls back to Python script if depot_tools is not available.
 *
 * @param {string} cwd - Dawn repository path
 */
function fetchDawnDependencies(cwd) {
  log.info('fetching Dawn dependencies');

  // Check if depot_tools (gclient) is available
  const gclientCheck = runCommand('gclient', ['--version'], { cwd, stdio: 'pipe' });

  if (gclientCheck.ok) {
    log.info('using depot_tools (gclient) to fetch dependencies');

    // Copy standalone gclient config
    const standaloneGclient = path.join(cwd, 'scripts', 'standalone.gclient');
    const gclientConfig = path.join(cwd, '.gclient');

    if (!fs.existsSync(gclientConfig)) {
      log.info({ source: standaloneGclient, dest: gclientConfig }, 'copying standalone .gclient config');
      fs.copyFileSync(standaloneGclient, gclientConfig);
    }

    // Set environment variable to use local Visual Studio toolchain instead of downloading from Google Cloud
    // This is required on Windows to avoid authentication errors when accessing Google's internal storage
    // Reference: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/windows_build_instructions.md
    const env = {
      ...process.env,
      DEPOT_TOOLS_WIN_TOOLCHAIN: '0',
    };

    log.info('setting DEPOT_TOOLS_WIN_TOOLCHAIN=0 to use local Visual Studio installation');
    log.info('Note: You may see warnings about depot-tools.allowGlobalGitConfig - these can be safely ignored');

    // Run gclient sync to fetch dependencies
    log.info('running gclient sync (this may take several minutes)');
    const syncResult = runCommand('gclient', ['sync'], { cwd, env, stdio: 'inherit' });

    if (!syncResult.ok) {
      fail('gclient sync', syncResult);
    }

    log.info('dependencies fetched successfully via gclient');
  } else {
    log.info('depot_tools not available, using Python script to fetch dependencies');

    // Use Python script as fallback
    const fetchScript = path.join(cwd, 'tools', 'fetch_dawn_dependencies.py');

    if (!fs.existsSync(fetchScript)) {
      throw new Error(`fetch_dawn_dependencies.py not found at ${fetchScript}`);
    }

    log.info('running fetch_dawn_dependencies.py (this may take several minutes)');

    // Determine Python command (python3 or python)
    const pythonCmd = determinePythonCommand();

    const fetchResult = runCommand(pythonCmd, [fetchScript], { cwd, stdio: 'inherit' });

    if (!fetchResult.ok) {
      fail('fetch_dawn_dependencies.py', fetchResult);
    }

    log.info('dependencies fetched successfully via Python script');
  }
}

/**
 * Clean stale CMake build artifacts to avoid path conflicts.
 * This removes the build directory if it exists to ensure a clean configuration.
 *
 * @param {string} cwd - Dawn repository path
 */
function cleanStaleBuildArtifacts(cwd) {
  const buildDir = path.join(cwd, 'out');

  if (fs.existsSync(buildDir)) {
    log.info({ buildDir }, 'cleaning stale CMake build directory to avoid path conflicts');
    fs.rmSync(buildDir, { recursive: true, force: true });
    log.info('stale build artifacts cleaned');
  }
}

/**
 * Get the actual Python executable path.
 * If using pyenv, gets the real Python path (not the shim).
 *
 * @returns {string|null} Python executable path or null
 */
function getPythonExecutable() {
  // Try to get the real Python path from pyenv
  const pyenvWhich = runCommand('pyenv', ['which', 'python'], { stdio: 'pipe', shell: process.platform === 'win32' });
  if (pyenvWhich.ok && pyenvWhich.stdout.trim()) {
    const pythonPath = pyenvWhich.stdout.trim();
    log.debug({ pythonPath }, 'found Python via pyenv which');
    return pythonPath;
  }

  // Try python3 command directly
  const python3Check = runCommand('python3', ['--version'], { stdio: 'pipe' });
  if (python3Check.ok) {
    // Get full path to python3
    const python3Path = runCommand('where', ['python3'], { stdio: 'pipe', shell: true });
    if (python3Path.ok && python3Path.stdout.trim()) {
      const lines = python3Path.stdout.trim().split('\n');
      const firstPath = lines[0].trim();
      // Skip if it's a pyenv shim
      if (!firstPath.includes('pyenv') && !firstPath.includes('shims')) {
        log.debug({ pythonPath: firstPath }, 'found Python via python3');
        return firstPath;
      }
    }
  }

  // Try python command
  const pythonCheck = runCommand('python', ['--version'], { stdio: 'pipe' });
  if (pythonCheck.ok && pythonCheck.stdout.includes('Python 3')) {
    const pythonPath = runCommand('where', ['python'], { stdio: 'pipe', shell: true });
    if (pythonPath.ok && pythonPath.stdout.trim()) {
      const lines = pythonPath.stdout.trim().split('\n');
      const firstPath = lines[0].trim();
      // Skip if it's a pyenv shim
      if (!firstPath.includes('pyenv') && !firstPath.includes('shims')) {
        log.debug({ pythonPath: firstPath }, 'found Python via python');
        return firstPath;
      }
    }
  }

  log.warn('could not determine Python executable path for CMake');
  return null;
}

/**
 * Configure Dawn build with CMake.
 * Sets up the build directory with appropriate options.
 *
 * @param {string} cwd - Dawn repository path
 * @param {string} buildDir - Build output directory
 * @param {string} installPrefix - Installation prefix for artifacts
 */
function configureDawnCMake(cwd, buildDir, installPrefix) {
  log.info({ buildDir, installPrefix }, 'configuring Dawn with CMake');

  ensureDirectory(buildDir);

  // Get the actual Python executable path (not the pyenv shim)
  const pythonExecutable = getPythonExecutable();

  const cmakeArgs = [
    '-S',
    '.',
    '-B',
    path.relative(cwd, buildDir),
    '-G',
    'Ninja',
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_INSTALL_PREFIX=${installPrefix}`,

    // Force Dawn to install and build everything internally
    '-DDAWN_ENABLE_INSTALL=ON',
    '-DDAWN_BUILD_SAMPLES=OFF',
    '-DTINT_BUILD_TESTS=OFF',
    '-DDAWN_BUILD_NODE_BINDINGS=OFF',

    // ✅ Build one monolithic DLL with every component statically linked
    '-DDAWN_BUILD_MONOLITHIC_LIBRARY=SHARED',
    '-DBUILD_SHARED_LIBS=OFF',

    // Enable every backend and feature that compiles on Windows
    '-DDAWN_ENABLE_CPP_API=ON',
    '-DDAWN_ENABLE_DESKTOP_GL=ON',
    '-DDAWN_ENABLE_METAL=OFF', // macOS only
    '-DDAWN_ENABLE_VULKAN=ON',
    '-DDAWN_ENABLE_D3D11=ON',
    '-DDAWN_ENABLE_D3D12=ON',
    '-DDAWN_USE_SWIFTSHADER=ON',

    // Pull in all of Tint’s code generators/readers so shaders compile at runtime
    '-DTINT_BUILD_SPV_READER=ON',
    '-DTINT_BUILD_SPV_WRITER=ON',
    '-DTINT_BUILD_GLSL_WRITER=ON',
    '-DTINT_BUILD_HLSL_WRITER=ON',
    '-DTINT_BUILD_MSL_WRITER=ON',
    '-DTINT_BUILD_WGSL_READER=ON',
    '-DTINT_BUILD_WGSL_WRITER=ON',
    '-DTINT_BUILD_IR=ON',
    '-DTINT_BUILD_FUZZERS=OFF',

    // Bundle all dependencies statically
    '-DDAWN_USE_STATIC_LIBS=ON',
    '-DTINT_USE_STATIC_LIBS=ON',

    // Disable all test harnesses
    '-DTINT_BUILD_TESTS=OFF',
    '-DDAWN_BUILD_TESTS=OFF',

    // Compiler setup
    '-DCMAKE_C_FLAGS_RELEASE=/O2 /DNDEBUG',
    '-DCMAKE_CXX_FLAGS_RELEASE=/O2 /DNDEBUG',
    '-DCMAKE_C_COMPILER=cl',
    '-DCMAKE_CXX_COMPILER=cl',
  ];
  // Tell CMake where Python is (CMake can't use pyenv shims)
  if (pythonExecutable) {
    cmakeArgs.push(`-DPython3_EXECUTABLE=${pythonExecutable}`);
    log.info({ pythonExecutable }, 'setting Python3 executable for CMake');
  }

  log.info({ args: cmakeArgs.join(' ') }, 'running CMake configuration');

  const configResult = runCommand('cmake', cmakeArgs, { cwd, stdio: 'inherit' });

  if (!configResult.ok) {
    fail('CMake configuration', configResult);
  }

  log.info('CMake configuration completed');
}

/**
 * Build Dawn with CMake and Ninja.
 *
 * @param {string} cwd - Dawn repository path
 * @param {string} buildDir - Build output directory
 */
function buildDawnCMake(cwd, buildDir) {
  log.info({ buildDir }, 'building Dawn with CMake');

  const buildArgs = ['--build', path.relative(cwd, buildDir), '--config', 'Release', '--parallel'];

  log.info('running CMake build (this may take several minutes)');

  const buildResult = runCommand('cmake', buildArgs, { cwd, stdio: 'inherit' });

  if (!buildResult.ok) {
    fail('CMake build', buildResult);
  }

  log.info('Dawn build completed');
}

/**
 * Install Dawn artifacts to the artifacts directory.
 * This includes headers and libraries needed for linking.
 *
 * @param {string} cwd - Dawn repository path
 * @param {string} buildDir - Build output directory
 */
function installDawnArtifacts(cwd, buildDir) {
  log.info('installing Dawn artifacts');

  const installArgs = ['--install', path.relative(cwd, buildDir), '--config', 'Release'];

  const installResult = runCommand('cmake', installArgs, { cwd, stdio: 'inherit' });

  if (!installResult.ok) {
    fail('CMake install', installResult);
  }

  log.info('Dawn artifacts installed successfully');
}

/**
 * Verify that Dawn artifacts were created successfully.
 * Checks for presence of key headers and libraries.
 *
 * @param {string} artifactsRoot - Artifacts directory
 */
function verifyDawnArtifacts(artifactsRoot) {
  log.info({ artifactsRoot }, 'verifying Dawn artifacts');

  const includeDir = path.join(artifactsRoot, 'include');
  const libDir = path.join(artifactsRoot, 'lib');

  if (!fs.existsSync(includeDir)) {
    throw new Error(`Dawn include directory not found: ${includeDir}`);
  }

  if (!fs.existsSync(libDir)) {
    throw new Error(`Dawn lib directory not found: ${libDir}`);
  }

  // Check for key Dawn headers
  const keyHeaders = [path.join(includeDir, 'dawn', 'webgpu.h'), path.join(includeDir, 'dawn', 'dawn_proc.h')];

  for (const header of keyHeaders) {
    if (!fs.existsSync(header)) {
      log.warn({ header }, 'expected Dawn header not found');
    } else {
      log.debug({ header }, 'verified Dawn header exists');
    }
  }

  // Check for libraries (Windows-specific)
  if (process.platform === 'win32') {
    const keyLibs = [path.join(libDir, 'webgpu_dawn.lib'), path.join(libDir, 'dawn_proc.lib')];

    for (const lib of keyLibs) {
      if (!fs.existsSync(lib)) {
        log.warn({ lib }, 'expected Dawn library not found');
      } else {
        log.debug({ lib }, 'verified Dawn library exists');
      }
    }
  }

  log.info('Dawn artifacts verified');
}

/**
 * Determine which Python command to use (python3 or python).
 *
 * @returns {string} Python command
 */
function determinePythonCommand() {
  // Try python3 first
  const python3Check = runCommand('python3', ['--version'], { stdio: 'pipe' });
  if (python3Check.ok) {
    return 'python3';
  }

  // Fall back to python
  const pythonCheck = runCommand('python', ['--version'], { stdio: 'pipe' });
  if (pythonCheck.ok && pythonCheck.stdout.includes('Python 3')) {
    return 'python';
  }

  throw new Error('Python 3 is required but not found. Please install Python 3.11 or newer.');
}

/**
 * Fail the build with a detailed error message.
 *
 * @param {string} label - Step label for error message
 * @param {Object} result - Command result object
 */
function fail(label, result) {
  const output = result.stderr || result.stdout || (result.error ? result.error.message : '');
  const code = typeof result.status === 'number' ? ` (exit code ${result.status})` : '';
  const err = result.error instanceof Error ? result.error : undefined;
  log.error({ label, status: result.status, output, err }, 'Dawn build step failed');
  throw new Error(`[dawn] ${label} failed${code}\n${output}`);
}

/**
 * Check if Dawn artifacts already exist.
 * Looks for key headers and libraries to determine if a build can be skipped.
 *
 * @param {string} artifactsRoot - Artifacts directory
 * @returns {boolean} True if artifacts exist and appear complete
 */
function checkDawnArtifactsExist(artifactsRoot) {
  const includeDir = path.join(artifactsRoot, 'include');
  const libDir = path.join(artifactsRoot, 'lib');

  // Check for key headers
  const keyHeaders = [
    path.join(includeDir, 'dawn', 'webgpu.h'),
    path.join(includeDir, 'dawn', 'dawn_proc_table.h'),
    path.join(includeDir, 'webgpu', 'webgpu.h'),
  ];

  // Check for libraries (Windows uses .lib, Linux/macOS use .a/.so)
  const keyLibs = process.platform === 'win32' ? [path.join(libDir, 'webgpu_dawn.lib')] : [path.join(libDir, 'libwebgpu_dawn.a')];

  // All key files must exist
  const allFiles = [...keyHeaders, ...keyLibs];
  const exists = allFiles.every(file => fs.existsSync(file));

  if (!exists) {
    log.debug({ artifactsRoot, missingFiles: allFiles.filter(f => !fs.existsSync(f)) }, 'Dawn artifacts incomplete or missing');
  }

  return exists;
}
