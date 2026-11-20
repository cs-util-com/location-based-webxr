/**
 * The look-dev pond's chosen wave set, P50 (programme plan 2026-09-26-0539,
 * W6 plan §5); the other candidates were rated and dropped. GENERATED from
 * the W6 exploration's wave sets (seeded, with the shader's anti-alias fade,
 * an integer-hash warp and a wave-group envelope); do not edit the GLSL by
 * hand. C0, the six built-in waves, needs no GLSL.
 *
 * `peaks`: the repetition metric (the highest autocorrelation peak of the
 * slope field; 1 = an exact repeat), the median over 8 window positions,
 * at pixel footprints 0 / 1 / 2.5 / 4 m. Today's six waves read
 * 0.97 / 0.98 / 1.00 / 1.00. `alu`: a hand-counted estimate per water
 * pixel (today's: 126), not a frame time.
 *
 * @see water-candidates.js.md
 */
export const WATER_CANDIDATES = [
  {
    id: "P50",
    label: "phone, 12 waves + wind patches",
    peaks: [0.31, 0.36, 0.4, 0.5],
    alu: 470,
    slopeGlsl:
      "// Generated: 12 waves, warp 4.00000000 m @ 90.0000000 m, seed 6, group envelope depth 0.8 at 72 m, 2 channel(s), seed 1006.\nuint waterLowbias32(uint x) {\n  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;\n  return x;\n}\n// Cell hash: lowbias32(ix ^ lowbias32(iz ^ seedMix)), seedMix = lowbias32(seed) folded in JS.\nuint waterCellHash(uvec2 c, uint seedMix) {\n  return waterLowbias32(c.x ^ waterLowbias32(c.y ^ seedMix));\n}\n// Two noise channels in [-1, 1] from one hash: high and low 16 bits.\nvec2 waterCorner(uint h) {\n  return vec2(float(h >> 16u), float(h & 0xffffu)) * (2.0 / 65535.0) - 1.0;\n}\nvec2 waterNoise(vec2 x, uint seedMix) {\n  vec2 i = floor(x);\n  vec2 f = x - i;\n  uvec2 c = uvec2(ivec2(i) + ivec2(1048576));\n  vec2 u = f * f * (3.0 - 2.0 * f);\n  vec2 a = waterCorner(waterCellHash(c, seedMix));\n  vec2 b = waterCorner(waterCellHash(c + uvec2(1u, 0u), seedMix));\n  vec2 d = waterCorner(waterCellHash(c + uvec2(0u, 1u), seedMix));\n  vec2 e = waterCorner(waterCellHash(c + uvec2(1u, 1u), seedMix));\n  return a + (b - a) * u.x + (d - a) * u.y + (a - b - d + e) * (u.x * u.y);\n}\nvec2 waterWarp(vec2 p) {\n  vec2 w = vec2(0.0);\n  w += 4.00000000 * waterNoise(p * 0.0111111111, 0xa7e3d3bbu);\n  return w;\n}\n// One travelling wave: A*k*cos(k(d.q) - w t + phase) along d, faded as its phase change\n// per pixel nears aliasing. fwidth sees the warp through the screen derivatives of q.\nvoid waterWave(vec2 q, float t, vec2 d, float k, float ak, float w, float phase, inout vec2 slope) {\n  float ph = k * dot(d, q);\n  float fade = 1.0 - smoothstep(0.800000000, 1.60000000, fwidth(ph));\n  slope += fade * ak * cos(ph - w * t + phase) * d;\n}\nvec2 waterSlopeAt(vec2 p, float t) {\n  vec2 q = p + waterWarp(p);\n  vec2 env = mix(vec2(1.0), waterNoise(p * 0.0138888889, 0x13c0f7a1u), 0.800000000);\n  vec2 slope = vec2(0.0);\n  waterWave(q, t, vec2(0.769190205, -0.639019896), 0.130563537, 0.0648247455 * env.x, 1.13173685, 4.16682893, slope);\n  waterWave(q, t, vec2(0.905906483, 0.423477797), 0.152892425, 0.0648247455 * env.y, 1.22469371, 0.444622499, slope);\n  waterWave(q, t, vec2(0.333623112, 0.942706539), 0.176863987, 0.0648247455 * env.x, 1.31720754, 6.09818094, slope);\n  waterWave(q, t, vec2(0.307695959, 0.951484733), 0.196184509, 0.0648247455 * env.y, 1.38728873, 2.40482274, slope);\n  waterWave(q, t, vec2(0.830837434, -0.556515191), 0.226703369, 0.0648247455 * env.x, 1.49129476, 2.84625702, slope);\n  waterWave(q, t, vec2(0.811545085, 0.584289804), 0.237873540, 0.0648247455 * env.y, 1.52759269, 3.02250706, slope);\n  waterWave(q, t, vec2(0.960806051, -0.277221451), 0.279838216, 0.0648247455 * env.x, 1.65686840, 6.20703190, slope);\n  waterWave(q, t, vec2(0.990972271, -0.134066989), 0.300771037, 0.0648247455 * env.y, 1.71772054, 5.93684837, slope);\n  waterWave(q, t, vec2(0.206645343, 0.978415915), 0.379295250, 0.0648247455 * env.x, 1.92895993, 4.38873158, slope);\n  waterWave(q, t, vec2(0.251971591, 0.967734632), 0.827656219, 0.0648247455 * env.y, 2.84943986, 5.93330861, slope);\n  waterWave(q, t, vec2(0.896399639, 0.443246757), 1.95804476, 0.0648247455 * env.x, 4.38274105, 1.29051606, slope);\n  waterWave(q, t, vec2(0.968415903, -0.249340407), 4.27785053, 0.0648247455 * env.y, 6.47809491, 5.22336428, slope);\n  return slope;\n}",
  },
];
