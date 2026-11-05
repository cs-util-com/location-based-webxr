/**
 * Why these tests matter: both 3D views give the Performance tab their
 * draw calls and triangles through one accessor, so a fix to how they are
 * counted lands in both at once; this pins what the accessor reads.
 */
import type * as THREE from "three";
import { describe, expect, it } from "vitest";

import { drawnCounts } from "./editor3d-view-parts.js";

describe("drawnCounts", () => {
  it("reads the last frame's draw calls and triangles off the renderer", () => {
    const renderer = {
      info: { render: { calls: 12, triangles: 34_567, points: 5 } },
    } as unknown as THREE.WebGLRenderer;
    expect(drawnCounts(renderer)).toEqual({ drawCalls: 12, triangles: 34_567 });
  });
});
