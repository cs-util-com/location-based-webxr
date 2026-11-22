# guided-texts.ts

## Purpose

The guided view's words per photo pair of the protocol: a short title, the three steps (before photo A, the change, photo B) and the diagram kind, plus the review note after a light check. The purpose and avoid lines are not repeated here: `guidedCard` takes them from `PAIR_GUIDE` (`bench-guide.ts`), so both views say the same thing about what a pair tests.

## Public API

- `ProtocolKey`: a key of `PAIRS` (every pair but the manual run `none`).
- `GUIDED_STEPS: Record<ProtocolKey, { title, a, change, b, diagram }>`; `diagram` is a `DiagramKind` of `guided-diagram.ts`.
- `guidedCard(key)`: the steps plus `purpose` and `avoid` from `PAIR_GUIDE`.
- `LIGHT_NOTE: Record<LightCheck, string>`: one line per light check result; every failed one names the photo to retake.

## Invariants

- Plain English, plain hyphens, no markup: the view sets them as text.
- The dimmed pairs `1b` and `1c` keep the light on for photo A and dim in the change step, between the photos.
- Titles are unique per pair.

## Example

```ts
const c = guidedCard("2b");
// c.title === "Quarter turn", c.diagram === "rot-90"
```

## Tests

`guided-texts.test.ts`: every protocol key has a filled title, steps and a known diagram, no dash or markup, unique titles, the dimmed pairs' order, purpose and avoid taken from `PAIR_GUIDE`, and the light notes naming the photo to retake.
