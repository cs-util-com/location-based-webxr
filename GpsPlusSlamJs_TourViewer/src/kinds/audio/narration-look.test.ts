import fc from "fast-check";
import {
  InstancedBufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type ShaderMaterial,
  type Texture,
} from "three";
import { describe, expect, it } from "vitest";

import {
  narrationLook,
  PLUME,
  type NarrationLookOptions,
  type NarrationState,
} from "./narration-look.js";
import { WARM_GLOW } from "./warm-glow.js";

/** The look's meshes: the ground, the plume and, given a canvas, the plate. */
function partsOf(object: Object3D) {
  const meshes: Mesh[] = [];
  object.traverse((o) => {
    if ((o as Mesh).isMesh === true) meshes.push(o as Mesh);
  });
  const shown = meshes.filter((m) => (m.material as Material).visible);
  const plume = shown.find(
    (m) => m.geometry instanceof InstancedBufferGeometry,
  );
  const ground = shown.find(
    (m) =>
      m !== plume && (m.material as ShaderMaterial).isShaderMaterial === true,
  );
  return { meshes, shown, plume, ground };
}

function uniform(mesh: Mesh | undefined, name: string): unknown {
  const material = mesh?.material as ShaderMaterial | undefined;
  return material?.uniforms[name]?.value;
}

/** A canvas that records what is painted on it, for the plate. */
function fakeCanvas() {
  const painted: string[] = [];
  const g = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === "fillText") {
          return (text: string) => painted.push(text);
        }
        if (key === "measureText") {
          return (text: string) => ({ width: text.length * 30 });
        }
        return () => undefined;
      },
      set: () => true,
    },
  );
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => g,
  } as unknown as HTMLCanvasElement;
  return { canvas, painted };
}

function withPlate(mode: NarrationLookOptions["mode"] = "play"): ReturnType<
  typeof fakeCanvas
> & {
  options: NarrationLookOptions;
  texture: { needsUpdate: boolean; disposed: number } & Texture;
} {
  const fake = fakeCanvas();
  const texture = {
    needsUpdate: false,
    disposed: 0,
    isTexture: true,
    dispose() {
      texture.disposed += 1;
    },
  } as unknown as { needsUpdate: boolean; disposed: number } & Texture;
  return {
    ...fake,
    texture,
    options: {
      mode,
      title: "The column's story",
      plate: { canvas: fake.canvas, texture },
    },
  };
}

describe("narrationLook, the plume", () => {
  // Why: the plume is drawn once per circle beside the globe on a phone;
  // its particle count is the cost, so it is fixed and one draw.
  it("is a ground circle, one bounded instanced plume and an unseen tap target", () => {
    const look = narrationLook(6, { mode: "play" });
    const { shown, plume, ground } = partsOf(look.object);
    expect(shown).toHaveLength(2);
    expect(ground).toBeDefined();
    const geometry = plume?.geometry as InstancedBufferGeometry;
    expect(geometry.instanceCount).toBe(PLUME.count);
    expect(PLUME.count).toBeLessThanOrEqual(256);
    expect(geometry.getAttribute("aSeed").count).toBe(PLUME.count);
    expect(look.tapTarget.parent).toBe(look.object);
    expect(((look.tapTarget as Mesh).material as Material).visible).toBe(false);
    // Culled by a sphere that holds the whole rise.
    expect(geometry.boundingSphere?.radius).toBeGreaterThanOrEqual(
      PLUME.heightM / 2,
    );
    look.dispose();
  });

  // Why: the sounds keep the editor's warm glow; the plume and its rim
  // read the one palette the zone's glow does.
  it("draws in the warm glow's colours", () => {
    const look = narrationLook(6, { mode: "edit" });
    const { plume, ground } = partsOf(look.object);
    const rgb = (v: unknown) => {
      const c = v as { x: number; y: number; z: number };
      return [c.x, c.y, c.z];
    };
    expect(rgb(uniform(plume, "uColor"))).toEqual([...WARM_GLOW.glow]);
    expect(rgb(uniform(plume, "uSpark"))).toEqual([...WARM_GLOW.spark]);
    expect(rgb(uniform(ground, "uColor"))).toEqual([...WARM_GLOW.rim]);
    expect(rgb(uniform(ground, "uInk"))).toEqual([...WARM_GLOW.ink]);
    expect(uniform(ground, "uR")).toBe(6);
    look.dispose();
  });

  // Why: tick runs every frame for every circle; it may only write a few
  // uniforms, never a buffer the GPU would have to take again.
  it("ticks by uniforms alone: no buffer upload, the same objects", () => {
    const look = narrationLook(6, { mode: "play" });
    const { plume, ground } = partsOf(look.object);
    const seed = (plume?.geometry as InstancedBufferGeometry).getAttribute(
      "aSeed",
    );
    const version = seed.version;
    const plumeUniforms = (plume?.material as ShaderMaterial).uniforms;
    const before = uniform(plume, "uClock");
    look.tick(1);
    look.tick(1.05);
    expect(seed.version).toBe(version);
    expect((plume?.material as ShaderMaterial).uniforms).toBe(plumeUniforms);
    expect(uniform(plume, "uClock")).not.toBe(before);
    expect(uniform(ground, "uTime")).toBe(1.05);
    look.dispose();
  });

  // Why: the plume's pace says what the voice does: it hurries while the
  // voice plays and slows when paused; in the editor it stands still.
  it("rises faster while playing, slower when paused, and stands in the editor", () => {
    const rise = (state: NarrationState) => {
      const look = narrationLook(6, { mode: "play" });
      look.show(state, true);
      for (let i = 0; i <= 300; i += 1) look.tick(i / 30);
      const clock = uniform(partsOf(look.object).plume, "uClock") as number;
      look.dispose();
      return clock;
    };
    expect(rise("playing")).toBeGreaterThan(rise("idle"));
    expect(rise("idle")).toBeGreaterThan(rise("paused"));
    const still = narrationLook(6, { mode: "edit" });
    const at = uniform(partsOf(still.object).plume, "uClock");
    still.tick(10);
    expect(uniform(partsOf(still.object).plume, "uClock")).toBe(at);
    expect(uniform(partsOf(still.object).ground, "uState")).toBe(4);
    still.dispose();
  });

  // Why a property: whatever the page clock does (a tab left, a clock
  // running back), the plume never jumps or runs backwards.
  it("never steps its rise back or by more than a short frame", () => {
    const states: NarrationState[] = [
      "idle",
      "playing",
      "paused",
      "away",
      "heard",
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: -100, max: 1e5, noNaN: true }),
            fc.constantFrom(...states),
          ),
          { minLength: 1, maxLength: 40 },
        ),
        (frames) => {
          const look = narrationLook(6, { mode: "play" });
          const plume = partsOf(look.object).plume;
          let last = uniform(plume, "uClock") as number;
          for (const [seconds, state] of frames) {
            look.show(state, true);
            look.tick(seconds);
            const now = uniform(plume, "uClock") as number;
            expect(now).toBeGreaterThanOrEqual(last);
            expect(now - last).toBeLessThanOrEqual(0.1 * 1.6 + 1e-9);
            last = now;
          }
          look.dispose();
        },
      ),
    );
  });

  // Why: a heard narration dims, so a walk shows what is still to hear.
  it("tells the ground and the plume its state", () => {
    const look = narrationLook(6, { mode: "play" });
    const { plume, ground } = partsOf(look.object);
    look.show("heard", false);
    look.tick(0);
    expect(uniform(ground, "uState")).toBe(3);
    expect(uniform(plume, "uState")).toBe(3);
    look.show("playing", true);
    look.tick(0.1);
    expect(uniform(ground, "uState")).toBe(1);
    look.dispose();
  });
});

