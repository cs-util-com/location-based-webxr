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
  // Why (F1a review minor 7): the conversion assumes plate-carree
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

  // Why (F1a review minor 5): the library snaps its pole rows to 90
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
});

describe("bathymetry clamped at the surface", () => {
  // Why (F1a review major 3; one-scene plan §5): exaggerated sea floors
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
    // The error target picked by the look (F1a review major 4): 2 draws
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
    terrain.tiles.dispatchEvent({
      type: "dispose-model",
      scene: model,
      tile: {},
    } as never);
    expect(terrain.litTiles()).toBe(0);
    terrain.dispose();
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
