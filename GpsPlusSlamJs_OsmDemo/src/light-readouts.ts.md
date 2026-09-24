# light-readouts.ts

## Purpose

The light dialog's two readouts from an RGBA frame (plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-2140-osm-demo-light-settings-dialog-plan.md`,
DEC-LIGHT-3): the brightness of the lit buildings and roads, and the frame's
mean chroma, whose difference with and without the heat grid is the
DEC-R4-5 margin.

## Public API

- `litSurfaceLuma(rgba)`: the mean Rec. 709 luma of the warm, low-saturation
  pixels (r ≥ b and chroma below 60), or NaN when there are none.
- `meanChroma(rgba)`: the mean of max minus min over every pixel, or NaN for
  an empty frame.
- Both throw `RangeError` for a buffer that is not a whole number of RGBA
  pixels.

## Invariants & assumptions

- The same measures as the e2e sweep's inline `litSurfaceLuma` and
  `meanChroma` (`playwright-tests/scene-3d.spec.js`). Those stay the
  independent reference (plan §7 item 4); a parity e2e holds the dialog's
  readout to them on the same frame.
- Row order does not matter (both are means), so a `gl.readPixels` buffer
  (bottom row first) can be passed as it is.

## Example

```ts
const lit = litSurfaceLuma(pixels);
const margin = meanChroma(withGrid) - meanChroma(withoutGrid);
```

## Tests

`light-readouts.test.ts`: warm grey pixels only (sky, heat-grid and exactly
chroma-60 pixels excluded, 59 included); NaN with no lit pixel; the chroma
mean over every pixel; the refusals.
