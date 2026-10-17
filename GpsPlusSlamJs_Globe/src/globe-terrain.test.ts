/**
 * The globe's relief carrier, prepared (round-5 plan 2026-10-01-0945 §8
 * DEC-GL5-9; F0 results 2026-10-02-0307 §7).
 *
 * Why this test matters: the carrier is the tile library's own terrain
 * tiles, and the F0 spike measured three defects in using them as they
 * ship: (1) heights as 32-bit float with linear filtering read 0 m on a
 * device without OES_texture_float_linear (flat relief); (2) the tiles
 * draw with the library's own material, not the globe's look; (3) the
 * library hands the imagery overlay a range in ITS tiling (Web Mercator,
 * Terrarium's) while the globe's imagery is plate carrée (EPSG:4326), so
 * every tile showed imagery from a different latitude (at 46.5 N, from
 * about 26 N: the Sahara instead of the Alps). These tests pin each fix
 * on the CPU side; the GPU side is the lab's globe-terrain smoke.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import * as plugins from "3d-tiles-renderer/plugins";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GLOBE_TERRAIN,
  createGlobeTerrain,
  geographicOverlay,
  litTerrainMaterial,
  mercatorToGeographicRange,
  tileGeographicBounds,
  useHalfFloatHeights,
} from "./globe-terrain.js";
import {
  DETAIL_DECLARATIONS,
  DETAIL_FRAGMENT,
  createGlobeDetailUniforms,
} from "./globe-detail.js";
import { reliefCacheBudget } from "./globe-relief-cache.js";

const DEG = Math.PI / 180;
/** Normalised Web Mercator y (0 south, 1 north) of a latitude. */
const mercY = (latDeg: number) =>
  (Math.log(Math.tan(Math.PI / 4 + (latDeg * DEG) / 2)) + Math.PI) /
  (2 * Math.PI);

describe("mercatorToGeographicRange", () => {
  // Why: the library passes the overlay a range normalised in Web
  // Mercator; the imagery is normalised in plate carree. Longitude is
  // linear in both; latitude is not.
  it("keeps longitude and maps Mercator latitude to plate carree", () => {
    const r = mercatorToGeographicRange([0.25, mercY(40), 0.5, mercY(50)]);
    expect(r[0]).toBeCloseTo(0.25, 12);
    expect(r[2]).toBeCloseTo(0.5, 12);
    expect(r[1]).toBeCloseTo((40 + 90) / 180, 12);
    expect(r[3]).toBeCloseTo((50 + 90) / 180, 12);
  });

  it("maps the whole Mercator square to +-85.0511 degrees", () => {
    const r = mercatorToGeographicRange([0, 0, 1, 1]);
    const edge = (2 * Math.atan(Math.exp(Math.PI)) - Math.PI / 2) / DEG;
    expect(edge).toBeCloseTo(85.0511, 4);
    expect(r).toEqual([
      0,
      expect.closeTo((90 - edge) / 180, 12),
      1,
      expect.closeTo((90 + edge) / 180, 12),
    ]);
  });

  // Why: the size of the F0 noon defect, as a number: a tile at 46.5 N
  // asked the imagery for about 26.3 N.
  it("is where the unconverted range landed 20 degrees south at 46.5 N", () => {
    const y = mercY(46.5);
    const asIfGeographic = y * 180 - 90;
    expect(asIfGeographic).toBeCloseTo(26.3, 1);
    expect(mercatorToGeographicRange([0, y, 1, y])[1] * 180 - 90).toBeCloseTo(
      46.5,
      9,
    );
  });

  it("refuses a range that is not four finite numbers in order", () => {
    for (const bad of [
      [0, 0, 1],
      [0, 0.5, 1, 0.4],
      [0, Number.NaN, 1, 1],
    ]) {
      expect(() => mercatorToGeographicRange(bad)).toThrow(RangeError);
    }
  });
});

describe("geographicOverlay", () => {
  // Why: the library's terrain plugin calls hasContent / lockTexture /
  // getTexture / releaseTexture with ITS range and level; the adapter must
  // hand the imagery the converted range at the imagery's own level, and
  // pass everything else through.
  it("converts the range and picks the imagery's own level for it", () => {
    const calls: { name: string; range: number[]; level: number }[] = [];
    const texture = new THREE.Texture();
    const imagery = {
      tiling: { maxLevel: 5 },
      init: () => Promise.resolve(),
      calculateLevel: (range: number[]) =>
        range[2]! - range[0]! > 0.5 ? 1 : 5,
      hasContent: (range: number[], level: number) => {
        calls.push({ name: "hasContent", range, level });
        return true;
      },
      lockTexture: (range: number[], level: number) => {
        calls.push({ name: "lockTexture", range, level });
        return Promise.resolve(texture);
      },
      getTexture: (range: number[], level: number) => {
        calls.push({ name: "getTexture", range, level });
        return texture;
      },
      releaseTexture: (range: number[], level: number) => {
        calls.push({ name: "releaseTexture", range, level });
      },
    };
    const adapted = geographicOverlay(imagery);
    expect(adapted.tiling).toBe(imagery.tiling);
    const m = [0.5, mercY(40), 0.53125, mercY(42)];
    expect(adapted.hasContent(m, 12)).toBe(true);
    expect(adapted.getTexture(m, 12)).toBe(texture);
    adapted.releaseTexture(m, 12);
    for (const c of calls) {
      expect(c.range[1]! * 180 - 90).toBeCloseTo(40, 9);
      expect(c.range[3]! * 180 - 90).toBeCloseTo(42, 9);
      expect(c.level).toBe(5);
    }
    expect(calls.map((c) => c.name)).toEqual([
      "hasContent",
      "getTexture",
      "releaseTexture",
    ]);
  });
});

