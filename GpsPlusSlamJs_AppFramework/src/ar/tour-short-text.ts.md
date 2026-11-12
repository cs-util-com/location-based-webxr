# tour-short-text.ts

## Purpose

A short text's look fields: how its caption stands in the world beyond the
pin. Read by the short-text row of `TOUR_KINDS` (`tour-kinds.ts`) in every
view, so switching a block between `pin`, `sign`, `edgeHint` and `ground`
keeps them. Every field is optional; the renderer gives each absent one its
default.

## Public API

- `shortTextLook(v, ctx)` - the look fields of one block's raw record, in
  writing order. Throws through `ctx.fail` for a broken value.
- `shortTextLetterHeightM(readAtM)` - the letter height (m) for a reading
  distance: 2.64 cm per metre (6.6 cm letters read at 2.5 m), the distance
  clamped to 1-40 m. The one size rule every short-text view uses.
- `TourShortTextLook` - the fields:
  - `role`: `instruction` | `label` | `warning` (`TOUR_SHORT_TEXT_ROLES`).
  - `orientation`: `world` (fixed at the pose) | `upright` (turns about its
    upright axis toward the visitor) | `face` (`TOUR_SHORT_TEXT_ORIENTATIONS`).
  - `readAtM`: the distance (m) its words are readable from, 1-40.
  - `pointsTo`: `[x, y, z]` in the station's frame (m), within 1000 m.
  - `lang`: a BCP-47 tag (shape-checked, at most 35 characters).
  - `style`: the ground view's style, `ribbon` | `vanes` | `footprints` |
    `lights` | `floor` (`TOUR_GROUND_STYLES`).
  - `bendDeg`: the ground view's bend, -60 to 60 degrees, + bends right
    seen from above.
  - `floorPlacement`: the `floor` style's arrow, `lying` | `hovering` |
    `upright`.
  - `captionOnArrow`: the `floor` style writes its caption on the arrow.
  - `color`, `darkColor`: the ground view's two colours, `#rrggbb`.
- The bounds as constants: `TOUR_SHORT_TEXT_MIN_READ_AT_M`,
  `TOUR_SHORT_TEXT_MAX_READ_AT_M`, `TOUR_SHORT_TEXT_POINT_MAX_M`,
  `TOUR_GROUND_MAX_BEND_DEG`.

## Invariants & assumptions

- A value of the wrong type (a reading distance that is not a positive
  number, a point that is not three finite numbers, a bend that is not a
  number) fails at every minor: no revision makes it valid.
- A value a later minor may allow (an unknown role or style, a distance or
  a bend out of range, a malformed tag or colour, a non-boolean flag)
  fails a file of this reader's own minor, and in a newer file drops just
  that field (`onDropped`), so the block still shows with the default: an
  older reader draws a newer style as the ribbon.
- No field depends on the view; a field a view does not read is kept.

## Examples

```ts
shortTextLook({ role: 'warning', readAtM: 12, style: 'vanes' }, ctx);
// { role: 'warning', readAtM: 12, style: 'vanes' }
shortTextLetterHeightM(10); // 0.264
```

## Tests

`tour-short-text.test.ts` (each field's rule, strict and lenient, the
letter height and its monotonicity as a property). The round trip through
a whole tour is `tour-blocks.property.test.ts`, whose generated short texts
carry every look field (`test-utils/tour-arbitraries.ts`).
