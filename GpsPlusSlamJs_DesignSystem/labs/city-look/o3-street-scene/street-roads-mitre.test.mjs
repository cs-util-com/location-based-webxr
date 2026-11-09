import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ROAD_PARAMS,
  buildRibbons,
  mitreStrip,
  turnDegrees,
} from "./street-roads.js";

const widthOf = (tags) => (tags.highway === "footway" ? 2 : 6);
const colourOf = () => 0xa0a3a8;
const way = (id, tags, points) => ({ key: `way/${id}`, tags, points });
const straight = (n, dx = 10) =>
  Array.from({ length: n }, (_, i) => ({ x: i * dx, y: 0 }));
const DISC = ROAD_PARAMS.discSegments;
const NO_BREAKS = new Set();

/** Signed area of a triangle in ENU (x east, y north); > 0 is counter-clockwise. */
const signedArea = ([a, b, c]) =>
  ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;

/** Whether `p` lies in triangle `t` (counter-clockwise), within `eps` metres. */
function inside(t, p, eps = 1e-6) {
  for (let i = 0; i < 3; i += 1) {
    const a = t[i];
    const b = t[(i + 1) % 3];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) return false;
    const side = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len;
    if (side < -eps) return false;
  }
  return true;
}

const covered = (triangles, p) => triangles.some((t) => inside(t, p));

/** A turn of `deg` at the middle of three points, segments `len` long. */
function bend(deg, len = 20) {
  const r = (deg * Math.PI) / 180;
  return [
    { x: -len, y: 0 },
    { x: 0, y: 0 },
    { x: Math.cos(r) * len, y: Math.sin(r) * len },
  ];
}

/** A deterministic PRNG (mulberry32), so a failing case can be replayed. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random polyline: steps of 3-40 m, turns of up to +-170 degrees. */
function randomPolyline(rand) {
  const n = 2 + Math.floor(rand() * 8);
  const points = [{ x: 0, y: 0 }];
  let heading = rand() * Math.PI * 2;
  for (let i = 1; i < n; i += 1) {
    heading += (rand() * 2 - 1) * ((170 * Math.PI) / 180);
    const step = 3 + rand() * 37;
    const last = points[points.length - 1];
    points.push({
      x: last.x + Math.cos(heading) * step,
      y: last.y + Math.sin(heading) * step,
    });
  }
  return points;
}

// Why: the discs style is what the owner compares against, so the mitre work
// must not move a single float of it. The digests were taken from the builder
// before the mitre style existed (2026-11-08), on a fixture with a bend, a
// junction, a footway and two ranks, at both join thresholds.
test("joinStyle 'discs' is today's output byte for byte", () => {
  const ways = [
    way(1, { highway: "residential" }, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 1 },
      { x: 28, y: 9 },
      { x: 30, y: 25 },
    ]),
    way(2, { highway: "footway" }, [
      { x: 10, y: 0 },
      { x: 12, y: -15 },
      { x: 13, y: -30 },
    ]),
    way(3, { highway: "primary" }, [
      { x: 30, y: 25 },
      { x: 50, y: 26 },
    ]),
  ];
  const digest = (arr) => {
    let h = 0x811c9dc5;
    for (const b of new Uint8Array(arr.buffer)) {
      h = Math.imul(h ^ b, 0x01000193);
    }
    return (h >>> 0).toString(16);
  };
  const expected = {
    0: [846, "27e8be06", "da6a01ed", "858803dd"],
    10: [774, "d3cd6476", "7bb91f4d", "f12200ed"],
  };
  for (const straightDeg of [0, 10]) {
    for (const options of [{}, { joinStyle: "discs" }]) {
      const b = buildRibbons(ways, {
        widthOf,
        colourOf,
        straightDeg,
        ...options,
      });
      assert.deepEqual(
        [
          b.positions.length,
          digest(b.positions),
          digest(b.colours),
          digest(b.street),
        ],
        expected[straightDeg],
      );
    }
  }
});

