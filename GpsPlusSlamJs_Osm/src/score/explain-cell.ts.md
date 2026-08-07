# `explain-cell.ts`

**Purpose.** Recompute, for one cell and one category, the full per-tag breakdown behind its score — including the tags the scorer's veto short-circuit never evaluated.

## Public API

- `explainCell(cell, features, table, category): CellExplanation`
  - `cell` — the H3 cell id, carried through for labelling only.
  - `features` — **the features covering the cell**, supplied by the caller.
  - `table` — the same `RuleTable` the index scored with.
  - `category` — the category to explain.
- `CellExplanation` — `{ cell, category, score, threshold, features }`. `score` is the product of every feature's factor; `threshold` comes from `thresholdFor(table, category)` so a UI can place the score against the bar.
- `FeatureExplanation` — `{ feature, osmUrl, factor, tags }`. `osmUrl` is the openstreetmap.org **browse** page (`getOsmDebugUrl`), matching the C# reference — not the iD editor.
- `TagContribution` — `{ key, value, ruleKey, factor, skippedByVeto, ignored }`.
  - `factor: undefined` means the table has **no rule** for that key. A rule that scores `1` reports `factor: 1`. Both contribute nothing to the product, and conflating them would misrepresent the table's coverage.
  - `skippedByVeto: true` means a `0` earlier in the same feature's tags meant the scorer never looked this tag up. The reported `factor` is what the table _would_ have said.
  - `ignored: true` means `isIgnoredTagKey` marks the key as deliberately unscored (`name`, `addr:*`, `source`, …).

Nothing here is ordered for display. Features come back in the order supplied; ranking them (vetoes first) is the caller's choice.

## Invariants & assumptions

- **`FeatureExplanation.factor` equals `scoreFeature(feature, category, table)` exactly**, bit for bit. Guaranteed by construction, not by coincidence: the product is accumulated with the _same_ short-circuit, stopping at the first `0`, rather than multiplying every reported factor afterwards. A later factor of `Infinity` would otherwise turn a plain product into `NaN` where the scorer returns `0`. Pinned by `explain-cell.property.test.ts`.
- **`CellExplanation.score` equals the index's `scores[category]`** for the same feature set, to within floating-point noise. Not bit-identical across differently-ordered inputs — multiplication is commutative but not associative, and the package already documents that consumers must not compare two scores for exact equality across differently-ordered inputs (see `affordance-scorer.ts.md`).
- **The caller must take the feature set from the provenance map, not from geometry.** `CellScore.contributors[category]` records every feature touching the cell — including those whose factor is `1`, deliberately — so its keys are the complete authoritative set. Re-deriving coverage geometrically would be a second source of truth, free to disagree with the score being explained.
- **No validation that a supplied feature actually touches the cell.** There is nothing here that could detect it, and a geometric check would reintroduce exactly the second source of truth above. A caller that supplies the wrong features gets a confident wrong answer — which is why the contract above is the contract.
- Pure: no I/O, no clock, no allocation beyond the returned structure. Cost is O(features × tags), paid once when a human clicks a cell, never in the scoring hot path.

## Examples

```ts
import { explainCell } from "gps-plus-slam-osm";

// The covering set comes from the provenance map the index already keeps.
const keys = Object.keys(cellScore.contributors[category] ?? {});
const covering = keys
  .map((key) => allFeatures.get(key))
  .filter((f): f is OsmFeature => f !== undefined);

const why = explainCell(cellScore.cell, covering, table, category);

// "It is a park and a meadow and there is a bench, and none of it matters
//  because landuse=cemetery is 0."
for (const feature of why.features) {
  console.log(feature.feature, feature.factor, feature.osmUrl);
  for (const tag of feature.tags) {
    console.log(
      " ",
      tag.ruleKey,
      tag.factor,
      tag.skippedByVeto ? "(skipped)" : "",
    );
  }
}
```

## Tests

- `explain-cell.test.ts` — the shape of the answer, per-tag factors, the "no rule" vs "scores 1" distinction, ignored tags, the cemetery veto with its skipped tags, and agreement with `scoreFeature` across every category of a hand-built table.
- `explain-cell.property.test.ts` — over arbitrary tables and feature sets: exact per-feature agreement with `scoreFeature`, cell-score agreement with `scoreCells` through the provenance map, every tag reported once in tag order, `factor === undefined` exactly when no rule exists, and `skippedByVeto` set for exactly the tags after the first zero.

No fixture data required — both files build their tables from inline CSV via `parseRuleTable`, because an oracle needs known inputs rather than whatever a real tile happens to contain.
