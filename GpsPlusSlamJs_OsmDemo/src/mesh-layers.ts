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
  POI_FALLBACK_MODEL,
  poiModelFor,
  resolvePoiPlacement,
  type MeshData,
  type PoiHostLayer,
  type PoiModel,
  type PoiPlacement,
  type TreeVariant,
} from "gps-plus-slam-osm";

import { RENDER_ORDER, groundLift } from "./layer-order.js";
import type { LayerSet } from "./layers.js";
import { PLATE_COLOUR } from "./surface-colours.js";
import type { TransferableMesh } from "./worker/protocol.js";

/**
 * The layers whose geometry comes out of the worker's mesh.
 *
 * The rest of `ALL_LAYERS` is drawn by other means — `cells` and `areas` are the
 * affordance overlays built by `cell-mesh.ts`. (`terrainDebug` used to be listed
 * here too; since W6 the height ramp is a ground MODE rather than a layer, and
 * `ALL_LAYERS` holds only things that are in the world.) This constant is the declared truth the
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
  /**
   * Solid barriers drawn (DEC-R11-2).
   *
   * Reported for the same reason the plate count is, and one more: DEC-R11-11
   * draws barriers with the buildings under no toggle and no distinct colour,
   * so nothing on screen distinguishes "this site has no walls" from "the
   * barrier builder produced nothing".
   */
  readonly barriers: number;
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
  barriers: 0,
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
 * about what a score looks like.** The demo owns one `fixedScale`/`heatColour`
 * pair, both views read it, and it is handed in here rather than reimplemented —
 * a second colour function would be a second source of truth for the same
 * question, which is the whole reason the store exists.
 */
export interface MeshLayerContext {
  /** The 2D map's colour for a score, as a packed `0xrrggbb`. */
  readonly colourForScore: (score: number) => number;
  /**
   * Which host layers are actually being DRAWN (DEC-S1).
   *
   * WHY IT TRAVELS ON THE CONTEXT RATHER THAN AS A `build` PARAMETER. This
   * interface exists for exactly this — what a layer needs beyond the mesh
   * itself — and it is already how the `areas` row gets the one shared
   * `colourForScore` instead of re-deriving it. Widening `build` would touch
   * all six rows for the benefit of one.
   *
   * WHY THE POI ROW NEEDS IT AT ALL. A marker whose feature is already drawn
   * moves onto it or gives way to it, and "already drawn" depends on which
   * layers are on — `plates` is off by default (DEC-R7b-5). Resolving that in
   * the worker would read a stale layer set, because a toggle rebuilds from the
   * cached payload and never re-runs it.
   */
  readonly drawnHostLayers: ReadonlySet<PoiHostLayer>;
}

/**
 * The fallback context.
 *
 * A VISIBLY WRONG magenta rather than a plausible grey, because the only way to
 * reach it is for a caller to forget the real scale — and a plausible colour
 * would make that mistake look like a design choice. The same reasoning as
 * `NO_DATA_RGB` in `height-ramp.ts`.
 */
const NEUTRAL_CONTEXT: MeshLayerContext = {
  colourForScore: () => 0xff00ff,
  // EMPTY, which means every marker stays at its node. That is the safe
  // default: a caller that forgot the real context gets markers where the data
  // puts them, rather than markers silently deleted or moved onto roofs.
  drawnHostLayers: new Set(),
};

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
   * A lift for a marker whose geometry is not based at `y = 0`.
   *
   * NOTHING PASSES ONE ANY MORE, and that is the point. It existed for the
   * fallback CONE, which was centred on its origin and therefore needed half its
   * height added; DEC-S19 replaced that cone with a model built on the shared
   * column, base at zero like every other. So the sampled ground height is now
   * the answer for every marker in the scene, and "the base is at zero" is a
   * contract the models satisfy rather than a number to look up.
   *
   * Kept as an optional parameter rather than deleted because stage 1 floats a
   * symbol above a building's roof, which is exactly this: a marker placed
   * somewhere other than the ground under it.
   */
  liftM = 0,
): [x: number, y: number, z: number] {
  return [marker.position.x, marker.groundHeightM + liftM, -marker.position.y];
}