// Why: a straight road is the common case; the strip must cost exactly a quad
// per segment, with no join triangles at all and round caps only at the ends.
test("a straight way is 2 triangles a segment plus its two end discs", () => {
  const strip = mitreStrip(straight(6), 3, { breaks: NO_BREAKS });
  assert.equal(strip.triangles.length, 5 * 2);
  assert.deepEqual(strip.discs, [0, 5]);
  assert.equal(strip.bevels, 0);
  const built = buildRibbons(
    [way(1, { highway: "residential" }, straight(6))],
    {
      widthOf,
      colourOf,
      joinStyle: "mitre",
    },
  );
  assert.equal(built.positions.length / 9, 5 * 2 + 2 * DISC);
  assert.equal(built.stats.joinTriangles, 0);
});

// Why: the defect the owner saw. A gently curved road lost its disc at every
// point under 10 degrees and showed a sawtooth of bare-ground notches on its
// outer side. The strip must cover the outer wedge at every such point.
test("a near-straight curve has no notch on either side", () => {
  const points = [];
  for (let i = 0; i < 20; i += 1) {
    const a = (i * 5 * Math.PI) / 180;
    points.push({ x: 60 * Math.sin(a), y: 60 - 60 * Math.cos(a) });
  }
  const half = 3;
  const { triangles } = mitreStrip(points, half, { breaks: NO_BREAKS });
  for (let k = 1; k + 1 < points.length; k += 1) {
    const p = points[k];
    for (let s = -1; s <= 1; s += 0.05) {
      // Every direction around the joint at 0.99 h: the round buffer.
      const angle = Math.atan2(p.y - 60, p.x) + (s * Math.PI) / 2;
      for (const dir of [angle, angle + Math.PI]) {
        const q = {
          x: p.x + Math.cos(dir) * half * 0.99,
          y: p.y + Math.sin(dir) * half * 0.99,
        };
        assert.ok(covered(triangles, q), `notch at point ${k}`);
      }
    }
  }
});

// Why: the mitre ratio 1/cos(t/2) grows without bound at a hairpin; above the
// limit the outer side is bevelled with one fill triangle, the inner side
// keeps its mitre point. At 90 degrees the ratio is 1.414, so it is a mitre
// at the default limit 2 and a bevel only under a limit below 1.414.
test("a 90 degree turn mitres at limit 2 and bevels under a limit of 1.4", () => {
  const points = bend(90);
  const mitred = mitreStrip(points, 3, { breaks: NO_BREAKS, mitreLimit: 2 });
  assert.equal(mitred.bevels, 0);
  assert.equal(mitred.triangles.length, 4);
  const bevelled = mitreStrip(points, 3, {
    breaks: NO_BREAKS,
    mitreLimit: 1.4,
  });
  assert.equal(bevelled.bevels, 1);
  assert.equal(bevelled.triangles.length, 5);
  assert.ok(Math.abs(mitred.maxOvershootM - (3 * Math.SQRT2 - 3)) < 1e-9);
  // 130 degrees: ratio 2.37, over the default limit.
  assert.equal(mitreStrip(bend(130), 3, { breaks: NO_BREAKS }).bevels, 1);
});

// Why: at a sharp turn between short segments the inner mitre point lands past
// the neighbouring segment and the strip folds over itself (inverted
// triangles, a dark flicker on screen). The guard falls back to a disc there.
test("an inner offset past a short segment falls back to a disc", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2 - Math.cos(0.3) * 2, y: Math.sin(0.3) * 2 },
  ];
  const strip = mitreStrip(points, 3, { breaks: NO_BREAKS });
  assert.deepEqual(strip.discs, [0, 1, 2]);
  assert.equal(strip.fallbacks, 1);
  for (const t of strip.triangles) assert.ok(signedArea(t) > 0);
});

