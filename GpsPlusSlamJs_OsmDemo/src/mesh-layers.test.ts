/**
 * The mesh-layer table — one row per drawable layer, instead of a branch per layer.
 *
 * WHY THESE TESTS MATTER. `BuildingView.render` reached complexity 21 by growing a
 * pair of branches for every layer (one to draw it, one to zero its counters), and
 * W12–W15 add four more. The table removes the branches, but it introduces a new
 * failure mode that the branchy version could not have: **a layer can be missing
 * from the table entirely**, and a missing row draws nothing, reports nothing and
 * throws nothing — it looks exactly like a layer whose data happened to be empty.
 *
 * That is the same shape as the shader outage that hid every `MeshStandardMaterial`
 * for ten work items, so the coverage assertion below is the point of this file, not
 * a formality.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { RENDER_ORDER, groundLift } from "./layer-order.js";
import { ALL_LAYERS, type LayerKind } from "./layers.js";
import {
  MESH_LAYERS,
  DRAWN_BY_MESH,
  drawMeshLayers,
  meshLayerSelection,
  poiMarkerPosition,
} from "./mesh-layers.js";
import type { TransferableMesh } from "./worker/protocol.js";

/** One triangle, enough for a layer to have something to draw. */
function triangle(): {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  forcedEars: number;
} {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    triangleCount: 1,
    forcedEars: 0,
  };
}

/** One chunk holding one triangle — the post-W20 shape of a mesh layer. */
function oneChunk(): { key: string; mesh: ReturnType<typeof triangle> }[] {
  return [{ key: "0,0", mesh: triangle() }];
}

/** A mesh in which EVERY layer has something to draw. */
function fullMesh(): TransferableMesh {
  return {
    buildings: oneChunk(),
    // `variant` was `0` here until W6 — a number where `TreeVariant` is a
    // string union, which the blanket `as unknown as` cast below hid. Nothing
    // read the field, so nothing noticed; the moment the draw loop started
    // grouping BY variant, a fixture carrying an impossible value would have
    // made every assertion about that grouping meaningless.
    trees: [
      {
        feature: "node/1",
        position: { x: 10, y: 20 },
        groundHeightM: 53,
        heightM: 8,
        crownDiameterM: 4,
        rotationY: 0.5,
        variant: "unknown",
      },
    ],
    plates: oneChunk(),
    plateCount: 3,
    roads: oneChunk(),
    roadCount: 2,
    regions: [{ medianScore: 4, id: "r1", mesh: triangle() }],
    poi: [
      {
        feature: "node/4242",
        position: { x: 5, y: -7 },
        groundHeightM: 53,
        kind: "amenity=cafe",
        label: "Café Schmitz",
        rotationY: 0,
        scale: 1,
      },
    ],
    volumes: 21,
    parts: 25,
    guessedHeights: 7,
    approximateRoofs: 2,
  } as unknown as TransferableMesh;
}

/** A mesh in which every layer is present but empty. */
function emptyMesh(): TransferableMesh {
  return {
    // NO chunks rather than one empty chunk (W20): an empty BufferGeometry is
    // still a draw call and a disposal obligation.
    buildings: [],
    trees: [],
    plates: [],
    plateCount: 0,
    roads: [],
    roadCount: 0,
    underground: [],
    regions: [],
    poi: [],
    volumes: 0,
    parts: 0,
    guessedHeights: 0,
    approximateRoofs: 0,
  };
}

/** Every layer on, whatever the table's defaults happen to be. */
const ALL_ON = Object.fromEntries(
  ALL_LAYERS.map((layer) => [layer, true]),
) as Record<LayerKind, boolean>;

