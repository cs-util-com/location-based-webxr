/**
 * The near clouds' shaders: one ray march through the layer between the
 * ground and about 3 km, from its coverage by the cloud map to its aerial
 * perspective. The march works in camera-relative kilometres over a sphere
 * of radius R, y up at the camera, its frame kept by
 * `globe-cloud-march-frame.ts`. Every limit is a uniform and the loops run
 * to fixed bounds, so the distance scale and a step-down change each frame
 * without a shader swap.
 *
 * @see globe-cloud-march-glsl.ts.md
 */

export const CLOUD_MARCH_VERTEX = /* glsl */ `in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `precision highp float; precision highp int; precision highp sampler3D; precision highp sampler2D;
uniform float uH;          // camera altitude, km
uniform vec3 uFwd, uRight, uUp;
uniform vec2 uTan;         // tan(half fov) x, y
uniform vec3 uSun;         // unit vector toward the sun (camera-local frame, y up at the camera)
uniform float uPixAng;     // radians per canvas pixel
uniform vec3 uSunCol;      // sun path at sea level: air column, haze column, ozone path (from JS)

const float PI = 3.14159265;
const float R = 6371.0;
const float HR = 8.0;      // air scale height, km
const float HM = 1.2;      // marine haze scale height, km
const vec3 BR = vec3(5.802e-3, 13.558e-3, 33.1e-3);   // air scattering, 1/km at sea level
const vec3 BMS = vec3(0.022);                         // haze scattering
const vec3 BME = vec3(0.025);                         // haze extinction
const float ESUN = 20.0;

// first hit of the sphere of altitude hs from altitude h (> hs) along a unit ray with vertical cosine dy
float hitDown(float dy, float h, float hs) {
  float b = (R + h) * dy;
  float c = (h - hs) * (2.0 * R + h + hs);
  float disc = b * b - c;
  if (disc < 0.0 || b >= 0.0) return -1.0;
  return c / (-b + sqrt(disc));
}
float altOf(vec3 p) { return length(vec3(p.x, R + uH + p.y, p.z)) - R; }
vec3 upOf(vec3 p) { return normalize(vec3(p.x, R + uH + p.y, p.z)); }
float chap(float x, float mu) { float c = sqrt(1.5707963 * x); return c / ((c - 1.0) * mu + 1.0); }
float column(float h, float mu, float H) {
  if (mu >= 0.0) return H * exp(-h / H) * chap((R + h) / H, mu);
  float ht = max((R + h) * sqrt(max(0.0, 1.0 - mu * mu)) - R, -50.0); // finite for a sun under the Earth
  return max(0.0, 2.0 * H * exp(-ht / H) * chap((R + ht) / H, 0.0) - H * exp(-h / H) * chap((R + h) / H, -mu));
}
const vec3 BO3 = vec3(0.65e-3, 1.881e-3, 0.085e-3);
vec3 sunTrans(float h) {
  return exp(-(BR * (uSunCol.x * exp(-h / HR)) + BME * (uSunCol.y * exp(-h / HM)) + BO3 * uSunCol.z));
}
float phaseR(float c) { return 0.0596831 * (1.0 + c * c); }
float phaseM(float c, float g) {
  float g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}
