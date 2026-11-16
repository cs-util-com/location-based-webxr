# `fallback-note.ts`

## Purpose

The one status-line phrase that names the buildings the city build could not
draw as built (`TransferableMesh.fallbackBuildings`, from
`City.fallbackBuildings` in the Osm package): a roof drawn as a flat lid
because its mesh did not close, a house drawn plain because planning its
roof hit a defect, or an outline drawn plain (or skipped) because its build
threw. Skipped buildings are not drawn at all, so the note says "simplified
or left out", true for both.

## Public API

- `fallbackBuildingsNote(count: number): string` - `"1 building simplified
or left out"`, `"N buildings simplified or left out"`, or `""` when `count`
  is 0, negative or not a number.

## Invariants & assumptions

- **Empty for none**, like the other counts on the line that are reported only
  when there are some: a zero would be noise on every build.
- **Calm on purpose.** One building that could not be built used to fail the
  whole city; now it is drawn simpler and counted. The note says what the
  viewer sees, not that something failed: it is not an error, and the error
  toast stays for builds that really failed.
- Defensive: anything but a positive number reads as none, so a mesh from an
  older worker without the field shows nothing rather than "undefined".

## Examples

```ts
fallbackBuildingsNote(0); // ""
fallbackBuildingsNote(3); // "3 buildings simplified or left out"
```

## Tests

- `fallback-note.test.ts` - none, one, many, and non-numbers.
