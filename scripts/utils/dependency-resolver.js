import { scopedLogger } from '../logging.js';

const log = scopedLogger('dependency-resolver');

/**
 * Resolves the build order for dependencies using topological sort.
 * Detects circular dependencies and throws an error if found.
 * 
 * @param {Object} config - Build configuration object
 * @returns {string[]} Array of dependency keys in build order (dependencies before dependents)
 * @throws {Error} If circular dependencies are detected
 */
export function resolveBuildOrder(config) {
  if (!config || !config.deps) {
    return [];
  }

  const deps = config.deps;
  const depNames = Object.keys(deps);
  
  // Build adjacency list (dep -> what depends on it)
  const graph = {};
  const inDegree = {};
  
  // Initialize
  for (const depName of depNames) {
    graph[depName] = [];
    inDegree[depName] = 0;
  }
  
  // Build the graph: if A depends on B, then B -> A (B points to A)
  // This way we can process B before A
  for (const depName of depNames) {
    const dependencies = deps[depName].deps || [];
    inDegree[depName] = dependencies.length; // How many things this depends on
    
    for (const dependency of dependencies) {
      if (!graph[dependency]) {
        graph[dependency] = [];
      }
      graph[dependency].push(depName); // dependency points to things that need it
    }
  }
  
  // Kahn's algorithm for topological sort
  const queue = [];
  const result = [];
  
  // Start with nodes that have no dependencies (in-degree 0)
  for (const depName of depNames) {
    if (inDegree[depName] === 0) {
      queue.push(depName);
    }
  }
  
  // Track visited nodes for cycle detection
  const visited = new Set();
  
  while (queue.length > 0) {
    const current = queue.shift();
    result.push(current);
    visited.add(current);
    
    // For each thing that depends on current, reduce its in-degree
    for (const dependent of graph[current]) {
      inDegree[dependent]--;
      if (inDegree[dependent] === 0) {
        queue.push(dependent);
      }
    }
  }
  
  // If we haven't visited all nodes, there's a cycle
  if (result.length !== depNames.length) {
    const unvisited = depNames.filter(name => !visited.has(name));
    const cycles = detectCycles(config, unvisited);
    
    log.error({ cycles, unvisited }, 'circular dependencies detected');
    
    const cycleDescription = cycles
      .map(cycle => cycle.join(' -> '))
      .join('\n  ');
    
    throw new Error(
      `Circular dependencies detected! Build cannot proceed.\n` +
      `Cycles found:\n  ${cycleDescription}\n\n` +
      `Please remove these circular dependencies from your buildConfig.json`
    );
  }
  
  log.info({ order: result }, 'build order resolved');
  
  return result;
}

/**
 * Detect cycles in the dependency graph using DFS.
 * 
 * @param {Object} config - Build configuration with deps
 * @param {string[]} unvisited - Nodes that haven't been processed by topological sort
 * @returns {string[][]} Array of cycles (each cycle is an array of node names)
 */
function detectCycles(config, unvisited) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  
  function dfs(node, path = []) {
    if (visiting.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node);
      const cycle = [...path.slice(cycleStart), node];
      cycles.push(cycle);
      return;
    }
    
    if (visited.has(node)) {
      return;
    }
    
    visiting.add(node);
    path.push(node);
    
    const dependencies = config.deps[node]?.deps || [];
    for (const dep of dependencies) {
      dfs(dep, [...path]);
    }
    
    visiting.delete(node);
    visited.add(node);
  }
  
  for (const node of unvisited) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }
  
  return cycles;
}

/**
 * Get the dependencies for a specific build target.
 * 
 * @param {Object} config - Build configuration object
 * @param {string} depName - Dependency name to get dependencies for
 * @returns {string[]} Array of dependency names that this target depends on
 */
export function getDependencies(config, depName) {
  if (!config || !config.deps || !config.deps[depName]) {
    return [];
  }
  
  return config.deps[depName].deps || [];
}

/**
 * Check if a dependency has any dependencies of its own.
 * 
 * @param {Object} config - Build configuration object
 * @param {string} depName - Dependency name to check
 * @returns {boolean} True if the dependency has dependencies
 */
export function hasDependencies(config, depName) {
  const deps = getDependencies(config, depName);
  return deps.length > 0;
}
