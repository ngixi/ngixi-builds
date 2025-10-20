# Build System Quick Reference

## Configuration Format

```json
{
  "version": "0.0.1",
  "deps": {
    "dependency-key": {
      "name": "display-name",
      "defaultVersion": "v1.0.0",    // Tag to checkout (or null)
      "gitUrl": "https://...",        // Git repository URL
      "branch": null,                 // Branch to checkout (when defaultVersion is null)
      "deps": ["other-dep"]           // Build dependencies (empty array if none)
    }
  }
}
```

## Key Rules

1. **Either version OR branch required**: 
   - If `defaultVersion` is set → checks out that tag
   - If `defaultVersion` is null → `branch` must be set

2. **Dependencies**: Use `deps` array to specify build order
   ```json
   "ffmpeg": {
     "deps": ["ngixi.zigwin32gen"]  // ffmpeg needs zigwin32gen built first
   }
   ```

3. **Circular dependencies**: System will detect and fail with error

## Build Worker Interface

Every build worker must export a function with this signature:

```javascript
export async function buildDependencyName(options) {
  const { repoRoot, artifactsRoot, force = false } = options;
  
  // repoRoot: Path to cloned repository (already checked out)
  // artifactsRoot: Where to install build artifacts
  // force: Whether to rebuild even if artifacts exist
  
  // Your build logic here
  
  return {
    ok: true,           // or false if build failed
    name: 'dep-name',   // dependency name
    skipped: false      // optional: true if skipped due to existing artifacts
  };
}
```

## Orchestrator Registration

In `build-orchestrator.js`, register your build worker:

```javascript
const BUILD_WORKER_MAP = {
  'your-dep-key': './build-workers/buildYourDep.js',
};

const ARTIFACTS_DIR_MAP = {
  'your-dep-key': 'subdirectory-name',
};

const REPO_OPTIONS_MAP = {
  'your-dep-key': {
    shallow: true,           // Use --depth 1 for clone
    initSubmodules: false,   // Initialize git submodules
  },
};
```

## Common Patterns

### Standard Dependency (Tag-based)
```json
"wasmtime": {
  "name": "wasmtime",
  "defaultVersion": "v37.0.2",
  "gitUrl": "https://github.com/bytecodealliance/wasmtime.git",
  "branch": null,
  "deps": []
}
```

### Branch-based Dependency
```json
"my-dep": {
  "name": "my-dep",
  "defaultVersion": null,
  "gitUrl": "https://github.com/org/repo.git",
  "branch": "development",
  "deps": []
}
```

### Dependency with Dependencies
```json
"ffmpeg": {
  "name": "ffmpeg",
  "defaultVersion": "n7.1.2",
  "gitUrl": "https://git.ffmpeg.org/ffmpeg.git",
  "branch": null,
  "deps": ["ngixi.zigwin32gen"]  // Needs zigwin32gen first
}
```

## Build Flow

1. **Validation** (`config-validator.js`)
   - Checks configuration structure
   - Validates version/branch requirements
   - Verifies dependency references

2. **Dependency Resolution** (`dependency-resolver.js`)
   - Builds dependency graph
   - Performs topological sort
   - Detects circular dependencies

3. **Repository Preparation** (`repo-manager.js`)
   - Clones repositories (or reuses existing)
   - Checks out version/branch
   - Initializes submodules if needed

4. **Build Execution** (`build-orchestrator.js`)
   - Dynamically imports build workers
   - Runs builds in dependency order
   - Collects and reports results

## Error Messages

### Missing Version/Branch
```
deps["my-dep"] must have either defaultVersion or branch specified.
If defaultVersion is null, branch is required.
```

### Invalid Dependency Reference
```
deps["ffmpeg"].deps references unknown dependency "invalid-dep".
Available dependencies: wasmtime, ngixi.zigwin32gen, google/dawn, ffmpeg
```

### Circular Dependency
```
Circular dependencies detected! Build cannot proceed.
Cycles found:
  dep-a -> dep-b -> dep-a

Please remove these circular dependencies from your buildConfig.json
```

## Directory Structure

```
build/
├── build.js                          # Main entry point
├── buildConfig.json                  # Build configuration
├── scripts/
│   ├── build-workers/                # Individual build workers
│   │   ├── buildWasmtime.js
│   │   ├── buildDawn.js
│   │   ├── buildFFmpeg.js
│   │   └── buildNgixi_zigwin32gen.js
│   └── utils/
│       ├── build-orchestrator.js     # Orchestrates entire build
│       ├── config-validator.js       # Validates configuration
│       ├── dependency-resolver.js    # Resolves build order
│       └── repo-manager.js           # Manages Git operations
├── .git.temp/                        # Cloned repositories
│   ├── wasmtime/
│   ├── google-dawn/
│   └── ...
└── artifacts/                        # Build output
    ├── wasmtime/
    │   ├── include/
    │   └── lib/
    ├── dawn/
    └── ...
```
