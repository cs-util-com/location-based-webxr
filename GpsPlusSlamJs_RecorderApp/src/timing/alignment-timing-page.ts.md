# `alignment-timing-page.ts` - the page behaviour

## Purpose

Everything `alignment-timing.html` does: the file input, the repeat selector,
the run button and its in-progress state, the progress line, the table, the
totals, the device line and the copyable JSON.

## Public API

- `wireAlignmentTimingPage(deps): void` - called once, at load. Throws `Error`
  when the markup lacks an element it drives, so a renamed id fails loudly at
  load rather than as a button that silently does nothing on a device nobody can
  attach a debugger to.
- `AlignmentTimingPageDeps` - `document`, `readFile`, `loadRecording`,
  `createStore`, `environment`, `now`, `nowIso`, and the optional `arms`,
  `ladder`, `repeatOptions`, `defaultRepeats`, `warmups`, `yieldControl`,
  `copyText`.

## Invariants and assumptions

- **Nothing leaves the device.** No network call, no storage write, anywhere in
  this module or its siblings; `alignment-timing-isolation.test.ts` asserts the
  absence rather than trusting the comment.
- **The parameters and the device are printed BEFORE any run**, so a run that
  fails halfway still leaves the reader with what it was attempted under.
- **The run button has three states**: disabled until a recording is chosen;
  disabled and labelled `Running…` for the whole awaited run, with a per-pass
  progress line; restored to `Run timing` in a `finally`, on success and on
  failure alike. Failures reach the status box with the error's own message and
  the error class.
- **A recording with no GPS fixes is refused**, not measured: a table of zeros
  would be worse than a refusal.
- **The loop yields between passes** (a macrotask by default) so the page keeps
  repainting during a run that takes minutes on a phone; it never yields
  mid-pass, which would put scheduler latency into the figure.
- Every dependency is injected, so both halves of every async action are
  exercised in jsdom against fakes.

## Example

```ts
wireAlignmentTimingPage({
  document,
  readFile: async (f) => new Uint8Array(await f.arrayBuffer()),
  loadRecording: async (b) =>
    (await loadRecording(b)).actions.map((e) => e.action),
  createStore: () =>
    createRecorderStore({ storageBackend: new NullStorageBackend() }),
  environment,
  now: () => performance.now(),
  nowIso: () => new Date().toISOString(),
});
```

## Tests

- `alignment-timing-page.test.ts` (jsdom, wired against the REAL
  `alignment-timing.html` markup read from disk, so a renamed id fails here):
  parameters and device before a run, the repeat options and default, the
  disabled run button, the in-progress state and its restoration on both the
  success and the failure path, the rendered table/totals/JSON, the refusal on a
  fix-less recording, and both copy outcomes.
- `alignment-timing-isolation.test.ts` - no link from `index.html`, no import
  from outside `src/timing/`, no transmission vocabulary, and the bundler entry.
