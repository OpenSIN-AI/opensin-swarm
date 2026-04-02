# Changelog

All notable changes to the opencode-omoc-swarm plugin are documented in this file.

## [Unreleased]

### Added

- **Live OpenCode E2E Tests** (`scripts/oc-swarm-e2e.test.sh`)
  - Real OpenCode runtime validation (server startup, API endpoints, session management)
  - tmux integration tests
  - Dependency verification (curl, jq, lsof, tmux, opencode)
  - Fail-closed design: skips gracefully when opencode unavailable
  - CI integration via separate `live-e2e` job with explicit opencode installation

- **Versioned Registry Migration System**
  - Schema versioning for registry entries (v1 → v2)
  - Automatic migration of v1 registries to v2 on load
  - Migration tracking with `migratedFrom` field
  - Version detection functions (`detectEntryVersion`, `detectRegistryVersion`)
  - Migration functions (`migrateEntryToV2`, `migrateRegistryToV2`)

- **Enhanced Path Conflict Detection**
  - Intelligent path overlap detection (ancestor/descendant relationships)
  - Cross-platform path support (Windows/Unix)
  - Normalization of trailing slashes and path separators
  - Improved reservation conflict handling in `reserveSwarmPaths`

- **Expanded Benchmark Corpus** (`benchmarks/routing-selector-benchmark.json`)
  - **59 total test cases** (from 28, +111% coverage)
  - **Routing benchmarks** (49 cases):
    - Legacy aliases (6 cases)
    - Canonical IDs (8 cases)
    - Unknown agents (11 cases)
    - Operator mistakes (8 cases) - whitespace, casing, formatting errors
    - Near-miss IDs (13 cases) - common typos and misspellings
    - Edge cases (3 cases)
  - **Selector benchmarks** (10 cases):
    - Minimal safe patch scenarios
    - Correctness over size tradeoffs
    - Test failure penalties
    - File count optimization
    - Real swarm scenarios (bug fixes, features, performance, tests)
  - Deterministic execution (<1 second)
  - JSON-based data-driven structure

### Changed

- **Eval Runner Rewrite** (`scripts/eval-routing.ts`)
  - Data-driven benchmark execution from JSON corpus
  - Category-based test organization
  - Enhanced failure reporting with detailed diagnostics
  - Maintains deterministic CI behavior

- **Type Strengthening**
  - Explicit v1/v2 type variants for registry entries
  - Stricter validation for versioned schemas
  - Removed implicit any usage in plugin types

### Improved

- **Test Coverage**
  - Migration tests (`plugins/migration.test.ts`) - 19 tests
  - Path overlap detection tests
  - Version detection tests
  - Registry validation tests for both v1 and v2

- **Documentation**
  - Live E2E runtime requirements in README
  - Benchmark corpus structure and coverage details
  - Migration version support documentation

### Technical Details

**Files Added**:
- `scripts/oc-swarm-e2e.test.sh` (live E2E test suite)
- `benchmarks/routing-selector-benchmark.json` (benchmark corpus)
- `plugins/migration.test.ts` (migration regression tests)

**Files Modified**:
- `plugins/registry.ts` - versioned types, migration functions, enhanced validation
- `plugins/state.ts` - path overlap detection, improved conflict handling
- `scripts/eval-routing.ts` - data-driven benchmark runner
- `package.json` - added migration tests to test script
- `.github/workflows/ci.yml` - fixed YAML structure, added live-e2e job
- `README.md` - documented live E2E tests and runtime requirements

**Backward Compatibility**:
- All existing tests continue to pass
- V1 registries automatically migrate to V2
- Legacy agent aliases remain supported
- No breaking changes to public API

---

## Version Support

- **Registry Schema**: v1 → v2 (automatic migration)
- **Agent Aliases**: planner→plan, researcher→explore, coder→build, reviewer→general
- **Supported Agents**: plan, build, explore, general, oracle, metis, momus, librarian

---

*Format based on [Keep a Changelog](https://keepachangelog.com/).*
