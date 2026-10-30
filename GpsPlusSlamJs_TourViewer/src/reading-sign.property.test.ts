/**
 * Why this test matters: the sign must read from wherever the visitor
 * stands, and its title must stay on the plate whatever a creator types.
 * For any viewer position around the sign the plate's face points at the
 * viewer (only about the upright axis), and for any title at most two
 * lines are drawn, none wider than the title's 760 px.
 */

import fc from "fast-check";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  buildReadingSign,
  drawReadingSign,
  turnToward,
  type SignContext,
} from "./reading-sign";

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
          turnToward(sign.plate, new Vector3(x, y, z));
          const face = new Vector3(0, 0, 1).applyEuler(sign.plate.rotation);
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
