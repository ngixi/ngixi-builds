import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import { platform, arch } from 'node:os';
import cpx from 'cpx2';
import pino from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

/**
 * Map Node.js platform() to standard OS names
 * @returns {string} OS name (win, linux, darwin)
 */
function getOSName() {
  const platformName = platform();
  const osMap = {
    'win32': 'win',
    'linux': 'linux',
    'darwin': 'darwin',
    'freebsd': 'freebsd',
    'openbsd': 'openbsd',
    'sunos': 'sunos',
    'aix': 'aix',
  };
  return osMap[platformName] || platformName;
}

/**
 * Map Node.js arch() to standard platform names
 * @returns {string} Platform name (x64, arm64, etc.)
 */
function getPlatformArch() {
  const archName = arch();
  const archMap = {
    'x64': 'x64',
    'arm64': 'arm64',
    'ia32': 'x86',
    'arm': 'arm',
    'ppc64': 'ppc64',
    's390x': 's390x',
  };
  return archMap[archName] || archName;
}

/**
 * Copy artifacts to the releases folder based on outConfig
 * @param {Object} options
 * @param {string} options.depName - Name of the dependency
 * @param {Object} options.depConfig - Configuration for the dependency
 * @param {string} options.version - Version that was built (can be null for no-version deps)
 * @param {string} options.artifactsRoot - Root path where artifacts are currently located
 * @param {string} options.artifactsDirName - The actual artifacts directory name (e.g., "zigwin32" not "ngixi.zigwin32gen")
 * @param {string} options.releasesRoot - Root path for releases (relative to build.js)
 * @param {string} options.buildRoot - Root path of build.js (for resolving releasesRoot)
 * @returns {Promise<{ok: boolean, copiedFiles: string[]}>}
 */
export async function copyToReleases(options) {
  const { depName, depConfig, version, artifactsRoot, artifactsDirName, releasesRoot, buildRoot } = options;

  const outConfig = depConfig.outConfig;
  if (!outConfig) {
    log.warn({ depName }, 'no outConfig found, skipping release copy');
    return { ok: true, copiedFiles: [] };
  }

  // Resolve the releases root path (relative to build.js location)
  const absoluteReleasesRoot = resolve(buildRoot, releasesRoot);

  // Build the output directory path with substitutions
  let outDir = outConfig.outDir || '{name}';
  outDir = outDir.replace('{name}', depConfig.name || depName);
  outDir = outDir.replace('{os}', getOSName());
  outDir = outDir.replace('{platform}', getPlatformArch());
  
  // Only substitute {version} if version is provided
  if (version) {
    outDir = outDir.replace('{version}', version);
    outDir = outDir.replace('{ver}', version);
  } else {
    // Remove any {version} or {ver} placeholders if no version
    outDir = outDir.replace('/{version}', '');
    outDir = outDir.replace('/{ver}', '');
    outDir = outDir.replace('{version}', '');
    outDir = outDir.replace('{ver}', '');
  }

  const targetReleaseDir = resolve(absoluteReleasesRoot, outDir);

  log.info(
    { depName, targetReleaseDir, version: version || 'no-version' },
    'preparing release directory'
  );

  // Clean the target directory if it exists (only if clearRelease is true)
  const clearRelease = outConfig.clearRelease !== undefined ? outConfig.clearRelease : false;
  
  if (clearRelease && existsSync(targetReleaseDir)) {
    log.info({ targetReleaseDir }, 'clearing existing release directory (clearRelease=true)');
    await rm(targetReleaseDir, { recursive: true, force: true });
  }

  // Create the target directory
  await mkdir(targetReleaseDir, { recursive: true });

  const copiedFiles = [];

  // Process each include configuration
  const includes = outConfig.include || [];
  if (includes.length === 0) {
    log.warn({ depName }, 'no includes found in outConfig, nothing to copy');
    return { ok: true, copiedFiles: [] };
  }

  // Resolve artifact source (from artifactsRoot/artifactsDirName/)
  const artifactSourceRoot = resolve(artifactsRoot, artifactsDirName || depName);

  for (const includeGroup of includes) {
    const globs = includeGroup.globs || [];

    for (const globConfig of globs) {
      const { folder, pattern, moveToRoot = false } = globConfig;

      // Determine source path
      let sourceFolder = artifactSourceRoot;
      if (folder && folder !== '/') {
        sourceFolder = resolve(artifactSourceRoot, folder);
      }

      // Determine target path
      let targetFolder = targetReleaseDir;
      if (!moveToRoot && folder && folder !== '/') {
        targetFolder = resolve(targetReleaseDir, folder);
      }

      const sourcePattern = join(sourceFolder, pattern);

      log.debug(
        {
          depName,
          sourcePattern,
          targetFolder,
          moveToRoot,
        },
        'copying files'
      );

      // Use cpx2 to copy files
      await new Promise((resolvePromise, reject) => {
        cpx.copy(sourcePattern, targetFolder, (err) => {
          if (err) {
            log.error({ err, sourcePattern, targetFolder }, 'failed to copy files');
            reject(err);
          } else {
            log.info({ sourcePattern, targetFolder }, 'copied files successfully');
            copiedFiles.push(`${sourcePattern} -> ${targetFolder}`);
            resolvePromise();
          }
        });
      });
    }
  }

  log.info(
    { depName, targetReleaseDir, fileCount: copiedFiles.length },
    'release copy completed'
  );

  return { ok: true, copiedFiles, releaseDir: targetReleaseDir };
}

/**
 * List all files that were copied to the release directory
 * @param {string} releaseDir - The release directory path
 * @returns {Promise<string[]>} Array of file paths relative to releaseDir
 */
export async function listReleasedFiles(releaseDir) {
  const { readdir, stat } = await import('node:fs/promises');
  const files = [];

  async function walk(dir, baseDir = dir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, baseDir);
      } else {
        const relativePath = fullPath.substring(baseDir.length + 1);
        files.push(relativePath);
      }
    }
  }

  if (existsSync(releaseDir)) {
    await walk(releaseDir);
  }

  return files;
}
