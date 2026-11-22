# model-import.worker.ts

**Purpose:** the model converter's module Worker: runs `convertImport` (`import-step.ts`) for kind `model` over the optimizer's protocol and loop (`serveSteps` in `optimizer-protocol.ts`).

## Invariants

- A Worker of its own, not the optimizer's: a model that runs it out of memory takes only its conversion down, and the runner lets it go after every conversion (`host.close()`).
- Spawned by `createModelImportHost` (`model-import-runner.ts`) on the first conversion only.

## Tests

The device seam: not unit-tested (it needs a real Worker). The step (`import-step.test.ts`) and the loop (`optimizer-protocol.test.ts`) are; the e2e `editor-model-import.spec.js` runs this file.
