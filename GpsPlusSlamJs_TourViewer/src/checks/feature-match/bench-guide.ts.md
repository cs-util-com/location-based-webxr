# bench-guide.ts

## Purpose

The texts the feature matching page shows the tester: per photo pair its purpose, the steps for photo A and photo B and what to avoid, plus the general rules of "Before you start". Data only, kept beside the pair list (`bench-export.ts`) so the page's HTML holds no protocol text.

## Public API

- `PairGuide { purpose, steps, strongSteps, avoid, spotNote }`: one sentence of what the pair measures, the steps in order without numbers (the page shows them as a numbered list, the first `strongSteps` in bold; 2 on `1b` and `1c`, whose first steps are "Photo A with the light ON as normal." and "Then dim the light, wait 2 seconds, then photo B.", 0 elsewhere; their purpose starts "Same place as 1a" and their steps say the camera brightens a dim picture a little by itself), one short avoid line (the page prefixes "Avoid: "), and whether the spot note applies (the light pairs `1a`-`1c` only).
- `PAIR_GUIDE`: a `PairGuide` for every `PairKey`, that is every key of `PAIRS` plus `none` (the manual run). The type forces an entry per key; the test forces each one to be filled.
- `BEFORE_YOU_START`: the five general rules (screen rotation and zoom, save before the next photo A, nothing personal in the picture, aim at detail, the selector moving on by itself).
- `SPOT_NOTE`: how the light pairs are repeated at up to three spots.

## Invariants

- Plain English, plain hyphens, no markup: the page sets them as `textContent`.
- Steps are not numbered in the text.

## Example

```ts
const g = PAIR_GUIDE["2b"];
// g.purpose === "Does a method cope with a quarter turn?"
```

## Tests

`bench-guide.test.ts`: every key of `PAIRS` and `none` has a complete entry and no other key exists, the dimmed pairs open with the two bold order steps and say "Same place as 1a" and that the camera brightens a dim picture, no step says not to touch the phone or to lay it down (1a asks to prop it up), the spot note is on exactly the light pairs, no text carries an em or en dash or markup, and the general rules keep their key phrases. The page's card following the selector is checked in `playwright-tests/feature-match-check.spec.js`.