describe("MESH_LAYERS — the table itself", () => {
  it("covers exactly the layers the mesh can draw, and no others", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A layer that the worker builds geometry
    // for but that has no row here is invisible in a way nothing else reports: it
    // draws nothing, contributes no counters, and raises no error. `DRAWN_BY_MESH`
    // is the declared truth; the table must match it exactly.
    //
    // Sorted rather than order-sensitive: the paint order is `layer-order.ts`'s
    // job, and pinning it twice would make one of the two the thing that drifts.
    expect([...MESH_LAYERS.map((one) => one.layer)].sort()).toEqual(
      [...DRAWN_BY_MESH].sort(),
    );
  });

  it("names only layers the registry knows about", () => {
    // A typo'd id would create a row that no toggle can ever reach, so the layer
    // would be permanently stuck on its default with no way to see why.
    const known = new Set<string>(ALL_LAYERS);
    for (const descriptor of MESH_LAYERS) {
      expect(known.has(descriptor.layer)).toBe(true);
    }
  });

  it("has exactly one row per layer", () => {
    // Two rows for one layer would draw it twice and double its counters — and
    // the doubled geometry is coplanar with itself, so it z-fights rather than
    // looking obviously wrong.
    const ids = MESH_LAYERS.map((one) => one.layer);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draws every mesh layer when the selection omits it (W9)", () => {
    // REPLACES "defaults to the picture the demo shipped with". That baseline
    // existed so the W10 registry migration could be checked against a known
    // good; the migration is done, and what was left was the historical order in
    // which builders were written. The per-row `defaultOn` flag is gone rather
    // than set to `true` everywhere — a field that can only hold one value is a
    // field that can only ever be wrong.
    const { objects } = drawMeshLayers(fullMesh());
    // Buildings, plates, roads, one area slab, one instanced tree mesh, one
    // instanced POI mesh.
    expect(objects).toHaveLength(6);
  });
});

describe("drawMeshLayers — what reaches the scene", () => {
  it("draws every layer that is on", () => {
    const { objects } = drawMeshLayers(fullMesh(), ALL_ON);
    // Buildings, plates, roads, one area slab, one tree cone, one POI marker.
    expect(objects).toHaveLength(6);
    for (const object of objects) expect(object).toBeInstanceOf(THREE.Object3D);
  });

  it("draws nothing for a layer that is off", () => {
    const { objects } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
      trees: false,
      plates: false,
      poi: false,
      roads: false,
      areas: false,
    });
    expect(objects).toEqual([]);
  });

  it("adds no object for a layer that is on but has no geometry", () => {
    // An empty `BufferGeometry` in the scene is not free — it is a draw call and a
    // disposal obligation — and an empty tree list must not produce a cone at the
    // origin, which is what a naive loop over `undefined` would do.
    const { objects } = drawMeshLayers(emptyMesh(), ALL_ON);
    expect(objects).toEqual([]);
  });

  it("uses the shared ladder for ground layers rather than a local constant", () => {
    // `layer-order.ts` exists because five things want to be at y ≈ 0 and any two
    // that end up coplanar z-fight. A layer that lifted itself would be outside
    // that guarantee while looking correct in isolation.
    const { objects } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
      trees: false,
      poi: false,
      roads: false,
      areas: false,
    });
    expect(objects[0]?.position.y).toBeCloseTo(groundLift("plates"), 10);
  });

  it("counts every layer it drew when no selection is given (W9)", () => {
    const { stats } = drawMeshLayers(fullMesh());
    // The counters describe what was DRAWN, so with everything on they are all
    // populated — a plate count of 0 here would mean the layer silently did not
    // draw, which is indistinguishable from there being no plates.
    expect(stats.volumes).toBe(21);
    expect(stats.plates).toBe(3);
    expect(stats.roads).toBe(2);
    expect(stats.poi).toBe(1);
    expect(stats.areas).toBe(1);
  });
});

describe("poiMarkerPosition", () => {
  // `satisfies`, not a plain literal: `feature` is a template-literal type
  // (`${string}/${number}`) and an object literal widens it to `string`.
  const marker = {
    feature: "node/1",
    position: { x: 30, y: 50 },
    groundHeightM: 53,
    kind: "amenity=cafe",
    label: "Café",
    rotationY: 0,
    scale: 1,
  } satisfies TransferableMesh["poi"][number];

  it("REFLECTS ENU north onto the scene's -z", () => {
    // WHY THIS TEST MATTERS, and it is not hypothetical. The identical
    // reflection was missing from the tree loop until 2026-07-29, and the
    // symptom was a forest rendered 100 m from the buildings it stands beside —
    // self-consistent, so it read as a data problem rather than a frame error.
    // Every tree assertion that existed at the time held in the mirrored world,
    // because they all compared trees against other trees.
    expect(poiMarkerPosition(marker)[2]).toBe(-50);
  });

  it("passes east through unchanged", () => {
    expect(poiMarkerPosition(marker)[0]).toBe(30);
  });

  it("puts a MODEL on the ground exactly, with no offset (W19)", () => {
    // Every model is built with its base at y = 0 (asserted in the package's
    // poi-models.test.ts), so the sampled ground height IS the answer. The old
    // unconditional half-height offset would now float every one of the fifty
    // models half its own height above the terrain.
    const [, y] = poiMarkerPosition(marker);
    expect(y).toBe(53);
  });

  it("still lifts the FALLBACK cone, which is centred on its origin", () => {
    // The long tail keeps the abstract pin, and a cone placed at the sampled
    // ground height is half buried — which at that size looks like a shorter
    // pin rather than like a bug.
    const [, y] = poiMarkerPosition(marker, 3);
    expect(y).toBe(56);
  });
});

