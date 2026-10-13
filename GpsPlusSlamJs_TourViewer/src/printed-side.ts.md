# printed-side.ts

## Purpose

The printed side length's field (`#author-size`) in centimetres (polish
round M0b, A15: "0.16 m" read as a strange number for a poster). Every
reader works in metres - the pose solve's unit - so the field's text is
read and written here and nowhere else. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-11-0049-tour-viewer-polish-round-plan.md`
(M0b).

## Public API

- `readSideM(field): number` - the field's size in metres, or `NaN` when
  it holds no positive finite number (empty, text, zero, negative,
  infinite).
- `writeSideM(field, sizeM): void` - shows `sizeM` in centimetres, rounded
  to a tenth.

## Invariants & assumptions

- The only place the field's unit is known. Readers: `creator-draft.ts`,
  `creator-measuring.ts`, `print-panel.ts`; writers: `creator-setup.ts`
  (the default), `creator-draft.ts` (a restored draft),
  `creator-measuring.ts` (an adopted measured size).
- A size written and read back is the same to a tenth of a centimetre
  (property-tested); finer sizes round on write.
- `field` is structural (`{ value: string }`), so node tests pass plain
  objects.

## Examples

```ts
writeSideM(sizeInput, 0.18); // shows "18"
const sizeM = readSideM(sizeInput); // 0.18
```

## Tests

`printed-side.test.ts` - centimetres as metres, broken input as NaN, the
tenth-of-a-centimetre write, and a round-trip property.
