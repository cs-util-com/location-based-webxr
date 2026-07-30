/**
 * One row per drawable mesh layer — what it builds, and what it counts.
 *
 * WHY THIS EXISTS. `BuildingView.render` was a branch per layer: one to decide
 * whether to draw it, and one ternary per counter to zero its contribution when it
 * was off. That is two edits in two places for every new layer, and it had reached
 * complexity 21 with three layers on the board. W12 (POI), W13 (roads), W14 (area
 * slabs) and W15 (filled regions) are four more, so the branchy form was going to be
 * rewritten anyway — doing it before W13 is the cheap moment (filed as the
 * complexity follow-up, 2026-07-30).
 *
 * WHAT THE TABLE BUYS BEYOND TIDINESS. The per-layer work was always the same four
 * steps — is it on, does it have anything, build it, count it — but written out
 * longhand each time, so nothing could check that a layer had all four. A row either
 * exists or it does not, and `mesh-layers.test.ts` asserts the set of rows equals
 * `DRAWN_BY_MESH`. **A layer missing from the table draws nothing, counts nothing
 * and throws nothing** — indistinguishable from a layer whose data was empty. That
 * is the same silent-absence shape as the shader outage, so it gets a real
 * assertion rather than a comment.
 *
 * WHY THE ROWS BUILD `three` OBJECTS DIRECTLY, unlike `sky-gradient.ts` which stops
 * at pixels. That split exists where there is ARITHMETIC worth proving without a
 * GPU — a colour ramp can be upside down or non-monotonic and still look
 * deliberate. Wrapping a `Float32Array` the worker already validated in a
 * `BufferGeometry` has no such arithmetic; the parts here that can be wrong are
 * coverage, defaults, counters and the ground lift, and all four are asserted
 * without a WebGL context. three's geometry and material classes are plain JS and
 * construct fine in vitest.
 *
 * @see mesh-layers.ts.md
 */

import * as THREE from "three";
import type { MeshData } from "gps-plus-slam-osm";

import { groundLift } from "./layer-order.js";
import type { LayerSet } from "./layers.js";
import type { TransferableMesh } from "./worker/protocol.js";

/**
 * The layers whose geometry comes out of the worker's mesh.
 *
 * The rest of `ALL_LAYERS` is drawn by other means — `cells` and `areas` are the
 * affordance overlays built by `cell-mesh.ts`, `terrainDebug` re-colours the ground
 * plane, and `roads` has no builder yet. This constant is the declared truth the
 * table is checked against, so adding a builder means adding its id HERE and the
 * test tells you the row is missing. That is not hypothetical: adding `poi` here
 * before writing its row turned the coverage test red, which is the guard working.
 */
export const DRAWN_BY_MESH = [
  "buildings",
  "trees",
  "plates",
  "poi",
  "roads",
  "areas",
] as const;

/** Not exported: nothing outside this module needs to name it, and knip is right
 * to say so. It is reachable through `MeshLayerDescriptor["layer"]` if that ever
 * changes. */
type MeshLayerKind = (typeof DRAWN_BY_MESH)[number];

/**
 * Which of the mesh layers to draw.
 *
 * Partial on purpose: an omitted layer falls back to its row's `defaultOn`, which
 * is what lets an omitted argument reproduce the picture the demo shipped with.
 */
export type MeshLayers = Partial<Record<MeshLayerKind, boolean>>;

export interface BuildingStats {
  readonly volumes: number;
  readonly parts: number;
  readonly triangles: number;
  readonly guessedHeights: number;
  /** Roofs generated from the bounding rectangle rather than exactly. */
  readonly approximateRoofs: number;
  readonly trees: number;
  /** Ground areas drawn. Reported because a silent 0 is the failure mode. */
  readonly plates: number;
  /** Their merged triangle count — a non-zero plate count with zero triangles
   * is a distinct failure from no plates at all, and only the pair tells them
   * apart. */
  readonly plateTriangles: number;
  /** POI markers drawn (W12). */
  readonly poi: number;
  /** Merged affordance regions drawn as slabs (W14). */
  readonly areas: number;
  /** Road ways drawn (W13). */
  readonly roads: number;
  /** Their merged triangle count — the same built-versus-drawn pair as plates. */
  readonly roadTriangles: number;
}

