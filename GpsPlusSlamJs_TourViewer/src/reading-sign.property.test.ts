/**
 * Why this test matters: the sign must read from wherever the visitor
 * stands, and its title must stay on the plate whatever a creator types.
 * For any viewer position around the sign the plate's face points at the
 * viewer (only about the upright axis), and for any title at most two
 * lines are drawn, none wider than the title's 760 px.
 */

import fc from "fast-check";
import { Box3, Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  buildReadingSign,
  drawReadingSign,
  turnToward,
  type SignContext,
} from "./reading-sign";
import { plateSizeM, TRAVEL_PLATE } from "./travelling-box-rules";

describe("reading sign properties", () => {
  it("the plate faces any viewer about the upright axis only", () => {
    const sign = buildReadingSign(null);
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        (x, y, z) => {
          fc.pre(Math.hypot(x, z) > 0.01);
          turnToward(sign.turn, new Vector3(x, y, z));
          const face = new Vector3(0, 0, 1).applyEuler(sign.turn.rotation);
          const len = Math.hypot(x, z);
          expect(face.y).toBeCloseTo(0, 9);
          expect(face.x).toBeCloseTo(x / len, 6);
          expect(face.z).toBeCloseTo(z / len, 6);
        },
      ),
      { numRuns: 300 },
    );
    sign.dispose();
  });

  it("any title draws at most two lines, each within the line's width", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,12}$/), { maxLength: 30 }),
        (words) => {
          const titles: string[] = [];
          let font = "";
          const g = {
            fillStyle: "",
            strokeStyle: "",
            lineWidth: 1,
            letterSpacing: "0px",
            get font() {
              return font;
            },
            set font(f: string) {
              font = f;
            },
            clearRect() {},
            beginPath() {},
            roundRect() {},
            arc() {},
            fill() {},
            stroke() {},
            fillText(text: string) {
              if (font.startsWith("600 64px")) titles.push(text);
            },
            measureText: (text: string) => ({ width: text.length * 30 }),
          } as unknown as SignContext;
          drawReadingSign(g, { title: words.join(" "), minutes: 3 });
          expect(titles.length).toBeGreaterThanOrEqual(1);
          expect(titles.length).toBeLessThanOrEqual(2);
          for (const line of titles) {
            // A single word longer than the line stands alone (12 letters
            // at most here, so it always fits).
            expect(line.length * 30).toBeLessThanOrEqual(760);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// Why: the plate under the sign is the narration box drawn in the world,
// painted from the box's own layout. If its world shape differed from the
// box's CSS shape the words would stretch and plate and dock would no
// longer read alike. Whatever size the box takes, the plate keeps its
// aspect, at 0.136 m an em.
describe("the words plate's shape", () => {
  it("is the box's CSS aspect for any box size", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 120, max: 900, noNaN: true }),
        fc.double({ min: 40, max: 400, noNaN: true }),
        fc.double({ min: 10, max: 32, noNaN: true }),
        (w, h, font) => {
          const sign = buildReadingSign(null);
          sign.attachWords(new Texture(), plateSizeM(w, h, font));
          sign.root.updateMatrixWorld(true);
          const size = new Box3()
            .setFromObject(sign.words)
            .getSize(new Vector3());
          sign.dispose();
          expect(size.x / size.y).toBeCloseTo(w / h, 6);
          expect(size.x).toBeCloseTo((w / font) * TRAVEL_PLATE.emM, 9);
        },
      ),
      { numRuns: 200 },
    );
  });
});
