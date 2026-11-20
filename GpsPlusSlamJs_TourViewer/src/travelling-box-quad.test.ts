import { describe, expect, it } from "vitest";
import type { BufferAttribute, WebGLRenderer } from "three";
import { Group, PerspectiveCamera, Scene, Texture } from "three";

import { createTravellingBoxQuad } from "./travelling-box-quad.js";

describe("createTravellingBoxQuad", () => {
  // Why this test matters: the quad maps the one words texture by its
  // corners in clip space; a uv or index order that differs from the
  // corner order (TL, TR, BL, BR) draws the words mirrored or as two
  // crossed triangles, which only a pixel look would otherwise catch.
  it("carries the corner order, uv and index of the prototype's quad", () => {
    const quad = createTravellingBoxQuad(() => undefined);
    const g = quad.mesh.geometry;
    const clip = g.getAttribute("clipPos") as BufferAttribute;
    expect(clip.itemSize).toBe(4);
    expect(clip.count).toBe(4);
    expect([...(g.getAttribute("uv") as BufferAttribute).array]).toEqual([
      0, 1, 1, 1, 0, 0, 1, 0,
    ]);
    expect([...(g.getIndex()?.array ?? [])]).toEqual([0, 2, 1, 2, 3, 1]);
    expect(g.getAttribute("position").count).toBe(4);
  });

  // Why: the quad is drawn over everything as one more mesh of the scene
  // (no second pass); a depth test, a frustum cull or a ray on it would
  // hide it behind the world, drop it at the screen's edge or let it
  // steal a tap meant for the world.
  it("draws last, over the world, never culled and never picked", () => {
    const quad = createTravellingBoxQuad(() => undefined);
    const m = quad.mesh.material;
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.vertexShader).toContain("gl_Position = clipPos");
    expect(m.fragmentShader).toContain("#include <colorspace_fragment>");
    expect(quad.mesh.frustumCulled).toBe(false);
    expect(quad.mesh.renderOrder).toBeGreaterThanOrEqual(1000);
    const hits: unknown[] = [];
    quad.mesh.raycast({} as never, hits as never);
    expect(hits).toEqual([]);
  });

  // Why: the corners are written for the camera of the render that draws
  // them (the XR eye's), not for one measured earlier, so the quad sits
  // on the plate with no frame of lag.
  it("writes the corners for the render's camera before each draw", () => {
    const seen: unknown[] = [];
    const quad = createTravellingBoxQuad((camera, out) => {
      seen.push(camera);
      out.set([1, 2, 3, 4], 0);
    });
    const clip = quad.mesh.geometry.getAttribute("clipPos") as BufferAttribute;
    const version = clip.version;
    const camera = new PerspectiveCamera();
    quad.mesh.onBeforeRender(
      {} as WebGLRenderer,
      new Scene(),
      camera,
      quad.mesh.geometry,
      quad.mesh.material,
      new Group(),
    );
    expect(seen).toEqual([camera]);
    expect([...clip.array].slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(clip.version).toBeGreaterThan(version);
  });

  it("takes the texture and the opacity, and frees its GPU parts", () => {
    const quad = createTravellingBoxQuad(() => undefined);
    const texture = new Texture();
    quad.setMap(texture);
    quad.setOpacity(0.4);
    const m = quad.mesh.material;
    expect(m.uniforms.map?.value).toBe(texture);
    expect(m.uniforms.opacity?.value).toBe(0.4);
    let freed = 0;
    quad.mesh.geometry.addEventListener("dispose", () => (freed += 1));
    m.addEventListener("dispose", () => (freed += 1));
    quad.dispose();
    expect(freed).toBe(2);
  });
});