/**
 * Every counter at zero.
 *
 * The base for every result, so a layer that is off simply never overwrites its
 * own fields. That is the mechanism replacing eight `wantX ? n : 0` ternaries, and
 * it is also why the stats object is always fully populated: a missing key reads as
 * `undefined` in the status line and silently satisfies `toBeGreaterThan`.
 */
const NO_STATS: BuildingStats = {
  volumes: 0,
  parts: 0,
  triangles: 0,
  guessedHeights: 0,
  approximateRoofs: 0,
  trees: 0,
  plates: 0,
  plateTriangles: 0,
  poi: 0,
  areas: 0,
  roads: 0,
  roadTriangles: 0,
};

/**
 * What a layer needs beyond the mesh itself.
 *
 * Exists for exactly one reason: W14's region slabs are coloured by
 * `medianScore`, and **the 2D map and the 3D view must never be able to disagree
 * about what a score looks like.** The demo owns one `heatScale`/`heatColour`
 * pair, both views read it, and it is handed in here rather than reimplemented —
 * a second colour function would be a second source of truth for the same
 * question, which is the whole reason the store exists.
 */
export interface MeshLayerContext {
  /** The 2D map's colour for a score, as a packed `0xrrggbb`. */
  readonly colourForScore: (score: number) => number;
}

/**
 * The fallback context.
 *
 * A VISIBLY WRONG magenta rather than a plausible grey, because the only way to
 * reach it is for a caller to forget the real scale — and a plausible colour
 * would make that mistake look like a design choice. The same reasoning as
 * `NO_DATA_RGB` in `height-ramp.ts`.
 */
const NEUTRAL_CONTEXT: MeshLayerContext = { colourForScore: () => 0xff00ff };

/** What one drawable layer contributes to the scene and to the status line. */
export interface MeshLayerDescriptor {
  readonly layer: MeshLayerKind;
  /**
   * Whether an omitted selection draws it.
   *
   * `true` for the two layers the demo shipped with, `false` for everything added
   * since — a new layer that switched itself on would destroy the known-good
   * baseline that makes the registry migration checkable at all (W10).
   */
  readonly defaultOn: boolean;
  /** Objects to add to the scene. Empty when the layer has nothing to draw. */
  build(mesh: TransferableMesh, context: MeshLayerContext): THREE.Object3D[];
  /** The counters this layer owns, supplied only when it is drawn. */
  counters(mesh: TransferableMesh): Partial<BuildingStats>;
}

/**
 * Where a tree's cone stands in the scene, from its ENU placement.
 *
 * Kept as its own function because it is the one part of the tree loop that can be
 * proved without a GPU, and the part that fails silently: see
 * `building-view.test.ts`.
 */
export function treeConePosition(
  tree: TransferableMesh["trees"][number],
): [x: number, y: number, z: number] {
  return [
    tree.position.x,
    // `ConeGeometry` is centred on its origin, so the base sits on the terrain
    // sample only if the centre is half a height above it.
    tree.groundHeightM + tree.heightM / 2,
    // ENU y is north; the scene's -z is north (`mesh-data.ts`), the same
    // reflection `cell-mesh.ts` and `MeshBuilder` apply. Without it a tree 50 m
    // north renders 50 m SOUTH — 100 m from the building it stands next to.
    -tree.position.y,
  ];
}

/**
 * Where a POI marker's pin stands, from its ENU placement.
 *
 * The same `+y` north to `-z` north reflection `treeConePosition` applies, and it
 * fails the same silent way: a marker 50 m north of a shop renders 50 m south of
 * it, labelled correctly, looking like a data error rather than a frame error.
 * The pin is a cone standing ON the ground, so its centre sits half its height up.
 */
export function poiMarkerPosition(
  marker: TransferableMesh["poi"][number],
): [x: number, y: number, z: number] {
  return [
    marker.position.x,
    marker.groundHeightM + POI_HEIGHT_M / 2,
    -marker.position.y,
  ];
}

/** Height of a marker pin, metres. Tall enough to clear a hedge, short enough
 * not to compete with the buildings. */
const POI_HEIGHT_M = 6;

/**
 * ONE geometry and ONE material, SHARED by every pin.
 *
 * Markers are numerous and identical, which is the whole reason the package emits
 * placements rather than geometry. Sharing here is also why `clear()` must not
 * dispose them — see the note in `building-view.ts`.
 */
const POI_GEOMETRY = new THREE.ConeGeometry(1.6, POI_HEIGHT_M, 5);
const POI_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffb454,
  flatShading: true,
  roughness: 0.5,
});

