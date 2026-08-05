# `src/model/below-surface.ts`

## Purpose

Decides whether an OSM feature sits **under** the ground being scored, so the
scorer can let it contribute nothing.

## Why it exists

`affordance-scorer.ts` computes

```text
heat(cell, category) = Π over features touching the cell ( Π over tags ( ruleValue ) )
```

and **`0` is absorbing** — `scoreFeature` returns immediately on it, because "a
hard veto can never recover". Correct for a wall across a path; wrong for a car
park two levels below a plaza. The scorer is 2D: a cell is a column, and
everything whose footprint covers it contributes equally.

Reported symptom: a way mapped beneath the Domplatte made the walkable plaza
above it score as **not walkable** — corrupting the input of the regions, the
geo-event's hill climb, and the planned NPC traversal graph.

**`layer` was never suppressed — it was never read.** It appears in
`ignored-tags.ts`, which looks like the cause and is not: that list is explicitly
_"diagnostic, not functional — nothing here changes a score"_, and exists only to
keep `unmappedTagCounts` a short list of real rule candidates. A tag absent from
the rule table already contributes the identity, so `layer=-1` neither vetoed nor
protected. The feature's **other** tags did the damage. (That entry's comment,
which claimed `layer` is "read elsewhere", was wrong and is worth correcting if
anyone touches it.)

## Public API

- `isBelowSurface(feature) -> boolean`

## What counts, and what deliberately does not

Below surface:

- `layer < 0` — the reported case, and the general one.
- `level < 0` — the indoor-mapping analogue; a basement corridor is under the
  surface for the same reason a tunnel is.
- `location=underground` — explicit and unambiguous.
- `tunnel` ∈ {`yes`, `culvert`}.

**Not** below surface, and these exclusions carry as much weight as the
inclusions:

- **`tunnel=building_passage`** — an arcade or gateway _through_ a building at
  ground level. It is walkable surface, and exactly the kind of covered
  pedestrian route a walkability map exists to find. This is why the check is a
  value set rather than a presence check on the `tunnel` key.
- **Bare `indoor=*`** — carries no vertical information at all; an indoor
  corridor is usually at ground level. `level` is what says which floor.
- **`covered=yes`** — a covered walkway is still ground you walk on.
- **`layer > 0`** — bridges, deliberately out of scope. A bridge deck and the
  ground beneath both score, so the demo shows one surface where there are two:
  wrong, but benign next to a wrong veto, and fixing it means deciding which
  surface wins. Filed as **F59**.

## Invariants & assumptions

- **An unparseable `layer`/`level` reads as SURFACE.** OSM values are free text:
  `-1;0` (a way spanning two layers), `−1` with U+2212, empty strings and junk
  all occur. The direction matters — today everything scores as surface, so
  keeping that on malformed data changes nothing, whereas guessing "below" would
  silently delete ground. For `-1;0` surface is also the _correct_ answer, since
  such a way touches it.
- **Never throws.** It runs over merged OSM data from an unbounded tag space
  inside the scoring pass; a throw here takes the whole pass down. Pinned by a
  fast-check property over arbitrary tag dictionaries.
- **Applied per feature, for every category.** The scorer gives a below-surface
  feature the multiplicative identity in `featureFactors` — "considered,
  contributed nothing" — so neither the cell loop nor the index needs to know.
  Skipped rather than clamped, and category-independent, because the claim is
  about geometry: expressing it as per-category factors would let a rule-table
  edit quietly undo it.
- **Used by BOTH the scorer and the mesh, and that is the point.** `mesh/buildings.ts`
  skips below-surface features at the same seam where it decides what is a
  building, so a structure with `location=underground` is neither scored on the
  surface nor extruded onto it. Two definitions of "below the surface" would
  simply move the disagreement rather than remove it.
  - It was scoring-only for one commit, which left the geometry standing an
    underground structure on the street while the scorer had stopped counting
    it — the two halves of the pipeline disagreeing about the same feature.

## Examples

```ts
isBelowSurface(feature({ layer: "-1", highway: "service" })); // true
isBelowSurface(feature({ tunnel: "building_passage" })); // false — walkable
isBelowSurface(feature({ layer: "-1;0" })); // false — touches the surface
```

## Tests

`below-surface.test.ts` — each inclusion and each exclusion separately, the
defensive parsing cases, and a property asserting it never throws and always
returns a boolean.

`affordance-scorer.test.ts` holds the end-to-end reproduction: a high-scoring
surface feature paired with a **vetoing** underground one. The veto is what makes
it able to fail — an underground feature the table does not know already
contributes the identity, so without one the fix would be indistinguishable from
doing nothing.

Both directions are mutation-checked: forcing `below` to `false` fails the
reproduction, and adding `building_passage` to the tunnel set fails the
mirror-bug tests.
