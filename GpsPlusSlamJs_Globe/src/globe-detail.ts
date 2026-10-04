/**
 * The relief's detail colour (globe round-5 F1): a grid of light factors
 * over a region (`globe-albedo`'s high-pass of the terrain lab's style B
 * against the imagery's footprint, computed by the lab), read by the
 * relief's tiles at each fragment's place and multiplied into the
 * imagery's colour. Off until a grid is set.
 *
 * @see globe-detail.ts.md
 */
import * as THREE from "three";

import { smoothstep } from "./globe-camera.js";

export const GLOBE_DETAIL = Object.freeze({
  /** The lab's ENU frame (`enuFrameAt`): metres a degree of latitude. */
  metresPerDegLat: 111_320,
  /** The detail fades out from this share of the drawn half extent. */
  fadeFrom: 0.9,
});

/** A grid of factors: `side` posts a row, post 0 at -`extentM`, drawn over +-`halfM`. */
export interface GlobeDetailGrid {
  readonly ratio: Float32Array;
  readonly side: number;
  readonly extentM: number;
  readonly halfM: number;
}

/** The uniforms every relief tile's shader shares. */
export interface GlobeDetailUniforms {
  readonly uDetail: { value: THREE.Texture };
  /** 1 while a grid is set, else 0. */
  readonly uDetailOn: { value: number };
  /** (centre latitude, centre longitude in degrees, extentM, side). */
  readonly uDetailRegion: { value: THREE.Vector4 };
  readonly uDetailHalfM: { value: number };
}

const DEG = Math.PI / 180;

/**
 * Where a geodetic latitude and longitude falls in a grid placed at
 * `centre` (the shader's mapping, for tests): the texture coordinate (u
 * east, v north; a post at its texel's centre) and the fade (1 inside
 * `fadeFrom` of the drawn half extent, 0 at and beyond it). The longitude
 * difference is taken the short way round.
 */
export function detailPlace(
  latDeg: number,
  lngDeg: number,
  centre: { lat: number; lng: number },
  grid: { side: number; extentM: number; halfM: number },
): { u: number; v: number; fade: number } {
  let dLng = lngDeg - centre.lng;
  dLng -= 360 * Math.floor((dLng + 180) / 360);
  const x = dLng * Math.cos(centre.lat * DEG) * GLOBE_DETAIL.metresPerDegLat;
  const y = (latDeg - centre.lat) * GLOBE_DETAIL.metresPerDegLat;
  const spacing = (2 * grid.extentM) / (grid.side - 1);
  const edge = Math.max(Math.abs(x), Math.abs(y));
  return {
    u: ((x + grid.extentM) / spacing + 0.5) / grid.side,
    v: ((y + grid.extentM) / spacing + 0.5) / grid.side,
    fade:
      1 -
      smoothstep(
        (edge - GLOBE_DETAIL.fadeFrom * grid.halfM) /
          ((1 - GLOBE_DETAIL.fadeFrom) * grid.halfM),
      ),
  };
}

/** A 1 x 1 factor of 1: what the shader reads while no grid is set. */
function neutralTexture(): THREE.DataTexture {
  return redHalfTexture(new Float32Array([1]), 1);
}

function redHalfTexture(values: Float32Array, side: number): THREE.DataTexture {
  const data = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    data[i] = THREE.DataUtils.toHalfFloat(values[i]!);
  }
  const texture = new THREE.DataTexture(
    data,
    side,
    side,
    THREE.RedFormat,
    THREE.HalfFloatType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createGlobeDetailUniforms(): GlobeDetailUniforms {
  return {
    uDetail: { value: neutralTexture() },
    uDetailOn: { value: 0 },
    uDetailRegion: { value: new THREE.Vector4(0, 0, 1, 2) },
    uDetailHalfM: { value: 1 },
  };
}

/**
 * Sets the grid the relief's tiles read (a half-float red texture, row 0
 * south, linearly filtered as the lab's is) at `centre`, or switches the
 * detail off for null. The previous texture is disposed. RangeError when
 * the grid does not hold `side`^2 factors or its sizes are not positive.
 */
export function setGlobeDetail(
  uniforms: GlobeDetailUniforms,
  grid: GlobeDetailGrid | null,
  centre: { lat: number; lng: number },
): void {
  if (grid !== null) {
    if (
      !(Number.isInteger(grid.side) && grid.side >= 2) ||
      grid.ratio.length !== grid.side * grid.side ||
      !(grid.extentM > 0 && grid.halfM > 0)
    ) {
      throw new RangeError(
        `a detail grid needs side^2 factors and positive extents, got ${grid.ratio.length} for side ${grid.side}`,
      );
    }
  }
  uniforms.uDetail.value.dispose();
  if (grid === null) {
    uniforms.uDetail.value = neutralTexture();
    uniforms.uDetailOn.value = 0;
    return;
  }
  uniforms.uDetail.value = redHalfTexture(grid.ratio, grid.side);
  uniforms.uDetailRegion.value.set(
    centre.lat,
    centre.lng,
    grid.extentM,
    grid.side,
  );
  uniforms.uDetailHalfM.value = grid.halfM;
  uniforms.uDetailOn.value = 1;
}

/** The uniforms, after `#include <common>`. */
export const DETAIL_DECLARATIONS = /* glsl */ `
uniform sampler2D uDetail;
uniform float uDetailOn;
uniform vec4 uDetailRegion;
uniform float uDetailHalfM;`;

/**
 * After `#include <map_fragment>` (the imagery in `diffuseColor`, linear):
 * `detailPlace` from the globe patch's geodetic normal, then the colour
 * times the factor, faded by the place's fade and `uDetailOn`.
 */
export const DETAIL_FRAGMENT = /* glsl */ `
{
  vec3 detailN = normalize( vGeoNormal );
  float detailLat = degrees( asin( clamp( detailN.z, -1.0, 1.0 ) ) );
  float detailLng = degrees( atan( detailN.y, detailN.x ) ) - uDetailRegion.y;
  detailLng -= 360.0 * floor( ( detailLng + 180.0 ) / 360.0 );
  vec2 detailEnu = vec2( detailLng * cos( radians( uDetailRegion.x ) ), detailLat - uDetailRegion.x ) * ${GLOBE_DETAIL.metresPerDegLat.toFixed(1)};
  float detailSpacing = 2.0 * uDetailRegion.z / ( uDetailRegion.w - 1.0 );
  vec2 detailUv = ( ( detailEnu + uDetailRegion.z ) / detailSpacing + 0.5 ) / uDetailRegion.w;
  float detailEdge = max( abs( detailEnu.x ), abs( detailEnu.y ) );
  float detailFade = uDetailOn * ( 1.0 - smoothstep( ${GLOBE_DETAIL.fadeFrom.toFixed(2)} * uDetailHalfM, uDetailHalfM, detailEdge ) );
  diffuseColor.rgb *= mix( 1.0, texture2D( uDetail, detailUv ).r, detailFade );
}`;
