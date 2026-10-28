# labs/globe/globe-perf-journal.js - the sweep's export kept across a reload

- Purpose: a fixed-view sweep runs for many minutes on a phone, and iOS
  reloads a tab it killed for memory. Without a record an auto-starting
  link would start over and every run measured so far would be lost. The
  recorder (`globe-perf.js`) keeps its export in the browser's storage
  after every run and at the end, and on load offers an unfinished one
  (Copy, Download, or start fresh) instead of starting by itself.
- Public API:
  - `SWEEP_JOURNAL_KEY`: `"globe-perf-sweep"`, one sweep per origin.
  - `createSweepJournal({ storage, key = SWEEP_JOURNAL_KEY })` ->
    `{ save, load, unfinished, clear, report }`:
    - `storage` a getter returning a Storage (`localStorage`); it may
      throw (a private window, blocked site data) or return undefined;
    - `save({ text, runs, total, state })` keeps the export text, the
      runs finished, the runs planned and the state (`"running"`,
      `"stopped"`, `"failed"` or `"done"`), stamped `savedAt`; returns
      whether it was kept (a full quota or no storage: false);
    - `load()` -> the entry, or null when there is none, it cannot be
      read, or its shape is wrong;
    - `unfinished()` -> the entry unless its state is `"done"`, else null;
    - `clear()` removes it;
    - `report()` -> `{ saves, failedSaves, lastError }`, carried in the
      export so a sweep whose journal never saved says so.
- Invariants & assumptions:
  - Never throws: the journal is a convenience, and a sweep runs on
    without it.
  - The storage is per viewer and per origin; nothing leaves the device.
- Examples: `const journal = createSweepJournal({ storage: () =>
localStorage }); journal.save({ text, runs: 3, total: 16, state:
"running" }); journal.unfinished()?.text;`
- Tests: `globe-perf-journal.test.mjs` (save and load, unfinished but
  not done, a throwing or missing storage, a malformed entry);
  `globe-perf-loss.smoke.spec.mjs` (a reload mid-sweep offers the cut-off
  sweep and does not start by itself).