void segment(float cR, float cM, float hRep, float cosT, out vec3 ins, out vec3 tr) {
  vec3 tau = BR * cR + BME * cM;
  tr = exp(-tau);
  vec3 tsR = sunTrans(hRep + 3.0);
  vec3 tsM = sunTrans(hRep + 0.4);
  float pm = 0.8 * phaseM(cosT, 0.78) + 0.2 * phaseM(cosT, 0.2);
  vec3 src = tsR * BR * cR * (phaseR(cosT) + 0.012) + tsM * BMS * cM * (pm + 0.02);
  ins = ESUN * src * (1.0 - tr) / max(tau, vec3(1e-5));
}
vec3 skyRad(float h, vec3 d, out vec3 tr) {
  float mu = d.y;
  float hmin = mu >= 0.0 ? h : (R + h) * sqrt(max(0.0, 1.0 - mu * mu)) - R;
  vec3 ins;
  segment(column(h, mu, HR), column(h, mu, HM), max(hmin, 0.0), dot(d, uSun), ins, tr);
  return ins;
}
// segment from the camera to a point p (relative to the camera, altitude hp)
void downSeg(vec3 d, vec3 p, float hp, out vec3 ins, out vec3 tr) {
  float mup = dot(d, upOf(p));
  float cR = max(0.0, column(hp, -mup, HR) - column(uH, -d.y, HR));
  float cM = max(0.0, column(hp, -mup, HM) - column(uH, -d.y, HM));
  segment(cR, cM, hp, dot(d, uSun), ins, tr);
}
float footprint(float t, float mu) {
  return t * uPixAng * inversesqrt(max(abs(mu), 0.04));
}
// The same segment for any direction. downSeg integrates the reversed ray, which
// for a ray climbing from the camera runs through the ground and overflows (inf - inf) from a few degrees up;
// a climbing ray is the column from the camera to space minus the column from p onward.
void segTo(vec3 d, vec3 p, float hp, out vec3 ins, out vec3 tr) {
  if (d.y < 0.0) { downSeg(d, p, hp, ins, tr); return; }
  float mup = dot(d, upOf(p));
  float cR = max(0.0, column(uH, d.y, HR) - column(hp, mup, HR));
  float cM = max(0.0, column(uH, d.y, HM) - column(hp, mup, HM));
  segment(cR, cM, uH, dot(d, uSun), ins, tr);
}
uniform sampler2D uSceneDepth;
uniform mat4 uSceneInverseProjection;
uniform float uSceneDepthOn;
in vec2 vUv;
// The distance to the drawn relief along this pixel's ray (km), -1 where none is drawn.
float sceneDistance() {
  if (uSceneDepthOn < 0.5) return -1.0;
  float z = texture(uSceneDepth, vUv).r;
  if (z >= 1.0) return -1.0;
  vec4 v = uSceneInverseProjection * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  return length(v.xyz / v.w) * 0.001;
}
const float WKM = 46.0, SKM = 3.8, DKM = 0.85;
const float WKML = 74.06;  // the dome tile read 1.61x larger where the region asks for big clouds (incommensurate with WKM)
const float RKM = 2048.0;  // the region map's period
const float WARP = 6.0;    // km: the region map displaces the dome tile by up to +-3 km, so its 46 km repeat never lines up
const float SIGMA = 75.0;  // extinction per unit density, 1/km
const float FAR_LIFE_FROM = 1.0, FAR_LIFE_TO = 2.2, FAR_LIFE_GAIN = 1.6;
float gDetailFade = 1.0; // erosion fades with distance so the fine texture never aliases into stripes
uniform float uDetailW;    // erosion detail weight, 0..1 (the distance scale fades it in)
#define DETAIL_W uDetailW
uniform float uDnMean;     // the erosion noise's mean value (from JS, measured on the baked texture)
uniform vec3 uCloudSun, uAmbTop, uAmbBot;
uniform vec2 uQ0;          // the weather-map position of the camera's ground point: origin minus wind drift (from JS, float64)
uniform float uCB, uCT;    // the march's slab, km
uniform float uPhase;      // the shape change's lifecycle phase, cycles (from JS, wrapped)
uniform vec2 uBillow;      // the rise of the shape and detail noise, km (from JS, wrapped to their periods)
uniform sampler2D uDomes, uRegion; uniform sampler3D uShape, uDetail;
uniform vec3 uDeck;        // the deck's coverage level, its relief's swing, 1 or 0 (the deck on or off)
uniform sampler2D uMap;    // the NASA cloud map: grey level = share of the place that is cloud
uniform mat3 uEcef;        // the camera-local frame (x east, y up, z south) to the Earth frame (z north)
uniform vec3 uMapSkew;     // from the march's sphere to the ellipsoid's normal, by which the map is read
uniform float uLifeGain;   // keeps the life cycle's mean cover the grown field's (from JS, measured on the bake)
uniform float uRcT[9];     // the coverage law, grey 0 .. 1 in eight steps
uniform float uOvT[9];     // the closed deck's share at each grey, in the same steps
// The globe's arcsine: a GPU's built-in one has an error near 7e-5 rad (0.45 km on the map).
float mapAsin(float x) {
  float a = min(abs(x), 1.0);
  bool high = a > 0.5;
  float z = high ? sqrt(0.5 * (1.0 - a)) : a;
  float z2 = z * z;
  float p = 0.0097616095291940784;
  p = p * z2 + 0.011551800896139705;
  p = p * z2 + 0.013964843750000001;
  p = p * z2 + 0.017352764423076924;
  p = p * z2 + 0.022372159090909092;
  p = p * z2 + 0.030381944444444444;
  p = p * z2 + 0.044642857142857144;
  p = p * z2 + 0.074999999999999997;
  p = p * z2 + 0.16666666666666666;
  float s = z + z * z2 * p;
  float r = high ? 1.5707963267948966 - 2.0 * s : s;
  return x < 0.0 ? -r : r;
}
// The globe's four-tap B-spline at the map's full size.
vec4 mapCubicWeights(float t) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - t;
  vec4 s = n * n * n;
  float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
}
float mapCubic(vec2 uv) {
  vec2 size = vec2(textureSize(uMap, 0));
  vec2 st = uv * size - 0.5, f = fract(st), i = st - f;
  vec4 wx = mapCubicWeights(f.x), wy = mapCubicWeights(f.y);
  vec4 g = vec4(wx.xz + wx.yw, wy.xz + wy.yw);
  vec4 at = (i.xxyy + vec4(-0.5, 1.5, -0.5, 1.5) + vec4(wx.yw, wy.yw) / g) / size.xxyy;
  vec2 share = vec2(g.x / (g.x + g.y), g.z / (g.z + g.w));
  float a = textureLod(uMap, at.xz, 0.0).r, b = textureLod(uMap, at.yz, 0.0).r;
  float c = textureLod(uMap, at.xw, 0.0).r, d = textureLod(uMap, at.yw, 0.0).r;
  return mix(mix(d, c, share.x), mix(b, a, share.x), share.y);
}
// The map's grey at a camera-relative point, read as the globe's shell reads it: by latitude and longitude, the
// cubic where a texel is larger than the footprint, the mip chain above that.
float mapGrey(vec3 p, float fp) {
  vec3 n = normalize(uMapSkew * (uEcef * normalize(vec3(p.x, R + uH + p.y, p.z))));
  float lon = atan(n.y, n.x), lat = mapAsin(n.z);
  vec2 uv = vec2(lon * 0.15915494309189535 + 0.5, lat * 0.3183098861837907 + 0.5);
  float cosLat = sqrt(max(1.0 - n.z * n.z, 0.0));
  float texelKm = 40075.0 * max(cosLat, 0.02) / float(textureSize(uMap, 0).x);
  float lod = log2(max(fp / texelKm, 1e-4));
  float fine = mapCubic(uv);
  return lod <= 0.0 ? fine : mix(fine, textureLod(uMap, uv, lod).r, smoothstep(0.0, 1.0, lod));
}
#define MAP_LAW(T, g) mix(T[int(min(floor(clamp(g, 0.0, 1.0) * 8.0), 7.0))], T[int(min(floor(clamp(g, 0.0, 1.0) * 8.0), 7.0)) + 1], clamp(g, 0.0, 1.0) * 8.0 - min(floor(clamp(g, 0.0, 1.0) * 8.0), 7.0))

