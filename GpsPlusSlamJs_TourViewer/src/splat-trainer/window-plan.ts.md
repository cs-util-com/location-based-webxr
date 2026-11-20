# window-plan.ts

## Purpose

The splat trainer page's view of the walk's windows. It does no planning:
the windows - which frames each one trains on and is scored on - come
unchanged from `planWindows` (`walk-windows.ts`) with `TRAINER_DEFAULTS`
(`trainer-defaults.ts`). This module numbers them as stretches and
measures the walked metres the page prints under each print.

## Public API

- `StretchSummary` - `{ id, index, fromM, toM, frames }`: what the page's
  state keeps of a stretch (`id` is `w<index>`, `frames` the core count,
  hold-outs included).
- `PlannedWindow` - a `StretchSummary` plus `window`, the planner's window
  with its `core`, `train` and `holdouts` frame lists. The page store keeps
  these beside the state (`sides.plans`) and hands the matching one to the
  trainer in each `TrainRequest`.
- `PlannerInput` - `{ captures: WalkFrame[] }`; the reader's `SplatInputs`
  satisfy it.
- `WindowPlanner` - `(input) => PlannedWindow[]`, the seam the page store
  takes (`TrainerPageDeps.plan`).
- `walkedDistances(captures) -> number[]` - cumulative distance at each
  capture, 0 at the first; a non-finite step counts as 0.
- `stretchesFromPlan(captures, plan) -> PlannedWindow[]` - one stretch per
  window with a non-empty core, in the plan's order.
- `windowPlanner(settings = TRAINER_DEFAULTS) -> WindowPlanner` -
  `planWindows` then `stretchesFromPlan`.
- `summaryOf(p) -> StretchSummary` - drops the frame lists.

## Invariants

- Stretches are numbered densely from 0 in the plan's order.
- A stretch runs from its first core frame's distance to the next
  stretch's first core frame, so the metres never run backwards and
  neighbours meet; the last one ends at its own last core frame.
- `planWindows` throws only for settings that cannot hold; the page store
  catches a throw and treats it as an empty plan (the page then refuses
  the recording).

## Example

```ts
const planned = windowPlanner()(inputs); // inputs from readSplatInputs
store.dispatch(A.readFinished({ id, census, windows: planned.map(summaryOf) }));
```

## Tests

`window-plan.test.ts`: one stretch per planned window with its core count
and the planner's frame lists, an empty walk, a non-finite step, and a
property over random walks (dense numbering, non-empty, monotone metres).