// Why: junctions and ends keep today's discs and rank order (DEC-R2-13), so
// the strip breaks at a point shared with another way.
test("a junction breaks the strip and keeps its disc", () => {
  const strip = mitreStrip(straight(3), 3, { breaks: new Set([1]) });
  assert.deepEqual(strip.discs, [0, 1, 2]);
  assert.equal(strip.triangles.length, 4);
});

// Why: the kerb shading reads the per-vertex offset; a mitre corner sits on
// both edge lines, so it must carry the full half width. Anything less draws
// a kerb line across the road at interior points.
test("every strip vertex lies on an edge line: offset is +-half", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 35, y: 8 },
    { x: 40, y: 30 },
  ];
  for (const limit of [1.05, 2]) {
    const { triangles } = mitreStrip(points, 3, {
      breaks: NO_BREAKS,
      mitreLimit: limit,
    });
    for (const t of triangles) {
      for (const v of t) assert.equal(Math.abs(v.offset), 3);
    }
  }
});

// Why: the three invariants on many shapes at once, at every limit swept: no
// fold, each segment's half-width rectangle covered, the mitred outer wedge
// covered, and the triangle count from its parts. Seeded, so replayable.
test("random polylines: no folds, full cover, count from its parts", () => {
  for (const mitreLimit of [1.05, 1.5, 2, 3, 4]) {
    for (let seed = 1; seed <= 150; seed += 1) {
      const rand = random(seed * 7919 + mitreLimit * 1000);
      const points = randomPolyline(rand);
      const half = 1 + rand() * 4;
      const strip = mitreStrip(points, half, {
        breaks: NO_BREAKS,
        mitreLimit,
      });
      const label = `seed ${seed} limit ${mitreLimit}`;
      for (const t of strip.triangles) {
        assert.ok(signedArea(t) > 1e-9, `${label}: folded triangle`);
      }
      assert.equal(
        strip.triangles.length,
        2 * (points.length - 1) + strip.bevels,
        label,
      );
      const discs = new Set(strip.discs);
      assert.ok(discs.has(0) && discs.has(points.length - 1), label);
      for (let i = 0; i + 1 < points.length; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        for (let s = 0.02; s < 1; s += 0.08) {
          for (let u = -0.97; u <= 0.97; u += 0.194) {
            const q = {
              x: a.x + ux * s * len - uy * u * half,
              y: a.y + uy * s * len + ux * u * half,
            };
            // A disc point covers its own round buffer, so only the strip's
            // own reach is asserted away from fallback discs.
            const nearDisc = [i, i + 1].some(
              (k) =>
                discs.has(k) &&
                Math.hypot(q.x - points[k].x, q.y - points[k].y) < half,
            );
            if (nearDisc) continue;
            assert.ok(covered(strip.triangles, q), `${label}: gap`);
          }
        }
      }
      for (let k = 1; k + 1 < points.length; k += 1) {
        if (discs.has(k)) continue;
        const t = turnDegrees(points[k - 1], points[k], points[k + 1]);
        if (1 / Math.cos((t * Math.PI) / 360) > mitreLimit) continue;
        // A mitred join covers the outer wedge between the two segments'
        // rectangles: the notch a dropped disc used to leave.
        const n = (i) => {
          const len = Math.hypot(
            points[i + 1].x - points[i].x,
            points[i + 1].y - points[i].y,
          );
          return {
            x: -(points[i + 1].y - points[i].y) / len,
            y: (points[i + 1].x - points[i].x) / len,
          };
        };
        const nIn = n(k - 1);
        const nOut = n(k);
        const cross = nIn.x * nOut.y - nIn.y * nOut.x;
        const sign = cross > 0 ? -1 : 1;
        for (let f = 0; f <= 1; f += 0.1) {
          const dx = sign * (nIn.x * (1 - f) + nOut.x * f);
          const dy = sign * (nIn.y * (1 - f) + nOut.y * f);
          const norm = Math.hypot(dx, dy);
          const q = {
            x: points[k].x + (dx / norm) * half * 0.97,
            y: points[k].y + (dy / norm) * half * 0.97,
          };
          assert.ok(covered(strip.triangles, q), `${label}: notch at ${k}`);
        }
      }
    }
  }
});

