/**
 * The city look: the page's wiring between a drawn mesh's scheme, the
 * time-of-day look weights, the brightness trim, the noon gain and the
 * plates.
 *
 * WHY THESE TESTS MATTER. `BuildingView` cannot be built in the unit suite
 * (it constructs a `WebGLRenderer`), so before this module existed the
 * app-level wiring of the blend (the material trim going to 1 under the look
 * weights, a time-of-day build drawn on the shared mix, a later fixed build
 * getting its own trim back) was covered by nothing: each ingredient was
 * tested, the order they were called in was not. These tests draw a real
 * mesh through the real layer table and read the materials and geometry
 * the GPU would get.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CityLook } from "./city-look.js";
import { colourSchemeOf, COLOUR_SCHEME_NAMES } from "./colour-schemes.js";
import type { GroundSlopeColours } from "./ground-slope-colours.js";
import { TIME_OF_DAY, TIME_OF_DAY_LOOKS } from "./look-choice.js";
import { LANDUSE_PLATE_TAG } from "./mesh-layers.js";
import { mixedPageLook } from "./mixed-page-look.js";
import type { TransferableMesh } from "./worker/protocol.js";

const LOOKS = TIME_OF_DAY_LOOKS.length;

/** One triangle with vertex colours, baked in every look. */
function lookChunk(): unknown {
  return {
    key: "0,0",
    mesh: {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      triangleCount: 1,
      forcedEars: 0,
    },
    colors: new Float32Array(9).fill(0.5),
    lookColours: Array.from({ length: LOOKS }, (_, k) =>
      new Uint8Array(9).fill(40 * (k + 1)),
    ),
  };
}

/** A mesh with buildings, roads and plates, built in `scheme`. */
function meshIn(scheme: string): TransferableMesh {
  return {
    buildKey: `test-${scheme}`,
    colourScheme: scheme,
    buildings: [lookChunk()],
    trees: [],
    cosmeticTrees: [],
    furniture: [],
    plates: [lookChunk()],
    plateCount: 1,
    roads: [lookChunk()],
    roadCount: 1,
    underground: [],
    regions: [],
    poi: [],
    volumes: 1,
    parts: 1,
    guessedHeights: 0,
    approximateRoofs: 0,
    inventedRoofCount: 0,
    barriers: 0,
    fallbackBuildings: 0,
  } as unknown as TransferableMesh;
}

function cityLook(): {
  look: CityLook;
  root: THREE.Group;
  grounds: { ground: number; slope: GroundSlopeColours }[];
  landUse: (readonly number[] | undefined)[];
} {
  const root = new THREE.Group();
  const grounds: { ground: number; slope: GroundSlopeColours }[] = [];
  const landUse: (readonly number[] | undefined)[] = [];
  const look = new CityLook({
    root,
    setGroundColours: (ground, slope) => grounds.push({ ground, slope }),
    setLandUseLookWeights: (weights) => landUse.push(weights),
  });
  return { look, root, grounds, landUse };
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o as THREE.Mesh);
  });
  return out;
}

function neutral(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  return meshes(root)
    .map((m) => m.material as THREE.MeshStandardMaterial)
    .filter((m) => m.userData["neutralSurface"] === true);
}

function plates(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  return meshes(root)
    .filter((m) => m.userData[LANDUSE_PLATE_TAG] === true)
    .map((m) => m.material as THREE.MeshStandardMaterial);
}

/** A fixed scheme whose trim is not 1, so carrying it over would show. */
const TRIMMED = COLOUR_SCHEME_NAMES.find(
  (name) => colourSchemeOf(name).brightnessTrim !== 1,
);
const GOLDEN = [0, 1, 0, 0] as const;
const GAIN = 1.25;