/** Wraps worker buffers in a geometry. The buffers are already validated. */
function geometryFrom(data: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(data.positions, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geometry;
}

/**
 * The table. Order here is construction order only — `layer-order.ts` owns the
 * vertical ladder, and paint order at ground level follows from it.
 */
export const MESH_LAYERS: readonly MeshLayerDescriptor[] = [
  {
    layer: "buildings",
    defaultOn: true,
    build: (mesh) =>
      mesh.buildings.triangleCount === 0
        ? []
        : [
            new THREE.Mesh(
              geometryFrom(mesh.buildings),
              new THREE.MeshStandardMaterial({
                color: 0xc8ccd8,
                // Double-sided because OSM volumes are not reliably closed — a
                // `building:part` with no floor, or a footprint the triangulator
                // could only partly cut, shows as a hole under culling for reasons
                // that have nothing to do with this package's correctness.
                //
                // IT DOES NOT VALIDATE WINDING — it hides it. Every wall quad in
                // the package was wound inside-out when this view was written and
                // it looked entirely fine here, which is why orientation is now
                // pinned by `mesh-orientation.test.ts` instead of by looking.
                side: THREE.DoubleSide,
                flatShading: true,
              }),
            ),
          ],
    counters: (mesh) => ({
      volumes: mesh.volumes,
      parts: mesh.parts,
      triangles: mesh.buildings.triangleCount,
      guessedHeights: mesh.guessedHeights,
      approximateRoofs: mesh.approximateRoofs,
    }),
  },
  {
    layer: "plates",
    // OFF by default, unlike buildings and trees: it is a layer added after the
    // baseline, and an omitted argument has to keep reproducing that baseline.
    defaultOn: false,
    build: (mesh) => {
      if (mesh.plates.triangleCount === 0) return [];
      const plate = new THREE.Mesh(
        geometryFrom(mesh.plates),
        new THREE.MeshStandardMaterial({
          color: 0x4a5468,
          roughness: 0.85,
          flatShading: true,
          // SINGLE-SIDED, unlike the buildings. A plate is horizontal with an
          // upward normal by construction, so a back face is never legitimately
          // visible — and culling it means a plate wound the wrong way DISAPPEARS
          // instead of being silently lit from below, which is the failure worth
          // noticing rather than hiding.
          side: THREE.FrontSide,
        }),
      );
      // From the shared ladder, so it cannot be coplanar with the roads or grid.
      plate.position.y = groundLift("plates");
      return [plate];
    },
    counters: (mesh) => ({
      plates: mesh.plateCount,
      plateTriangles: mesh.plates.triangleCount,
    }),
  },
  {
    layer: "trees",
    defaultOn: true,
    build: (mesh) =>
      mesh.trees.map((tree) => {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(tree.crownDiameterM / 2, tree.heightM, 6),
          new THREE.MeshStandardMaterial({ color: 0x3f7d4a }),
        );
        cone.position.set(...treeConePosition(tree));
        cone.rotation.y = tree.rotationY;
        return cone;
      }),
    counters: (mesh) => ({ trees: mesh.trees.length }),
  },
  {
    layer: "areas",
    // OFF by default like every layer added after the W10 baseline. It is also
    // the layer the round-1 feedback missed entirely, which is why W15 fills the
    // 2D outline at the same time — the same claim, drawn in both views.
    defaultOn: false,
    build: (mesh, context) =>
      mesh.regions
        .filter((slab) => slab.mesh.triangleCount > 0)
        .map((slab) => {
          const object = new THREE.Mesh(
            geometryFrom(slab.mesh),
            new THREE.MeshStandardMaterial({
              // THE SAME COLOUR THE MAP DRAWS, through the same function. A
              // region that reads as "good" in 2D and "poor" in 3D is the exact
              // cross-view disagreement the store was introduced to prevent.
              color: context.colourForScore(slab.medianScore),
              roughness: 0.8,
              flatShading: true,
              transparent: true,
              // Translucent so the ground and the buildings inside a region stay
              // readable through it — a region is a claim ABOUT the ground, not
              // a replacement for it.
              opacity: 0.55,
              side: THREE.DoubleSide,
            }),
          );
          object.position.y = groundLift("areas");
          return object;
        }),
    counters: (mesh) => ({ areas: mesh.regions.length }),
  },
  {
    layer: "roads",
    defaultOn: false,
    build: (mesh) => {
      if (mesh.roads.triangleCount === 0) return [];
      const ribbon = new THREE.Mesh(
        geometryFrom(mesh.roads),
        new THREE.MeshStandardMaterial({
          // LIGHTER than the ground, not darker, and that was a measurement
          // rather than a preference. The first attempt was 0x2f333d — asphalt
          // reasoning — but the ground renders at rgb(40,40,56) under this
          // scene's lighting, so a darker road landed within a few levels of it
          // and switching the layer on changed 77 pixels out of 460 800. A road
          // that cannot be told from the ground it lies on is a failed layer
          // whatever the test says.
          color: 0x8b909c,
          roughness: 0.9,
          // OPAQUE, and DEC-R2-13 depends on it. The disc at each vertex overlaps
          // the segment quads it joins; in translucent geometry that overlap would
          // double-blend into a visible blob at every junction.
          transparent: false,
          // SINGLE-SIDED for the same reason as the plates: a ribbon is
          // horizontal with an upward normal by construction, so a wrongly-wound
          // one should disappear rather than be lit from below.
          side: THREE.FrontSide,
          flatShading: true,
        }),
      );
      ribbon.position.y = groundLift("roads");
      return [ribbon];
    },
    counters: (mesh) => ({
      roads: mesh.roadCount,
      roadTriangles: mesh.roads.triangleCount,
    }),
  },
  {
    layer: "poi",
    // OFF by default. Every layer added after the W10 baseline is, so that an
    // omitted selection still reproduces the picture the demo shipped with.
    defaultOn: false,
    build: (mesh) =>
      mesh.poi.map((marker) => {
        const pin = new THREE.Mesh(POI_GEOMETRY, POI_MATERIAL);
        pin.position.set(...poiMarkerPosition(marker));
        // The identity a pick reads back. Stored on the object rather than in a
        // side table keyed by index, because `clear()` and the next render
        // rebuild the scene and an index-keyed table survives that silently while
        // pointing at the previous working set — the half-swapped scene, in its
        // most damaging form: a panel confidently describing the wrong feature.
        // `sharedResources` tells the scene owner this object's geometry and
        // material are BORROWED, not its own to free. `BuildingView.clear()`
        // disposes both for every child it removes, which for a shared resource
        // means the first refresh destroys it and every later frame silently draws
        // nothing — three.js does not throw for a disposed geometry.
        pin.userData = { poi: marker, sharedResources: true };
        return pin;
      }),
    counters: (mesh) => ({ poi: mesh.poi.length }),
  },
];

