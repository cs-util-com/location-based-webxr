/**
 * Why this test matters (owner report on r753, 2026-09-27): on a preview's
 * first visit the balls rest but cast no shadow until the Mesh dropdown is
 * switched and back. The cause is unknown and only visible on the phone, so
 * the status line must say what the receiver was compiled with (flags read
 * from the real shader sources), and the one-shot rebuild must happen
 * exactly once, only when the session is visible AND the mesh exists, with
 * the flags before and after on record. A rebuild that fires early, twice,
 * or never would make the owner's screenshot say nothing.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  RECEIVER_NODE,
  createFirstVisitRebuild,
  createReceiverFlagsReader,
  flagsText,
  programFlags,
  type ShaderSourceReader,
} from "./shadow-diagnostics";

/** A GL stub whose programs carry the given shader sources. */
function glWith(sources: Map<WebGLProgram, string[]>) {
  const reads = { count: 0 };
  const gl: ShaderSourceReader = {
    getAttachedShaders: (p) => (sources.get(p) ?? []).map((s) => ({ s })),
    getShaderSource: (shader) => {
      reads.count += 1;
      return (shader as unknown as { s: string }).s;
    },
  };
  return { gl, reads };
}

// As three r185 emits them: USE_SHADOWMAP and HAS_NORMAL are #defines, but
// the light counts are substituted into the body (`replaceLightNums`), so
// the directional-shadow count shows only as the arrays' sizes. The first
// version of the reader looked for a NUM_DIR_LIGHT_SHADOWS define and read
// 0 on every real program (caught by the replay e2e, "rx S1N1D0").
const VERTEX_WITH =
  "#version 300 es\n#define USE_SHADOWMAP\n#define HAS_NORMAL\n#if 1 > 0\nuniform mat4 directionalShadowMatrix[ 1 ];\n#endif\nvoid main(){}";
const FRAGMENT_WITH =
  "#version 300 es\n#define USE_SHADOWMAP\n#if 1 > 0\nuniform sampler2DShadow directionalShadowMap[ 1 ];\n#endif\nvoid main(){}";
const VERTEX_WITHOUT =
  "#version 300 es\n#if 0 > 0\nuniform mat4 directionalShadowMatrix[ 0 ];\n#endif\nvoid main(){}";

describe("programFlags", () => {
  it("reads the shadow map, normals and directional-shadow defines", () => {
    const p = {} as WebGLProgram;
    const { gl } = glWith(new Map([[p, [VERTEX_WITH, FRAGMENT_WITH]]]));
    expect(programFlags(gl, p)).toEqual({
      shadowMap: true,
      normals: true,
      dirShadows: 1,
    });
    expect(flagsText(programFlags(gl, p))).toBe("S1N1D1");
  });

  it("says when a define is absent, and when there is no program", () => {
    const p = {} as WebGLProgram;
    const { gl } = glWith(new Map([[p, [VERTEX_WITHOUT]]]));
    expect(flagsText(programFlags(gl, p))).toBe("S0N0D0");
    expect(programFlags(gl, null)).toBeNull();
    expect(flagsText(null)).toBe("none");
  });
});

describe("createReceiverFlagsReader", () => {
  it("finds the receiver by name, and re-reads only a new program", () => {
    const root = new THREE.Group();
    const material = new THREE.ShadowMaterial();
    const node = new THREE.Mesh(new THREE.BufferGeometry(), material);
    node.name = RECEIVER_NODE;
    const first = {} as WebGLProgram;
    const second = {} as WebGLProgram;
    const { gl, reads } = glWith(
      new Map([
        [first, [VERTEX_WITHOUT]],
        [second, [VERTEX_WITH]],
      ]),
    );
    let current: { program?: WebGLProgram } | undefined = undefined;
    const renderer = {
      properties: { get: () => ({ currentProgram: current }) },
      getContext: () => gl,
    };
    const read = createReceiverFlagsReader(renderer, root);
    expect(read()).toBe("off"); // no receiver attached
    root.add(node);
    expect(read()).toBe("none"); // attached, not yet compiled
    current = { program: first };
    expect(read()).toBe("S0N0D0");
    expect(read()).toBe("S0N0D0");
    expect(reads.count).toBe(1); // cached while the program is the same
    current = { program: second };
    expect(read()).toBe("S1N1D1");
  });
});

describe("createFirstVisitRebuild", () => {
  function setup() {
    let tris = 0;
    let flags = "S0N0D1";
    let now = 1000;
    const rebuild = vi.fn();
    const r = createFirstVisitRebuild({
      rebuild,
      meshTris: () => tris,
      readFlags: () => flags,
      now: () => now,
      startedAtMs: 0,
    });
    return {
      r,
      rebuild,
      set: (o: { tris?: number; flags?: string; now?: number }) => {
        tris = o.tris ?? tris;
        flags = o.flags ?? flags;
        now = o.now ?? now;
      },
    };
  }

  it("waits for a visible session AND a mesh, then rebuilds exactly once", () => {
    const { r, rebuild, set } = setup();
    r.tick("visible"); // no mesh yet
    set({ tris: 40 });
    r.tick("visible-blurred"); // the permission prompt's state
    r.tick("hidden");
    expect(rebuild).not.toHaveBeenCalled();
    expect(r.text()).toBe("rebuild pending");
    set({ now: 3200 });
    r.tick("visible");
    expect(rebuild).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 300; i++) r.tick("visible");
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it("records the flags before, and after once the new receiver is compiled", () => {
    const { r, set } = setup();
    set({ tris: 40, now: 3200 });
    r.tick("visible");
    expect(r.text()).toBe("rebuilt 3.2 s S0N0D1>...");
    set({ flags: "none" }); // the new receiver, not compiled yet
    r.tick("visible");
    expect(r.text()).toBe("rebuilt 3.2 s S0N0D1>...");
    set({ flags: "S1N1D1" });
    r.tick("visible");
    expect(r.text()).toBe("rebuilt 3.2 s S0N0D1>S1N1D1");
    set({ flags: "S0N0D0" }); // later changes do not rewrite the record
    r.tick("visible");
    expect(r.text()).toBe("rebuilt 3.2 s S0N0D1>S1N1D1");
  });

  it("gives up waiting for the new program after a while, and says so", () => {
    const { r, set } = setup();
    set({ tris: 40 });
    r.tick("visible");
    set({ flags: "none" });
    for (let i = 0; i < 200; i++) r.tick("visible");
    expect(r.text()).toBe("rebuilt 1.0 s S0N0D1>none");
  });
});