describe("CityLook - the time-of-day blend drawn on the page", () => {
  // WHY: the trims fold into the mix's weights, so under weights the
  // material trim must be 1; a fixed scheme's trim left on the material
  // would brighten the blend twice. The fixed scheme is drawn FIRST so a
  // missing reset to 1 shows.
  it("draws a time-of-day build on the mix, with the trim folded into it", () => {
    expect(TRIMMED).toBeDefined();
    const { look, root } = cityLook();
    look.setSurfaceGain(GAIN);
    look.followScheme(TRIMMED, GOLDEN);
    look.followScheme(TIME_OF_DAY, GOLDEN);
    look.draw(meshIn(TIME_OF_DAY), undefined, undefined);

    const surfaces = neutral(root);
    expect(surfaces).toHaveLength(2);
    for (const m of surfaces) {
      expect([m.color.r, m.color.g, m.color.b]).toEqual([GAIN, GAIN, GAIN]);
    }
    const trimGolden = colourSchemeOf(TIME_OF_DAY_LOOKS[1]).brightnessTrim;
    expect(look.mix.trimWeights.value.toArray()).toEqual([0, trimGolden, 0, 0]);
    // Buildings and roads carry every look and no plain colours.
    for (const mesh of meshes(root).filter(
      (m) => m.userData[LANDUSE_PLATE_TAG] !== true,
    )) {
      const geometry = mesh.geometry;
      for (let k = 0; k < LOOKS; k++) {
        expect(geometry.getAttribute(`lookColour${k}`)).toBeDefined();
      }
      expect(geometry.getAttribute("color")).toBeUndefined();
    }
    for (const m of plates(root)) {
      expect(m.color.getHex()).toBe(mixedPageLook([...GOLDEN]).plates);
    }
  });

  // WHY: the trim is the scheme's, so a fixed build after the blend must get
  // its own trim back, not keep the blend's 1.
  it("gives a following fixed build its scheme's trim back", () => {
    const { look, root } = cityLook();
    look.setSurfaceGain(GAIN);
    look.followScheme(TIME_OF_DAY, GOLDEN);
    look.draw(meshIn(TIME_OF_DAY), undefined, undefined);
    look.followScheme(TRIMMED, GOLDEN);
    root.clear();
    look.draw(meshIn(TRIMMED ?? ""), undefined, undefined);
    const trim = colourSchemeOf(TRIMMED).brightnessTrim;
    for (const m of neutral(root)) {
      expect(m.color.r).toBeCloseTo(GAIN * trim, 12);
    }
    // A fixed build draws its plain colours, never the mix.
    for (const mesh of meshes(root)) {
      const geometry = mesh.geometry;
      expect(geometry.getAttribute("lookColour0")).toBeUndefined();
    }
    expect(look.lookWeights).toBeUndefined();
    for (const m of plates(root)) {
      expect(m.color.getHex()).toBe(colourSchemeOf(TRIMMED).ground.plates);
    }
  });

  // WHY: a weight change between builds is uniform and colour writes only;
  // the plates drawn already must follow it, or they keep the look of the
  // build they were drawn with (the plates once took a boot constant).
  it("recolours the drawn plates, ground and land use when the weights move", () => {
    const { look, root, grounds, landUse } = cityLook();
    look.followScheme(TIME_OF_DAY, GOLDEN);
    look.draw(meshIn(TIME_OF_DAY), undefined, undefined);
    const dusk = [0, 0, 1, 0];
    look.setLookWeights(dusk);
    const mixed = mixedPageLook(dusk);
    for (const m of plates(root)) expect(m.color.getHex()).toBe(mixed.plates);
    expect(grounds.at(-1)).toEqual({
      ground: mixed.ground,
      slope: mixed.slope,
    });
    expect(landUse.at(-1)).toEqual(dusk);
    expect(look.mix.trimWeights.value.toArray()).toEqual(mixed.trimWeights);
  });

  // WHY: a bad weight list must change nothing (the store or a link can
  // hand one in), so the check runs before any write.
  it("refuses bad weights and changes nothing", () => {
    const { look, grounds } = cityLook();
    look.followScheme(TIME_OF_DAY, GOLDEN);
    const before = look.mix.trimWeights.value.toArray();
    expect(() => look.setLookWeights([1, Number.NaN, 0, 0])).toThrow(
      RangeError,
    );
    expect(() => look.setLookWeights([1, 0])).toThrow(RangeError);
    expect(look.mix.trimWeights.value.toArray()).toEqual(before);
    expect(look.lookWeights).toEqual(GOLDEN);
    expect(grounds).toHaveLength(1);
  });
});

/**
 * Source-text checks, because `BuildingView` and `main.ts` cannot be run in
 * the unit suite: they pin that the page routes through the city look, so
 * the runtime tests above test the code the page runs.
 */
describe("CityLook - the page routes through it", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const view = readFileSync(path.join(HERE, "building-view.ts"), "utf-8");
  const main = readFileSync(path.join(HERE, "main.ts"), "utf-8");

  it("BuildingView draws the city only through the city look", () => {
    expect(view).toContain("this.cityLook.draw(mesh, layers, context)");
    expect(view).not.toMatch(/\bdrawMeshLayers\(/);
    expect(view).not.toMatch(/\bapplySurfaceGain\(/);
    expect(view).not.toMatch(/\bsetTrimWeights\(/);
  });

  it("main routes every full mesh's scheme to the city look", () => {
    expect(main).toContain(
      "buildingView.followMeshScheme(built.mesh.colourScheme,",
    );
    expect(main).not.toContain("plateColour");
  });
});
