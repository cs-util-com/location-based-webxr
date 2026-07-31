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
import {
  packInstances,
  poiModelFor,
  type MeshData,
  type PoiModel,
  type TreeVariant,
} from "gps-plus-slam-osm";

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
 * Partial on purpose: an omitted layer DRAWS (W9). It used to fall back to a
 * per-row `defaultOn` flag that reproduced the picture the demo shipped with,
 * which was a migration guarantee — and the migration is over.
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
  /** Objects to add to the scene. Empty when the layer has nothing to draw. */
  build(mesh: TransferableMesh, context: MeshLayerContext): THREE.Object3D[];
  /** The counters this layer owns, supplied only when it is drawn. */
  counters(mesh: TransferableMesh): Partial<BuildingStats>;
}

/**
 * Where a POI marker's pin stands, from its ENU placement.
 *
 * The same `+y` north to `-z` north reflection the tree instances get from
 * `packInstances`, and it fails the same silent way: a marker 50 m north of a
 * shop renders 50 m south of it, labelled correctly, looking like a data error
 * rather than a frame error. The pin is a cone standing ON the ground, so its
 * centre sits half its height up.
 *
 * Trees no longer have a counterpart to this (W6): they are instanced, and
 * `packInstances` applies the reflection inside the package where its test
 * lives, so the demo has one fewer place to get the frame wrong.
 */
export function poiMarkerPosition(
  marker: TransferableMesh["poi"][number],
  /**
   * Half-height for the FALLBACK cone, which is centred on its origin.
   *
   * Zero for a real model (W19): every one is built with its base at `y = 0`
   * (`poi-primitives.ts`, asserted in `poi-models.test.ts`), so the sampled
   * ground height IS the answer. The old unconditional `POI_HEIGHT_M / 2` is
   * gone rather than parameterised per kind, because "the base is at zero" is a
   * contract the models satisfy rather than a number to look up.
   */
  centreOffsetM = 0,
): [x: number, y: number, z: number] {
  return [
    marker.position.x,
    marker.groundHeightM + centreOffsetM,
    -marker.position.y,
  ];
}

/**
 * Height of the FALLBACK pin, metres — the long tail with no model of its own.
 *
 * Tall enough to clear a hedge, short enough not to compete with the buildings.
 * It stays a deliberately abstract cone rather than a generic box, because an
 * obviously-abstract marker is a better claim than a plausible-looking wrong one.
 */
const POI_HEIGHT_M = 6;

/**
 * Per-kind geometry and material, built once and shared by every instance.
 *
 * CACHED ACROSS RENDERS, and that is the reason W7 had to land before Stage 2:
 * fifty kinds means up to fifty `InstancedMesh` objects per publish, and
 * rebuilding their geometry each time would be exactly the per-publish
 * allocation instancing removed — fifty times over.
 *
 * Everything in here is BORROWED by the scene (`sharedResources`), so
 * `BuildingView.clear()` must not dispose it.
 */
const modelResources = new Map<
  string,
  { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }
>();

function resourcesFor(model: PoiModel): {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
} {
  const cached = modelResources.get(model.kind);
  if (cached !== undefined) return cached;
  const built = {
    geometry: geometryFrom(model.mesh),
    material: new THREE.MeshStandardMaterial({
      color: model.colour,
      flatShading: true,
      // Slightly reflective, like the buildings (W13) — a fully matte marker
      // sits oddly in a scene where everything else catches the moving sun.
      roughness: 0.75,
    }),
  };
  modelResources.set(model.kind, built);
  return built;
}

