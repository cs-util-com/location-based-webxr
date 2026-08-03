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

/** `cross(x,y,z,s,c)` — G's shared plus-sign, two crossed boxes. */
function crossG(
  b: MeshBuilder,
  x: number,
  y: number,
  z: number,
  s: number,
  colour: number,
): void {
  bxG(b, s * 0.3, s, s * 0.3, colour, y, x, z);
  bxG(b, s, s * 0.3, s * 0.3, colour, y, x, z);
}

/** Every G model, keyed by kind. Built at G's own scale; the registry rescales. */
export const G_VARIANTS: ReadonlyMap<string, () => MeshData> = new Map<
  string,
  () => MeshData
>([
  [
    "amenity=parking",
    (): MeshData =>
      composed((b) => {
        cyG(b, 0.1, 2, 6, G.mG);
        bxG(b, 1, 1, 0.1, G.rT, 2.5);
        // The "P", as five strokes on the sign face.
        bxG(b, 0.2, 0.5, 0.15, G.tW, 2.5, -0.15);
        bxG(b, 0.4, 0.15, 0.15, G.tW, 2.675, 0.05);
        bxG(b, 0.4, 0.15, 0.15, G.tW, 2.425, 0.05);
        bxG(b, 0.15, 0.25, 0.15, G.tW, 2.55, 0.2);
      }),
  ],
  [
    "amenity=waste_basket",
    (): MeshData =>
      composed((b) => {
        cyG(b, 0.4, 1.2, 8, G.mD);
        cyG(b, 0.42, 0.2, 8, G.mG, 1.1);
        bxG(b, 0.3, 0.15, 0.45, G.win, 1.1);
      }),
  ],
  [
    "amenity=fast_food",
    (): MeshData =>
      composed((b) => {
        cyG(b, 0.15, 2, 4, G.mG);
        cyG(b, 0.6, 0.3, 8, G.mu, 2.4);
        cyG(b, 0.65, 0.2, 8, G.ruB, 2.65);
        cyG(b, 0.6, 0.3, 8, G.mu, 2.9);
      }),
  ],
  [
    "amenity=pharmacy",
    (): MeshData =>
      composed((b) => {
        cyG(b, 0.15, 2, 6, G.mD);
        crossG(b, 0, 2.6, 0, 1, G.fT);
      }),
  ],
  [
    "leisure=swimming_pool",
    (): MeshData =>
      composed((b) => {
        bxG(b, 4, 0.3, 3, G.pavD);
        bxG(b, 3.5, 0.31, 2.5, G.wT);
        // THE LADDER IS AN ADDITION, NOT A PORT (Q-V2). It is the owner's only
        // requested CHANGE to a model rather than a choice between models —
        // _"swimming_pool (maybe a ladder missing that you could add?)"_ — so it
        // is built into this variant rather than offered as a further one.
        //
        // Two uprights and two rungs at the deep end, in galvanised metal
        // against the deck's paving. Sized off the pool itself so it stays
        // proportional through DEC-V5's rescale rather than drifting when the
        // target height changes.
        for (const x of [-0.2, 0.2]) {
          cyG(b, 0.05, 0.7, 6, G.mG, 0.55, x, 1.35);
        }
        for (const y of [0.45, 0.75]) {
          bxG(b, 0.5, 0.06, 0.06, G.mG, y, 0, 1.35);
        }
      }),
  ],
]);

/** The palette values a G port may paint with. Pinned in the tests. */
export const G_PALETTE = G;