describe("per-feature colour reaches the geometry (W22/W23)", () => {
  /** A chunked layer carrying a colour buffer, as the worker now sends it. */
  function colouredChunk() {
    const mesh = triangle();
    return [
      {
        key: "0,0",
        mesh,
        colors: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
      },
    ];
  }

  function materialAndGeometry(layer: "buildings" | "roads") {
    const base = fullMesh();
    const mesh = { ...base, [layer]: colouredChunk() };
    const { objects } = drawMeshLayers(mesh, {
      buildings: layer === "buildings",
      trees: false,
      plates: false,
      roads: layer === "roads",
      poi: false,
      areas: false,
    });
    const first = objects[0] as THREE.Mesh;
    return {
      material: first.material as THREE.MeshStandardMaterial,
      geometry: first.geometry,
    };
  }

  it.each(["buildings", "roads"] as const)(
    "%s put the chunk's colours on the geometry",
    (layer) => {
      // WHY THIS MATTERS. The palette is computed in the package and travels as a
      // buffer; if the demo forgets to attach it, every feature renders in the
      // material's base colour and the whole of W22/W23 is invisible — with no
      // error, and looking exactly like the grey it replaced.
      const { geometry } = materialAndGeometry(layer);
      expect(geometry.getAttribute("color")).toBeDefined();
      expect(geometry.getAttribute("color").count).toBe(3);
    },
  );

  it.each(["buildings", "roads"] as const)(
    "%s use a WHITE base, or the palette is tinted by it",
    (layer) => {
      // A vertex colour multiplies the material colour. The old constants
      // (0xc8ccd8, 0x8b909c) would darken and desaturate every colour in the
      // palette — subtly, uniformly, and in a way that reads as "the palette is
      // a bit dull" rather than as a bug.
      const { material } = materialAndGeometry(layer);
      expect(material.vertexColors).toBe(true);
      expect(material.color.getHex()).toBe(0xffffff);
    },
  );

  it("still draws when a chunk carries NO colours", () => {
    // The fallback path: an older worker reply, or a layer that is one colour
    // throughout. It must render rather than throw on a missing attribute.
    const mesh = {
      ...fullMesh(),
      buildings: [{ key: "0,0", mesh: triangle() }],
    } as TransferableMesh;
    const { objects } = drawMeshLayers(mesh, {
      buildings: true,
      trees: false,
      plates: false,
      roads: false,
      poi: false,
      areas: false,
    });
    expect(objects).toHaveLength(1);
    expect(
      (objects[0] as THREE.Mesh).geometry.getAttribute("color"),
    ).toBeUndefined();
  });
});

