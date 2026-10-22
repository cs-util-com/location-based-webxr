# vitest.config.ts

## Purpose

Vitest configuration for unit testing with V8 coverage.

## Settings

| Setting             | Value              | Description              |
| ------------------- | ------------------ | ------------------------ |
| `globals`           | `true`             | Enable global test APIs  |
| `environment`       | `node`             | Node.js test environment |
| `include`           | `src/**/*.test.ts` | Test file pattern        |
| `coverage.provider` | `v8`               | V8 coverage engine       |
| `coverage.reporter` | `text, json, html` | Coverage output formats  |

## Setup files

- `src/test-setup.ts` - the jsdom `Blob.stream()` polyfill.
- `../../scripts/test-timing/fast-check-time-limit.mjs` - the workspace's shared fast-check time limit, so a failing property cannot shrink for hours (see its sidecar); `src/fast-check-time-limit.test.ts` reads it in this package's run.

## Path Alias

- `@app/*` → `src/*`

## Coverage Exclusions

- Test files (`*.test.ts`, `*.spec.ts`)
- Entry point (`main.ts`) - integration layer
- Benchmarks (`*.bench.ts`) - measurement instruments run via `pnpm bench` ([vitest.bench.config.ts.md](vitest.bench.config.ts.md)), not code under test; excluding them keeps the hard coverage thresholds unaffected

## Usage

```bash
npm run test:unit      # Run with coverage
npm run test:watch     # Watch mode
```
