/**
 * The `G` variants — ported from `gemini-code-1785634682505` (DEC-R6-30…33).
 *
 * Five of the owner's 51 liked pairs come from this file, and it is the odd one
 * out of the six: **free-standing, with no plinth at all**, at a compressed
 * scale rather than a diorama one — a hotel is a 2.5 × 3.5 × 2.5 m box.
 * §4.1 of the round-6 plan noted that the owner picked from it anyway, which was
 * a small piece of evidence for DEC-R6-8's real-world-scale decision.
 *
 * **NOTHING HAS TO BE STRIPPED**, which makes this the cleanest of the three
 * ports so far. What has to be converted is the `y` convention: G takes `y` as
 * the part's CENTRE and defaults it to `h / 2`, so a part with no `y` sits on the
 * ground. Every helper below undoes that to our base-`y`.
 *
 * Its cylinders take ONE radius for both ends, unlike D's and B's, so there is
 * no top/bottom order to get wrong here.
 *
 * **Scale still needs DEC-V5.** Compressed is not real: G's own `parking` sign
 * stands 3 m tall. The registry rescales to the shipped model's height.
 *
 * @see poi-variants-g.ts.md
 */

import type { MeshBuilder, MeshData } from "./mesh-data.js";
import { box, composed, prism } from "./poi-primitives.js";

/** G's palette, abbreviated as the source names it. Same values as the rest. */
const G = {
  sL: 0x8894a0,
  sM: 0x6e7b85,
  sD: 0x4f5a64,
  mG: 0xa6adb2,
  mD: 0x5a6167,
  wD: 0x6b4e3d,
  win: 0x2b3540,
  tW: 0xedede4,
  pavD: 0xa99e8c,
  rT: 0x3e7a80,
  fT: 0x3e6b60,
  wT: 0x2fb3b0,
  mu: 0xd9b64e,
  ruB: 0xde7c3b,
} as const;

/** `B(w,h,d,c, y = h/2, x, z)` — `y` is the part's CENTRE. */
function bxG(
  b: MeshBuilder,
  w: number,
  h: number,
  d: number,
  colour: number,
  y: number = h / 2,
  x = 0,
  z = 0,
): void {
  b.paint(colour);
  box(b, w, h, d, y - h / 2, x, z);
}

/** `CY(r,h,seg,c, y = h/2, x, z)` — ONE radius, `y` the CENTRE. */
function cyG(
  b: MeshBuilder,
  r: number,
  h: number,
  seg: number,
  colour: number,
  y: number = h / 2,
  x = 0,
  z = 0,
): void {
  b.paint(colour);
  prism(b, r, r, h, seg, y - h / 2, x, z);
}

/** Every G model, keyed by kind. Built at G's own scale; the registry rescales. */
export const G_VARIANTS: ReadonlyMap<string, () => MeshData> = new Map<
  string,
  () => MeshData
>([
  [
    "amenity=waste_basket",
    (): MeshData =>
      composed((b) => {
        cyG(b, 0.4, 1.2, 8, G.mD);
        cyG(b, 0.42, 0.2, 8, G.mG, 1.1);
        bxG(b, 0.3, 0.15, 0.45, G.win, 1.1);
      }),
  ],
]);
