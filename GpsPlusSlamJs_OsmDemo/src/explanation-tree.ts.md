# `explanation-tree.ts`

**Purpose.** Shape `explainCell`'s output into rows a collapsible tree can render — feature → its tags → each tag's factor and the running product.

## Public API

- `explanationTree(explanation: CellExplanation): ExplanationTree`
- `ExplanationTree` — `{ cell, category, scoreLabel, thresholdLabel, aboveThreshold, summary, features }`.
- `FeatureRow` — `{ key, osmUrl, factor, factorLabel, state, tags }`. `state` is `veto | raised | lowered | silent`.
- `TagRow` (reachable through `FeatureRow.tags`) — `{ key, value, ruleKey, factorLabel, runningLabel, state }`. `state` is `scored | veto | skipped | no-rule | ignored`.

`TagRow`, `TagState` and `FeatureState` are not exported: they are reached through `ExplanationTree`, and the dead-code gate is right that nothing imports them by name. Export them when something does.

## Invariants & assumptions

- **The running product uses the same short-circuit as the scorer.** Once a tag vetoes, every later row stays at `0`, because that is what the product actually did. Continuing to multiply the skipped factors would print a column of arithmetic that never happened.
- **The vetoing feature ranks first**, by the same `|log(factor)|` magnitude `contributor-order.ts` uses for the popup — so the two lists cannot disagree about which contributor is worth reading first. Ordering is done on the **raw** `factor`, never on the rounded `factorLabel`.
- **`skipped` and `no-rule` and `ignored` are three different statements** and are kept apart: "the veto meant this was never evaluated", "the table has never heard of this tag", and "the table has decided this kind of tag can never matter". Only the middle one is a gap in the rule table worth filing.
- **The summary sentence carries what a table of numbers cannot.** "Nothing is mapped here", "something vetoed it" and "it scored but under the bar" look almost identical as rows, and telling them apart is the reason the panel exists.
- Labels round to 2 decimals for display only; `factor` stays exact.
- Pure — no DOM, no store. The panel builds nodes from this and nothing else.

## Examples

```ts
const tree = explanationTree(explainCell(cell, covering, table, "restingArea"));
tree.summary; // "Vetoed by node/2: a single 0 makes …"
tree.features[0].state; // "veto"
tree.features[0].tags[1].state; // "skipped"
tree.features[0].tags.map((t) => t.runningLabel); // ["4", "8", "48"]
```

## Tests

`explanation-tree.test.ts` — the cemetery answer end to end (the veto leads, its own tag is marked `veto`, the tag after it is `skipped`, and the outvoted positives are still shown under their own feature); the score and the threshold verdict; the running product accumulating `4 → 8 → 48`; feature ordering with a veto present; a silent feature; `ignored` vs `no-rule`; the browse-page link; rounding; and an empty cell described as the identity rather than as zero.
