import { describe, expect, it } from "vitest";
import fc from "fast-check";
import * as THREE from "three";

import { measureLightReadouts } from "./light-measure.js";

const frame = new Uint8Array([100, 100, 90, 255]);

describe("measureLightReadouts (properties)", () => {
  // Why this test matters: over every mix of grid objects (absent, hidden,
  // seen or not by the AO), with or without the margin, the work stays
  // bounded and consistent: each read is one scene render carrying exactly
  // one AO (computed or reapplied), the AO is computed again only when the
  // AO sees the grid, every grid object ends with the visibility it had,
  // and a frame is requested exactly when the canvas was left without the
  // grid that is shown.
  it("keeps the work per read bounded and restores the grid as found", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            present: fc.boolean(),
            visible: fc.boolean(),
            seenByAo: fc.boolean(),
          }),
          { maxLength: 3 },
        ),
        fc.boolean(),
        (specs, withMargin) => {
          const seen = new Set<THREE.Object3D>();
          const grid = specs.map((s) => {
            if (!s.present) return undefined;
            const o = new THREE.Mesh();
            o.visible = s.visible;
            if (s.seenByAo) seen.add(o);
            return o;
          });
          let draws = 0;
          let aoRenders = 0;
          let reapplies = 0;
          let reads = 0;
          let frames = 0;
          const result = measureLightReadouts({
            grid,
            withMargin,
            drawScene: () => {
              draws += 1;
            },
            ambientOcclusion: {
              render: () => {
                aoRenders += 1;
                return true;
              },
              reapply: () => {
                reapplies += 1;
                return true;
              },
            },
            hiddenFromAo: (o) => !seen.has(o),
            readFrame: () => {
              reads += 1;
              return frame;
            },
            requestFrame: () => {
              frames += 1;
            },
          });
          const shown = grid.filter(
            (o): o is THREE.Mesh => o !== undefined && o.visible,
          );
          const margin = withMargin && shown.length > 0;
          const aoSees = shown.some((o) => seen.has(o));
          expect(draws).toBe(margin ? 2 : 1);
          expect(reads).toBe(draws);
          expect(aoRenders + reapplies).toBe(reads);
          expect(aoRenders).toBe(margin && aoSees ? 2 : 1);
          expect(result.margin === null).toBe(!margin);
          expect(frames).toBe(shown.length > 0 && !margin ? 1 : 0);
          expect(grid.map((o) => o?.visible)).toEqual(
            specs.map((s) => (s.present ? s.visible : undefined)),
          );
        },
      ),
    );
  });
});
