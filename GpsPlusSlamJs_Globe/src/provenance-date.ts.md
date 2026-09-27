# provenance-date.ts - the provenance file's fetch dates

- Purpose: the text after "Fetched: " in `assets/PROVENANCE.md`, which the
  hand-run `scripts/fetch-globe-assets.mjs` rewrites on every run. A pure
  function, so its paths are unit-tested (stream F review, 2026-09-27: the
  logic went wrong twice while it lived untested inside the script).
- Public API: `provenanceFetchedOn({ previous, today, force, fetched })` →
  the dates as text:
  - `today` on a first run (no previous file, or one with no date) and
    under `--force` (every file fetched again, so older dates are void);
  - the previous dates unchanged when the run fetched nothing;
  - `"<first>; files added: <today>"` when the run added files on a later
    day than the first fetch; the first date alone when both are the same
    day.
- Invariants & assumptions: dates are `YYYY-MM-DD` and matched as such, so
  the sentence's own full stop is never captured (the "2026-09-26.." bug).
  `previous` is the old file's whole text, or "" when there is none.
- Example: `provenanceFetchedOn({ previous: "... Fetched: 2026-09-26. ...",
today: "2026-09-27", force: false, fetched: 512 })` is
  `"2026-09-26; files added: 2026-09-27"`.
- Tests: `provenance-date.test.ts` (first run, nothing fetched, files
  added on a later day and on the same day, a second addition, `--force`,
  a previous file without a date).
