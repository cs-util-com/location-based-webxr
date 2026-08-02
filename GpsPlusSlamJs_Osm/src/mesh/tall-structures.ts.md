# `tall-structures.ts`

**Purpose:** selects and heights tall `man_made` structures that carry no
`building` tag, so they are extruded instead of silently missing (F34, §5).

## The case that named it

Cologne Cathedral has two 157 m towers and only one drew:

- `way/645732604` "Nordturm" — `building=tower` **and** `man_made=tower`.
- `way/645732603` "Südturm" — `man_made=tower` **only**.

`isBuilding` keys off `building`. A cathedral with one tower reads as a failed
fetch rather than as a tagging distinction.

## Public API

- `isTallStructure(feature): boolean`
- `tallStructureHeightM(feature): number | undefined`
- `TALL_STRUCTURE_KINDS` — the closed set of `man_made` values.

## Invariants & assumptions

- **NOT A PORT.** streets-gl's `OSMAreaQualifierFactory` has no `man_made`
  branch, so its Südturm is missing too. Nothing external supplies the tag list
  or the height conventions — this is our design and is validated only by the
  fixture assertions.
- **Two exclusions prevent a DOUBLE draw, not a wrong one.** Anything
  `isBuilding` or `isBuildingPart` already claims is refused, so the Nordturm
  (which carries both tags) is extruded exactly once. Two coincident 157 m
  prisms are invisible until they z-fight.
- **The kind list is closed, and an unlisted value draws nothing.** `man_made`
  is one of OSM's broadest keys — the Cologne fixture carries 36
  `man_made=surveillance` plus `column`, `street_cabinet`, `pipeline`,
  `water_well` and a bare `yes`. A permissive rule fills the street with boxes.
- **No default height, unlike buildings.** A building with no height is still a
  building and 6 m is a reasonable stand-in. A tower could be 5 m or 300 m, so a
  guess is a landmark-sized lie; drawing nothing is the honest failure.
- **Areas only.** Nodes belong to `poi.ts`.

## Tests

- `tall-structures.test.ts` — the selector and the height rule, with most of the
  effort on what must not be drawn.
- `nested-outlines.test.ts` — the fixture proof: the Südturm is extruded at its
  tagged height, the Nordturm is still drawn exactly once, the five `Sockel`
  parts are untouched, and none of the fixture's street furniture appears.
