/**
 * Why these tests matter (code book plan, M6 v5.1): the settle measures, for
 * each sighting of a stored code, how far the visit's GPS puts the code from
 * each of its KNOWN spots, with the viewer's own rigid fit
 * (`estimateCodeDisplacement`, `CODE_MOVE_ESTIMATOR`, the shipped gate) and
 * the viewer's window around the sighting. A wrong pin, a wrong window or an
 * ungated fit would move codes on GPS noise, or never move them. The world
 * here is exact (the odometry is the truth, the GPS is the truth plus an
 * offset), so every distance is known in advance.
 */
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";

import type { DisplacementSample } from "./code-displacement.js";
import { judgeCodeSpots, type SpotSighting } from "./code-spot-settle.js";
import type { SpotRef } from "./code-spots.js";
import type { NuePose } from "./visit-anchoring.js";

const rad = (d: number): number => (d * Math.PI) / 180;

/** A yaw-only pose in a NUE frame, turned `yawDeg` about Up. */
function pose(n: number, e: number, yawDeg = 0, up = 0): NuePose {
  const h = rad(yawDeg) / 2;
  return { position: [n, up, e], rotation: [0, Math.sin(h), 0, Math.cos(h)] };
}

const matrixOf = (p: NuePose): Matrix4 =>
  new Matrix4().compose(
    new Vector3(...p.position),
    new Quaternion(...p.rotation),
    new Vector3(1, 1, 1),
  );

/** The true odometry-to-world transform: a yaw and an offset, so a pin that
 *  mixed the two frames up could not pass. */
const WORLD_TO_ODOM = matrixOf(pose(120, -60, 40, 3)).invert();

function inOdom(world: NuePose): NuePose {
  const m = WORLD_TO_ODOM.clone().multiply(matrixOf(world));
  const p = new Vector3();
  const q = new Quaternion();
  m.decompose(p, q, new Vector3());
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
}

const T0 = 1_700_000_000_000;

/** A two-minute walk along a 30 m loop, one fix a second; the GPS reads the
 *  truth plus `gpsOffset`. */
function walk(
  gpsOffset: readonly [number, number] = [0, 0],
  fromS = 0,
  toS = 120,
): DisplacementSample[] {
  const out: DisplacementSample[] = [];
  for (let s = fromS; s <= toS; s += 1) {
    const a = (s / 120) * 2 * Math.PI;
    const n = 15 * Math.cos(a);
    const e = 15 * Math.sin(a);
    const o = new Vector3(n, 1.4, e).applyMatrix4(WORLD_TO_ODOM);
    out.push({
      tMs: T0 + s * 1000,
      gps: [n + gpsOffset[0], e + gpsOffset[1]],
      odom: [o.x, o.z],
      accuracyM: 5,
    });
  }
  return out;
}

/** The poster really hangs here (world NUE), facing east. */
const POSTER = pose(10, 5, 90, 1.5);
const seenAt = (atS = 60): SpotSighting => ({
  atMs: T0 + atS * 1000,
  codeOdomNue: inOdom(POSTER),
});
const at = (dn: number, de: number): NuePose =>
  pose(POSTER.position[0] + dn, POSTER.position[2] + de, 90, 1.5);

const current: SpotRef = { kind: "current" };
const previous: SpotRef = { kind: "previous" };

const judge = (over: Partial<Parameters<typeof judgeCodeSpots>[0]>) =>
  judgeCodeSpots({
    spots: [{ spot: current, pose: POSTER }],
    sightings: [seenAt()],
    samples: walk(),
    candidate: [POSTER.position[0], POSTER.position[2]],
    reliable: true,
    frameChanged: false,
    previousExpires: false,
    ...over,
  });

