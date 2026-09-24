/**
 * The AR sun marker (plan 2026-09-24-0100, M2, §3.3): a virtual sun drawn
 * over the real one, with a heading scale, so the alignment's heading error
 * can be read by eye.
 *
 * DIRECTION-ONLY, LIKE THE SKY. Every vertex is a DIRECTION, placed with the
 * rotation-only view (`projectionMatrix * vec4(mat3(viewMatrix) * d, 1)`),
 * evaluated with the matrices three sets at render time: no lag behind the
 * camera, no parallax, correct for each XR view, and never clipped by the
 * far plane (plan §3.2). The mesh sits on the scene ROOT, which is the
 * GPS-world NUE frame.
 *
 * GEOMETRY IN ANGLES. Each vertex carries `sunOffset` = (Δazimuth, u, v) in
 * degrees; the vertex shader builds the direction exactly as
 * `markerVertexDirection` in `sun-check-geometry.ts` does (its JS twin, which
 * the tests use). Heading ticks are anchored on the almucantar at Δazimuth =
 * N; everything else hangs off the sun itself. Rings are built at their TRUE
 * angular radius (the gnomonic plane's radius is tan r).
 *
 * OVER EVERYTHING, UNGRADED. No depth test or write, no fog, no tone mapping
 * (so OsmDemo's Khronos Neutral grade cannot shift the magenta), drawn last,
 * never frustum-culled. A dark outline under each line keeps it visible on a
 * white, blown-out sky.
 *
 * Tick LABELS are not drawn yet (a text atlas, plan §3.3); the rings sit at
 * fixed, documented radii so the scale reads without them.
 *
 * @see sun-marker.ts.md
 */
import * as THREE from 'three';

/** The marker's layout, degrees and colours, in one place. */
export const SUN_MARKER = {
  /** The disc (the sun's real diameter is 0.53°) and the distance rings. */
  ringsDeg: [0.265, 1, 2, 5] as readonly number[],
  ringSegments: 96,
  /** Crosshair arms reach this far, with a gap around the centre. */
  armLengthDeg: 6,
  armGapDeg: 0.6,
  /** Heading ticks: Δazimuth on the almucantar, in heading degrees. */
  headingTicksDeg: [-5, -2, -1, 1, 2, 5] as readonly number[],
  headingTickHalfLengthDeg: 0.35,
  /** Elevation ticks on the vertical arm. */
  elevationTicksDeg: [-2, -1, -0.5, 0.5, 1, 2] as readonly number[],
  elevationTickHalfLengthDeg: 0.25,
  /** The centre dot's half size. */
  dotHalfDeg: 0.04,
  /** Line widths: about 2 px and 4 px on a phone's ~70° view. */
  lineWidthDeg: 0.1,
  outlineWidthDeg: 0.25,
  colour: 0xff00ff,
  outlineColour: 0x1a0020,
  /** Drawn after everything else. */
  renderOrder: 1e6,
} as const;

const DEG = Math.PI / 180;

/** A point in the marker's angular frame: (Δazimuth, u, v), degrees. */
type Offset = readonly [number, number, number];

const VERTEX_SHADER = /* glsl */ `
uniform float sunAzimuthDeg;
uniform float sunElevationDeg;
attribute vec3 sunOffset;
attribute vec3 markerColor;
varying vec3 vMarkerColor;
const float DEG = 0.017453292519943295;
void main() {
  // The twin of markerVertexDirection (sun-check-geometry.ts).
  float az = (sunAzimuthDeg + sunOffset.x) * DEG;
  float el = sunElevationDeg * DEG;
  vec3 anchor = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  vec3 east = vec3(-sin(az), 0.0, cos(az));
  vec3 up = cross(east, anchor);
  vec3 d = normalize(anchor + tan(sunOffset.y * DEG) * east + tan(sunOffset.z * DEG) * up);
  vMarkerColor = markerColor;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * d, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
varying vec3 vMarkerColor;
void main() {
  gl_FragColor = vec4(vMarkerColor, 1.0);
}
`;

/** The gnomonic (u, v) of a TRUE angular radius r at polar angle φ. */
function ringPoint(rDeg: number, phi: number): readonly [number, number] {
  const t = Math.tan(rDeg * DEG);
  return [
    Math.atan(t * Math.cos(phi)) / DEG,
    Math.atan(t * Math.sin(phi)) / DEG,
  ];
}

/** Two triangles for a quad a-b-c-d (in order around it). */
function quad(out: Offset[], a: Offset, b: Offset, c: Offset, d: Offset) {
  out.push(a, b, c, a, c, d);
}

