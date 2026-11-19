/**
 * Why these tests matter: the globe's debug layer must stay one draw for
 * the thumbnails and one for the line however long the walk, put each
 * thumbnail in its own atlas cell (two sharing one would show the wrong
 * picture at a place), keep a capture without its thumbnail a dot, and
 * free its GPU objects when it is replaced or the view closes - a long
 * walk's atlas is 16 MB of texture.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ATLAS_MAX_PX,
  THUMB_WIDTH_PX,
  atlasCell,
  atlasLayout,
  createGlobeDebugLayer,
  type AtlasSurface,
} from "./globe-debug-layer.js";

function fakeSurface() {
  const draws: { x: number; y: number; w: number; h: number }[] = [];
  let px = 0;
  const surface: AtlasSurface = {
    image: { source: null, width: 1, height: 1 },
    reset(size) {
      px = size;
      draws.length = 0;
    },
    draw(_source, x, y, w, h) {
      draws.push({ x, y, w, h });
    },
  };
  return { surface, draws, px: () => px };
}

const at = (x: number) => new THREE.Vector3(x, 0, 0);
const captures = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    image: `img-${String(i)}`,
    at: at(i),
  }));

describe("atlasLayout", () => {
  it("fits every capture in a square of cells, a power of two, at most the cap", () => {
    expect(atlasLayout(2)).toEqual({ px: 128, cellPx: 64, columns: 2 });
    expect(atlasLayout(1000)).toEqual({ px: 2048, cellPx: 64, columns: 32 });
    const long = atlasLayout(5000);
    expect(long.px).toBe(ATLAS_MAX_PX);
    expect(long.columns * long.columns).toBeGreaterThanOrEqual(5000);
    expect(long.columns * long.cellPx).toBeLessThanOrEqual(ATLAS_MAX_PX);
  });

  it("takes a count that is no number as one capture", () => {
    expect(atlasLayout(Number.NaN)).toEqual(atlasLayout(1));
    expect(atlasLayout(-3)).toEqual(atlasLayout(1));
  });
});

describe("atlasCell", () => {
  it("keeps the picture's aspect inside its cell, and its texture place flipped", () => {
    const layout = atlasLayout(4);
    // A landscape picture in the second row's first cell.
    const c = atlasCell(layout, 2, 64, 48);
    expect(c).toMatchObject({ x: 0, y: 64, w: 64, h: 48 });
    // Inset half a texel, so the filter never reads the next cell.
    expect(c.uv).toEqual([0.5 / 128, 1 - 111.5 / 128, 63 / 128, 47 / 128]);
    // A picture one pixel wide keeps its texel.
    expect(atlasCell(layout, 0, 1, 64).uv[2]).toBe(1 / 128);
    // A portrait one fits by its height.
    expect(atlasCell(layout, 1, 48, 64)).toMatchObject({
      x: 64,
      y: 0,
      w: 48,
      h: 64,
    });
  });
});

describe("createGlobeDebugLayer", () => {
  it("draws the captures as one mesh and the walk as one line, under the given frame", () => {
    const parent = new THREE.Group();
    const { surface } = fakeSurface();
    const layer = createGlobeDebugLayer(parent, surface);
    layer.set(captures(5), true);
    const group = parent.getObjectByName("debug-layer");
    expect(group?.children.map((c) => c.name).sort()).toEqual([
      "debug-thumbs",
      "debug-walk",
    ]);
    const mesh = parent.getObjectByName(
      "debug-thumbs",
    ) as THREE.Mesh<THREE.InstancedBufferGeometry>;
    expect(mesh.geometry.instanceCount).toBe(5);
    expect(layer.stats()).toMatchObject({
      captures: 5,
      thumbs: 0,
      linePoints: 5,
      atlasPx: 256,
      objects: 2,
    });
  });

  it("hands the GPU the captures relative to their first one, so a scan far from the frame keeps its place", () => {
    // A 32-bit attribute 8000 km from the frame's centre is rounded to
    // half a metre, which jitters on screen (globe-debug-precision.test.ts);
    // the anchor goes into the object's 64-bit position instead.
    const parent = new THREE.Group();
    const { surface } = fakeSurface();
    const layer = createGlobeDebugLayer(parent, surface);
    const far = new THREE.Vector3(5e6, -4e6, 4.5e6);
    layer.set(
      [0, 1, 2].map((i) => ({
        image: `far-${String(i)}`,
        at: far.clone().add(new THREE.Vector3(i * 10, 0.5, -i * 3)),
      })),
      true,
    );
    const mesh = parent.getObjectByName(
      "debug-thumbs",
    ) as THREE.Mesh<THREE.InstancedBufferGeometry>;
    const line = parent.getObjectByName("debug-walk") as THREE.Object3D;
    const anchor = far
      .clone()
      .add(new THREE.Vector3(0, 0.5, 0))
      .toArray();
    expect(mesh.position.toArray()).toEqual(anchor);
    expect(line.position.toArray()).toEqual(anchor);
    expect(Array.from(mesh.geometry.getAttribute("center").array)).toEqual([
      0, 0, 0, 10, 0, -3, 20, 0, -6,
    ]);
    const start = (
      line as unknown as { geometry: THREE.BufferGeometry }
    ).geometry.getAttribute("instanceStart");
    expect(start.getX(1)).toBe(10);
    expect(start.getY(1)).toBeCloseTo(0.05, 6);
    expect(start.getZ(1)).toBe(-3);
  });

  it("draws no line when not asked (the tour's own walk is drawn already), nor for one capture", () => {
    const parent = new THREE.Group();
    const layer = createGlobeDebugLayer(parent, fakeSurface().surface);
    layer.set(captures(3), false);
    expect(parent.getObjectByName("debug-walk")).toBeUndefined();
    layer.set(captures(1), true);
    expect(parent.getObjectByName("debug-walk")).toBeUndefined();
    expect(layer.stats().linePoints).toBe(0);
  });

  it("puts a thumbnail in its capture's cell at the map's width, once", () => {
    const { surface, draws } = fakeSurface();
    const parent = new THREE.Group();
    const layer = createGlobeDebugLayer(parent, surface);
    layer.set(captures(4), false);
    expect(layer.thumb("img-3", { source: null, width: 64, height: 48 })).toBe(
      true,
    );
    expect(draws).toEqual([{ x: 64, y: 64, w: 64, h: 48 }]);
    expect(layer.hasThumb("img-3")).toBe(true);
    // Its instance samples its cell; the others stay dots (no cell).
    const cells = (
      parent.getObjectByName(
        "debug-thumbs",
      ) as THREE.Mesh<THREE.InstancedBufferGeometry>
    ).geometry.getAttribute("cell");
    expect(cells.getX(3)).toBeCloseTo(64.5 / 128);
    expect(cells.getZ(3)).toBeGreaterThan(0);
    expect([0, 1, 2].map((i) => cells.getZ(i))).toEqual([0, 0, 0]);
    expect(layer.thumb("img-3", { source: null, width: 64, height: 48 })).toBe(
      false,
    );
    expect(layer.thumb("nobody", { source: null, width: 64, height: 48 })).toBe(
      false,
    );
    expect(layer.thumb("img-0", { source: null, width: 0, height: 48 })).toBe(
      false,
    );
    expect(layer.stats().thumbs).toBe(1);
  });

  it("uploads the atlas at most every quarter second while thumbnails come", () => {
    const layer = createGlobeDebugLayer(
      new THREE.Group(),
      fakeSurface().surface,
    );
    layer.set(captures(3), false);
    layer.frame(0);
    expect(layer.stats().uploads).toBe(0);
    layer.thumb("img-0", { source: null, width: 64, height: 48 });
    layer.frame(1000);
    layer.thumb("img-1", { source: null, width: 64, height: 48 });
    layer.frame(1100);
    expect(layer.stats().uploads).toBe(1);
    layer.frame(1300);
    expect(layer.stats().uploads).toBe(2);
    layer.frame(2000);
    expect(layer.stats().uploads).toBe(2);
  });

  it("drops a capture without a finite point and a name drawn twice", () => {
    const layer = createGlobeDebugLayer(
      new THREE.Group(),
      fakeSurface().surface,
    );
    layer.set(
      [
        { image: "a", at: at(1) },
        { image: "b", at: new THREE.Vector3(Number.NaN, 0, 0) },
        { image: "a", at: at(2) },
        { image: "c", at: at(3) },
      ],
      true,
    );
    expect(layer.stats()).toMatchObject({ captures: 2, linePoints: 2 });
  });

  it("hides and shows the whole layer", () => {
    const parent = new THREE.Group();
    const layer = createGlobeDebugLayer(parent, fakeSurface().surface);
    layer.set(captures(2), true);
    layer.show(false);
    expect(parent.getObjectByName("debug-layer")?.visible).toBe(false);
    expect(layer.stats().shown).toBe(false);
    layer.show(true);
    expect(parent.getObjectByName("debug-layer")?.visible).toBe(true);
  });

  it("frees its geometry and atlas when replaced, and everything on dispose", () => {
    const parent = new THREE.Group();
    const { surface, px } = fakeSurface();
    const layer = createGlobeDebugLayer(parent, surface);
    layer.set(captures(3), true);
    const freed: string[] = [];
    const watch = (o: THREE.Object3D | undefined, name: string) => {
      const m = o as THREE.Mesh | undefined;
      m?.geometry.addEventListener("dispose", () => freed.push(`${name}-geo`));
      (m?.material as THREE.Material | undefined)?.addEventListener(
        "dispose",
        () => freed.push(`${name}-mat`),
      );
    };
    watch(parent.getObjectByName("debug-thumbs"), "thumbs");
    watch(parent.getObjectByName("debug-walk"), "walk");
    const atlas = (
      parent.getObjectByName("debug-thumbs") as THREE.Mesh<
        THREE.InstancedBufferGeometry,
        THREE.ShaderMaterial
      >
    ).material.uniforms["atlas"]?.value as THREE.Texture;
    atlas.addEventListener("dispose", () => freed.push("atlas"));
    layer.set(null, true);
    // The atlas's texture and its pixels go with the drawing: a long
    // walk's are 16 MB each.
    expect(freed.sort()).toEqual(["atlas", "thumbs-geo", "walk-geo"]);
    expect(px()).toBe(1);
    expect(layer.stats()).toMatchObject({
      captures: 0,
      objects: 0,
      atlasPx: 0,
    });
    layer.set(captures(2), true);
    layer.dispose();
    expect(freed).toContain("thumbs-mat");
    expect(freed).toContain("walk-mat");
    expect(parent.children).toHaveLength(0);
  });

  it("sizes the thumbnails on screen by the canvas", () => {
    const parent = new THREE.Group();
    const layer = createGlobeDebugLayer(parent, fakeSurface().surface);
    layer.set(captures(2), false);
    layer.resize(800, 600);
    layer.thumb("img-0", { source: null, width: 64, height: 48 });
    const mesh = parent.getObjectByName("debug-thumbs") as THREE.Mesh<
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >;
    expect(mesh.material.uniforms["resolution"]?.value).toEqual(
      new THREE.Vector2(800, 600),
    );
    const sizes = mesh.geometry.getAttribute("sizePx");
    expect([sizes.getX(0), sizes.getY(0)]).toEqual([
      THUMB_WIDTH_PX,
      THUMB_WIDTH_PX * 0.75,
    ]);
    // Not yet thumbnailed: a dot.
    expect([sizes.getX(1), sizes.getY(1)]).toEqual([8, 8]);
  });
});