vec3 rayDir(vec2 uv) { vec2 n = uv * 2.0 - 1.0; return normalize(uFwd + n.x * uTan.x * uRight + n.y * uTan.y * uUp); }
// Ray-sphere from the camera (Earth centre at (0, -(R + uH), 0)) with the precision-friendly discriminant.
vec2 sph(vec3 d, float r) {
  vec3 oc = vec3(0.0, R + uH, 0.0); float b = dot(oc, d); float dp = length(oc - b * d);
  float h = (r - dp) * (r + dp); if (h < 0.0) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h);
}
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.5663706 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
float phase2(float c, float k) { return mix(hg(c, -0.2 * k), hg(c, 0.82 * k), 0.6); }
// mip level for a texture of texel size tx (km) at a footprint fp (km)
float lodFor(float fp, float tx) { return clamp(log2(max(fp / tx, 1.0)), 0.0, 7.0); }

// Shape change: three generations of cumulus, a third of a cycle apart. Their sin^2 weights sum to 1.5 at
// every moment, so the amount of cloud holds while each cloud grows, lives and dissolves over one cycle.
// A weight w keeps the part of each dome above 1 - w, rescaled: a young cloud is a narrow, lower core of
// its dome that widens and rises as w grows (a dome scaled by w instead flattened into a pancake), and at
// w = 1 it is the whole dome, the static field. The ramp is never steeper than 1 / 0.35, and it flattens to
// 1 where the footprint grows past a dome texel (rl, the mip level): there a young cloud's core is about a
// cloud pixel wide, and a steep ramp turned it into a single pixel that blinked as the wind moved it.
// The ramp's mean over one cycle at m = 1, E[max(0, d - 1 + w)] with w = sin^2 of a uniform phase (w is
// arcsine-distributed; with w = sin^2(th) the integral is closed): what a dome looks like on average.
float lifeMean(float d) {
  float a = clamp(1.0 - d, 0.0, 1.0), th = asin(sqrt(a));
  return 0.63661977 * ((0.78539816 - 0.5 * th + 0.25 * sin(2.0 * th)) - a * (1.57079633 - th));
}
vec3 life(vec3 d, vec3 w, float rl) {
  float m = 0.35 + 0.65 * smoothstep(0.0, 1.5, rl);
  vec3 c = clamp((d - 1.0 + w) / max(w, vec3(m)), 0.0, 1.0);
  // Far away, where a young core would be smaller than the filter, the dome's growth and decay is replaced by
  // its cycle mean, scaled so a grown cloud keeps its size: no core is born below a pixel and blinks there.
  float a = smoothstep(FAR_LIFE_FROM, FAR_LIFE_TO, rl);
  if (a > 0.0) c = mix(c, min(vec3(lifeMean(d.x), lifeMean(d.y), lifeMean(d.z)) * FAR_LIFE_GAIN, 1.0), a);
  return c;
}
float genCov(vec4 d, float ph, float rl) {
  vec3 w = 0.5 - 0.5 * cos(6.2831853 * (ph + vec3(0.0, 0.3333333, 0.6666667)));
  vec3 c = life(d.rgb, w, rl);
  return (1.0 - (1.0 - c.x) * (1.0 - c.y) * (1.0 - c.z)) * uLifeGain;
}
// What the region map says about a place: the displaced tile position, the share of big clouds, the
// lifecycle phase, the regional coverage, the local cloud base and top.
float gDeck = 0.0; // how far the last coverage read was the deck's rather than the domes'
struct Wx { vec2 qw; float size; float ph; float rc; float cb; float ct; float ov; };
Wx wxAt(vec3 p, vec2 q, float fp) {
  Wx w;
  vec4 r = textureLod(uRegion, q / RKM, lodFor(fp, RKM / 512.0));
  w.qw = q + (r.ba - 0.5) * WARP;
  w.size = smoothstep(0.5, 0.8, r.g);
  w.ph = uPhase + 2.0 * r.b + 3.0 * r.a;
  w.cb = mix(1.1, 1.4, r.b);
  w.ct = w.cb + mix(1.2, 1.9, r.g);
  // The NASA map says how much of a place is cloud (r.r, the procedural coverage, is not read); the region's
  // other channels stay: size and top, warp, phase, base.
  float g = mapGrey(p, fp);
  w.rc = MAP_LAW(uRcT, g);
  w.ov = uDeck.z * MAP_LAW(uOvT, g);
  return w;
}
// The dome tile at the cloud scale and, where the region asks for big clouds, 1.61x larger; both reads only
// in the band where the two mix (the size field varies over tens of km, so the branch is coherent).
// rl: the level the young-cloud ramp is set for (the read's own level; the skip passes 0, the sharpest, so it
// never thins a cloud the density draws)
float domes(Wx w, float lod, float lodL, float rl) {
  float c = 0.0;
  if (w.size < 0.999) { vec4 d = textureLod(uDomes, w.qw / WKM, lod); c += (1.0 - w.size) * genCov(d, w.ph + 1.5 * d.a, min(rl, lod)); }
  if (w.size > 0.001) { vec4 d = textureLod(uDomes, w.qw / WKML + vec2(0.37, 0.61), lodL); c += w.size * genCov(d, w.ph + 1.5 * d.a, min(rl, lodL)); }
  return c;
}
// The bound of the shape change: a generation at any moment of its life is never more than its grown dome
// (at w = 1 the life ramp is the dome itself, below it the ramp only cuts the dome), so the union of the
// three grown generations covers every cloud the march can meet, at every moment, and does not change in time.
float genBound(vec4 d) {
  return (1.0 - (1.0 - d.r) * (1.0 - d.g) * (1.0 - d.b)) * uLifeGain;
}
float domesBound(Wx w, float lod, float lodL) {
  float c = 0.0;
  if (w.size < 0.999) c += (1.0 - w.size) * genBound(textureLod(uDomes, w.qw / WKM, lod));
  if (w.size > 0.001) c += w.size * genBound(textureLod(uDomes, w.qw / WKML + vec2(0.37, 0.61), lodL));
  return c;
}
// A closed cloud deck where the map is overcast: nothing in the dome tile hides its gaps there, so a deck of full
// height rises under the domes. w.ov opens or closes it through a relief of unrelated periods (the tile's phase
// channel at 46 and 74.06 km), so its gaps are gaps, not a thin veil, and no tile shows in it.
float deckCov(Wx w, float fp) {
  float a = textureLod(uDomes, w.qw / WKM, lodFor(fp, WKM / 512.0)).a;
  float b = textureLod(uDomes, w.qw / WKML + vec2(0.37, 0.61), lodFor(fp, WKML / 512.0)).a;
  float e = 1.0 - (1.0 + uDeck.y) * w.ov;
  return uDeck.x * smoothstep(e, e + uDeck.y, 0.5 * (a + b));
}
float domesCov(Wx w, float fp) {
  gDeck = 0.0;
  if (w.rc < 0.02 && w.ov <= 0.0) return 0.0;
  float c = w.rc < 0.02 ? 0.0 : domes(w, lodFor(fp, WKM / 512.0), lodFor(fp, WKML / 512.0), 9.0) * w.rc * 1.25;
  gDeck = 0.0;
  if (w.ov > 0.0) {
    float k = deckCov(w, fp);
    gDeck = smoothstep(c - 0.08, c + 0.08, k);
    c = max(c, k);
  }
  return c;
}
// cov, the height potential and the local base and top at a weather-map position q
float coverage(vec3 p, vec2 q, float fp, out float hpot, out float cb, out float ct) {
  Wx w = wxAt(p, q, fp);
  hpot = 1.0; cb = w.cb; ct = w.ct;
  return domesCov(w, fp);
}
// The empty-space skip's coverage: a coarse (about 1.4 km) mip of the same field, so it slides smoothly.
float skipCov(vec2 q, Wx w) {
  if (w.rc < 0.02 && w.ov <= 0.0) return 0.0;
  if (w.ov > 0.0) return 1.0; // a deck fills the layer: no long steps there
  // log2(1.61) = 0.6871: both reads at about 1.4 km.
  // The skip reads the shape change's bound, which does not move in time: the live field would change the step
  // lengths of the whole ray behind every growing cloud, and the surfaces behind would blink.
  return domesBound(w, 4.0, 4.0 - 0.6871) * w.rc;
}
// Cloud density at p (camera-relative, km) for a known coverage. fp = footprint (km).
// erW: the weight of the sampled erosion on a view sample (0..1); a negative erW is a light or shadow sample,
// which skips the erosion. Where the sampled erosion fades (distance, the scale's low end), a view sample takes
// the erosion's MEAN in its place: faded to nothing, a small dome that the erosion eats near the camera would
// survive far away as a small round blob and vanish as the camera came closer.
float densityAt(vec2 q, float alt, float cov, float hpot, float cb, float ct, float fp, float erW) {
  float hf = (alt - cb) / (ct - cb);
  if (hf < 0.0 || hf > 1.0) return 0.0;
  if (cov < 0.03) return 0.0;
  float topH = clamp(cov * 1.15, 0.0, 1.0) * mix(0.5, 1.0, hpot);
  if (hf > topH) return 0.0;
  vec3 sp = vec3(q.x, alt * 1.3 - uBillow.x, q.y) / SKM;
  float s = textureLod(uShape, sp, lodFor(fp, SKM / 64.0)).r;
  // In a closed deck no dome hides the shape tile's 3.8 km period, so a second copy, turned and scaled by unrelated
  // amounts, breaks the lattice (one more 3D read, in a deck only).
  if (gDeck > 0.0) {
    vec3 sp2 = vec3(0.8 * q.x - 0.6 * q.y, alt * 1.3 + uBillow.x, 0.6 * q.x + 0.8 * q.y) / (SKM * 1.37);
    float s2 = textureLod(uShape, sp2, lodFor(fp, SKM * 1.37 / 64.0)).r;
    s = mix(s, clamp(0.5 + 1.4 * (0.5 * (s + s2) - 0.5), 0.0, 1.0), gDeck);
  }
  float top = topH * mix(0.62, 1.0, s);
  float hp = smoothstep(0.0, 0.045, hf) * smoothstep(top, top * 0.4, hf);
  if (hp <= 0.0) return 0.0;
  float base = cov * hp;
  float d = remap(base, (1.0 - s) * 0.58, 1.0, 0.0, 1.0);
  if (d <= 0.0) return 0.0;
  if (erW >= 0.0) {
    float hk = clamp(hf * 3.0, 0.0, 1.0);
    float er = mix(1.0 - uDnMean, uDnMean, hk);
    if (erW > 0.0) {
      float dn = textureLod(uDetail, vec3(q.x, alt - uBillow.y, q.y) / DKM, lodFor(fp, DKM / 32.0)).r;
      er = mix(er, mix(1.0 - dn, dn, hk), erW);
    }
    d = remap(d, er * 0.42, 1.0, 0.0, 1.0);
  }
  d = clamp(d, 0.0, 1.0);
  return d * (2.0 - d); // denser: thin parts rise faster (0.2 becomes 0.36), the cores stay at 1
}
float density(vec3 p, float fp, float erW) {
  float alt = altOf(p);
  if (alt < uCB || alt > uCT) return 0.0;
  vec2 q = p.xz + uQ0;
  float hpot, cb, ct; float cov = coverage(p, q, fp, hpot, cb, ct);
  return densityAt(q, alt, cov, hpot, cb, ct, fp, erW);
}
// The march's form: the region read once per step is shared by the skip and the density.
float densityW(vec3 p, vec2 q, Wx w, float fp, float erW) {
  float alt = altOf(p);
  if (alt < w.cb || alt > w.ct) return 0.0;
  return densityAt(q, alt, domesCov(w, fp), 1.0, w.cb, w.ct, fp, erW);
}
// A light sample: the primary step's region read moved along by dq. The light path is at most about 2 km
// and the region's texels are 4 km, so the shading barely changes, and each light sample saves a region read.
float densityL(vec3 p, vec2 dq, Wx w, float fp) {
  float alt = altOf(p);
  if (alt < w.cb || alt > w.ct) return 0.0;
  Wx v = w; v.qw += dq;
  return densityAt(p.xz + uQ0, alt, domesCov(v, fp), 1.0, v.cb, v.ct, fp, -1.0);
}
`;

/** The march: premultiplied radiance, opacity in alpha. */
export const CLOUD_MARCH_FRAGMENT = /* glsl */ `${COMMON}
out vec4 fragColor;
uniform int uRefDiv;
uniform sampler2D uBlue;
uniform float uTMax, uCloudPx; // uCloudPx = canvas pixels per cloud pixel
// The far reach: the clouds fade between uTFade and uTMax, where the haze in front of them lets 10 % and 1 %
// through (from JS); beyond uGrowA km of path inside the layer every step grows by 1 per uGrowG km, up to
// uGrowMax times, and the march may take uFarIt more steps, so a ray reaches the haze before its budget ends.
uniform float uTFade, uGrowA, uGrowG, uGrowMax, uFarIt;
// The distance scale: every limit is a uniform, the loops run to fixed bounds and exit early, so the
// quality changes every frame without a shader swap. Fractional limits weight the last step, so the
// picture changes smoothly with them.
uniform float uMaxIt, uSegN, uKStep, uTOff, uDtMin, uLSteps, uMsOct;
// The field's filter width must not follow the quality (a coarser setting would read coarser mips and the
// clouds would change shape): it comes from fixed reference values, whatever the resolution and step count.
uniform float uFiltPx;    // canvas pixels per cloud pixel used for the filter
uniform vec4 uFiltStep;   // segN, kStep, tOff, dtMin used for the filter
const int MAXIT_B = 128;
const float LTAIL = 0.3; // light path beyond the last light sample: its mean density, times this
// The entry refinement adds up to REFN_MAX passes of 2 x uRefDiv steps of 1 / uRefDiv of a step per ray.
const int REFN_MAX = 2, FINE_B = 8;
const int FAR_B = 48; // the bound of uFarIt
const int LOOP_B = MAXIT_B + FAR_B + FINE_B * REFN_MAX;
float grow(float x) { return min(uGrowMax, 1.0 + max(0.0, x - uGrowA) / uGrowG); }

