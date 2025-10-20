# Build System Refactoring Summary

## Overview

The build system has been completely refactored to be more modular, maintainable, and automated. The key improvements include:

1. **Dynamic build orchestration** - Dependencies are built in the correct order based on their `deps` array
2. **Centralized Git operations** - All repository cloning and checkout logic is now in one place
3. **Circular dependency detection** - The system will panic if circular dependencies are detected
4. **Branch support** - Can now checkout branches when `defaultVersion` is null
5. **Modular build workers** - Each build worker is now a standalone module that can be dynamically imported

## Architecture

### Core Components

#### 1. `build-orchestrator.js`
The main orchestrator that coordinates the entire build process:
- Validates the build configuration
- Resolves dependency order using topological sort
- Prepares repositories (clone + checkout)
- Dynamically imports and runs build workers in the correct order

#### 2. `config-validator.js`
Validates the build configuration structure:
- Ensures each dependency has either `defaultVersion` or `branch` specified
- Validates that `deps` arrays only reference valid dependencies
- Checks for required fields (`name`, `gitUrl`)

#### 3. `dependency-resolver.js`
Resolves build order and detects circular dependencies:
- Uses Kahn's algorithm for topological sort
- Detects circular dependencies using DFS
- Throws detailed error messages when cycles are found

#### 4. `repo-manager.js`
Centralized Git repository management:
- Handles cloning repositories
- Checks out tags when `defaultVersion` is specified
- Checks out branches when `branch` is specified (and `defaultVersion` is null)
- Initializes submodules when needed
- Supports force re-clone

### Build Workers

Each build worker has been refactored to:
- Accept a `repoRoot` parameter (the already-cloned repository path)
- Accept an `artifactsRoot` parameter (where to install build artifacts)
- Accept a `force` parameter (whether to rebuild even if artifacts exist)
- Return a standardized result object: `{ ok, name, skipped? }`

Build workers are now **pure build functions** - they no longer handle Git operations.

## Build Configuration (`buildConfig.json`)

### Structure

```json
{
  "version": "0.0.1",
  "deps": {
    "dependency-name": {
      "name": "dependency-name",
      "defaultVersion": "v1.0.0",  // or null to use branch
      "gitUrl": "https://github.com/...",
      "branch": null,              // or "main" if defaultVersion is null
      "deps": ["other-dep"]        // dependencies this one needs
    }
  }
}
```

### Rules

1. **Version/Branch Requirement**: Each dependency MUST have either:
   - `defaultVersion` set to a tag/version string, OR
   - `branch` set to a branch name (when `defaultVersion` is null)

2. **Dependencies Array**: The `deps` array lists other dependencies that must be built first
   - Example: `"ffmpeg"` depends on `"ngixi.zigwin32gen"`, so ffmpeg's `deps: ["ngixi.zigwin32gen"]`

3. **Circular Dependencies**: The system will detect and panic on circular dependencies
   - Example: If A depends on B, and B depends on A, the build will fail with a clear error

## Usage

### Running the Build

```bash
# Standard build
node build.js

# Force rebuild (removes and reclones all repos)
node build.js --force

# Just check tooling
node build.js --toolcheck
```

### Adding a New Dependency

1. **Add to `buildConfig.json`**:
   ```json
   "my-new-dep": {
     "name": "my-new-dep",
     "defaultVersion": "v1.0.0",
     "gitUrl": "https://github.com/org/repo.git",
     "branch": null,
     "deps": ["dependency-it-needs"]
   }
   ```

2. **Create a build worker** in `build/scripts/build-workers/buildMyNewDep.js`:
   ```javascript
   export async function buildMyNewDep(options) {
     const { repoRoot, artifactsRoot, force = false } = options;
     
     // Your build logic here
     
     return { ok: true, name: 'my-new-dep' };
   }
   ```

3. **Register in orchestrator** (`build-orchestrator.js`):
   ```javascript
   const BUILD_WORKER_MAP = {
     // ... existing entries
     'my-new-dep': './build-workers/buildMyNewDep.js',
   };
   
   const ARTIFACTS_DIR_MAP = {
     // ... existing entries
     'my-new-dep': 'my-new-dep',
   };
   
   const REPO_OPTIONS_MAP = {
     // ... existing entries
     'my-new-dep': {
       shallow: true,
       initSubmodules: false,
     },
   };
   ```

4. **Build** - The orchestrator will automatically:
   - Validate the configuration
   - Resolve build order
   - Clone the repository
   - Checkout the version/branch
   - Run your build worker at the right time

## Benefits

### Before Refactoring
- Manual build order in `build.js`
- Duplicated Git operations in every build worker
- No dependency resolution
- No circular dependency detection
- Branch support was ad-hoc
- Hard to add new dependencies

### After Refactoring
- ✅ Automatic build order resolution
- ✅ Centralized Git operations
- ✅ Circular dependency detection with clear errors
- ✅ Consistent branch/tag checkout logic
- ✅ Easy to add new dependencies (just config + worker)
- ✅ Build workers are pure functions
- ✅ Dynamic imports for modularity
- ✅ Comprehensive validation

## File Changes Summary

### New Files
- `build/scripts/utils/config-validator.js` - Configuration validation
- `build/scripts/utils/dependency-resolver.js` - Dependency graph resolution
- `build/scripts/utils/repo-manager.js` - Centralized Git operations
- `build/scripts/utils/build-orchestrator.js` - Build orchestration

### Modified Files
- `build/build.js` - Simplified to use orchestrator
- `build/buildConfig.json` - Added `branch` and `deps` fields
- `build/scripts/utils/index.js` - Export new utilities
- `build/scripts/build-workers/buildWasmtime.js` - Refactored to accept `repoRoot`
- `build/scripts/build-workers/buildDawn.js` - Refactored to accept `repoRoot`
- `build/scripts/build-workers/buildFFmpeg.js` - Refactored to accept `repoRoot`
- `build/scripts/build-workers/buildNgixi_zigwin32gen.js` - Refactored to accept `repoRoot`

## Migration Notes

### Branch Checkout Example

To use a branch instead of a tag:

```json
{
  "my-dep": {
    "name": "my-dep",
    "defaultVersion": null,
    "gitUrl": "https://github.com/...",
    "branch": "development",
    "deps": []
  }
}
```

The repo-manager will:
1. Clone the repository
2. Fetch the branch from origin
3. Checkout the branch (not a tag)

### Circular Dependency Error Example

If you create a circular dependency:

```json
{
  "dep-a": { "deps": ["dep-b"] },
  "dep-b": { "deps": ["dep-a"] }
}
```

You'll get:

```
Error: Circular dependencies detected! Build cannot proceed.
Cycles found:
  dep-a -> dep-b -> dep-a

Please remove these circular dependencies from your buildConfig.json
```

## Testing

Test the refactored build system:

```bash
# Validate configuration and tooling
node build.js --toolcheck

# Force a clean build to test everything
node build.js --force

# Normal incremental build
node build.js
```

## Future Enhancements

Potential improvements:
- Parallel builds for independent dependencies
- Cache build artifacts to avoid rebuilds
- Support for conditional dependencies (platform-specific)
- Build worker plugins/hooks system
- Better error recovery and partial builds
