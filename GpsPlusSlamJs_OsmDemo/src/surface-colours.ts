/**
 * The two base colours of the terrain, and the relationship between them
 * (DEC-R6b-7).
 *
 * WHY THEY LIVE TOGETHER NOW. They were two literals in two files —
 * `building-view.ts` for the ground plane, `mesh-layers.ts` for the landuse
 * plates that lie on it — and nothing said they were related. Round 6's §2
 * (DEC-R6-6) lightened the ground from `0x3a4356` to `0x6b7280` and left the
 * plate behind, which INVERTED their relationship: the plate had been ~1.6x the
 * ground's relative luminance and became ~0.5x it, a threefold swing. The sixth
 * testing session reported the result as "riesige schwarze Polygone".
 *
 * WHAT THIS FILE IS NOT. It is not the cause of that report. The black polygons
 * were `plates.ts` emitting its triangulator output unreversed, so every face
 * normal pointed DOWN and `flatShading` lit the plates from beneath — black
 * under a low sun whatever the colour said. That is fixed and covered by
 * `plates.test.ts`. **The contrast inversion is a SEPARATE regression that
 * survived the winding fix**, and this file is where it stops being invisible.
 *
 * THE POINT IS THE TEST, NOT THE CONSTANTS. Two numbers in two files can drift
 * silently for a whole round; two numbers with an asserted relationship cannot.
 * `surface-colours.test.ts` fails if someone lightens one and forgets the other,
 * which is exactly what happened.
 *
 * @see surface-colours.ts.md
 */

/**
 * The ground plane (DEC-R6-6).
 *
 * Lighter and more neutral than the near-black it started as: a dark surface has
 * almost no dynamic range for a highlight to live in, and the slope tint needs
 * somewhere to show rather than fighting a blue base.
 */
export const GROUND_COLOUR = 0x6b7280;

/**
 * Landuse plates — grass, parks, car parks, pitches — lying ON the ground.
 *
 * SLIGHTLY LIGHTER THAN THE GROUND, and that ordering is the invariant rather
 * than the exact value. A plate is a surface treatment sitting on the terrain;
 * reading darker than what it lies on makes it look like a hole punched through,
 * which is how the sixth session described it. Restored to the ~1.6x ratio the
 * pair had before DEC-R6-6 moved one of them.
 *
 * NEUTRALISED to match the ground DEC-R6-6 neutralised, and deliberately at a
 * LOWER chroma than the `0x4a5468` it replaces (26 against 30). DEC-R4-5 says
 * the affordance heat ramp must stay the loudest thing on screen, measured as
 * absolute chroma and gated in the e2e suite — so a re-tune that raised chroma
 * would be trading one regression for another.
 */
export const PLATE_COLOUR = 0x848d9e;

/**
 * The below-surface diagnostic lines, in both the 3D scene and the 2D map.
 *
 * SHARED SO THE TWO VIEWS AGREE. Each view had its own literal, and the map's
 * was not a colour at all — the polylines carried a `className` with no CSS
 * rule behind it anywhere, so Leaflet fell back to its `Path` default and the
 * "a colour nothing else uses" claim in both sidecars was simply untrue. Review
 * on #256 caught it.
 *
 * A SATURATED PINK, deliberately outside every other palette here: the ground
 * and plates are desaturated greys, the heat ramp runs yellow-to-red, and
 * region outlines are white. The layer exists to be compared against what
 * remains on screen, so reading as "another affordance overlay" would defeat
 * it. A test pins the separation rather than trusting the eye.
 */
export const UNDERGROUND_COLOUR = 0xff7ad9;

/**
 * `#rrggbb` for a packed colour, for Leaflet and CSS.
 *
 * Exists so a colour used by both a three.js material (which wants the number)
 * and a Leaflet path option (which wants the string) has ONE definition. Two
 * constants would drift, and the drift would be invisible until someone
 * compared screenshots of the two views.
 */
export function cssColour(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

/**
 * Relative luminance of a packed `0xrrggbb`, per WCAG's sRGB formula.
 *
 * Exported because the assertion about these two colours is the reason the file
 * exists, and a test that reimplemented the maths could agree with itself while
 * disagreeing with the renderer.
 */
export function relativeLuminance(colour: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel((colour >> 16) & 0xff);
  const g = channel((colour >> 8) & 0xff);
  const b = channel(colour & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Absolute chroma, max channel minus min.
 *
 * The metric DEC-R4-5 settled on after HSV saturation proved to be a ratio and
 * therefore called the dark blue-grey ground "saturated" while it looked
 * neutral. Used here only to keep a plate re-tune from raising chroma.
 */
export function chroma(colour: number): number {
  const channels = [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff];
  return Math.max(...channels) - Math.min(...channels);
}
