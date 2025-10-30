# ngixi-builds

> **🔥 HOT IN FLIGHT 🔥**  
> *Build server for precompiled dependencies. Very much under construction.*

## What This Is

GitHub Actions workflows that build precompiled binaries for NGIXI dependencies so you only need Zig installed locally.

**Goal**: Build everything (Dawn, Wasmtime, SDL3, FFmpeg, FreeType) for all platforms (Linux/macOS/Windows)

## Current Status

**What's Actually Working**:
- ✅ Dawn WebGPU Windows builds (`build-dawn-windows.yml`)
- ✅ Win32 bindings generation (`build-zig-win32.yml`)

**What's Planned/TBD**:
- 📋 Dawn Linux builds
- 📋 Dawn macOS builds (need Mac build infrastructure!)
- 📋 Wasmtime builds (all platforms)
- 📋 SDL3 builds (all platforms)
- 📋 FreeType builds
- 📋 FFmpeg builds

## How It Works

1. GitHub Actions workflows build dependencies from source
2. Artifacts are packaged as tarballs
3. Released to GitHub Releases
4. Other NGIXI projects fetch these prebuilt binaries at build time

## Organization Variables

Build versions are managed via GitHub organization variables. See `.github/workflows/VARIABLES.md` for current versions.

## Status

🚧 **Early stage, partial builds only**  

Expect rapid changes as we expand platform coverage and add more dependencies.

Part of the [NGIXI](https://github.com/ngixi) experimental multimedia framework ecosystem.