describe("geographicOverlay, the imagery's projection", () => {
  // Why (review 2026-10-02-1235 minor 7): the conversion assumes plate-carree
  // imagery; a Web Mercator imagery source would be converted wrongly
  // without a word, so it is refused. The overlay's projection is only
  // known once it has initialised (before, the library reports "none":
  // the first lab run refused every overlay at construction), so the
  // check runs in init.
  it("refuses imagery that is not plate carree, once it has initialised", async () => {
    const imagery = (scheme: string) => {
      const tiling = { maxLevel: 5, projection: { scheme: "none" } };
      return {
        tiling,
        init: () => {
          tiling.projection.scheme = scheme;
          return Promise.resolve();
        },
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      };
    };
    const mercator = geographicOverlay(imagery("EPSG:3857"));
    await expect(mercator.init()).rejects.toThrow(RangeError);
    await expect(
      geographicOverlay(imagery("EPSG:4326")).init(),
    ).resolves.toBeUndefined();
    await expect(
      geographicOverlay(imagery("CRS:84")).init(),
    ).resolves.toBeUndefined();
  });
});

describe("useHalfFloatHeights", () => {
  // Why (F0b, measured): R32F with linear filtering is incomplete without
  // OES_texture_float_linear and reads 0 m; R16F filters linearly in
  // WebGL2 without any extension (1,625.3 m read back against 1,625.0 m).
  it("uploads a float height texture as R16F, once", () => {
    const t = new THREE.DataTexture(
      new Float32Array(4),
      2,
      2,
      THREE.RedFormat,
      THREE.FloatType,
    );
    const version = t.version;
    useHalfFloatHeights(t);
    expect(t.internalFormat).toBe("R16F");
    expect(t.version).toBe(version + 1);
    useHalfFloatHeights(t);
    expect(t.version).toBe(version + 1);
  });

  it("leaves a texture that is not 32-bit float alone", () => {
    const t = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    useHalfFloatHeights(t);
    expect(t.internalFormat).toBeNull();
  });

  it("states the half-float height step it accepts", () => {
    expect(GLOBE_TERRAIN.halfFloatStepM(1000)).toBe(0.5);
    expect(GLOBE_TERRAIN.halfFloatStepM(4000)).toBe(2);
    expect(GLOBE_TERRAIN.halfFloatStepM(8848)).toBe(8);
  });
});

describe("tileGeographicBounds", () => {
  // Why: the imagery UV is computed per vertex from the geodetic normal
  // (exact, unlike a linear map across a Mercator tile, which is 15 km
  // off at level 5 and 860 km at level 2); the tile's box comes from the
  // same normals.
  it("reads the latitude and longitude box from the normals", () => {
    const g = new THREE.BufferGeometry();
    const n = (lat: number, lng: number) => [
      Math.cos(lat * DEG) * Math.cos(lng * DEG),
      Math.cos(lat * DEG) * Math.sin(lng * DEG),
      Math.sin(lat * DEG),
    ];
    g.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(
        [...n(40, 5), ...n(42, 5), ...n(40, 7.5), ...n(42, 7.5)],
        3,
      ),
    );
    const b = tileGeographicBounds(g);
    expect(b.west / DEG).toBeCloseTo(5, 4);
    expect(b.east / DEG).toBeCloseTo(7.5, 4);
    expect(b.south / DEG).toBeCloseTo(40, 4);
    expect(b.north / DEG).toBeCloseTo(42, 4);
  });

  // Why (review 2026-10-02-1235 minor 5): the library snaps its pole rows to 90
  // degrees while the imagery it was asked for ends at the Web Mercator
  // limit (85.0511 degrees); the box must end there too, or a pole tile's
  // imagery is stretched over the cap.
  it("ends a pole tile's box at the Web Mercator limit", () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(
        [0, 0, 1, 0.1, 0, 0.995, 0, 0.1, 0.995],
        3,
      ),
    );
    expect(tileGeographicBounds(g).north / DEG).toBeCloseTo(85.0511, 4);
  });

  it("refuses a geometry without normals", () => {
    expect(() => tileGeographicBounds(new THREE.BufferGeometry())).toThrow(
      RangeError,
    );
  });
});