describe("narrationLook, the name plate", () => {
  // Why: words in the world are painted on a canvas, which costs a texture
  // upload: it is painted again only when its line changes.
  it("paints the title and its line, again only when the line changes", () => {
    const { options, painted, texture } = withPlate("play");
    const look = narrationLook(6, options);
    expect(partsOf(look.object).shown).toHaveLength(3);
    look.show("idle", false);
    expect(painted).toEqual(["The column's story", "Step into the circle"]);
    texture.needsUpdate = false;
    look.show("idle", false);
    look.tick(1);
    expect(painted).toHaveLength(2);
    expect(texture.needsUpdate).toBe(false);
    look.show("idle", true);
    expect(painted.slice(2)).toEqual([
      "The column's story",
      "Tap play on the card",
    ]);
    look.show("away", false);
    expect(painted.at(-1)).toBe("Paused, step back in");
    look.show("heard", false);
    expect(painted.at(-1)).toBe("Heard");
    look.dispose();
    expect(texture.disposed).toBe(1);
  });

  it("says what it is in the editor, at its radius", () => {
    const { options, painted } = withPlate("edit");
    const look = narrationLook(7.5, options);
    expect(painted).toEqual(["The column's story", "Narration, circle 7.5 m"]);
    look.dispose();
  });

  // Why: the plate turns to the one looking at it, about the vertical.
  it("faces a viewer about the vertical", () => {
    const { options } = withPlate("play");
    const look = narrationLook(6, options);
    const plate = partsOf(look.object).shown.find(
      (m) =>
        m !== partsOf(look.object).plume && m !== partsOf(look.object).ground,
    );
    look.face(1, 0);
    expect(plate?.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    look.face(0, 1);
    expect(plate?.rotation.y).toBeCloseTo(0, 6);
    look.dispose();
  });
});

describe("narrationLook, disposal", () => {
  // Why: circles come and go with their station; each must free what it
  // made or a walk leaks GPU memory.
  it("frees every geometry and material it made", () => {
    const look = narrationLook(6, { mode: "play" });
    const owned = new Set<{ dispose(): void }>();
    look.object.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh === true) {
        owned.add(m.geometry);
        owned.add(m.material as Material);
      }
    });
    let freed = 0;
    for (const thing of owned) {
      (
        thing as unknown as {
          addEventListener(t: string, f: () => void): void;
        }
      ).addEventListener("dispose", () => {
        freed += 1;
      });
    }
    look.dispose();
    expect(freed).toBe(owned.size);
  });
});
