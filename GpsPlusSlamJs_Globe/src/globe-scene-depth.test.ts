/**
 * The scene depth, moved out of the globe lab.
 *
 * Why this file matters: the cloud volume's march and the space pass's
 * rays end at this depth, and it is drawn from the relief's own meshes with
 * their colour writes turned off for the pass. A colour write left off
 * would blank the relief in the next frame; a render target or auto-clear
 * left changed would draw the rest of the frame into the depth target; a
 * near plane taken from the view camera would clip the cloud deck away in
 * every view down. These tests pin each of those under Node with a
 * recording fake renderer. The depth's look is the lab's smokes and the
 * reference captures.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createGlobeSceneDepth } from "./globe-scene-depth.js";

/** A renderer that records its draws and what each mesh wrote meanwhile. */
const fakeRenderer = () => {
  const log: string[] = [];
  const outside = new THREE.WebGLRenderTarget(1, 1);
  let target: THREE.WebGLRenderTarget | null = outside;
  const seen: THREE.WebGLRenderTarget[] = [];
  const renderer = {
    autoClear: true,
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
      if (next !== null) seen.push(next);
    },
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(320, 200),
    clear: (color: boolean, depth: boolean, stencil: boolean) => {
      log.push(`clear ${color} ${depth} ${stencil}`);
    },
    render: (scene: THREE.Object3D, camera: THREE.Camera) => {
      const writes: boolean[] = [];
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m !== undefined && !Array.isArray(m)) writes.push(m.colorWrite);
      });
      log.push(
        `render ${scene.name} near ${(camera as THREE.PerspectiveCamera).near} autoClear ${renderer.autoClear} into ${target === outside ? "outside" : "depth"} writes ${writes.join(",")}`,
      );
    },
  };
  return {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    raw: renderer,
    log,
    outside,
    current: () => target,
    seen,
  };
};

const mesh = (colorWrite = true) => {
  const material = new THREE.MeshBasicMaterial();
  material.colorWrite = colorWrite;
  return new THREE.Mesh(new THREE.BufferGeometry(), material);
};

const viewCamera = (near: number) => {
  const camera = new THREE.PerspectiveCamera(50, 1.6, near, 1e7);
  camera.position.set(1, 2, 3);
  return camera;
};

describe("createGlobeSceneDepth", () => {
  // The pass draws the relief and the extras with their colour writes off,
  // into its own target, auto-clear off, after clearing depth only; then
  // gives everything back as it was.
  it("draws the relief and extras depth-only and restores the renderer and the materials", () => {
    const { renderer, raw, log, outside, current } = fakeRenderer();
    const depth = createGlobeSceneDepth(renderer);
    const relief = new THREE.Group();
    relief.name = "relief";
    const a = mesh();
    const b = mesh();
    relief.add(a, b);
    const city = new THREE.Group();
    city.name = "city";
    const c = mesh();
    city.add(c);
    depth.render(viewCamera(2800), relief, [city]);
    expect(log).toEqual([
      "clear false true false",
      "render relief near 10 autoClear false into depth writes false,false",
      "render city near 10 autoClear false into depth writes false",
    ]);
    for (const m of [a, b, c]) {
      expect((m.material as THREE.Material).colorWrite).toBe(true);
    }
    expect(current()).toBe(outside);
    expect(raw.autoClear).toBe(true);
  });

  // A material that never wrote colour stays off: the pass turns back on
  // only what it turned off. A material array is left alone, as the lab
  // did (its `colorWrite` is undefined).
  it("restores only the colour writes it turned off and leaves material arrays alone", () => {
    const { renderer } = fakeRenderer();
    const depth = createGlobeSceneDepth(renderer);
    const off = mesh(false);
    const many = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshBasicMaterial(),
    ]);
    const relief = new THREE.Group();
    relief.add(off, many);
    depth.render(viewCamera(5), relief);
    expect((off.material as THREE.Material).colorWrite).toBe(false);
    expect((many.material as THREE.Material[])[0]?.colorWrite).toBe(true);
  });

  // Its own near plane is the view camera's capped at 10 m, so a deck
  // nearer than the ground's fitted near plane is still in the depth.
  it("draws with the view camera's pose and a near plane of at most 10 m", () => {
    const { renderer } = fakeRenderer();
    const depth = createGlobeSceneDepth(renderer);
    const far = viewCamera(2800);
    depth.render(far, new THREE.Group());
    expect(depth.camera.near).toBe(10);
    expect(depth.camera.position.toArray()).toEqual([1, 2, 3]);
    expect(depth.camera.projectionMatrix.equals(far.projectionMatrix)).toBe(
      false,
    );
    depth.render(viewCamera(0.5), new THREE.Group());
    expect(depth.camera.near).toBe(0.5);
    expect(depth.state().near).toBe(0.5);
  });

  // The callers draw the depth once a frame: `fresh` says it is drawn,
  // `beginFrame` says it is not, and the frames are counted.
  it("tracks whether this frame's depth is drawn", () => {
    const { renderer } = fakeRenderer();
    const depth = createGlobeSceneDepth(renderer);
    expect(depth.fresh).toBe(false);
    depth.render(viewCamera(1), new THREE.Group());
    expect(depth.fresh).toBe(true);
    depth.beginFrame();
    expect(depth.fresh).toBe(false);
    depth.render(viewCamera(1), new THREE.Group());
    expect(depth.state()).toEqual({ frames: 2, fresh: true, near: 1 });
  });

  // The target follows the drawing buffer, and the depth texture is the
  // one a reader was handed at construction.
  it("sizes its target to the drawing buffer and keeps its texture", () => {
    const { renderer, seen, outside } = fakeRenderer();
    const depth = createGlobeSceneDepth(renderer);
    const texture = depth.texture;
    expect(texture).toBeInstanceOf(THREE.DepthTexture);
    depth.render(viewCamera(1), new THREE.Group());
    expect(depth.texture).toBe(texture);
    const drawnInto = seen.find((t) => t !== outside);
    expect(drawnInto?.depthTexture).toBe(texture);
    expect([drawnInto?.width, drawnInto?.height]).toEqual([320, 200]);
    depth.dispose();
  });
});
