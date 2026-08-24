# The route cost still ignores climb — follow-up

**Status:** filed, not acted on. Owner decision **DEC-S3** (2026-08-18) put this
out of scope for the slope fix
([`../../GpsPlusSlamJs_Osm/docs/2026-08-18-0659-nav-terrain-slope-vs-step-plan.md`](../../GpsPlusSlamJs_Osm/docs/2026-08-18-0659-nav-terrain-slope-vs-step-plan.md)),
and this records the question rather than reopening it.

## Why it is worth re-asking now

`planRouteWithIndex` minimises **horizontal** metres, and `agent-route.ts` says
why in as many words: charging climb would make the agent avoid stairs and
slopes, "a behaviour nobody asked for". That rationale is sound, but it was
written when **the planner had no choice to make** — ground steeper than ~7.5 %
was not walkable at all, so a steep shortcut was never a candidate in the first
place.

Since the slope fix, it is. Two routes of equal horizontal length are now equally
cheap whether one climbs 7 m and the other is level, and the search will take
either. On the reported Cologne bank — ~24 % — that is the difference between
walking the promenade and walking straight up the embankment.

## What it would take

- **Cost.** A climb term on top of the existing `metres × scorePenalty ×
pathFactor`. It must stay ≥ 1× the metres or the heuristic breaks (below).
- **The heuristic must be re-checked, and this is the real work.**
  `agent-route.ts` uses straight-line horizontal distance, and its admissibility
  argument is exactly that every cost factor is ≥ 1, so no route can be cheaper
  than its own horizontal metres. A climb term preserves that (it only adds), but
  the note claiming it is a lower bound needs re-deriving rather than assuming —
  `search.ts` documents **consistency**, not mere admissibility, as its contract.
- **A test that can tell the difference.** Two routes of equal horizontal length
  over a sloped field, asserting the flatter one is chosen — and a control that
  stairs are still taken when they are the only way, which is the behaviour the
  original decision was protecting.

## What NOT to do

**Do not charge the climb the drawn polyline measures.** `route-path.ts`
deliberately measures the drawn length _with_ the climb included, and its sidecar
notes that this is a different question from what the planner minimises. Reusing
that number here would silently couple the two.