const float LSL[5] = float[5](0.07, 0.16, 0.32, 0.6, 1.1);
const float LSL2[2] = float[2](0.18, 0.7);

float lightOD(vec3 p, float fp, Wx w) {
  float od = 0.0;
  float t = 0.0, wl = 0.0, rest = 0.0;
  for (int i = 0; i < 5; i++) {
    float l = LSL[i], k = clamp(uLSteps - float(i), 0.0, 1.0);
    t += l * 0.5;
    if (k > 0.0) { od += k * densityL(p + uSun * t, uSun.xz * t, w, fp * 2.0) * l; wl += k * l; }
    rest += (1.0 - k) * l;
    t += l * 0.5;
  }
  od += LTAIL * rest * od / max(wl, 1e-4);
  return od * SIGMA;
}

void main() {
  vec3 d = rayDir(vUv);
  vec2 o = sph(d, R + uCT), ib = sph(d, R + uCB);
  bool hitIn = ib.x <= ib.y && ib.x > 0.0;
  float t0 = 0.0, t1 = -1.0;
  if (uH > uCT) { if (o.x <= o.y && o.y > 0.0) { t0 = max(o.x, 0.0); t1 = hitIn ? ib.x : o.y; } }
  else if (uH > uCB) { t0 = 0.0; t1 = hitIn ? ib.x : o.y; }
  else { t0 = max(ib.y, 0.0); t1 = o.y; }
  t1 = min(t1, uTMax);
  // Nothing behind the ground: the sea's sphere and the drawn relief end the ray.
  float tSea = hitDown(d.y, uH, 0.0);
  if (tSea > 0.0) t1 = min(t1, tSea);
  float tScene = sceneDistance();
  if (tScene > 0.0) t1 = min(t1, tScene);

  vec3 col = vec3(0.0); float T = 1.0; float tw = 0.0, ws = 0.0;
  if (t1 > t0) {
    float cs = dot(d, uSun);
    float powMix = smoothstep(0.15, 0.95, cs);
    // Fixed blue-noise start offset per pixel. It never changes from frame to frame, so a still camera
    // gives a still picture; its grain is removed by the tent filter in the composite.
    float bn = texelFetch(uBlue, ivec2(gl_FragCoord.xy) % 64, 0).r;
    float segN = uSegN, kst = uKStep, tof = uTOff, dtm = uDtMin, lim = uMaxIt + uFarIt;
    int fineN = 2 * uRefDiv; float fineF = 1.0 / float(uRefDiv);
    float segDt = (t1 - t0) / segN;
    float dt = max(dtm, min(segDt, (t0 + tof) * kst));
    float t = t0 + dt * bn;
    float done = 0.0;        // coarse steps taken (a quarter step counts a quarter)
    float dtPrev = dt * bn;  // the step that led to the current sample
    int fine = 0, refs = 0;
    bool armed = true;
    for (int i = 0; i < LOOP_B; i++) {
      if (t > t1 || T < 0.015 || done >= lim) break;
      vec3 p = d * t;
      vec2 q = p.xz + uQ0;
      // the step grows with the path already inside the layer (a function of distance alone, so the sample
      // positions do not depend on what the march met on the way)
      float dtC = max(dtm, min(segDt, (t + tof) * kst)) * grow(t - t0);
      // Filter width: the larger of one cloud pixel and a share of the step length, both from fixed
      // references, never from the step actually taken, so the quality and the entry refinement draw the same field.
      float dtF = max(uFiltStep.w, min((t1 - t0) / uFiltStep.x, (t + uFiltStep.z) * uFiltStep.y));
      float fpBase = t * uPixAng * uFiltPx;
      // The region is read once per step (at the footprint before the skip; its texels are 4 km) and shared.
      Wx w = wxAt(p, q, max(fpBase, dtF * 0.6));
      // Empty-space skip that varies smoothly: steps grow where a coarse (1.4 km) mip of the coverage map is
      // empty. It reads the same field as the density, so it never skips over a cloud the density would draw.
      float sk = mix(2.0, 1.0, smoothstep(0.02, 0.25, skipCov(q, w)));
      dtC *= sk;
      dtF *= sk;
      dtC *= min(1.0, lim - done); // a fractional last step: the march's end moves smoothly with the limit
      float dts = fine > 0 ? dtC * fineF : dtC;
      gDetailFade = 1.0 - smoothstep(9.0, 32.0, t);
      float fp = max(fpBase, dtF * 0.6);
      float den = densityW(p, q, w, fp, t > 28.0 ? 0.0 : gDetailFade * DETAIL_W);
      if (fine == 0) {
        if (den > 0.002 && armed && refs < REFN_MAX) {
          // The first sample inside a cloud: step back to the last empty sample and cross the entry again in
          // quarter steps. The visible surface sits on the step shells; this places it four times as finely
          // without a history, so a still camera still gives a still picture.
          refs++;
          armed = false;
          fine = fineN;
          t = max(t0, t - dtPrev) + fineF * dtC * bn;
          continue;
        }
        if (den <= 0.002) armed = true;
      }
      if (den > 0.002) {
        den *= smoothstep(uTMax, uTFade, t);
        float od = lightOD(p, fp, w);
        float lt = 0.0, a = 1.0, b = 1.0, k = 1.0;
        for (int m = 0; m < 3; m++) { lt += clamp(uMsOct - float(m), 0.0, 1.0) * a * phase2(cs, k) * exp(-od * b); a *= 0.5; b *= 0.5; k *= 0.5; }
        lt *= 12.566;
        float powder = 1.0 - exp(-den * SIGMA * 0.2);
        lt *= mix(powder, 1.0, powMix * 0.85 + 0.15);
        float hf = clamp((altOf(p) - w.cb) / (w.ct - w.cb), 0.0, 1.0);
        vec3 amb = mix(uAmbBot, uAmbTop, smoothstep(0.0, 1.0, hf)) * (0.45 + 0.55 * hf);
        vec3 S = uCloudSun * lt + amb;
        float tr = exp(-den * SIGMA * dts);
        col += T * S * (1.0 - tr);
        tw += T * (1.0 - tr) * t; ws += T * (1.0 - tr);
        T *= tr;
      }
      if (fine > 0) { fine--; done += fineF; } else done += 1.0;
      dtPrev = dts;
      t += dts;
    }
    // Far impostor: where the march ran out of steps before the slab ended, one coverage lookup on a
    // mid-layer sphere stands in for the distant clouds (a few pixels tall and hazed anyway).
    if (t < t1 && T > 0.02) {
      vec2 m = sph(d, R + uCB + (uCT - uCB) * 0.3);
      // fades out as the march end approaches the layer, so it never switches on or off from one frame to the next
      float tm = m.x > 0.0 ? m.x : m.y;
      float fadeIn = m.x <= m.y ? smoothstep(0.0, 3.0, tm - t) : 0.0;
      if (tm < uTMax && fadeIn > 0.0) {
        vec2 q = (d * tm).xz + uQ0; float hpot, cb, ct;
        float cov = coverage(d * tm, q, max(tm * uPixAng * uFiltPx, WKM / 32.0), hpot, cb, ct);
        float a = smoothstep(0.1, 0.5, cov) * 0.97 * smoothstep(uTMax, uTFade, tm) * fadeIn;
        vec3 S = uCloudSun * (0.55 + 6.0 * hg(cs, 0.6)) * 0.5 + uAmbTop * 0.9;
        col += T * a * S; tw += T * a * tm; ws += T * a; T *= 1.0 - a;
      }
    }
  }
  // The march stops once less than 1.5 % of the light gets through; kept as transmittance, that rest let the sun's
  // disc, some ten thousand times the sky's radiance, through a thick cloud base as a white dot. A ray that stopped
  // on opacity is opaque: its rest goes to the cloud's own light and nothing from behind shows.
  if (T < 0.015) { col /= max(1.0 - T, 0.5); T = 0.0; }
  // aerial perspective in front of the clouds, at their opacity-weighted depth
  vec3 outc = col;
  if (ws > 1e-4) {
    vec3 pD = d * (tw / ws); vec3 ins, tr;
    segTo(d, pD, altOf(pD), ins, tr);
    outc = col * tr + ins * (1.0 - T);
  }
  fragColor = vec4(outc, 1.0 - T); // premultiplied radiance, opacity
}`;

/** The clouds' shadow on the ground, one column per pixel. */
export const CLOUD_MARCH_SHADOW_FRAGMENT = /* glsl */ `${COMMON}
float covShadow(vec3 P, float mu, float fp) {
  vec3 Q = P + uSun * (max(uCB + 0.4 - altOf(P), 0.0) / mu);
  float hp, cb, ct; float cv = coverage(Q, Q.xz + uQ0, fp, hp, cb, ct);
  return 1.0 - 0.82 * smoothstep(0.2, 0.6, cv);
}
uniform float uShW; // weight of the density shadow near the camera, 0 = coverage map only (the scale fades it in)
float cloudShadow(vec3 P, float t, float fp) {
  float mu = max(dot(upOf(P), uSun), 0.03);
  float sc = covShadow(P, mu, fp);
  if (uShW <= 0.0) return sc;
  float far = smoothstep(40.0, 70.0, t);
  float sd = 1.0;
  if (far < 1.0) {
    float od = 0.0;
    for (int k = 0; k < 2; k++) { float h = uCB + (uCT - uCB) * (0.12 + 0.3 * float(k)); od += density(P + uSun * (max(h - altOf(P), 0.0) / mu), fp, -1.0) * 0.9; }
    sd = mix(1.0, exp(-od * SIGMA * 0.12), 0.82);
  }
  return mix(sc, mix(sd, sc, far), uShW);
}
out vec4 fragColor;
uniform float uShadowStrength;
uniform float uFiltPx;
// The clouds' shadow on the ground: black, its strength in alpha. Where the view ray meets the drawn relief, else
// the sea's sphere; nothing above the cloud base and nothing with the sun down.
void main() {
  vec3 d = rayDir(vUv);
  float t = sceneDistance();
  if (t <= 0.0) t = hitDown(d.y, uH, 0.0);
  if (t <= 0.0) { fragColor = vec4(0.0); return; }
  vec3 P = d * t;
  float sunUp = dot(upOf(P), uSun);
  if (sunUp <= 0.02 || altOf(P) >= uCB + 0.4) { fragColor = vec4(0.0); return; }
  float fp = max(t * uPixAng * uFiltPx, 0.05);
  fragColor = vec4(0.0, 0.0, 0.0, uShadowStrength * (1.0 - cloudShadow(P, t, fp)) * smoothstep(0.02, 0.1, sunUp));
}`;