describe("materials — what the light has to work with (W13)", () => {
  /**
   * The material of the only object drawn when just `layer` is on.
   *
   * Every OTHER layer is explicitly off: an omitted layer falls back to its
   * row's `defaultOn`, so `{ plates: true }` alone still draws the buildings and
   * `objects[0]` is then the wrong material entirely — which is how the first
   * version of this helper "proved" the plates were 0.65.
   */
  function materialOf(layer: "buildings" | "plates" | "roads") {
    const { objects } = drawMeshLayers(fullMesh(), {
      buildings: false,
      trees: false,
      plates: false,
      roads: false,
      poi: false,
      areas: false,
      [layer]: true,
    });
    return (objects[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  }

  it("gives the buildings a specular lobe to catch the moving highlight", () => {
    // WHY THIS TEST MATTERS. DEC-R2-1 made the GROUND reflective so that facet
    // edges show up as a highlight slides across them while the camera moves,
    // and the buildings were left on `MeshStandardMaterial`'s default
    // `roughness: 1.0` — fully diffuse, no specular lobe, nothing for the light
    // to do. That is invisible in a diff and invisible in a screenshot taken
    // from one angle, which is why it survived a round.
    expect(materialOf("buildings").roughness).toBeLessThan(1);
  });

  it("keeps them rougher than the ground, so they do not read as glass", () => {
    // The ground is 0.42 and gets away with it because wet-ish ground is
    // plausible. A residential block at 0.42 looks like polished stone, which
    // is a different kind of wrong rather than an improvement.
    expect(materialOf("buildings").roughness).toBeGreaterThan(0.5);
  });

  it("leaves the ground-level layers matte", () => {
    // Plates and roads are deliberately not part of this: DEC-R2-13's measured
    // road-versus-ground contrast depends on the road not competing with the
    // surface it lies on.
    expect(materialOf("plates").roughness).toBeGreaterThan(0.8);
    expect(materialOf("roads").roughness).toBeGreaterThan(0.8);
  });

  it("gives every chunk its OWN material, and hands all of them to `clear()`", () => {
    // WHY THIS TEST MATTERS — it is the pairing, not either half.
    //
    // PR #239 read a comment here claiming the material was shared across
    // chunks; it never was, since `new MeshStandardMaterial` sits inside the
    // `.map()`. That is fine — identical materials share one compiled program,
    // so a material per chunk costs a small object and no draw call. What is
    // NOT fine is hoisting it to a module constant on its own: `clear()` skips
    // a child entirely when `sharedResources` is set, so a hoisted material
    // either gets destroyed on the first refresh (no flag) or takes the chunk's
    // per-render GEOMETRY with it into a leak (flag set, since the flag is
    // all-or-nothing). Both failures are silent — three.js does not throw for a
    // disposed material and the counters keep reporting the geometry.
    //
    // So this asserts the shape the disposal path actually assumes: owned
    // material, owned geometry, no borrow flag. Anyone hoisting the material
    // has to come here and teach `clear()` about a material-only borrow first.
    const twoChunks = [
      { key: "0,0", mesh: triangle() },
      { key: "1,0", mesh: triangle() },
    ];
    for (const layer of ["buildings", "plates", "roads"] as const) {
      const { objects } = drawMeshLayers(
        { ...fullMesh(), [layer]: twoChunks },
        {
          buildings: false,
          trees: false,
          plates: false,
          roads: false,
          poi: false,
          areas: false,
          [layer]: true,
        },
      );
      expect(objects).toHaveLength(2);
      const [first, second] = objects as THREE.Mesh[];
      expect(first?.material).not.toBe(second?.material);
      expect(first?.geometry).not.toBe(second?.geometry);
      for (const chunk of objects) {
        expect(chunk.userData["sharedResources"]).toBeUndefined();
      }
    }
  });
});

describe("drawMeshLayers — trees are instanced, one mesh per variant (W6)", () => {
  /** Three trees: two broadleaved, one needleleaved. */
  function forest(): TransferableMesh {
    return {
      ...fullMesh(),
      trees: [
        {
          feature: "node/1",
          position: { x: 10, y: 20 },
          groundHeightM: 53,
          heightM: 8,
          crownDiameterM: 4,
          rotationY: 0,
          variant: "broadleaved",
        },
        {
          feature: "node/2",
          position: { x: 11, y: 21 },
          groundHeightM: 54,
          heightM: 9,
          crownDiameterM: 5,
          rotationY: 0.5,
          variant: "broadleaved",
        },
        {
          feature: "node/3",
          position: { x: 12, y: 22 },
          groundHeightM: 55,
          heightM: 10,
          crownDiameterM: 6,
          rotationY: 1,
          variant: "needleleaved",
        },
      ],
    };
  }

  function treeMeshes(mesh: TransferableMesh): THREE.InstancedMesh[] {
    // Every other layer explicitly OFF. Since W9 an omitted layer draws, and the
    // POI markers are instanced too — so `{ trees: true }` alone would put their
    // InstancedMesh in this filter and count it as a tree variant.
    const { objects } = drawMeshLayers(mesh, {
      buildings: false,
      trees: true,
      plates: false,
      roads: false,
      poi: false,
      areas: false,
    });
    return objects.filter(
      (object): object is THREE.InstancedMesh =>
        (object as THREE.InstancedMesh).isInstancedMesh === true,
    );
  }

  it("draws ONE object per variant rather than one per tree", () => {
    // WHY THIS TEST MATTERS. This is the finding, not a refactor: the package
    // emits placements precisely so a forest is a handful of draw calls, and
    // `packInstances` was written for it and never called — so the demo
    // allocated a fresh ConeGeometry AND a fresh MeshStandardMaterial for every
    // tree, on every publish, three publishes per click. Counting objects is
    // the only assertion that can tell the two apart, because both draw trees.
    const meshes = treeMeshes(forest());
    expect(meshes).toHaveLength(2);
    expect(meshes.map((m) => m.count).sort()).toEqual([1, 2]);
  });

  it("gives each variant its OWN geometry, so they stop all being firs", () => {
    // The defect R4-3 reports. `variant` is computed in the package, crosses
    // the worker boundary, and was read by nothing — so a broadleaved tree and
    // a needleleaved tree rendered as the identical cone. Distinct geometry per
    // variant is the minimum that can be false when that regresses.
    const meshes = treeMeshes(forest());
    const geometries = new Set(meshes.map((m) => m.geometry));
    expect(geometries.size).toBe(2);
  });

  it("places an instance at the reflected position, standing ON the ground", () => {
    // The SAME trap `poiMarkerPosition` documents: ENU `+y` is north and the
    // scene's north is `-z`. It is worth re-asserting through the instance
    // matrix because the reflection moved — it now comes from the package's
    // `packInstances` rather than from a per-tree `position.set`, and a
    // regression there is a forest 100 m from its own buildings, self-consistent
    // and therefore reading as bad data.
    const meshes = treeMeshes(forest());
    const needle = meshes.find((m) => m.count === 1);
    expect(needle).toBeDefined();

    const matrix = new THREE.Matrix4();
    needle?.getMatrixAt(0, matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(position.x).toBeCloseTo(12);
    expect(position.z).toBeCloseTo(-22);
    // The BASE sits on the sampled ground: the unit geometries are built with
    // their base at y = 0 precisely so this is the ground height itself rather
    // than the ground height plus half a tree.
    expect(position.y).toBeCloseTo(55);
  });

  it("scales an instance by its own height and crown", () => {
    // The half of R4-3 that was already correct and must stay so: tree size is
    // real data (tagged `height`, else a stable hash), and it is what the
    // owner noticed working. Instancing must carry it through the matrix.
    const meshes = treeMeshes(forest());
    const needle = meshes.find((m) => m.count === 1);
    const matrix = new THREE.Matrix4();
    needle?.getMatrixAt(0, matrix);
    const scale = new THREE.Vector3().setFromMatrixScale(matrix);
    expect(scale.y).toBeCloseTo(10);
    expect(scale.x).toBeCloseTo(6);
    expect(scale.z).toBeCloseTo(6);
  });

  it("marks its geometry and material as BORROWED", () => {
    // Shared across every instance and every render — that is the point. If
    // `clear()` disposed them, the first refresh would destroy them and every
    // later frame would silently draw nothing: three.js does not throw for a
    // disposed geometry, and the counters would keep reporting the trees.
    for (const mesh of treeMeshes(forest())) {
      expect(mesh.userData["sharedResources"]).toBe(true);
    }
  });

  it("draws nothing at all when there are no trees", () => {
    expect(treeMeshes({ ...fullMesh(), trees: [] })).toHaveLength(0);
  });
});

describe("drawMeshLayers — POI markers get their own models (W19)", () => {
  function poiMesh(kinds: string[]): THREE.InstancedMesh[] {
    const mesh = {
      ...fullMesh(),
      poi: kinds.map((kind, i) => ({
        feature: `node/${i}`,
        position: { x: i, y: -i },
        groundHeightM: 53,
        kind,
        label: kind,
        rotationY: 0,
        scale: 1,
      })),
    } as TransferableMesh;
    const { objects } = drawMeshLayers(mesh, {
      buildings: false,
      trees: false,
      plates: false,
      roads: false,
      poi: true,
      areas: false,
    });
    return objects as THREE.InstancedMesh[];
  }

  it("draws one mesh PER KIND, so a bench is not a waste basket", () => {
    // The whole of W19 in one assertion. Before it, every marker shared a single
    // orange cone — a bench, a hospital entrance and a fountain all identical.
    const meshes = poiMesh(["amenity=bench", "amenity=waste_basket"]);
    expect(meshes).toHaveLength(2);
    expect(new Set(meshes.map((m) => m.geometry)).size).toBe(2);
  });

  it("groups instances of the SAME kind into one mesh", () => {
    // The draw-call budget: fifty kinds is a handful of meshes only if repeats
    // share one. Ten benches must not be ten meshes.
    const meshes = poiMesh(Array.from({ length: 10 }, () => "amenity=bench"));
    expect(meshes).toHaveLength(1);
    expect(meshes[0]?.count).toBe(10);
  });

  it("puts the whole unmodelled tail in ONE fallback mesh", () => {
    // Fifty kinds are modelled and roughly 650 are not, so the tail is the
    // common case. A bucket per unmodelled kind would be hundreds of draw calls
    // for markers that look identical anyway.
    const meshes = poiMesh([
      "amenity=nonexistent_a",
      "amenity=nonexistent_b",
      "shop=nonexistent_c",
    ]);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]?.count).toBe(3);
  });

  it("keeps each mesh's identity table aligned with its own instances", () => {
    // Instancing indexes identity by position in the array that built the
    // matrices. Per-kind meshes mean per-kind arrays, and handing any mesh the
    // WHOLE marker list would make every pick after the first bucket name the
    // wrong place — confidently, and only for some kinds.
    const meshes = poiMesh([
      "amenity=bench",
      "amenity=waste_basket",
      "amenity=bench",
    ]);
    for (const mesh of meshes) {
      const markers = mesh.userData["poiInstances"] as { kind: string }[];
      expect(markers).toHaveLength(mesh.count);
      for (const marker of markers) {
        expect(marker.kind).toBe(markers[0]?.kind);
      }
    }
  });

  it("shares geometry across renders, so a rebuild allocates nothing", () => {
    // W7's instancing removed the per-marker allocation; fifty kinds would put
    // it straight back if each render rebuilt their geometry. The cache is what
    // makes Stage 2 affordable, and `sharedResources` is what stops `clear()`
    // destroying it.
    const first = poiMesh(["amenity=bench"])[0];
    const second = poiMesh(["amenity=bench"])[0];
    expect(first?.geometry).toBe(second?.geometry);
    expect(first?.material).toBe(second?.material);
    expect(first?.userData["sharedResources"]).toBe(true);
  });
});

describe("drawMeshLayers — POI markers", () => {
  it("carries the markers IN INSTANCE ORDER, so a pick can name what was clicked", () => {
    // The identity that reaches the details panel. Since W7 the pins share one
    // `InstancedMesh`, so there is nowhere per-object left to put it — the table
    // is an array and the hit's `instanceId` indexes it.
    //
    // ORDER IS THE ASSERTION, not presence. The table is built in the same loop
    // as the instance matrices precisely so the two cannot disagree; a table
    // assembled anywhere else would survive a `clear()` and the next render
    // while pointing at the PREVIOUS working set, which is a panel confidently
    // describing the wrong feature.
    const { objects } = drawMeshLayers(fullMesh(), ALL_ON);
    const pin = objects.find((o) => o.userData["poiInstances"] !== undefined);
    expect(pin).toBeDefined();
    const markers = pin?.userData["poiInstances"] as { label: string }[];
    expect(markers.map((m) => m.label)).toEqual(["Café Schmitz"]);
  });

  it("SHARES one geometry and material, and flags them so nothing disposes them", () => {
    // WHY THIS TEST MATTERS. Markers are numerous and identical, which is the
    // whole reason the package emits placements instead of geometry — so the pins
    // share one geometry and one material. But `BuildingView.clear()` disposes the
    // geometry and material of every child it removes, which for a shared resource
    // means the FIRST refresh destroys it and every later frame draws nothing.
    //
    // That failure is silent in exactly the way this codebase keeps meeting:
    // three.js does not throw for a disposed geometry, the counters still report
    // the markers, and the layer simply stops appearing. The flag is what lets
    // `clear()` tell "mine to free" from "borrowed".
    const first = drawMeshLayers(fullMesh(), ALL_ON).objects.find(
      (o) => o.userData["poiInstances"] !== undefined,
    );
    const second = drawMeshLayers(fullMesh(), ALL_ON).objects.find(
      (o) => o.userData["poiInstances"] !== undefined,
    );
    expect(first).toBeInstanceOf(THREE.Mesh);
    const a = first as THREE.Mesh;
    const b = second as THREE.Mesh;
    // The same instances ACROSS calls, which is what makes disposal fatal.
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    expect(a.userData["sharedResources"]).toBe(true);
  });
});

describe("drawMeshLayers — region slabs", () => {
  it("colours a slab through the CALLER's scale, not one of its own", () => {
    // WHY THIS IS THE TEST W14 EXISTS FOR. A region that reads as "good" in the
    // 2D map and "poor" in the 3D view is the cross-view disagreement the store
    // was introduced to prevent, and a colour function defined in here would
    // reintroduce it by the back door — silently, because both views would look
    // internally consistent.
    //
    // The context is the seam: `main.ts` passes the same `heatColour`/`heatScale`
    // pair the map paints with, built from the same snapshot.
    const { objects } = drawMeshLayers(
      fullMesh(),
      {
        ...ALL_ON,
        buildings: false,
        trees: false,
        plates: false,
        poi: false,
        roads: false,
      },
      { colourForScore: (score) => (score === 4 ? 0x123456 : 0x000000) },
    );
    expect(objects).toHaveLength(1);
    const slab = objects[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    expect(slab.material.color.getHex()).toBe(0x123456);
  });

  it("falls back to a VISIBLY wrong colour when no scale is given", () => {
    // Magenta, not a plausible grey. The only way to reach this is for a caller
    // to forget the real scale, and a plausible colour would make that mistake
    // look like a design choice — the same reasoning as `NO_DATA_RGB`.
    const { objects } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
      trees: false,
      plates: false,
      poi: false,
      roads: false,
    });
    const slab = objects[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    expect(slab.material.color.getHex()).toBe(0xff00ff);
  });

  it("puts the slab on the shared ladder, above plates and roads", () => {
    // A region is a claim ABOUT the ground rather than part of it, which is the
    // ordering `layer-order.ts` states. Coplanar with the roads it would z-fight.
    const { objects } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
      trees: false,
      plates: false,
      poi: false,
      roads: false,
    });
    expect(objects[0]?.position.y).toBeCloseTo(groundLift("areas"), 10);
  });
});