// Why: the page shows both styles' counts side by side, and the mitre style
// must be the cheaper one on a curved road (no disc at any interior point).
test("stats report the mitre style's parts", () => {
  const points = bend(30);
  const built = buildRibbons([way(1, { highway: "residential" }, points)], {
    widthOf,
    colourOf,
    joinStyle: "mitre",
  });
  assert.equal(built.stats.quadTriangles, 4);
  assert.equal(built.stats.joinTriangles, 0);
  assert.equal(built.stats.discTriangles, 2 * DISC);
  assert.equal(built.stats.discsKept, 2);
  assert.equal(built.positions.length / 9, 4 + 2 * DISC);
  assert.throws(
    () => buildRibbons([], { widthOf, colourOf, joinStyle: "round" }),
    RangeError,
  );
});

/** The kerb width (`street`'s third value) of every vertex at ENU `(x, y)`. */
function edgesAt(built, x, y) {
  const found = [];
  for (let v = 0; v < built.positions.length / 3; v += 1) {
    const px = built.positions[v * 3];
    const py = -built.positions[v * 3 + 2];
    if (Math.hypot(px - x, py - y) < 1e-3) found.push(built.street[v * 3 + 2]);
  }
  return found;
}

// Why: the dark lines ACROSS the road the owner saw. Where two ways meet, the
// one drawn on top kept its kerb edges inside the other's surface (screenshots
// r1153/shots/top-discs.png against top-discs-noedge.png). In the mitre style
// the kerb fades out over `kerbTaperM` before the other way's half width and
// is off inside it; junction discs carry no kerb either. A dead end keeps its.
test("the kerb is off where a way runs into another, on elsewhere", () => {
  const through = way(1, { highway: "residential" }, straight(5));
  const side = way(2, { highway: "footway" }, [
    { x: 20, y: 0 },
    { x: 20, y: 30 },
  ]);
  const built = buildRibbons([through, side], {
    widthOf,
    colourOf,
    joinStyle: "mitre",
  });
  const car = ROAD_PARAMS.carEdgeM;
  const path = ROAD_PARAMS.pathEdgeM;
  const taper = ROAD_PARAMS.kerbTaperM;
  // At the junction point both ways' vertices (strip and disc) carry no kerb.
  assert.ok(edgesAt(built, 20, 0).length > 0);
  for (const e of edgesAt(built, 20, 0)) assert.ok(Math.abs(e) < 1e-6);
  // The footway (half 1) inside the road (half 3): off up to 3 m, full from 3 + taper.
  for (const e of edgesAt(built, 21, 3)) assert.ok(Math.abs(e) < 1e-6);
  for (const e of edgesAt(built, 21, 3 + taper)) {
    assert.ok(Math.abs(e - path) < 1e-6);
  }
  // The road under the footway's mouth (half 1): off to 1 m, full from 1 + taper.
  assert.ok(edgesAt(built, 21, -3).length > 0);
  for (const e of edgesAt(built, 21, -3)) assert.ok(Math.abs(e) < 1e-6);
  assert.ok(edgesAt(built, 20 + 1 + taper, -3).length > 0);
  for (const e of edgesAt(built, 20 + 1 + taper, -3)) {
    assert.ok(Math.abs(e - car) < 1e-6);
  }
  // A dead end keeps its kerb, disc and all.
  const deadEnd = edgesAt(built, 40, 0);
  assert.ok(deadEnd.length > 0);
  for (const e of deadEnd) assert.ok(Math.abs(e - car) < 1e-6);
  // The fade costs cross-sections, not discs: the through road keeps three
  // (two ends, the junction), the footway two (its ends, one the junction).
  assert.equal(built.stats.discsKept, 5);
});