/**
 * UNIT tree geometries — one per variant, built once, shared by every instance.
 *
 * WHY INSTANCED AT ALL (W6). `trees.ts` says it in its own header: trees are
 * "numerous, identical up to a transform, and therefore exactly what
 * `InstancedMesh` exists for", which is why the package emits placements rather
 * than geometry and ships `packInstances` to pack them. **Nothing called it.**
 * This loop allocated a fresh `ConeGeometry` and a fresh
 * `MeshStandardMaterial` per tree, on every publish, three publishes per click —
 * so a forest was N draw calls and N allocations on the main thread, which is
 * half of what R4-9 reports as the hitch.
 *
 * WHY ONE PER VARIANT (R4-3, DEC-R4-10). `variantOf` reads `leaf_type`/`wood`
 * into `broadleaved | needleleaved | unknown`, `TransferableMesh` carries it
 * across the worker boundary, and the draw loop **discarded it** — so every
 * tree, whatever its tags said, came out as the same fir. The data for the fix
 * was already in hand; only the geometry was missing.
 *
 * WHY UNIT-SIZED WITH THE BASE AT y = 0. The instance matrix then composes
 * directly from what `packInstances` already emits — position (with the ENU
 * `+y` north to scene `-z` reflection already applied), a rotation about the
 * vertical, and a scale of (crown, height, crown). The old per-tree code had to
 * add half a height to stand a centred cone on the ground; a base-at-zero
 * geometry removes that arithmetic rather than relocating it.
 *
 * SEGMENT COUNTS ARE DELIBERATELY LOW. This is an AR overlay before it is a
 * desktop scene: 6 radial segments on the cone and a level-0 icosahedron (20
 * triangles) keep a thousand trees affordable, and the flat-shaded low-polygon
 * look is the house style rather than a compromise.
 */
function unitTreeGeometries(): Record<TreeVariant, THREE.BufferGeometry> {
  // Radius 0.5 and height 1, translated up by half, so the geometry occupies
  // x,z in [-0.5, 0.5] and y in [0, 1] — a unit cube's worth, scaled per tree.
  const needle = new THREE.ConeGeometry(0.5, 1, 6);
  needle.translate(0, 0.5, 0);
  // A rounded crown, not a cone: this is the whole visible point of reading
  // `leaf_type`. Level 0 keeps it at 20 triangles.
  const broad = new THREE.IcosahedronGeometry(0.5, 0);
  broad.translate(0, 0.5, 0);
  return {
    needleleaved: needle,
    broadleaved: broad,
    // UNKNOWN KEEPS THE CONE, deliberately: it is what the demo drew before, so
    // the picture changes exactly where the data says something and nowhere
    // else. A third invented shape would make untagged trees look like a claim.
    unknown: needle,
  };
}

const TREE_GEOMETRY = unitTreeGeometries();

/** ONE material for every tree, shared like the geometries. */
const TREE_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x3f7d4a,
  flatShading: true,
  roughness: 0.8,
});

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

/**
 * Triangles across a layer's chunks (W20).
 *
 * The status line reports what was DRAWN, and after chunking that is a sum
 * rather than a field. Written once because three layers need it and three
 * copies of a reduce is three chances for one to be forgotten when a layer is
 * added — which is the same shape as the missing-row failure the table exists
 * to prevent.
 */