describe("drawMeshLayers — the counters", () => {
  it("reports what was DRAWN, not what was available", () => {
    // The status line describing geometry that is switched off is the class of
    // defect the store and the legend exist to prevent — it makes the number and
    // the picture disagree with no way to tell which is lying.
    const { stats } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
    });
    expect(stats.volumes).toBe(0);
    expect(stats.parts).toBe(0);
    expect(stats.triangles).toBe(0);
    expect(stats.guessedHeights).toBe(0);
    expect(stats.approximateRoofs).toBe(0);
    // The layers still on are untouched by the one that went off.
    expect(stats.trees).toBe(1);
    expect(stats.plates).toBe(3);
  });

  it("counts every layer when everything is on", () => {
    const { stats } = drawMeshLayers(fullMesh(), ALL_ON);
    expect(stats).toEqual({
      volumes: 21,
      parts: 25,
      triangles: 1,
      guessedHeights: 7,
      approximateRoofs: 2,
      trees: 1,
      plates: 3,
      plateTriangles: 1,
      poi: 1,
      areas: 1,
      roads: 2,
      roadTriangles: 1,
    });
  });

  it("returns a fully-populated stats object even with every layer off", () => {
    // `undefined` in a counter renders as "undefined" in the status line rather
    // than as 0, and `toBeGreaterThan(undefined)` passes — a real defect this repo
    // has already shipped once, via a dropped field in `buildHeightfieldData`.
    const { stats } = drawMeshLayers(fullMesh(), {
      ...ALL_ON,
      buildings: false,
      trees: false,
      plates: false,
      poi: false,
      roads: false,
      areas: false,
    });
    for (const value of Object.values(stats)) expect(value).toBe(0);
    expect(Object.keys(stats)).toHaveLength(12);
  });
});