describe("litTerrainMaterial", () => {
  // Why: the globe's look (night lights, clouds, the water glint) and the
  // library's terrain (displacement, its bump chunk) must both reach one
  // material, as the globe does for its own tiles, with the imagery's UV
  // taken from the geodetic normal.
  it("keeps the terrain's maps and runs both compile hooks", () => {
    const template = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const order: string[] = [];
    template.onBeforeCompile = () => order.push("globe");
    const own = new THREE.MeshLambertMaterial();
    own.onBeforeCompile = () => order.push("terrain");
    own.map = new THREE.Texture();
    own.displacementMap = new THREE.DataTexture(
      new Float32Array(1),
      1,
      1,
      THREE.RedFormat,
      THREE.FloatType,
    );
    own.displacementScale = 3;
    own.bumpMap = own.displacementMap;
    own.bumpScale = 3;
    const bounds = { west: 0.1, south: 0.7, east: 0.2, north: 0.8 };
    const lit = litTerrainMaterial(template, own, bounds);
    expect(lit).not.toBe(template);
    expect(lit.map).toBe(own.map);
    expect(lit.displacementMap).toBe(own.displacementMap);
    expect(lit.displacementScale).toBe(3);
    expect(lit.bumpMap).toBe(own.bumpMap);
    expect(lit.bumpScale).toBe(3);
    const shader = {
      vertexShader: "#include <common>\nvoid main() {\n#include <uv_vertex>\n}",
      fragmentShader: "void main() {}",
      uniforms: {} as Record<string, THREE.IUniform>,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    lit.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(order).toEqual(["terrain", "globe"]);
    expect(shader.vertexShader).toContain("uTerrainGeoBounds");
    expect(shader.vertexShader).toMatch(/vMapUv\s*=/);
    expect(
      (shader.uniforms.uTerrainGeoBounds?.value as THREE.Vector4).toArray(),
    ).toEqual([0.1, 0.7, 0.2, 0.8]);
    expect(lit.customProgramCacheKey()).toBe(GLOBE_TERRAIN.programKey);
    // The imagery UV is clamped to the tile's texture (pole rows).
    expect(shader.vertexShader).toContain("vMapUv = clamp(");
    // The relief's side of the band's dither (globe-surface-material.ts):
    // its tiles keep the pixels the globe's tiles drop.
    expect(
      shader.fragmentShader.startsWith("#define GLOBE_FADE_SIDE 1\n"),
    ).toBe(true);
  });

  // Why (F1, globe-albedo plus detail on the library's tiles): the detail
  // factor multiplies the imagery's colour right after the map is read,
  // before the globe's clouds whiten it, from ONE uniforms object every
  // tile shares (the lab sets it once for all tiles). A tile compiled
  // without its anchor must fail loudly, not drop the detail.
  it("multiplies the shared detail into the imagery right after the map", () => {
    const template = new THREE.MeshStandardMaterial();
    const own = new THREE.MeshLambertMaterial();
    const detail = createGlobeDetailUniforms();
    const bounds = { west: 0.1, south: 0.7, east: 0.2, north: 0.8 };
    const shaderOf = (fragmentShader: string) =>
      ({
        vertexShader:
          "#include <common>\nvoid main() {\n#include <uv_vertex>\n}",
        fragmentShader,
        uniforms: {} as Record<string, THREE.IUniform>,
      }) as unknown as THREE.WebGLProgramParametersWithUniforms;
    const a = shaderOf(
      "#include <common>\nvoid main() {\n#include <map_fragment>\n#include <alphamap_fragment>\n}",
    );
    const b = shaderOf(a.fragmentShader);
    litTerrainMaterial(template, own, bounds, detail).onBeforeCompile(
      a,
      {} as THREE.WebGLRenderer,
    );
    litTerrainMaterial(template, own, bounds, detail).onBeforeCompile(
      b,
      {} as THREE.WebGLRenderer,
    );
    const fs = a.fragmentShader;
    expect(fs.split(DETAIL_FRAGMENT).length - 1).toBe(1);
    expect(fs.indexOf("#include <map_fragment>")).toBeLessThan(
      fs.indexOf(DETAIL_FRAGMENT),
    );
    expect(fs.indexOf(DETAIL_FRAGMENT)).toBeLessThan(
      fs.indexOf("#include <alphamap_fragment>"),
    );
    expect(fs.indexOf(DETAIL_DECLARATIONS)).toBeLessThan(fs.indexOf("main"));
    for (const name of [
      "uDetail",
      "uDetailOn",
      "uDetailRegion",
      "uDetailHalfM",
    ] as const) {
      expect(a.uniforms[name]).toBe(detail[name]);
      expect(b.uniforms[name]).toBe(detail[name]);
    }
    const missing = shaderOf("#include <common>\nvoid main() {}");
    expect(() =>
      litTerrainMaterial(template, own, bounds, detail).onBeforeCompile(
        missing,
        {} as THREE.WebGLRenderer,
      ),
    ).toThrow("#include <map_fragment>");
  });

  // Why (G0 spikes 2026-10-17, Q5): a second imagery overlay through the
  // library's ImageOverlayPlugin wraps each tile's material: its compile
  // hook declares the layers under `#if ... < LAYER_COUNT`, and the count
  // is a DEFINE on the material. The lit copy carried the hook but not the
  // defines, so the shader failed to compile ("LAYER_COUNT: unexpected
  // token") and the relief vanished. The copy must carry the tile's defines
  // (its own object: the plugin later writes to the material the mesh
  // wears, which is the lit copy), next to the standard material's own.
  it("carries the overlay plugin's defines next to the material's own", () => {
    const template = new THREE.MeshStandardMaterial();
    const own = new THREE.MeshLambertMaterial();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), own);
    const model = new THREE.Group();
    model.add(mesh);
    const overlays = new plugins.ImageOverlayPlugin({
      overlays: [],
      renderer: {} as THREE.WebGLRenderer,
    }) as unknown as {
      _wrapMaterials(scene: THREE.Object3D): void;
    };
    overlays._wrapMaterials(model);
    // What the plugin's layer update writes once a layer's texture is in.
    own.defines!.LAYER_COUNT = 1;
    own.defines!.LAYER_0_EXISTS = 1;
    const lit = litTerrainMaterial(template, own, {
      west: 0.1,
      south: 0.7,
      east: 0.2,
      north: 0.8,
    });
    expect(lit.defines).toEqual({
      STANDARD: "",
      LAYER_COUNT: 1,
      LAYER_0_EXISTS: 1,
    });
    expect(lit.defines).not.toBe(own.defines);
    expect(lit.defines).not.toBe(template.defines);
    // A tile without the plugin keeps exactly the standard material's.
    const plain = litTerrainMaterial(
      template,
      new THREE.MeshLambertMaterial(),
      { west: 0.1, south: 0.7, east: 0.2, north: 0.8 },
    );
    expect(plain.defines).toEqual({ STANDARD: "" });
  });
});