function totalTriangles(chunks: readonly { mesh: MeshData }[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.mesh.triangleCount, 0);
}

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
    // ONE MESH PER CHUNK (W20). Each is frustum-culled on its own, which one
    // merged city could not be — see `chunk-meshes.ts`. The material is shared
    // across chunks, so this costs draw calls and not memory.
    build: (mesh) =>
      mesh.buildings.map(
        (chunk) =>
          new THREE.Mesh(
            geometryFrom(chunk.mesh),
            new THREE.MeshStandardMaterial({
              color: 0xc8ccd8,
              // SINGLE-SIDED SINCE W24 (R4-17). It was `DoubleSide`, and the
              // reason was honest: OSM volumes are not reliably closed, so a
              // `building:part` with no floor shows as a hole under culling for
              // reasons that have nothing to do with this package.
              //
              // But that comment also recorded why it was a bad guarantee —
              // "IT DOES NOT VALIDATE WINDING, it hides it. Every wall quad in
              // the package was wound inside-out when this view was written and
              // it looked entirely fine here" — and the fix for THAT was
              // `mesh-orientation.test.ts`, which now pins the winding directly.
              // With the winding proved, double-siding buys only the open-volume
              // case, at roughly double the fragment work on the largest mesh in
              // the scene. A hole where a floor is genuinely missing is also the
              // more honest failure: it shows the data gap instead of papering
              // over it with a wrongly-lit interior.
              side: THREE.FrontSide,
              flatShading: true,
              // REFLECTIVE, and this was an oversight rather than a decision
              // (W13, R4-15, N3). DEC-R2-1 made the GROUND reflective so facet
              // edges show as a highlight slides across them while the camera
              // moves; the buildings kept `MeshStandardMaterial`'s default
              // `roughness: 1.0`, which is fully diffuse and has no specular
              // lobe at all. Nothing in the record says buildings should stay
              // matte.
              //
              // 0.65, NOT the ground's 0.42. A building at 0.42 reads as glass
              // or polished stone, which for a residential block is a
              // different kind of wrong — the ground gets away with it because
              // wet-ish ground is plausible.
              roughness: 0.65,
              metalness: 0,
            }),
          ),
      ),
    counters: (mesh) => ({
      volumes: mesh.volumes,
      parts: mesh.parts,
      triangles: totalTriangles(mesh.buildings),
      guessedHeights: mesh.guessedHeights,
      approximateRoofs: mesh.approximateRoofs,
    }),
  },
  {
    layer: "plates",
    build: (mesh) =>
      mesh.plates.map((chunk) => {
        const plate = new THREE.Mesh(
          geometryFrom(chunk.mesh),
          new THREE.MeshStandardMaterial({
            color: 0x4a5468,
            roughness: 0.85,
            flatShading: true,
            // SINGLE-SIDED. A plate is horizontal with an upward normal by
            // construction, so a back face is never legitimately visible — and
            // culling it means a plate wound the wrong way DISAPPEARS instead of
            // being silently lit from below, which is the failure worth noticing
            // rather than hiding.
            side: THREE.FrontSide,
          }),
        );
        // From the shared ladder, so it cannot be coplanar with roads or grid.
        plate.position.y = groundLift("plates");
        return plate;
      }),
    counters: (mesh) => ({
      plates: mesh.plateCount,
      plateTriangles: totalTriangles(mesh.plates),
    }),
  },
  {
    layer: "trees",
    build: (mesh) => {
      const objects: THREE.Object3D[] = [];
      // `packInstances` groups by variant and applies the ENU→scene reflection
      // itself — it is the package function written for exactly this and never
      // called until now. Reimplementing the grouping here would be a second
      // place for the reflection to be wrong.
      for (const [variant, packed] of packInstances(mesh.trees)) {
        const count = packed.rotations.length;
        if (count === 0) continue;
        const instanced = new THREE.InstancedMesh(
          TREE_GEOMETRY[variant],
          TREE_MATERIAL,
          count,
        );
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < count; i++) {
          position.set(
            packed.positions[i * 3] ?? 0,
            packed.positions[i * 3 + 1] ?? 0,
            packed.positions[i * 3 + 2] ?? 0,
          );
          // `scales` is [heightM, crownDiameterM] per instance; the geometry is
          // a unit whose crown spans x,z in [-0.5, 0.5], so the crown diameter
          // is the horizontal scale directly.
          const heightM = packed.scales[i * 2] ?? 1;
          const crownM = packed.scales[i * 2 + 1] ?? 1;
          scale.set(crownM, heightM, crownM);
          quaternion.setFromAxisAngle(up, packed.rotations[i] ?? 0);
          instanced.setMatrixAt(i, matrix.compose(position, quaternion, scale));
        }
        instanced.instanceMatrix.needsUpdate = true;
        // BORROWED, like the POI pins: `clear()` must not dispose a geometry or
        // material that every later render depends on. three.js does not throw
        // for a disposed geometry — it silently draws nothing, and the counters
        // keep reporting the trees.
        instanced.userData = { sharedResources: true };
        objects.push(instanced);
      }
      return objects;
    },
    counters: (mesh) => ({ trees: mesh.trees.length }),
  },
  {
    layer: "areas",
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
    build: (mesh) =>
      mesh.roads.map((chunk) => {
        const ribbon = new THREE.Mesh(
          geometryFrom(chunk.mesh),
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
        return ribbon;
      }),
    counters: (mesh) => ({
      roads: mesh.roadCount,
      roadTriangles: totalTriangles(mesh.roads),
    }),
  },
  {
    layer: "poi",
    build: (mesh) => {
      if (mesh.poi.length === 0) return [];
      // ONE InstancedMesh PER KIND — W7 made it instanced, W19 gave each kind
      // its own model. Grouping first is what keeps fifty models a handful of
      // draw calls rather than one per marker, and it is why W7 had to land
      // before Stage 2 rather than after it.
      //
      // THE FALLBACK SHARES ONE BUCKET, keyed by the empty string. Fifty kinds
      // are modelled and roughly 650 are not, so the long tail is the common
      // case: giving it a bucket per kind would be 650 draw calls for the
      // markers that look identical anyway.
      const byKind = new Map<string, TransferableMesh["poi"][number][]>();
      for (const marker of mesh.poi) {
        const bucket =
          poiModelFor(marker.kind) === undefined ? "" : marker.kind;
        const list = byKind.get(bucket) ?? [];
        list.push(marker);
        byKind.set(bucket, list);
      }

      const objects: THREE.Object3D[] = [];
      const matrix = new THREE.Matrix4();
      for (const [bucket, markers] of byKind) {
        const model = bucket === "" ? undefined : poiModelFor(bucket);
        const { geometry, material } =
          model === undefined
            ? { geometry: POI_GEOMETRY, material: POI_MATERIAL }
            : resourcesFor(model);
        const pins = new THREE.InstancedMesh(
          geometry,
          material,
          markers.length,
        );
        // The fallback cone is centred on its origin; every MODEL is built with
        // its base at y = 0 by contract, so it needs no offset at all. That
        // contract is asserted in `poi-models.test.ts`, which is what lets this
        // be a zero rather than a per-kind lookup.
        const centreOffsetM = model === undefined ? POI_HEIGHT_M / 2 : 0;
        markers.forEach((marker, i) => {
          pins.setMatrixAt(
            i,
            matrix.makeTranslation(...poiMarkerPosition(marker, centreOffsetM)),
          );
        });
        pins.instanceMatrix.needsUpdate = true;
        // THE IDENTITY A PICK READS BACK, an array indexed by instance —
        // instancing collapses N objects onto one, so there is nowhere
        // per-object left to put it. Per BUCKET now, so the array a hit indexes
        // is the array that produced that mesh's matrices.
        //
        // BUILT IN THIS LOOP, with the geometry, and that is the whole
        // guarantee: an index-keyed table assembled anywhere else survives a
        // `clear()` and the next render while pointing at the PREVIOUS working
        // set, which is a panel confidently describing the wrong feature.
        //
        // `sharedResources` tells the scene owner the geometry and material are
        // BORROWED. `BuildingView.clear()` disposes both for every child it
        // removes, which for a shared resource means the first refresh destroys
        // it and every later frame silently draws nothing — three.js does not
        // throw for a disposed geometry.
        pins.userData = { poiInstances: markers, sharedResources: true };
        objects.push(pins);
      }
      return objects;
    },
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
    // AN OMITTED LAYER DRAWS (W9). The per-row `defaultOn` flag was deleted
    // rather than flipped to `true` everywhere: it existed to reproduce a
    // baseline that no longer exists, and a field that can only ever hold one
    // value is a field that can only ever be wrong.
    if (!(layers?.[descriptor.layer] ?? true)) continue;
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