/**
 * Builds every enabled layer, and the counters describing exactly what was built.
 *
 * The counters describe WHAT WAS DRAWN, not what was available. A status line
 * reporting 400 buildings while the buildings layer is off would be the status line
 * lying about the picture, which is the class of defect the legend and the store
 * exist to prevent.
 */
export function drawMeshLayers(
  mesh: TransferableMesh,
  layers?: MeshLayers,
  context: MeshLayerContext = NEUTRAL_CONTEXT,
): { objects: THREE.Object3D[]; stats: BuildingStats } {
  const objects: THREE.Object3D[] = [];
  let stats = NO_STATS;
  for (const descriptor of MESH_LAYERS) {
    if (!(layers?.[descriptor.layer] ?? descriptor.defaultOn)) continue;
    objects.push(...descriptor.build(mesh, context));
    stats = { ...stats, ...descriptor.counters(mesh) };
  }
  return { objects, stats };
}

/**
 * Narrows the registry's full layer set to the mesh layers.
 *
 * Exists so `main.ts` does not hand-list them a second time. It listed them twice
 * before — once to decide whether any mesh layer was wanted, once to build the
 * argument — so adding a layer meant remembering two places, and forgetting one
 * gave a layer that could be toggled in the UI but never drew.
 */
export function meshLayerSelection(layers: LayerSet): MeshLayers {
  return Object.fromEntries(
    MESH_LAYERS.map((descriptor) => [
      descriptor.layer,
      layers[descriptor.layer],
    ]),
  );
}

/** Whether any mesh layer is on — i.e. whether `render` has anything to do. */
export function wantsAnyMeshLayer(layers: LayerSet): boolean {
  return MESH_LAYERS.some((descriptor) => layers[descriptor.layer]);
}
