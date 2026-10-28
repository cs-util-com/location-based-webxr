# labs/globe/globe-perf-journal.js - the sweep's export kept across a reload

- Purpose: a fixed-view sweep runs for many minutes on a phone, and iOS
  reloads a tab it killed for memory; a tester may also reload after
  Done. Without a record an auto-starting link would start over and
  every run measured so far, or the finished result, would be lost. The
  recorder (`globe-perf.js`) keeps its export in the browser's storage
  after every run and at the end, with the link it was measured with,
  and on load offers whatever is kept (Copy, Download, or start fresh).
  Only the same link's sweep keeps `perfAuto=1` from starting; one from
  other settings is offered and replaced by the new sweep.
- Public API:
  - `SWEEP_JOURNAL_KEY`: `"globe-perf-sweep"`, one sweep per origin.
  - `createSweepJournal({ storage, key = SWEEP_JOURNAL_KEY })` ->
    `{ save, load, previous, clear, report }`:
    - `storage` a getter returning a Storage (`localStorage`); it may
      throw (a private window, blocked site data) or return undefined;
    - `save({ text, runs, total, state, link })` keeps the export text,
      the runs finished, the runs planned, the state (`"running"`,
      `"stopped"`, `"failed"` or `"done"`) and the link (the page's
      `location.hash`, every setting of the sweep), stamped `savedAt`;
      returns whether it was kept (a full quota or no storage: false);
    - `load()` -> the entry, or null when there is none, it cannot be
      read, or its shape is wrong;
    - `previous(link)` -> the entry whatever its state, with `sameLink`
      (it was measured with `link`; an entry without a link matches
      none), or null;
    - `clear()` removes it;
    - `report()` -> `{ saves, failedSaves, lastError }`, carried in the
      export so a sweep whose journal never saved says so.
  - `previousSweepText(entry)` -> the overlay's line for a kept sweep:
    "Previous sweep cut off after 7 of 80 runs (page reloaded)",
    "finished: 7 of 80 runs", "stopped after ..." or "failed after ...",
    each ending "Copy or Download it, or start fresh."; one from other
    settings reads "An earlier sweep with other settings is kept
    (finished, 7 of 80 runs). Copy or Download it; a new sweep replaces
    it."
- Invariants & assumptions:
  - Never throws: the journal is a convenience, and a sweep runs on
    without it.
  - The storage is per viewer and per origin; nothing leaves the device.
- Examples: `const journal = createSweepJournal({ storage: () =>
localStorage }); journal.save({ text, runs: 3, total: 16, state:
"running", link: location.hash });
journal.previous(location.hash)?.text;`
- Tests: `globe-perf-journal.test.mjs` (save and load, any kept sweep
  offered with whether it is this link's, a throwing or missing storage,
  a malformed entry, the overlay's line per ending);
  `globe-perf-loss.smoke.spec.mjs` (a reload mid-sweep offers the cut-off
  sweep and does not start by itself).