describe("bathymetry clamped at the surface", () => {
  // Why (review 2026-10-02-1235 major 3; one-scene plan §5): exaggerated sea floors
  // sank 10-15 km under the water's imagery at E 3. Heights below 0 are
  // drawn and shaded as 0, so the sea keeps the globe's surface and colour.
  it("displaces and shades with heights clamped at 0", () => {
    const template = new THREE.MeshStandardMaterial();
    const own = new THREE.MeshLambertMaterial();
    own.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <bumpmap_pars_fragment>",
        "float a = texture2D( bumpMap, vBumpMapUv + dx ).x - texture2D( bumpMap, vBumpMapUv - dx ).x;",
      );
    };
    const lit = litTerrainMaterial(template, own, {
      west: 0,
      south: 0,
      east: 0.1,
      north: 0.1,
    });
    const shader = {
      vertexShader: [
        "#include <common>",
        "#include <uv_vertex>",
        "#include <displacementmap_vertex>",
      ].join("\n"),
      fragmentShader: "#include <bumpmap_pars_fragment>",
      uniforms: {} as Record<string, THREE.IUniform>,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    lit.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).not.toContain(
      "#include <displacementmap_vertex>",
    );
    expect(shader.vertexShader).toContain(
      "max( texture2D( displacementMap, vDisplacementMapUv ).x, 0.0 )",
    );
    // Every read of the bump map's height is clamped, none left bare.
    const reads = shader.fragmentShader.split("texture2D( bumpMap,").length - 1;
    const clamped =
      shader.fragmentShader.split("max( texture2D( bumpMap,").length - 1;
    expect(reads).toBe(2);
    expect(clamped).toBe(reads);
    expect(shader.fragmentShader).toContain(
      "max( texture2D( bumpMap, vBumpMapUv + dx ).x, 0.0 )",
    );
  });
});

describe("the library's terrain plugin (a guard)", () => {
  // Why: the overlay adapter relies on the plugin asking the overlay with
  // its own tiling's normalised range; if a library bump converts the
  // range itself, the adapter would convert twice.
  it("still passes its own tiling's normalised range to the overlay", () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "node_modules",
        "3d-tiles-renderer",
        "src",
        "three",
        "plugins",
        "images",
        "terrain-rgb",
        "TerrainRGBMeshPlugin.js",
      ),
      "utf8",
    );
    expect(source).toContain(
      "const range = this._tiling.getTileBounds( x, y, level, true, false );",
    );
    expect(source).toContain("overlay.lockTexture( range, level )");
  });
});