/** A straight line between two (u, v) points at one anchor, as a quad. */
function line(
  out: Offset[],
  dAz: number,
  from: readonly [number, number],
  to: readonly [number, number],
  width: number
) {
  const du = to[0] - from[0];
  const dv = to[1] - from[1];
  const length = Math.hypot(du, dv);
  const nu = (-dv / length) * (width / 2);
  const nv = (du / length) * (width / 2);
  quad(
    out,
    [dAz, from[0] + nu, from[1] + nv],
    [dAz, to[0] + nu, to[1] + nv],
    [dAz, to[0] - nu, to[1] - nv],
    [dAz, from[0] - nu, from[1] - nv]
  );
}

/** A ring at true radius r, as quads between r ± width / 2. */
function ring(out: Offset[], rDeg: number, width: number) {
  const n = SUN_MARKER.ringSegments;
  const inner = Math.max(0, rDeg - width / 2);
  const outer = rDeg + width / 2;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const b = (2 * Math.PI * (i + 1)) / n;
    const [ia, oa, ib, ob] = [
      ringPoint(inner, a),
      ringPoint(outer, a),
      ringPoint(inner, b),
      ringPoint(outer, b),
    ];
    quad(
      out,
      [0, ia[0], ia[1]],
      [0, oa[0], oa[1]],
      [0, ob[0], ob[1]],
      [0, ib[0], ib[1]]
    );
  }
}

/** Every shape of the marker, at one line width. */
function shapes(width: number): Offset[] {
  const out: Offset[] = [];
  const m = SUN_MARKER;
  for (const r of m.ringsDeg) ring(out, r, width);
  // Crosshair arms, with a gap so the real sun's centre stays visible.
  for (const sign of [-1, 1]) {
    line(out, 0, [sign * m.armGapDeg, 0], [sign * m.armLengthDeg, 0], width);
    line(out, 0, [0, sign * m.armGapDeg], [0, sign * m.armLengthDeg], width);
  }
  for (const n of m.headingTicksDeg) {
    const h = m.headingTickHalfLengthDeg;
    line(out, n, [0, -h], [0, h], width);
  }
  for (const v of m.elevationTicksDeg) {
    const h = m.elevationTickHalfLengthDeg;
    line(out, 0, [-h, v], [h, v], width);
  }
  const s = m.dotHalfDeg + (width - m.lineWidthDeg) / 2;
  quad(out, [0, -s, -s], [0, s, -s], [0, s, s], [0, -s, s]);
  return out;
}

function buildGeometry(): THREE.BufferGeometry {
  const outline = shapes(SUN_MARKER.outlineWidthDeg);
  const fill = shapes(SUN_MARKER.lineWidthDeg);
  const all = [...outline, ...fill];
  const offsets = new Float32Array(all.length * 3);
  const colours = new Float32Array(all.length * 3);
  const dark = new THREE.Color(SUN_MARKER.outlineColour);
  const bright = new THREE.Color(SUN_MARKER.colour);
  all.forEach((p, i) => {
    offsets.set(p, i * 3);
    const c = i < outline.length ? dark : bright;
    colours.set([c.r, c.g, c.b], i * 3);
  });
  const geometry = new THREE.BufferGeometry();
  // three needs a position attribute to draw; the direction is in sunOffset.
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(all.length * 3), 3)
  );
  geometry.setAttribute('sunOffset', new THREE.BufferAttribute(offsets, 3));
  geometry.setAttribute('markerColor', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/** The marker: its mesh (add it to the scene root) and its controls. */
export interface SunMarker {
  readonly object: THREE.Mesh;
  /** Point the marker at the (apparent) sun, degrees. */
  setSun(azimuthDeg: number, elevationDeg: number): void;
  setVisible(visible: boolean): void;
  /** Frees the geometry and material and removes the mesh from its parent. */
  dispose(): void;
}

/** Builds the marker. Owns no clock and no store. */
export function createSunMarker(): SunMarker {
  const material = new THREE.ShaderMaterial({
    name: 'sun-marker',
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      sunAzimuthDeg: { value: 0 },
      sunElevationDeg: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const object = new THREE.Mesh(buildGeometry(), material);
  object.name = 'sun-marker';
  object.frustumCulled = false;
  object.renderOrder = SUN_MARKER.renderOrder;
  return {
    object,
    setSun(azimuthDeg, elevationDeg) {
      if (!Number.isFinite(azimuthDeg) || !Number.isFinite(elevationDeg)) {
        throw new RangeError('sun angles must be finite');
      }
      if (Math.abs(elevationDeg) > 90) {
        throw new RangeError(
          `elevation must be within ±90°, got ${elevationDeg}`
        );
      }
      material.uniforms.sunAzimuthDeg!.value = azimuthDeg;
      material.uniforms.sunElevationDeg!.value = elevationDeg;
    },
    setVisible(visible) {
      object.visible = visible;
    },
    dispose() {
      object.removeFromParent();
      object.geometry.dispose();
      material.dispose();
    },
  };
}
