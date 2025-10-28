# Organization Variables

These variables are defined at the organization level (ngixi) and are accessible to all repositories in the organization.

## Build Version Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `DAWN_REPO` | `https://github.com/google/dawn` | Repository URL for Google Dawn WebGPU implementation |
| `DAWN_TAG` | `v20251026.130842` | Tag/version to checkout for Dawn builds |
| `FREETYPE_REPO` | `https://github.com/freetype/freetype` | Repository URL for FreeType font rendering library |
| `FREETYPE_TAG` | `VER-2-14-1` | Tag/version to checkout for FreeType builds |
| `NGIXI_ASSET_VERSION` | `0.0.1` | Version number for NGIXI asset releases |
| `WASMTIME_REPO` | `https://github.com/bytecodealliance/wasmtime` | Repository URL for Wasmtime WebAssembly runtime |
| `WASMTIME_TAG` | `v38.0.3` | Tag/version to checkout for Wasmtime builds |
| `SDL_REPO` | `https://github.com/libsdl-org/SDL` | Repository URL for Simple DirectMedia Layer |
| `SDL_TAG` | `release-3.2.4` | Tag/version to checkout for SDL builds |

## Usage in Workflows

Access these variables in GitHub Actions workflows using the `vars` context:

```yaml
- name: Example step
  run: |
    echo "Dawn repo: ${{ vars.DAWN_REPO }}"
    echo "Dawn tag: ${{ vars.DAWN_TAG }}"
```

## Notes

- These variables are set at the organization level and apply to all repositories
- Repository-level variables take precedence over organization-level ones
- Environment-level variables take precedence over both
- All variables are currently set as public (not secrets)