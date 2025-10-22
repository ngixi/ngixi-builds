import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scopedLogger } from '../scripts/logging.js';

const log = scopedLogger('tool-loader');

/**
 * Loads and configures tools for a build, capturing and restoring environment state.
 * 
 * @param {Array<Object>} toolSpecs - Array of { name, toolFile } objects
 * @param {string} toolsDir - Directory containing tool configuration files
 * @returns {Promise<Function>} Cleanup function to restore environment
 */
export async function loadTools(toolSpecs, toolsDir) {
  if (!toolSpecs || toolSpecs.length === 0) {
    log.info('no tools to load');
    return () => {}; // no-op cleanup
  }

  log.info({ toolCount: toolSpecs.length }, 'loading tools for build');

  // Capture original environment state
  const originalEnv = {
    PATH: process.env.PATH,
    INCLUDE: process.env.INCLUDE,
    LIB: process.env.LIB,
    // Add more env vars as needed
  };

  const cleanupFunctions = [];

  // Load and configure each tool
  for (const spec of toolSpecs) {
    const { name, toolFile } = spec;
    
    log.debug({ name, toolFile }, 'loading tool configuration');
    
    const toolPath = path.join(toolsDir, toolFile);
    const toolUrl = pathToFileURL(toolPath).href;
    
    try {
      const toolModule = await import(toolUrl);
      
      if (typeof toolModule.configureTool !== 'function') {
        log.warn({ name, toolFile }, 'tool module does not export configureTool function');
        continue;
      }

      // Configure the tool (may modify process.env)
      const result = await toolModule.configureTool();
      
      if (!result.ok) {
        log.error({ name, reason: result.reason }, 'tool configuration failed');
        throw new Error(`Failed to configure tool "${name}": ${result.reason || 'unknown error'}`);
      }

      log.info({ name, version: result.version, path: result.path }, 'tool configured successfully');

      // Store cleanup function if provided
      if (typeof result.cleanup === 'function') {
        cleanupFunctions.push({ name, cleanup: result.cleanup });
      }

    } catch (error) {
      log.error({ name, toolFile, err: error }, 'failed to load tool module');
      throw new Error(`Failed to load tool "${name}" from "${toolFile}": ${error.message}`);
    }
  }

  // Return cleanup function that restores environment
  return () => {
    log.info({ toolCount: cleanupFunctions.length }, 'cleaning up tools and restoring environment');
    
    // Run tool-specific cleanup functions in reverse order
    for (let i = cleanupFunctions.length - 1; i >= 0; i--) {
      const { name, cleanup } = cleanupFunctions[i];
      try {
        log.debug({ name }, 'running tool cleanup');
        cleanup();
      } catch (error) {
        log.warn({ name, err: error }, 'tool cleanup failed');
      }
    }

    // Restore original environment variables
    process.env.PATH = originalEnv.PATH;
    process.env.INCLUDE = originalEnv.INCLUDE;
    process.env.LIB = originalEnv.LIB;
    
    log.info('environment restored');
  };
}

/**
 * Helper to append to PATH without duplicates
 */
export function prependToPath(newPath) {
  const current = process.env.PATH || '';
  const paths = current.split(path.delimiter);
  
  if (!paths.includes(newPath)) {
    process.env.PATH = newPath + path.delimiter + current;
  }
}

/**
 * Helper to append to env variable (like INCLUDE or LIB)
 */
export function appendToEnv(varName, value) {
  const current = process.env[varName] || '';
  const values = current.split(';').filter(Boolean);
  
  if (!values.includes(value)) {
    process.env[varName] = current ? `${current};${value}` : value;
  }
}