describe("meshLayerSelection", () => {
  it("picks exactly the mesh layers out of the full registry set", () => {
    // This is what keeps `main.ts` from hand-listing the mesh layers a second
    // time. It listed them twice before, so adding a layer meant remembering two
    // places and the failure of forgetting one was a layer that could be toggled
    // in the UI but never drew.
    const all = Object.fromEntries(
      ALL_LAYERS.map((layer) => [layer, true]),
    ) as Record<LayerKind, boolean>;
    const selection = meshLayerSelection({ ...all, plates: false });

    expect(Object.keys(selection).sort()).toEqual([...DRAWN_BY_MESH].sort());
    expect(selection.plates).toBe(false);
    expect(selection.buildings).toBe(true);
  });
});

/**
 * WHY THESE TESTS MATTER (DEC-R7b-7). The region slab shipped for six rounds
 * with `transparent: true` and three's default `depthWrite: true`. A translucent
 * surface that writes depth occludes transparent geometry drawn after it, so the
 * slabs and the affordance grid composited differently depending on which
 * happened to be drawn first — reported from a testing session as "the alpha
 * transparency is suddenly broken from some angles".
 *
 * THE POINT IS THAT THIS NEEDED NO SCREENSHOT. The defect is a property of the
 * material, visible to a unit test, and the cell grid in `building-view.ts` had
 * always paired the two correctly. Nothing compared them.
 */
