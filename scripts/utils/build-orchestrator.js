import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scopedLogger } from '../logging.js';
import { validateBuildConfig, getDependency } from './config-validator.js';
import { resolveBuildOrder } from './dependency-resolver.js';
import { prepareRepository } from './repo-manager.js';
import { ensureDirectory } from './file-system.js';
import { copyToReleases, listReleasedFiles } from './release-manager.js';

const log = scopedLogger('build-orchestrator');

/**
 * Orchestrates the entire build process.
 * 
 * This is the main entry point that:
 * 1. Validates the build configuration
 * 2. Resolves dependency order (detects circular deps)
 * 3. Prepares Git repositories (clone + checkout)
 * 4. Dynamically imports and runs build workers in order
 * 
 * @param {Object} options - Orchestration options
 * @param {Object} options.config - Build configuration object
 * @param {string} options.buildRoot - Root directory for build process
 * @param {boolean} [options.force=false] - Force clean rebuild
 * @returns {Promise<Object[]>} Array of build results
 */
export async function orchestrateBuild(options) {
  const { config, buildRoot, force = false } = options;

  if (!config) {
    throw new Error('orchestrateBuild requires a config object');
  }
  if (!buildRoot) {
    throw new Error('orchestrateBuild requires a buildRoot directory');
  }

  log.info({ configVersion: config.version, force }, 'starting build orchestration');

  // Step 1: Validate configuration
  validateBuildConfig(config);

  // Step 2: Resolve build order (detects circular dependencies)
  const buildOrder = resolveBuildOrder(config);
  
  log.info(
    { buildOrder, count: buildOrder.length },
    'build order resolved'
  );

  // Step 3: Set up directories
  const gitRoot = path.join(buildRoot, '.git.temp');
  const artifactsRoot = path.join(buildRoot, 'artifacts');
  
  ensureDirectory(gitRoot);
  ensureDirectory(artifactsRoot);

  // Step 4: Build each dependency in order
  const results = [];

  for (const depName of buildOrder) {
    log.info({ depName }, 'processing dependency');

    const depConfig = getDependency(config, depName);
    
    if (!depConfig) {
      const error = new Error(`Dependency ${depName} not found in configuration`);
      log.error({ depName }, 'dependency not found');
      results.push({
        ok: false,
        name: depName,
        error: error.message,
      });
      throw error;
    }

    try {
      // Prepare repository (clone + checkout)
      const repoResult = await prepareRepository({
        config: depConfig,
        depName,
        gitRoot,
        force,
        shallow: depConfig.git.shallow,
        initSubmodules: depConfig.git.initSubmodules,
      });

      log.info(
        {
          depName,
          repoRoot: repoResult.repoRoot,
          version: repoResult.version,
          branch: repoResult.branch,
        },
        'repository prepared'
      );

      // Get build worker path from config
      const workerPath = depConfig.runner;
      
      if (!workerPath) {
        throw new Error(
          `Dependency "${depName}" is missing a "runner" field in buildConfig.json`
        );
      }

      // Resolve the absolute path to the worker module
      const absoluteWorkerPath = path.resolve(buildRoot, workerPath);
      
      // Convert to file:// URL for ESM import (required on Windows)
      const workerUrl = pathToFileURL(absoluteWorkerPath).href;
      
      log.info({ depName, workerPath: absoluteWorkerPath }, 'importing build worker');
      
      const workerModule = await import(workerUrl);
      
      // All build workers export a standard "build" function
      const buildFunction = workerModule.build;
      
      if (!buildFunction || typeof buildFunction !== 'function') {
        throw new Error(
          `Build worker at "${workerPath}" does not export a "build" function. ` +
          `Available exports: ${Object.keys(workerModule).join(', ')}`
        );
      }

      // Determine artifacts directory using the name from config
      const artifactsDirName = depConfig.name || depName;
      const depArtifactsRoot = path.join(artifactsRoot, artifactsDirName);
      
      ensureDirectory(depArtifactsRoot);

      // Run the build worker
      log.info({ depName, repoRoot: repoResult.repoRoot }, 'starting build');
      
      const buildResult = await buildFunction({
        repoRoot: repoResult.repoRoot,
        artifactsRoot: depArtifactsRoot,
        force,
      });

      log.info({ depName, result: buildResult }, 'build completed');

      // Copy artifacts to releases (always, even if build was skipped)
      if (config.releasesRoot) {
        log.info({ depName }, 'copying artifacts to releases');
        
        const releaseResult = await copyToReleases({
          depName,
          depConfig,
          version: repoResult.version,
          artifactsRoot,
          artifactsDirName,
          releasesRoot: config.releasesRoot,
          buildRoot,
        });

        if (releaseResult.ok) {
          // List all files in the release directory
          const releasedFiles = await listReleasedFiles(releaseResult.releaseDir);
          
          log.info(
            {
              depName,
              releaseDir: releaseResult.releaseDir,
              fileCount: releasedFiles.length,
            },
            'release files copied'
          );

          // Log each file for visibility
          if (releasedFiles.length > 0) {
            log.info({ depName, files: releasedFiles }, 'released files:');
          }

          results.push({
            ...buildResult,
            name: depName,
            version: repoResult.version,
            branch: repoResult.branch,
            releaseDir: releaseResult.releaseDir,
            releasedFiles,
          });
        } else {
          results.push({
            ...buildResult,
            name: depName,
            version: repoResult.version,
            branch: repoResult.branch,
          });
        }
      } else {
        results.push({
          ...buildResult,
          name: depName,
          version: repoResult.version,
          branch: repoResult.branch,
        });
      }
    } catch (error) {
      log.error({ depName, err: error }, 'build failed');
      
      results.push({
        ok: false,
        name: depName,
        error: error.message,
      });
      
      // Re-throw to stop the build process
      throw error;
    }
  }

  log.info(
    { totalBuilds: results.length, successful: results.filter(r => r.ok).length },
    'build orchestration complete'
  );

  return results;
}