describe("judgeCodeSpots - the viewer's fit against every known spot", () => {
  it("sees the code at its saved spot when the GPS agrees", () => {
    expect(judge({}).decision).toEqual({
      kind: "none",
      reason: "at-current",
    });
    expect(judge({}).classes).toEqual([current]);
  });

  it("moves a code whose saved spot is 30 m from where the poster hangs", () => {
    const r = judge({
      spots: [{ spot: current, pose: at(30, 0) }],
      candidate: [POSTER.position[0], POSTER.position[2]],
    });
    expect(r.decision).toEqual({ kind: "move" });
    expect(r.classes).toEqual(["new"]);
  });

  it("undoes a move when the poster hangs at the spot the move left", () => {
    const r = judge({
      spots: [
        { spot: current, pose: at(0, 28) },
        { spot: previous, pose: POSTER },
      ],
    });
    expect(r.decision).toEqual({ kind: "undo" });
  });

  // The fit, not the raw GPS, decides: a GPS that is 30 m off for the whole
  // visit is absorbed by the fit only as far as the odometry disagrees with
  // it. Here the whole walk's GPS is shifted, which IS what a moved code
  // looks like, so it reads as moved - the measured false-move case.
  it("reads a whole-visit GPS shift of 30 m as moved (the measured false-trigger case)", () => {
    // The pose a move would mint comes through the same GPS: shifted too.
    const shifted: [number, number] = [
      POSTER.position[0] + 30,
      POSTER.position[2],
    ];
    expect(
      judge({ samples: walk([30, 0]), candidate: shifted }).decision.kind,
    ).toBe("move");
  });

  it("uses only the fixes within the viewer's window around the sighting", () => {
    // Fixes 10 minutes before the sighting are 40 m off: outside the
    // 300 s window they must not count.
    const samples = [...walk([40, 0], -900, -700), ...walk([0, 0], 0, 120)];
    expect(judge({ samples }).decision).toEqual({
      kind: "none",
      reason: "at-current",
    });
  });

  it("judges nothing from a visit too short for the viewer's gate", () => {
    const r = judge({ samples: walk([0, 0], 0, 30) });
    expect(r.decision).toEqual({ kind: "none", reason: "not-judged" });
    expect(r.classes).toEqual([null]);
  });

  // v5.1 review #3: without a gated fit a sighting is still placed at a
  // known spot by where the visit's alignment saw it, so a second print is
  // never corrected through the saved pose.
  it("classifies an unfitted sighting by where the visit's alignment saw it", () => {
    const r = judge({
      samples: walk([0, 0], 0, 30),
      spots: [
        { spot: current, pose: at(0, 30) },
        { spot: { kind: "copy", index: 0 }, pose: POSTER },
      ],
      sightings: [
        { ...seenAt(), seenNue: [POSTER.position[0], POSTER.position[2]] },
      ],
    });
    expect(r.decision).toEqual({ kind: "none", reason: "not-judged" });
    expect(r.classes).toEqual([{ kind: "copy", index: 0 }]);
  });

  it("places a sighting at the nearest known spot within the floor", () => {
    const r = judge({
      spots: [
        { spot: current, pose: at(30, 0) },
        { spot: { kind: "copy", index: 0 }, pose: at(-18, 0) },
      ],
    });
    // The fit puts the code 18 m from the copy: it belongs to the copy.
    expect(r.decision).toEqual({ kind: "copy", index: 0 });
  });

  // v4 review #2: the move mints the candidate, so a candidate within the
  // floor of a known spot moves nothing even when the fit reads "new".
  it("does not move when the pose it would mint lies near a known spot", () => {
    const r = judge({
      spots: [
        { spot: current, pose: at(30, 0) },
        { spot: { kind: "copy", index: 0 }, pose: at(0, -25) },
      ],
      candidate: [POSTER.position[0], POSTER.position[2] - 10],
    });
    expect(r.classes).toEqual(["new"]);
    expect(r.decision).toEqual({ kind: "none", reason: "near-known" });
  });

  it("does not move without a pose to mint", () => {
    const r = judge({
      spots: [{ spot: current, pose: at(30, 0) }],
      candidate: null,
    });
    expect(r.decision).toEqual({ kind: "none", reason: "near-known" });
  });
});