/**
 * The FALLBACK marker for the long tail — now built in the package (DEC-S19).
 *
 * IT WAS A 6 m ORANGE CONE HERE, and the symbol port is what made that wrong.
 * With every known kind at ~2.5 m, the marker meaning "we do not know what this
 * is" would have been 2.4x taller than every marker that does know — and it is
 * the most numerous marker in the scene, ~650 kinds against 50.
 *
 * It is the shared column with a plain neutral cap where a symbol would go, so
 * it is a member of the family that is visibly missing its payload. Built in
 * `poi-models.ts` rather than here, because that is where the column lives and
 * two definitions of one shape is how they drift.
 */

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

function resourcesFor(
  model: PoiModel,
  /**
   * Take the SYMBOL alone rather than the whole marker (DEC-S16).
   *
   * A hosted marker draws its symbol over a roof with no column under it, which
   * is a different geometry from the same kind at its node — so it needs its own
   * cache entry and its own `InstancedMesh`. Falls back to the full mesh when a
   * model has no symbol, which is every family-L kind.
   */
  symbolOnly = false,
): {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
} {
  const source = (symbolOnly ? model.symbol : undefined) ?? model.mesh;
  const cacheKey = source === model.mesh ? model.kind : `${model.kind}@symbol`;
  const cached = modelResources.get(cacheKey);
  if (cached !== undefined) return cached;
  // PER-FACE PAINTING, WHEN THE MODEL HAS IT (§4, DEC-R6-11). `MeshData.colours`
  // is undefined for a model painted in one colour, which is most of them while
  // the rebuild is in progress — so both paths stay live and the attribute is
  // only attached when there is something to attach.
  //
  // `vertexColors` MULTIPLIES `color`, so an unpainted vertex in a painted model
  // is white and renders as `model.colour` unchanged. That is what lets a model
  // be painted one face at a time instead of all at once.
  const colours = source.colours;
  const built = {
    geometry: geometryFrom(source, colours),
    material: new THREE.MeshStandardMaterial({
      color: model.colour,
      flatShading: true,
      ...(colours === undefined ? {} : { vertexColors: true }),
      // Slightly reflective, like the buildings (W13) — a fully matte marker
      // sits oddly in a scene where everything else catches the moving sun.
      roughness: 0.75,
    }),
  };
  modelResources.set(cacheKey, built);
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
function geometryFrom(
  data: MeshData,
  /**
   * Per-vertex RGB, when the layer is coloured per feature (W22/W23).
   *
   * A chunk is ONE draw call and the point of chunking is that it stays one, so
   * a chunk holding a hundred buildings of twelve classes cannot use a
   * per-material colour without becoming a hundred draw calls. Per-vertex is
   * what keeps both.
   */
  colors?: Float32Array,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(data.positions, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  if (colors !== undefined) {
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
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
    // merged city could not be — see `chunk-meshes.ts`.
    //
    // A MATERIAL PER CHUNK, and deliberately so — this said "the material is
    // shared across chunks" until PR #239 pointed out that the constructor is
    // inside the `.map()`. Identical materials share one compiled program in
    // three, so the cost is a small object per chunk and never a draw call.
    // Hoisting it to a module constant is NOT a free improvement: `clear()`
    // skips a child wholesale when `sharedResources` is set, so a hoisted
    // material is either disposed on the first refresh or drags the chunk's
    // owned geometry into a leak. `mesh-layers.test.ts` pins the pairing.
    build: (mesh) =>
      mesh.buildings.map((chunk) => {
        const object = new THREE.Mesh(
          geometryFrom(chunk.mesh, chunk.colors),
          new THREE.MeshStandardMaterial({
            // WHITE plus VERTEX COLOURS (W22). The class/material palette lives
            // in the package and arrives per vertex, so a chunk holding a dozen
            // building classes is still ONE draw call — which is the whole
            // reason W20 had to come first. A non-white base would tint every
            // colour in the palette by itself.
            color: 0xffffff,
            vertexColors: true,
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
            // 0.55, DOWN FROM 0.65 (DEC-S3). The round-5 owner asked for as
            // much of the scene as possible to carry the shiny-tile look, and
            // facades are the largest surface in it — at 0.65 they were the
            // one thing in the frame with no highlight to catch as the sun
            // swings with the camera.
            //
            // 0.55 AND NOT 0.45, WHICH IS WHERE THIS FIRST LANDED. A W13 guard
            // asserts buildings stay above 0.5 so they do not read as glass,
            // and 0.45 broke it. The guard is right and the fix was to move
            // this value rather than loosen it: 0.45 is only 0.03 from the
            // ground's 0.42, so it was very nearly the polished-stone look that
            // decision exists to prevent. 0.55 still tightens the lobe usefully
            // against the old 0.65.
            //
            // THE RISK THIS CARRIES, and it is the reason DEC-S3 made this a
            // step of its own: DEC-R4-5 requires the affordance heat ramp to
            // stay the loudest thing on screen, and R4-14 warned the scene was
            // close to too colourful before the height ramp became the default
            // surface. Shiny cells over shiny buildings over a ramped ground is
            // three competing speculars. Reverting THIS line alone is the
            // intended way back.
            roughness: 0.55,
            metalness: 0,
          }),
        );
        // A BLOCKER FOR PICKING, NOT A SELECTABLE THING (DEC-R11-17).
        // `building-view.ts` puts every object carrying this key into the
        // raycast set, and `resolvePick` stops at the first one — so a click on
        // a facade resolves to nothing rather than to the ground behind it.
        //
        // **PICKING BLOCKS ON THE DRAWN VOLUME; NAVIGATION BLOCKS ON THE SOLID
        // ONE, AND THEY ARE NOT THE SAME SET.** `solidBuildingFootprints`
        // excludes `building=roof` canopies (DEC-R11-14) and `min_height > 0`
        // arches — an agent walks under both — while this flag is per CHUNK,
        // and a chunk is a spatial batch of many buildings that cannot say
        // which of them is passable. So a canopy is drawn, is navigable, and
        // still swallows the click. Cologne's station forecourt roof is the
        // case that matters: ~16 200 m², the largest single outline in the
        // corpus, over ground the agent can genuinely reach.
        //
        // Left as-is rather than papered over: expressing it would mean either
        // per-feature picking objects (giving up W20's chunking, which exists
        // so a 2.8 km tile can be frustum-culled at all) or a second per-vertex
        // channel. Raised in review on #274 and filed as a follow-up; what is
        // fixed here is the comment that claimed the two sets agreed.
        object.userData["solid"] = true;
        return object;
      }),
    counters: (mesh) => ({
      volumes: mesh.volumes,
      parts: mesh.parts,
      triangles: totalTriangles(mesh.buildings),
      guessedHeights: mesh.guessedHeights,
      approximateRoofs: mesh.approximateRoofs,
      barriers: mesh.barriers,
    }),
  },
  {
    layer: "plates",
    build: (mesh) =>
      mesh.plates.map((chunk) => {
        const plate = new THREE.Mesh(
          geometryFrom(chunk.mesh),
          new THREE.MeshStandardMaterial({
            // LIGHTER THAN THE GROUND, and that ordering is asserted rather than
            // hoped for — see `surface-colours.ts`. DEC-R6-6 lightened the ground
            // and left this literal behind, which inverted the pair and is half
            // of what the sixth session saw as black polygons (the other and
            // larger half was the inverted winding, fixed in `plates.ts`).
            color: PLATE_COLOUR,
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
              // EMISSIVE FROM THE SAME SCORE COLOUR, at the same weight the cell
              // grid uses. A slab and the cells inside it are the same claim at
              // two grains, so a slab lit and a grid self-lit would have made
              // them disagree about their own value under the same sun.
              //
              // Cheap here where it needed a shader patch on the grid: a slab is
              // ONE colour, so `emissive` — which is a uniform — can just carry
              // it, while the grid's colour is per-vertex and never reaches
              // `emissive` through `vertexColors`.
              emissive: context.colourForScore(slab.medianScore),
              emissiveIntensity: 0.5,
              // 0.8 -> 0.25, matching the grid (DEC-S1). A region was the one
              // score-coloured surface with no specular at all, which read as a
              // duller cousin of the cells rather than as a coarser claim.
              roughness: 0.25,
              flatShading: true,
              transparent: true,
              // Translucent so the ground and the buildings inside a region stay
              // readable through it — a region is a claim ABOUT the ground, not
              // a replacement for it. Deliberately NOT raised to the grid's 0.8:
              // a slab covers far more ground than a cell does, and DEC-S1's
              // trade — hiding the surface beneath — is only bearable because
              // the grid's coverage is a ~250 m disc.
              opacity: 0.55,
              // PAIRED WITH `transparent`, which it was not (DEC-R7b-7).
              // three's default is `depthWrite: true`, so this translucent
              // surface was writing depth and occluding transparent geometry
              // drawn after it — which is what "the alpha breaks from some
              // angles" was. The cell grid gets this right in `building-view.ts`
              // and the slab simply never did.
              depthWrite: false,
              // `FrontSide` now the walls are gone (DEC-R7b-7a): there is no
              // self-blending geometry left to sort against, and a two-sided
              // translucent surface blends against its own far face.
              side: THREE.FrontSide,
            }),
          );
          object.position.y = groundLift("areas");
          // THE ID A CLICK RESOLVES TO (DEC-R7b-3a). `building-view.ts` adds
          // every object carrying this key to the raycast set, so the marker and
          // the membership are one fact rather than two that can disagree.
          object.userData["regionId"] = slab.id;
          // AFTER the opaque world, before nothing in particular. With
          // `depthWrite` off, a transparent surface is at the mercy of three's
          // default sort, which orders by distance and knows nothing about which
          // of two overlapping claims is the coarser one. An explicit order is
          // the only way the grid and the slabs composite the same way from
          // every camera; there was none anywhere in the demo before this.
          object.renderOrder = RENDER_ORDER.areas;
          return object;
        }),
    counters: (mesh) => ({ areas: mesh.regions.length }),
  },
  {
    layer: "roads",
    build: (mesh) =>
      mesh.roads.map((chunk) => {
        const ribbon = new THREE.Mesh(
          geometryFrom(chunk.mesh, chunk.colors),
          new THREE.MeshStandardMaterial({
            // WHITE plus VERTEX COLOURS (W23), like the buildings. The class and
            // surface palette is in the package, and every colour in it is
            // contrast-checked against the ground — DEC-R2-13's measurement, now
            // enforced for the whole palette rather than for one constant.
            vertexColors: true,
            // WHITE, because the real colour is per vertex now. It was 0x8b909c,
            // and that constant was a MEASUREMENT rather than a preference: the
            // first attempt was 0x2f333d on asphalt reasoning, the ground renders
            // at rgb(40,40,56) under this scene's lighting, and the darker road
            // moved 77 pixels out of 460 800. "A road that cannot be told from
            // the ground it lies on is a failed layer whatever the test says" —
            // so that measurement is now enforced for the WHOLE palette by
            // `feature-colours.test.ts`, rather than for one constant here.
            color: 0xffffff,
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
    build: (mesh, context) => {
      if (mesh.poi.length === 0) return [];
      // WHERE EACH MARKER ACTUALLY GOES (DEC-S1, DEC-S2), resolved HERE because
      // this is the only place that has both the payload and the layers being
      // drawn. The worker collected the candidates; this picks between them.
      const placements = mesh.poi.map((marker) =>
        resolvePoiPlacement(marker, context.drawnHostLayers),
      );
      // ONE InstancedMesh PER KIND — W7 made it instanced, W19 gave each kind
      // its own model. Grouping first is what keeps fifty models a handful of
      // draw calls rather than one per marker, and it is why W7 had to land
      // before Stage 2 rather than after it.
      //
      // THE FALLBACK SHARES ONE BUCKET, keyed by the empty string. Fifty kinds
      // are modelled and roughly 650 are not, so the long tail is the common
      // case: giving it a bucket per kind would be 650 draw calls for the
      // markers that look identical anyway.
      // TWO BUCKETS PER HOSTED KIND, not one. A marker on a roof draws the
      // SYMBOL alone and a marker at its node draws the whole marker, and those
      // are different geometries — so they cannot share an InstancedMesh even
      // though they share a kind. The suffix keeps them apart in one map rather
      // than needing a second one.
      const byBucket = new Map<
        string,
        { marker: TransferableMesh["poi"][number]; placement: PoiPlacement }[]
      >();
      mesh.poi.forEach((marker, index) => {
        const placement = placements[index] as PoiPlacement;
        // SUPPRESSED MARKERS ARE NOT DRAWN AT ALL — the area under them already
        // says what they say. They stay in `mesh.poi` and in the counters,
        // because the feature is still there and still worth counting; only the
        // geometry goes.
        if (placement.at === "suppressed") return;
        const model = poiModelFor(marker.kind);
        const onHost = placement.at === "host" && model?.symbol !== undefined;
        const bucket =
          model === undefined ? "" : `${marker.kind}${onHost ? "@host" : ""}`;
        const list = byBucket.get(bucket) ?? [];
        list.push({ marker, placement });
        byBucket.set(bucket, list);
      });

      const objects: THREE.Object3D[] = [];
      const matrix = new THREE.Matrix4();
      for (const [bucket, entries] of byBucket) {
        const onHost = bucket.endsWith("@host");
        const kind = onHost ? bucket.slice(0, -"@host".length) : bucket;
        const model = kind === "" ? undefined : poiModelFor(kind);
        const markers = entries.map((entry) => entry.marker);
        // THE SYMBOL ALONE ON A HOST, the whole marker at a node. Same kind, two
        // geometries — a column standing on a roof would be a marker growing out
        // of a building, which is the thing this change exists to stop drawing.
        const { geometry, material } = resourcesFor(
          model ?? POI_FALLBACK_MODEL,
          onHost,
        );
        const pins = new THREE.InstancedMesh(
          geometry,
          material,
          markers.length,
        );
        // NO OFFSET FOR ANYTHING NOW. Every model is built with its base at
        // y = 0 by contract, and since DEC-S19 the fallback is a model too
        // rather than a cone centred on its origin — so the sampled ground
        // height IS the answer for every marker in the scene.
        // COMPOSE, NOT `makeTranslation` (§4a, DEC-R6-18/R6-20). This was a
        // translation alone, which meant every bench in the city faced exactly
        // the same direction — at street level a far louder repetition cue than
        // any difference between two models of the same kind. The yaw and the
        // scale are computed in the package from the feature key (`poi.ts`), so
        // they are stable across the republish that happens on every move; this
        // is only the application of them, exactly as the `trees` builder above
        // already does.
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        entries.forEach(({ marker, placement }, i) => {
          if (placement.at === "host") {
            // OVER THE HOST'S CENTROID, not the marker's node — and the ENU→
            // scene reflection is applied here rather than in the package, the
            // same way `poiMarkerPosition` does it for a node. `host.y` is ENU
            // NORTH; `-host.y` is the scene's z.
            position.set(
              placement.host.x,
              placement.host.topM + placement.liftM,
              -placement.host.y,
            );
            // THE HOST'S SCALE MULTIPLIES THE MARKER'S OWN (DEC-S6). The
            // per-instance jitter still applies — two cafés on two roofs should
            // not be identical — and the host term is what keeps a symbol
            // readable over a large building.
            scale.setScalar(marker.scale * placement.scale);
          } else {
            const [x, y, z] = poiMarkerPosition(marker);
            position.set(x, y, z);
            scale.setScalar(marker.scale);
          }
          quaternion.setFromAxisAngle(up, marker.rotationY);
          pins.setMatrixAt(i, matrix.compose(position, quaternion, scale));
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
  /**
   * `drawnHostLayers` is DERIVED HERE, not supplied — it is `layers` restated,
   * and a caller passing its own could disagree with the set that actually
   * gates drawing. So the parameter omits it and the rows receive it.
   */
  context: Omit<MeshLayerContext, "drawnHostLayers"> = NEUTRAL_CONTEXT,
): { objects: THREE.Object3D[]; stats: BuildingStats } {
  const objects: THREE.Object3D[] = [];
  let stats = NO_STATS;
  // THE HOST LAYERS ARE DERIVED FROM THE SAME SET THAT GATES DRAWING two lines
  // below, so "is this layer drawn" cannot give one answer to the loop and a
  // different one to the POI row. Reading the store separately here is exactly
  // what would let them drift.
  const hostAware: MeshLayerContext = {
    ...context,
    drawnHostLayers: new Set(
      (["buildings", "plates"] as const).filter(
        (layer) => layers?.[layer] ?? true,
      ),
    ),
  };
  for (const descriptor of MESH_LAYERS) {
    // AN OMITTED LAYER DRAWS (W9). The per-row `defaultOn` flag was deleted
    // rather than flipped to `true` everywhere: it existed to reproduce a
    // baseline that no longer exists, and a field that can only ever hold one
    // value is a field that can only ever be wrong.
    if (!(layers?.[descriptor.layer] ?? true)) continue;
    objects.push(...descriptor.build(mesh, hostAware));
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