describe("the transparent layers composite deterministically", () => {
  const areaMaterial = (): THREE.MeshStandardMaterial => {
    const { objects } = drawMeshLayers(fullMesh(), {
      buildings: false,
      trees: false,
      plates: false,
      poi: false,
      roads: false,
      areas: true,
    });
    const mesh = objects[0] as THREE.Mesh;
    return mesh.material as THREE.MeshStandardMaterial;
  };

  it("never lets a translucent surface write depth", () => {
    // The pairing itself. `transparent` without `depthWrite: false` is the bug;
    // asserting the RELATIONSHIP rather than the literal means a future change to
    // the opacity cannot reintroduce it while both values still look deliberate.
    const material = areaMaterial();
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
  });

  it("draws a region single-sided, now that it has no walls to blend against", () => {
    // DoubleSide made every slab blend against its own far face. That was the
    // price of the boundary walls (DEC-R2-11); with those gone it is pure cost.
    const material = areaMaterial();
    expect(material.side).toBe(THREE.FrontSide);
  });

  it("orders regions under the cells, so the finer claim wins", () => {
    // Without an explicit order, three sorts transparent objects back-to-front by
    // distance — which flips as the camera moves, and reads as flicker rather
    // than as a decision about which claim is on top.
    const material = areaMaterial();
    expect(material).toBeDefined();
    const { objects } = drawMeshLayers(fullMesh(), {
      buildings: false,
      trees: false,
      plates: false,
      poi: false,
      roads: false,
      areas: true,
    });
    expect(objects[0]?.renderOrder).toBe(RENDER_ORDER.areas);
    // NOT `expect(RENDER_ORDER.areas).toBeLessThan(RENDER_ORDER.cells)`. That
    // compared two frozen literals from the same object, so it could never
    // fail — and it passed for the whole time the invariant was actually
    // INVERTED in the scene, because `RENDER_ORDER.cells` was never assigned to
    // anything. The grid sat at three's default 0 and the slab drew over it.
    //
    // The grid is built by `building-view.ts`, which needs a WebGL context, so
    // the object-level assertion lives in `building-view` territory rather than
    // here. What this file can honestly claim is the half it draws: the slab
    // takes the rung it was given.
    expect(objects[0]?.renderOrder).toBeGreaterThan(0);
  });
});

/**
 * WHY THIS TEST MATTERS (DEC-R7b-3a). Selecting a region in the 3D scene works
 * only if the slab carries its id into `userData` — `building-view.ts` uses that
 * key BOTH to decide the object is raycastable and to name what was hit, so a
 * missing id makes the slab silently unselectable rather than throwing.
 */
describe("region slabs carry their identity into the scene", () => {
  it("puts the region id on the drawn object", () => {
    const { objects } = drawMeshLayers(fullMesh(), {
      buildings: false,
      trees: false,
      plates: false,
      poi: false,
      roads: false,
      areas: true,
    });
    expect(objects[0]?.userData["regionId"]).toBe("r1");
  });
});
