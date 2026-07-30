# session-zip-naming.ts

## Purpose

Session-ZIP naming and scenario-identity helpers shared across layers: the
canonical `DEFAULT_SCENARIO` constant, the zip-filename timestamp parser, and
the `session.json` → scenario-name resolver.

## Why it is its own module

Scenario identity is decided in exactly one place. Four consumers need it:
[`recording-discovery`](recording-discovery.ts.md) (replay/recording folder
scan), [`ref-point-recovery`](ref-point-recovery.ts.md) (recording-mode ref-point
indexing, 2026-07-05 folder-import plan §3.1), and `ui/hud.ts` +
`recording/recording-session-handlers.ts` for `DEFAULT_SCENARIO` alone.

Historically the split was forced: the discovery module lived in `ui/`, and
dependency-cruiser's `no-storage-importing-ui` blocked `ref-point-recovery`
from reaching it. That pressure is gone since discovery moved to `storage/`
(2026-07-30) — all four consumers now import from here directly, with no
re-export hop.

## Public API

- `DEFAULT_SCENARIO: string` — canonical scenario name for recordings without
  an explicit scenario. Missing metadata, empty strings, and the literal
  `"Default Scenario"` all canonicalize to it.
- `parseDateFromSessionFilename(filename: string): Date | null` — parses the
  `..._YYYY-MM-DD_HH-MM-SSutc.zip` timestamp (both `recording-…` and
  `<Scenario>-session-…` forms); `null` for non-conforming names or impossible
  timestamps (e.g. Feb 30, hour 24). Validation compares every component of
  the `Date.UTC`-constructed date back to the parsed fields — engines
  NORMALIZE out-of-range ISO components instead of rejecting them (V8 parses
  `2026-02-30T…Z` as March 2), so an `isNaN` check alone is not enough
  (PR #163 review fix, 2026-07-06).
- `resolveScenarioNameFromMetadata(metadata: Record<string, unknown> | null): string`
  — resolves a recording's scenario with precedence `contextTag` (current
  framework field) → legacy `scenarioName` → `DEFAULT_SCENARIO`.

## Invariants & assumptions

- Pure functions, no I/O, no module state.
- `resolveScenarioNameFromMetadata` treats metadata as untrusted (any field
  may be missing or non-string) and never throws.
- The precedence rules must stay identical for replay discovery and ref-point
  indexing — that is the whole reason this module exists; never fork them.

## Examples

```ts
parseDateFromSessionFilename('recording-2026-02-19_10-15-00utc.zip');
// → Date(2026-02-19T10:15:00Z)

resolveScenarioNameFromMetadata({ contextTag: 'Paris' }); // → 'Paris'
resolveScenarioNameFromMetadata({ scenarioName: 'Old' }); // → 'Old'
resolveScenarioNameFromMetadata(null); // → 'Default Scenario'
```

## Tests

Covered via the consumers' suites: `src/storage/recording-discovery.test.ts`
and `src/storage/recording-discovery.property.test.ts` (timestamp parsing,
including its properties), `src/storage/replay-zip-discovery.test.ts`
(resolution precedence via `discoverScenariosFromZipMetadata`), and
`src/storage/ref-point-recovery.test.ts` (resolution + newest-first ordering
via `indexRefPointDefinitionsFromFolder`).
