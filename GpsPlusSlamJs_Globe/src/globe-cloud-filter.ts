/**
 * The cloud map's sampling (round-3 plan 2026-10-08-2345 M1, DEC-R3-5): a
 * cubic B-spline over the map's texels in four bilinear taps (Sigg and
 * Hadwiger, GPU Gems 2 ch. 20), shared by every reader of the map (the
 * surface's paint and shadow, the shell, the volume's coverage) so they
 * agree where they meet. A bilinear read draws the texel grid at high
 * magnification: its value is a facet per texel, and the shading's
 * screen gradient of it is constant per texel, which the owner saw as
 * pixels at 3,000 km. The B-spline is smooth to its second derivative.
 */

/**
 * The four cubic B-spline weights for a fraction `t` in [0, 1) of the way
 * from texel 1 to texel 2 of the four texels 0..3 around a point. They sum
 * to 1 and are never negative (so the four bilinear taps below hold them).
 */
export function bsplineWeights(
  t: number,
): readonly [number, number, number, number] {
  const s = 1 - t;
  return [
    (s * s * s) / 6,
    (4 - 6 * t * t + 3 * t * t * t) / 6,
    (1 + 3 * t + 3 * t * t - 3 * t * t * t) / 6,
    (t * t * t) / 6,
  ];
}

/**
 * One axis of the four-tap form: the two tap positions (in texel units,
 * texel centres at i + 0.5) and the share of the first tap. The pair of
 * texels 0, 1 is read by one linear tap at its weighted position, and so
 * is 2, 3.
 * @param x the sample position in texels (texel i covers [i, i + 1)).
 */
export function bsplineTaps(x: number): {
  readonly at: readonly [number, number];
  readonly share: number;
} {
  const st = x - 0.5;
  const i = Math.floor(st);
  const [w0, w1, w2, w3] = bsplineWeights(st - i);
  const g0 = w0 + w1;
  const g1 = w2 + w3;
  return {
    at: [i - 0.5 + w1 / g0, i + 1.5 + w3 / g1],
    share: g0,
  };
}

/**
 * The GLSL twin, at a program's global scope: `globeCloudCubic( sampler,
 * uv, dx, dy )` with the map's gradients (the surface, its shadow and the
 * shell), and `globeCloudCubicLod( sampler, uv )` at level 0 (the volume's
 * march, where no gradients exist). `uCloudCubic` below 0.5 reads the map
 * bilinearly instead (the lab's `cloudCubic=0`, to compare). Guarded, so a
 * program that includes it twice (a relief tile: the surface's declarations
 * and the volume shadow's coverage chunk) declares it once.
 */
export const GLOBE_CLOUD_FILTER_GLSL = /* glsl */ `
#ifndef GLOBE_CLOUD_FILTER
#define GLOBE_CLOUD_FILTER
uniform float uCloudCubic;
vec4 globeCubicWeights( float t ) {
  vec4 n = vec4( 1.0, 2.0, 3.0, 4.0 ) - t;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4( x, y, z, 6.0 - x - y - z ) / 6.0;
}
void globeCubicTaps( vec2 size, vec2 uv, out vec4 at, out vec2 share ) {
  vec2 st = uv * size - 0.5;
  vec2 f = fract( st );
  vec2 i = st - f;
  vec4 wx = globeCubicWeights( f.x );
  vec4 wy = globeCubicWeights( f.y );
  vec4 g = vec4( wx.xz + wx.yw, wy.xz + wy.yw );
  at = ( i.xxyy + vec4( -0.5, 1.5, -0.5, 1.5 ) + vec4( wx.yw, wy.yw ) / g ) / size.xxyy;
  share = vec2( g.x / ( g.x + g.y ), g.z / ( g.z + g.w ) );
}
float globeCloudCubic( sampler2D map, vec2 uv, vec2 dx, vec2 dy ) {
  if ( uCloudCubic < 0.5 ) return textureGrad( map, uv, dx, dy ).r;
  vec4 at; vec2 share;
  globeCubicTaps( vec2( textureSize( map, 0 ) ), uv, at, share );
  float a = textureGrad( map, at.xz, dx, dy ).r;
  float b = textureGrad( map, at.yz, dx, dy ).r;
  float c = textureGrad( map, at.xw, dx, dy ).r;
  float d = textureGrad( map, at.yw, dx, dy ).r;
  return mix( mix( d, c, share.x ), mix( b, a, share.x ), share.y );
}
float globeCloudCubicLod( sampler2D map, vec2 uv ) {
  if ( uCloudCubic < 0.5 ) return textureLod( map, uv, 0.0 ).r;
  vec4 at; vec2 share;
  globeCubicTaps( vec2( textureSize( map, 0 ) ), uv, at, share );
  float a = textureLod( map, at.xz, 0.0 ).r;
  float b = textureLod( map, at.yz, 0.0 ).r;
  float c = textureLod( map, at.xw, 0.0 ).r;
  float d = textureLod( map, at.yw, 0.0 ).r;
  return mix( mix( d, c, share.x ), mix( b, a, share.x ), share.y );
}
#endif`;
