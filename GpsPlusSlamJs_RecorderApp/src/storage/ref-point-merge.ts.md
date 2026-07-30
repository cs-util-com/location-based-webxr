# ref-point-merge.ts

## Purpose

Collapses "visually duplicate, identity-distinct" ref-point definitions —
the same physical spot stored under two ids — into one definition per
cluster (D6(a), 2026-07-06). Two mechanisms produce such duplicates:
durable **neighbor-cell H3 twins** (the import gap-fill only guards NEW
writes; it never merges two definitions that both already exist) and
**legacy user-typed ids** (no spatial identity, so the exact-id fallback can
never match them to an H3 re-mark of the same spot).

## Public API

- `mergeSiblingRefPoints(defs: RefPointDefinition[]): RefPointDefinition[]` —
  pure; never mutates input, never touches storage. Runs the cluster pass to
  a fixpoint so the output is idempotent.
- `SIBLING_MERGE_MAX_DIST_M` (`const 10`) — maximum distance between two
  definitions' averaged positions for a merge. Legitimate re-marks of one
  point sit within a few meters of GPS jitter; same-cell/neighbor candidates
  farther apart than this must NOT merge.

## Merge semantics

- **Cluster rule:** two definitions are the same anchor when they share an
  id, OR their _effective cells_ match (`h3CellsMatch`, i.e. identical or
  gridDisk-1 neighbors) AND their robust averaged positions (accuracy-gated
  `averageGpsPerRefPoint`) are ≤ `SIBLING_MERGE_MAX_DIST_M` apart. Clusters
  are transitive (union-find).
- **Effective cell:** the H3 id itself; for legacy ids, the cell re-minted
  from the averaged position. Lone legacy definitions are also re-minted
  in the output (in-memory only — the on-disk file keeps its legacy id), so
  the proximity matcher can spatially match them; the first re-observation
  then persists under the H3 id and the legacy file merges into it on the
  next load.
- **Merged definition:** id = effective cell of the _primary_ member (most
  observations; ties → newest observation); name via
  **most-observations-wins** (ties → the name with the newest backing
  observation — so one throwaway rename loses against a consistent naming
  history, while a deliberate rename sticks once it accumulates more
  observations); earliest `createdAt`; observations unioned and deduped by
  the content key `sessionId|timestamp|lat|lon`.

## Invariants & assumptions

- Idempotent: `merge(merge(x))` equals `merge(x)` (fixpoint iteration —
  a merge can move an averaged position and expose a further merge).
- Conserves the distinct-observation set: nothing lost, nothing duplicated.
- Never invents a name; never increases the definition count.
- Definitions without observations cannot cluster and pass through as-is.
- Known limitation: the merged id is ONE member's cell; a live fix inside a
  chained cluster's far member cell can sit outside gridDisk(1) of that id
  and mint a fresh definition — which the next load merges back into the
  cluster (self-healing, at the cost of an extra file).

## Consumers

- `folder-manager.loadAndDisplayRefPoints` — load-time in-memory merge:
  display, matcher, and averaging consume merged definitions; existing OPFS
  files are never rewritten.
- `ref-point-recovery.indexRefPointDefinitionsFromFolder` — per-scenario
  bucket merge, so clean imports persist one merged definition per cluster.

## Examples

```ts
import { mergeSiblingRefPoints } from './ref-point-merge';

const defs = await loadAllRefPoints(scenarioHandle);
const merged = mergeSiblingRefPoints(defs); // one def per physical anchor
```

## Tests

- `ref-point-merge.test.ts` — neighbor-twin merge, rename-artifact name
  policy (+ tie-break), legacy-into-H3 merge, lone-legacy re-mint,
  over-distance non-merge, empty/no-observation pass-through, content-key
  dedupe; properties: idempotency, distinct-observation conservation,
  no invented names / no count increase.
