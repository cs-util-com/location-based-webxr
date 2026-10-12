/**
 * Why this test matters: the relief's tiles take `globe-albedo`'s detail
 * (the terrain lab's style B high-pass over the imagery) from a grid of
 * light factors the lab computes over its region. The shader finds a
 * fragment's place in that grid from its geodetic normal; the lab placed
 * its posts with an equirectangular frame at the region's centre
 * (`enuFrameAt`, the AR core's metres a degree). A different mapping would shift the
 * detail against the relief by kilometres at the region's edge, and
 * nothing would look broken, only wrong. So the shader's mapping has a
 * twin here, checked against posts placed the lab's way, and the texture
 * is checked to carry the grid unchanged, filtered as the lab's is.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  DETAIL_FRAGMENT,
  GLOBE_DETAIL,
  createGlobeDetailUniforms,
  detailPlace,
  setGlobeDetail,
} from "./globe-detail.js";

const centre = { lat: 46.5, lng: 8.0 };
const grid = { side: 5, extentM: 2_000, halfM: 1_500 };

/** A post's lat/lng the lab's way (enuFrameAt's inverse). */
const postLatLng = (x: number, y: number) => ({
  lat: centre.lat + y / GLOBE_DETAIL.metresPerDegLat,
  lng:
    centre.lng +
    x /
      (GLOBE_DETAIL.metresPerDegLngEquator *
        Math.cos((centre.lat * Math.PI) / 180)),
});

describe("detailPlace", () => {
  it("puts each of the lab's posts at its texel's centre", () => {
    const spacing = (2 * grid.extentM) / (grid.side - 1);
    for (let r = 0; r < grid.side; r++) {
      for (let c = 0; c < grid.side; c++) {
        const x = -grid.extentM + c * spacing;
        const y = -grid.extentM + r * spacing;
        const p = postLatLng(x, y);
        const place = detailPlace(p.lat, p.lng, centre, grid);
        expect(place.u).toBeCloseTo((c + 0.5) / grid.side, 9);
        expect(place.v).toBeCloseTo((r + 0.5) / grid.side, 9);
      }
    }
  });

  it("fades the detail out over the drawn region's outer tenth, and wraps the date line", () => {
    const inside = postLatLng(0, 0);
    expect(detailPlace(inside.lat, inside.lng, centre, grid).fade).toBe(1);
    const edge = postLatLng(grid.halfM, 0);
    expect(detailPlace(edge.lat, edge.lng, centre, grid).fade).toBe(0);
    const mid = postLatLng(0.95 * grid.halfM, 0);
    const f = detailPlace(mid.lat, mid.lng, centre, grid).fade;
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
    // Across 180 degrees the longitude difference is the short way round.
    const east = { lat: 0, lng: 179.99 };
    const p = detailPlace(0, -179.99, east, grid);
    expect(p.u).toBeGreaterThan(0.5);
    expect(p.u).toBeLessThan(1);
  });
});

describe("setGlobeDetail", () => {
  it("holds the grid as a half-float red texture, linearly filtered, and switches the detail on", () => {
    const u = createGlobeDetailUniforms();
    expect(u.uDetailOn.value).toBe(0);
    const ratio = Float32Array.from({ length: 25 }, (_, i) => 0.5 + i / 24);
    setGlobeDetail(u, { ratio, ...grid }, centre);
    const t = u.uDetail.value as THREE.DataTexture;
    expect(t.type).toBe(THREE.HalfFloatType);
    expect(t.format).toBe(THREE.RedFormat);
    expect(t.magFilter).toBe(THREE.LinearFilter);
    expect(t.image.width).toBe(5);
    const data = t.image.data as Uint16Array;
    for (let i = 0; i < 25; i++) {
      expect(THREE.DataUtils.fromHalfFloat(data[i]!)).toBeCloseTo(ratio[i]!, 2);
    }
    expect(u.uDetailOn.value).toBe(1);
    expect(u.uDetailRegion.value.toArray()).toEqual([
      centre.lat,
      centre.lng,
      grid.extentM,
      grid.side,
    ]);
    expect(u.uDetailHalfM.value).toBe(grid.halfM);
  });

  it("switches off and frees the texture for null, and refuses a grid of the wrong size", () => {
    const u = createGlobeDetailUniforms();
    setGlobeDetail(u, { ratio: new Float32Array(25).fill(1), ...grid }, centre);
    const first = u.uDetail.value;
    let disposed = false;
    first.addEventListener("dispose", () => {
      disposed = true;
    });
    setGlobeDetail(u, null, centre);
    expect(disposed).toBe(true);
    expect(u.uDetailOn.value).toBe(0);
    expect(() =>
      setGlobeDetail(u, { ratio: new Float32Array(24), ...grid }, centre),
    ).toThrow(RangeError);
  });
});

describe("DETAIL_FRAGMENT", () => {
  // The shader's copy of detailPlace: the same constant and the same
  // fade, multiplying the imagery's colour (linear) by the factor.
  it("maps by the geodetic normal with the lab's metres a degree and fades at the edge", () => {
    expect(DETAIL_FRAGMENT).toContain("vGeoNormal");
    expect(DETAIL_FRAGMENT).toContain(GLOBE_DETAIL.metresPerDegLat.toFixed(4));
    expect(DETAIL_FRAGMENT).toContain(
      GLOBE_DETAIL.metresPerDegLngEquator.toFixed(4),
    );
    expect(DETAIL_FRAGMENT).toContain(
      `smoothstep( ${GLOBE_DETAIL.fadeFrom.toFixed(2)} * uDetailHalfM, uDetailHalfM`,
    );
    expect(DETAIL_FRAGMENT).toContain(
      "diffuseColor.rgb *= mix( 1.0, texture2D( uDetail, detailUv ).r, detailFade );",
    );
  });
});
