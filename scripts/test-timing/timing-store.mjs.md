> **Mirror of the GpsPlusSlamJs pilot** — see `README.md` in this directory; fix pure-module bugs upstream first.

# timing-store.mjs — md-embedded timing data store

- Purpose: parse/serialize `docs/test-timings.md`. The fenced JSON block at the bottom of that file is the single source of truth; the human-readable tables are re-rendered from it on every write, so data and rendered view cannot drift.
- Public API:
  - `HISTORY_LIMIT` (= 10) — bounded trailing history per stage.
  - `createEmptyStore(project)` → fresh version-1 `Store`.
  - `parseStore(mdText | null, project)` → `{ store, recovered, warning }`. `null` input (file absent) is a clean fresh start; a missing/corrupt/schema-mismatched JSON block **recovers** to an empty store with a warning — recording must never break the gate.
  - `appendRecording(store, stageName, recording, { machineLabel, branch })` → new store (input not mutated): prepends newest-first, bounds at `HISTORY_LIMIT`, updates `meta.lastWrite`. Malformed recordings throw `TypeError`.
  - `renderMd(store, stageOrder)` → the full md text (Latest table → History bullets → JSON block). Pure and byte-stable. The JSON block is plain JSON with **one line per history entry** (and one for `meta`) so a recorded run diffs as ~one added line per stage — whitespace-only difference vs `JSON.stringify`, parsing is unaffected.
  - `formatSeconds(ms)` → `"41.2 s"`.
  - `medianSameMachineMs(history)` → median duration (ms) over the entries recorded on the same machine as the newest one (including it); throws `TypeError` on an empty history. Feeds the Latest table's `Median` column — pure display context against noise (ghost flags, sub-threshold drift); flag semantics still compare only against the single previous same-machine run.
- Invariants & assumptions:
  - Round-trip identity: `parseStore(renderMd(store)).store` deep-equals `store` for any reachable store.
  - Rows render in `stageOrder`; data-only stages render defensively after them; the `total` row renders last. Columns: Stage, Duration, Δ duration, Median (same-machine), Tests, Δ tests, Flag. Unflagged changes show `≈`; flagged ones the full `+3.4 s (+40 %)` plus 🔺/🔻; machine changes show `baseline reset`.
  - The History bullet list uses the same ordering as the Latest table (gate order → data-only extras → `total` last), never an alphabetical sort — see [2026-07-02-0332-test-timings-md-rendering-improvements.md](../../docs/2026-07-02-0332-test-timings-md-rendering-improvements.md).
  - History values recorded on a different machine than their series' newest entry carry a `*` suffix (plus a legend line, rendered only when at least one marker exists) — raw seconds across machines are not comparable.
  - The "Last recorded" header line describes the most recent write only — per-recording provenance (`ts`/`machine`/`git`) lives in the JSON entries.
  - `docs/test-timings.md` is in `.prettierignore`: this module's writer must remain the only writer, or byte-stability breaks.
- Example:
  ```js
  const { store } = parseStore(readFileSync(p, 'utf8'), 'GpsPlusSlamJs');
  const next = appendRecording(store, 'test:unit', recording, writeMeta);
  writeFileSync(tmp, renderMd(next, STAGE_ORDER));
  ```
- Tests: [timing-store.test.mjs](timing-store.test.mjs) (recovery, bounding, rendering examples), [timing-store.property.test.mjs](timing-store.property.test.mjs) (serialize∘parse identity, bounded histories, row counts — for arbitrary append sequences).
