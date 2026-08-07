# ref-point-recovery.ts

## Purpose

Indexes full `RefPointDefinition` objects from the recording ZIPs in a folder,
**grouped per scenario** (resolved from each ZIP's `session.json`) with
observations merged/deduplicated per ref-point id. This single pass powers
both folder-import flows of the 2026-07-05 plan (see
`GpsPlusSlamJs_Docs/docs/2026-07-05-0611-recorder-folder-import-indexing-progress-plan.md`):
the **eager** full-folder pass at folder-pick time (D1) and the **lazy**
scenario-change recovery safety net — both persisted by folder-manager's
strict per-scenario gap-fill (D4a/D4b).

Unlike `ref-point-importer.ts` (dormant; returns simplified `ImportedRefPoint`
with only lat/lon), this module preserves complete observation data (AR poses,
GPS, timestamps) needed for 3D display and OPFS restoration.

## Public API

### `indexRefPointDefinitionsFromFolder(folderHandle, options?): Promise<RefPointIndexResult>`

Scans all `.zip` files in the folder **newest-first** (filename timestamp
`..._YYYY-MM-DD_HH-MM-SSutc.zip`; non-conforming names fall back to
`File.lastModified`, read lazily only for those), resolves each ZIP's scenario
(`contextTag` → legacy `scenarioName` → `DEFAULT_SCENARIO`; shared resolver in
`session-zip-naming.ts`), extracts `refPoints/*.json` entries, and merges each
scenario bucket via the shared `mergeSiblingRefPoints` (D6(a),
`ref-point-merge.ts`) **within each scenario bucket only** (D4a — the same id
under two scenarios stays in both buckets): same-anchor definitions collapse
(same id, or neighbor cells with averaged positions within the merge
distance), legacy ids re-mint to their averaged-position cell, observations
dedupe by content key, and name conflicts resolve most-observations-wins.

**Options:**

- `onProgress?: ({done, total}) => void` — fired with `{done: 0, total}`
  before the first ZIP, then once per ZIP (including failed ones, so a
  progress bar never stalls on a corrupt archive).
- `signal?: AbortSignal` — checked before each ZIP; aborting throws a
  `DOMException` `AbortError`.

**Output:**

```typescript
interface RefPointIndexResult {
  // Buckets in first-encounter order = newest recording first (D4b-ii);
  // the folder-manager gap-fill acceptance relies on this order.
  definitionsByScenario: Map<string, RefPointDefinition[]>;
  zipFilesScanned: number; // successfully read ZIPs
  errors: string[]; // non-fatal per-ZIP / per-entry errors
}
```

**Error handling:**

- Corrupt ZIPs: logged, skipped, error recorded, progress still advances.
- Malformed `refPoints/*.json`: logged, skipped, error recorded.
- Unreadable/missing `session.json`: the ZIP's points go to the canonical
  `DEFAULT_SCENARIO` bucket (consistent with `discoverScenariosFromZipMetadata`).
- Abort: throws `AbortError`; the function is pure w.r.t. storage —
  persistence is the caller's job, so an abort never leaves a half-written
  store behind.

## Invariants & Assumptions

- Bucket merging is delegated to `mergeSiblingRefPoints` (`ref-point-merge.ts`,
  D6(a)): same-anchor clusters collapse (exact id, or matching effective
  cells with averaged positions within the merge distance), legacy ids
  re-mint to the H3 cell of their averaged position, so a clean import
  persists exactly what an existing store displays after its load-time merge.
- Observations are deduplicated by a content key
  (`sessionId|timestamp|lat|lon`).
- Merged metadata: the name backed by the MOST observations wins (ties → the
  name with the newest backing observation); earliest `createdAt` wins.
- Scenario resolution and filename-timestamp parsing live in
  `session-zip-naming.ts` so [`recording-discovery`](recording-discovery.ts.md) and this pass can never
  drift apart.

## Examples

```typescript
import { indexRefPointDefinitionsFromFolder } from './ref-point-recovery';

const abort = new AbortController();
const result = await indexRefPointDefinitionsFromFolder(readFolder, {
  onProgress: ({ done, total }) => updateBar(done, total),
  signal: abort.signal,
});
for (const [scenarioName, defs] of result.definitionsByScenario) {
  // persist defs into scenarioName's own store (see folder-manager's
  // gapFillScenarioStore for the D4b acceptance rule)
}
```

## Tests

- `ref-point-recovery.test.ts` — scenario grouping (contextTag / legacy /
  missing metadata), Default-Scenario canonicalization, progress events
  (initial 0/total, corrupt-ZIP advance), abort (pre-start and mid-pass),
  newest-first ordering + name tie-break, most-observations name policy,
  legacy-into-H3 sibling merge, cross-scenario isolation.
- `ref-point-recovery.property.test.ts` — partition completeness at the
  observation level (every input observation lands in exactly its scenario
  bucket, nothing lost or leaked — ids may change through the merge) and
  determinism/idempotence over arbitrary generated ZIP sets.
- The merge algorithm itself is covered in `ref-point-merge.test.ts`.