describe("createGlobeTerrain", () => {
  // The plugin draws height tiles on an OffscreenCanvas; Node has none, and
  // these tests never draw one.
  beforeEach(() => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return null;
        }
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Why: the three fixes must reach every tile the library loads, without
  // the caller wiring each one: on each tile's load its heights go half
  // float and its material becomes the globe's lit copy over its box.
  it("registers the library's terrain plugin and fixes every loaded tile", () => {
    const template = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const imagery = {
      tiling: { maxLevel: 5 },
      init: () => Promise.resolve(),
      hasContent: () => false,
      lockTexture: () => Promise.resolve(null),
      getTexture: () => new THREE.Texture(),
      releaseTexture: () => {},
    };
    const terrain = createGlobeTerrain({
      url: "/heights/{z}/{x}/{y}.png",
      imagery,
      template,
      heightScale: 2,
    });
    expect(terrain.plugin.heightScale).toBe(2);
    // The per-frame clearance reads the drawn height through the plugin's
    // own sampler (review 2026-10-03-1835 major 1): null with nothing loaded.
    expect(terrain.plugin.sampleCartographicElevation(0.8, 0.16)).toBeNull();
    // The error target picked by the look (review 2026-10-02-1235 major 4): 2 draws
    // the real Alps as 1 does (mean 0.12 levels, 95th percentile 0 at
    // 30 km) for 9.9 MiB a descent against 11.5; 4 differs by 42 levels.
    expect(GLOBE_TERRAIN.errorTarget).toBe(2);
    expect(terrain.tiles.errorTarget).toBe(GLOBE_TERRAIN.errorTarget);
    const n = (lat: number, lng: number) => [
      Math.cos(lat * DEG) * Math.cos(lng * DEG),
      Math.cos(lat * DEG) * Math.sin(lng * DEG),
      Math.sin(lat * DEG),
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute([...n(46, 9), ...n(47, 10)], 3),
    );
    const heights = new THREE.DataTexture(
      new Float32Array(4),
      2,
      2,
      THREE.RedFormat,
      THREE.FloatType,
    );
    const own = new THREE.MeshLambertMaterial({ displacementMap: heights });
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(g, own);
    const model = new THREE.Group();
    model.add(mesh);
    terrain.tiles.dispatchEvent({
      type: "load-model",
      scene: model,
      tile: {},
      url: "",
    } as never);
    expect(heights.internalFormat).toBe("R16F");
    expect(mesh.material).not.toBe(own);
    expect((mesh.material as THREE.MeshStandardMaterial).displacementMap).toBe(
      heights,
    );
    expect(terrain.litTiles()).toBe(1);
    // Every loaded tile reads the terrain's one detail uniforms object,
    // off until the page sets a grid.
    const compiled = {
      vertexShader: "#include <common>\nvoid main() {\n#include <uv_vertex>\n}",
      fragmentShader:
        "#include <common>\nvoid main() {\n#include <map_fragment>\n}",
      uniforms: {} as Record<string, THREE.IUniform>,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mesh.material.onBeforeCompile(compiled, {} as THREE.WebGLRenderer);
    expect(compiled.uniforms.uDetail).toBe(terrain.detail.uDetail);
    expect(terrain.detail.uDetailOn.value).toBe(0);
    terrain.setDetail(
      {
        ratio: new Float32Array(4).fill(1.2),
        side: 2,
        extentM: 500,
        halfM: 400,
      },
      { lat: 46.5, lng: 9.5 },
    );
    expect(terrain.detail.uDetailOn.value).toBe(1);
    terrain.setDetail(null, { lat: 46.5, lng: 9.5 });
    expect(terrain.detail.uDetailOn.value).toBe(0);
    // The last tile's lit material is kept alive past its tile (review
    // 2026-10-03-2017 H4): its program must survive a release, or every
    // return into the band compiles it again. It goes with the terrain.
    const lit = mesh.material;
    const freeLit = vi.spyOn(lit, "dispose");
    terrain.tiles.dispatchEvent({
      type: "dispose-model",
      scene: model,
      tile: {},
    } as never);
    expect(terrain.litTiles()).toBe(0);
    expect(freeLit).not.toHaveBeenCalled();
    terrain.dispose();
    expect(freeLit).toHaveBeenCalledTimes(1);
  });

  // Why (F1, the altitude band): the library gives every renderer ONE
  // shared tile cache by default, and the globe caps it at its 64 MB. In
  // the band both carriers load into it, the cache filled and refused
  // every request: at 1,900 km the relief never settled and the globe's
  // loaded tiles fell from 178 to 70. The relief has a cache of its own,
  // with the globe's budget and the library's unload order.
  it("keeps the relief's tiles in a cache and queues of its own", () => {
    const defaults = new TilesRenderer();
    const shared = defaults.lruCache;
    const terrain = createGlobeTerrain({
      url: "/heights/{z}/{x}/{y}.png",
      imagery: {
        tiling: { maxLevel: 5 },
        init: () => Promise.resolve(),
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      },
      template: new THREE.MeshStandardMaterial(),
      heightScale: 1,
    });
    const own = terrain.tiles.lruCache;
    expect(own).not.toBe(shared);
    expect(own.maxBytesSize).toBe(GLOBE_TERRAIN.cacheBytes);
    expect(own.minBytesSize).toBe(GLOBE_TERRAIN.cacheFloorBytes);
    expect(GLOBE_TERRAIN.cacheBytes).toBe(64 * 1024 * 1024);
    expect(GLOBE_TERRAIN.cacheFloorBytes).toBe(48 * 1024 * 1024);
    expect(own.unloadPriorityCallback).toBe(shared.unloadPriorityCallback);
    expect(own.unloadPriorityCallback).toBeTypeOf("function");
    // The queues too (F1): a relief not updated outside the band left its
    // jobs in the shared parse queue, and the globe's 370 tiles waited
    // behind them (2 drawn at 1,900 km). Same limits and order, its own.
    const t = terrain.tiles;
    expect(t.downloadQueue).not.toBe(defaults.downloadQueue);
    expect(t.parseQueue).not.toBe(defaults.parseQueue);
    expect(t.processNodeQueue).not.toBe(defaults.processNodeQueue);
    expect(t.downloadQueue.maxJobsPerOrigin).toBe(
      defaults.downloadQueue.maxJobsPerOrigin,
    );
    expect(t.downloadQueue.priorityCallback).toBe(
      defaults.downloadQueue.priorityCallback,
    );
    expect(t.parseQueue.maxJobs).toBe(defaults.parseQueue.maxJobs);
    expect(t.parseQueue.priorityCallback).toBe(
      defaults.parseQueue.priorityCallback,
    );
    expect(t.processNodeQueue.maxJobs).toBe(defaults.processNodeQueue.maxJobs);
    expect(t.processNodeQueue.priorityCallback).toBe(
      defaults.processNodeQueue.priorityCallback,
    );
    terrain.dispose();
  });

  // Why (perf plan 2026-10-03-2017 H1, PERF-2b A): the library's E step
  // rebuilt every node's bounding volume (19,926 nodes by the end of one
  // descent), the likeliest source of the owner's phone hitches. The relief
  // must step through the deferred refresh, never the library's whole-tree
  // method, and expose its counters for the frame-hitch recorder.
  it("steps the height scale through the deferred refresh, not the whole-tree walk", () => {
    const proto = Object.getPrototypeOf(
      Object.getPrototypeOf(
        createGlobeTerrain({
          url: "/heights/{z}/{x}/{y}.png",
          imagery: {
            tiling: { maxLevel: 5 },
            init: () => Promise.resolve(),
            hasContent: () => false,
            lockTexture: () => Promise.resolve(null),
            getTexture: () => new THREE.Texture(),
            releaseTexture: () => {},
          },
          template: new THREE.MeshStandardMaterial(),
          heightScale: 1,
        }).plugin,
      ),
    ) as { _updateHeightScale: () => void };
    const wholeTree = vi.spyOn(proto, "_updateHeightScale");
    const terrain = createGlobeTerrain({
      url: "/heights/{z}/{x}/{y}.png",
      imagery: {
        tiling: { maxLevel: 5 },
        init: () => Promise.resolve(),
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      },
      template: new THREE.MeshStandardMaterial(),
      heightScale: 1,
    });
    // The plugin's own init may set its scale once, on an empty tree,
    // before the deferred refresh is installed; only the steps count.
    const atCreation = wholeTree.mock.calls.length;
    terrain.plugin.heightScale = 2.5;
    terrain.plugin.heightScale = 2.6;
    expect(wholeTree.mock.calls.length).toBe(atCreation);
    expect(terrain.heightScaleStats().scaleChanges).toBe(2);
    wholeTree.mockRestore();
    terrain.dispose();
  });

  // Why: the owner's phone measures before and after on ONE preview (perf
  // plan 2026-10-03-2017, DEC-PERF-2): `lazyHeightScale: false` keeps the
  // library's own whole-tree step, so the before run is the old cost.
  it("keeps the library's whole-tree step when the deferred refresh is off", () => {
    const options = {
      url: "/heights/{z}/{x}/{y}.png",
      imagery: {
        tiling: { maxLevel: 5 },
        init: () => Promise.resolve(),
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      },
      template: new THREE.MeshStandardMaterial(),
      heightScale: 1,
    };
    const proto = Object.getPrototypeOf(
      Object.getPrototypeOf(createGlobeTerrain(options).plugin),
    ) as { _updateHeightScale: () => void };
    const wholeTree = vi.spyOn(proto, "_updateHeightScale");
    const terrain = createGlobeTerrain({ ...options, lazyHeightScale: false });
    const atCreation = wholeTree.mock.calls.length;
    terrain.plugin.heightScale = 2.5;
    expect(wholeTree.mock.calls.length).toBe(atCreation + 1);
    expect(terrain.heightScaleStats()).toEqual({
      lastStepRefreshes: 0,
      deferredRefreshes: 0,
      scaleChanges: 0,
    });
    wholeTree.mockRestore();
    terrain.dispose();
  });

  // Why (owner decision 2026-10-04, DEC-N1): a return into the band must
  // find its decoded heights, not fetch them again. The relief keeps the
  // grids its tiles release within a budget (16 MiB by default, 0 off), and
  // the terrain's dispose gives them back.
  it("keeps released height grids within a budget, and exposes the keeper's counters", () => {
    const options = {
      url: "/heights/{z}/{x}/{y}.png",
      imagery: {
        tiling: { maxLevel: 5 },
        init: () => Promise.resolve(),
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      },
      template: new THREE.MeshStandardMaterial(),
      heightScale: 1,
    };
    expect(GLOBE_TERRAIN.keepHeightsBytes).toBe(16 * 2 ** 20);
    const terrain = createGlobeTerrain(options);
    expect(terrain.heightKeeperStats()).toEqual({
      kept: 0,
      keptBytes: 0,
      evicted: 0,
    });
    // Wrapped on the instance: the plugin's own method is no longer the
    // prototype's.
    const plugin = terrain.plugin as unknown as Record<string, unknown>;
    const proto = Object.getPrototypeOf(
      Object.getPrototypeOf(terrain.plugin),
    ) as Record<string, unknown>;
    expect(plugin["_releaseGrid"]).not.toBe(proto["_releaseGrid"]);
    terrain.dispose();
    expect(() =>
      createGlobeTerrain({ ...options, keepHeightsBytes: -1 }),
    ).toThrow(RangeError);
  });

  // Why (G0 spikes 2026-10-17, Q1): Mapterhorn serves 512 px tiles. The
  // library reads the size from its own option (default 256), and a 512 px
  // tile read as 256 px loads a quarter of the tile at every level: the
  // relief stood at the wrong place. The factory must pass it through, and
  // refuse a size the source tiling cannot have.
  it("passes the source's tile size to the plugin, 256 px by default", () => {
    const options = {
      url: "/heights/{z}/{x}/{y}.webp",
      imagery: {
        tiling: { maxLevel: 5 },
        init: () => Promise.resolve(),
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      },
      template: new THREE.MeshStandardMaterial(),
      heightScale: 1,
    };
    const plain = createGlobeTerrain(options);
    expect(
      (plain.plugin as unknown as { tileDimension: number }).tileDimension,
    ).toBe(256);
    expect(GLOBE_TERRAIN.tileDimension).toBe(256);
    plain.dispose();
    const fine = createGlobeTerrain({ ...options, tileDimension: 512 });
    expect(
      (fine.plugin as unknown as { tileDimension: number }).tileDimension,
    ).toBe(512);
    fine.dispose();
    for (const bad of [0, 100, 256.5, 8192, -256, Number.NaN]) {
      expect(() =>
        createGlobeTerrain({ ...options, tileDimension: bad }),
      ).toThrow(RangeError);
    }
  });

  // Why (G0 spikes 2026-10-17, the headline finding): 512 px heights filled
  // the 64 MB relief cache at 49 tiles and the tree silently stopped at
  // level 2. The app must be able to set the budget (per tile format and
  // device class, `reliefCacheBudget`), and to SEE a full cache that turns
  // tiles away: the terrain's `reliefCache()` reads the library's own
  // refusals. Driven here through the terrain's real cache and the
  // renderer's real queue step.
  it("takes the app's cache budget and reports a full cache that stalls", () => {
    const options = {
      url: "/heights/{z}/{x}/{y}.webp",
      imagery: {
        tiling: { maxLevel: 5 },
        init: () => Promise.resolve(),
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      },
      template: new THREE.MeshStandardMaterial(),
      heightScale: 1,
    };
    // The default stays the phone's 256 px budget, 64/48 MB.
    expect(reliefCacheBudget(256, "phone")).toEqual({
      maxBytes: GLOBE_TERRAIN.cacheBytes,
      minBytes: GLOBE_TERRAIN.cacheFloorBytes,
    });
    const budget = reliefCacheBudget(512, "desktop");
    const terrain = createGlobeTerrain({ ...options, cache: budget });
    const cache = terrain.tiles.lruCache;
    expect(cache.maxBytesSize).toBe(budget.maxBytes);
    expect(cache.minBytesSize).toBe(budget.minBytes);
    expect(terrain.reliefCache()).toEqual({
      usedBytes: 0,
      maxBytes: budget.maxBytes,
      full: false,
      refusedRequests: 0,
      refusedLoads: 0,
      stalled: false,
    });
    // Fill it, then run an update's queue step as the library does.
    const tile = { internal: { loadingState: 3 } };
    cache.add(tile, () => {});
    cache.setLoaded(tile, true);
    cache.setMemoryUsage(tile, budget.maxBytes);
    const tiles = terrain.tiles as unknown as {
      stats: { refused: number };
      frameCount: number;
      queueTileForDownload(t: unknown): void;
      dispatchEvent(e: { type: string }): void;
    };
    tiles.stats.refused = 0;
    tiles.frameCount++;
    tiles.queueTileForDownload({ internal: { loadingState: 0 } });
    tiles.dispatchEvent({ type: "update-after" });
    expect(terrain.reliefCache()).toMatchObject({
      full: true,
      refusedRequests: 1,
      stalled: true,
    });
    terrain.dispose();
    for (const bad of [
      { maxBytes: 0, minBytes: 0 },
      { maxBytes: 1_000, minBytes: 2_000 },
      { maxBytes: Number.NaN, minBytes: 1 },
      { maxBytes: 1_000, minBytes: -1 },
    ]) {
      expect(() => createGlobeTerrain({ ...options, cache: bad })).toThrow(
        RangeError,
      );
    }
  });

  // Why (G0 spikes 2026-10-17, "Mapterhorn DRAWN depends on mesh density"):
  // z14 drawn at the library's default depth (level 15, about 25.5 m
  // between vertices) is good enough only on flat ground; at level 17
  // (about 6.5 m) it passes everywhere from 0.75 m. The tree's depth is the
  // library's max(source levels + 1, the overlay tiling's maxLevel), so
  // `meshMaxLevel` deepens it through the overlay the plugin reads; the
  // tree only refines there near the camera (screen-space error).
  it("deepens the relief's tree to meshMaxLevel, and leaves it alone without", async () => {
    const options = {
      url: "/heights/{z}/{x}/{y}.webp",
      imagery: {
        tiling: { maxLevel: 5 },
        init: () => Promise.resolve(),
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      },
      template: new THREE.MeshStandardMaterial(),
      heightScale: 1,
      maxZoom: 14,
      tileDimension: 512,
    };
    type Rooted = {
      loadRootTileset(): Promise<unknown>;
      _tiling: { maxLevel: number };
    };
    // The library resolves its tileset's base path against the page.
    vi.stubGlobal("window", { location: { href: "http://127.0.0.1/" } });
    const plain = createGlobeTerrain(options);
    await (plain.plugin as unknown as Rooted).loadRootTileset();
    expect((plain.plugin as unknown as Rooted)._tiling.maxLevel).toBe(15);
    plain.dispose();
    const dense = createGlobeTerrain({ ...options, meshMaxLevel: 17 });
    await (dense.plugin as unknown as Rooted).loadRootTileset();
    expect((dense.plugin as unknown as Rooted)._tiling.maxLevel).toBe(17);
    dense.dispose();
    for (const bad of [-1, 16.5, 25, Number.NaN]) {
      expect(() =>
        createGlobeTerrain({ ...options, meshMaxLevel: bad }),
      ).toThrow(RangeError);
    }
  });

  // Why (G0 spikes, "Coverage"): Mapterhorn answers 404 at z14 outside
  // national coverage. Driven through the REAL plugin and image source
  // (only the network is a fake): the tile the library asks for, by its
  // own token order and url, must be asked of the fallback at the same
  // z/x/y, through the relief's download queue.
  it("asks the fallback source for a tile the relief's source answers 404 for", async () => {
    // The library resolves its tileset's base path against the page.
    vi.stubGlobal("window", { location: { href: "http://127.0.0.1/" } });
    // The download queue schedules its jobs a frame later.
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
      setTimeout(cb, 0),
    );
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        requests.push(url);
        return Promise.resolve(
          url.startsWith("https://primary/")
            ? new Response(null, { status: 404 })
            : new Response(null, { status: 503 }),
        );
      }),
    );
    const terrain = createGlobeTerrain({
      url: "https://primary/{z}/{x}/{y}.webp",
      fallbackUrl: "https://fallback/{z}/{x}/{y}.png",
      imagery: {
        tiling: { maxLevel: 5 },
        init: () => Promise.resolve(),
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      },
      template: new THREE.MeshStandardMaterial(),
      heightScale: 1,
      maxZoom: 14,
      tileDimension: 512,
    });
    const plugin = terrain.plugin as unknown as {
      loadRootTileset(): Promise<unknown>;
      _source: {
        fetchItem(tokens: number[], signal?: AbortSignal): Promise<unknown>;
      };
    };
    await plugin.loadRootTileset();
    await expect(plugin._source.fetchItem([8712, 5678, 14])).rejects.toThrow(
      /404, and its fallback HTTP 503/,
    );
    expect(requests).toEqual([
      "https://primary/14/8712/5678.webp",
      "https://fallback/14/8712/5678.png",
    ]);
    expect(terrain.reliefFallback()).toEqual({ fallbacks: 0, failures: 1 });
    terrain.dispose();
    // Without a fallback the library's own fetch stays in place.
    const plain = createGlobeTerrain({
      url: "https://primary/{z}/{x}/{y}.webp",
      imagery: {
        tiling: { maxLevel: 5 },
        init: () => Promise.resolve(),
        hasContent: () => false,
        lockTexture: () => Promise.resolve(null),
        getTexture: () => new THREE.Texture(),
        releaseTexture: () => {},
      },
      template: new THREE.MeshStandardMaterial(),
      heightScale: 1,
    });
    expect(plain.reliefFallback()).toBeNull();
    plain.dispose();
    expect(() =>
      createGlobeTerrain({
        url: "https://primary/{z}/{x}/{y}.webp",
        fallbackUrl: "https://fallback/{z}.png",
        imagery: {
          tiling: { maxLevel: 5 },
          init: () => Promise.resolve(),
          hasContent: () => false,
          lockTexture: () => Promise.resolve(null),
          getTexture: () => new THREE.Texture(),
          releaseTexture: () => {},
        },
        template: new THREE.MeshStandardMaterial(),
        heightScale: 1,
      }),
    ).toThrow(RangeError);
  });

  it("refuses a missing url or a height scale that is not finite and >= 0", () => {
    const template = new THREE.MeshStandardMaterial();
    const imagery = {
      tiling: {},
      init: () => Promise.resolve(),
      hasContent: () => false,
      lockTexture: () => Promise.resolve(null),
      getTexture: () => new THREE.Texture(),
      releaseTexture: () => {},
    };
    expect(() =>
      createGlobeTerrain({ url: "", imagery, template, heightScale: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      createGlobeTerrain({
        url: "/h/{z}/{x}/{y}.png",
        imagery,
        template,
        heightScale: -1,
      }),
    ).toThrow(RangeError);
  });
});
