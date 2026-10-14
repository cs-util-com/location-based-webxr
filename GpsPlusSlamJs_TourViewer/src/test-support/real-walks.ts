/**
 * TEST ONLY (imported by `*.test.ts` files alone, never by the app): the
 * D20 real-walk cache and its reference-point helpers, shared by
 * `code-displacement.recordings.test.ts` (which builds the cache and owns
 * every sweep over it) and the QR-first M0 replay's GPS-noise arm
 * (`qr-hold-replay.recordings.test.ts`, plan 2026-10-14-0445 §7 #8), so both
 * read the same 42 reference points the same way. Moved here unchanged
 * from the D20 file; its header documents the cache and the collision rule.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  calcGpsCoords,
  calcRelativeCoordsInMeters,
  type LatLong,
  type Quaternion,
  type Vector3,
} from "gps-plus-slam-app-framework/core";

export const CACHE_DIR =
  process.env.D20_REAL_CACHE ?? path.join(os.tmpdir(), "d20-real-walks");

/** Where a recording was taken, by the folder it is filed in (the
 *  Investigation's filing rule, GpsPlusSlamJs_Docs 2026-07-28-1903). */
export type Place = "outdoor" | "indoor" | "mixed" | "other";

/** One device fix of a replayed walk. */
export interface WalkFix {
  /** Fix time (epoch ms). */
  readonly t: number;
  /** Device fix, metres from the zero: north, east. */
  readonly g: readonly [number, number];
  /** Its odometry partner, odometry-NUE: north, up, east. */
  readonly o: readonly [number, number, number];
  /** Reported horizontal accuracy (m), or null. */
  readonly acc: number | null;
  /** The alignment published after this fix (column-major), or null. */
  readonly a: readonly number[] | null;
  /** Magnetic bearing of the AR north axis from the compass and the AR
   *  pose (core `arNorthBearingDeg`), portrait readings only; or null. */
  readonly compass: number | null;
}

/** One reference-point mark: a physically fixed spot the walker marked. */
export interface WalkMark {
  /** The point's identity: its name when the walker gave one, else its id. */
  readonly key: string;
  readonly t: number;
  /** The mark's AR pose (raw WebXR). */
  readonly position: Vector3;
  readonly rotation: Quaternion;
  /** The alignment in effect when the mark was taken, or null. */
  readonly a: readonly number[] | null;
  /** Device fixes recorded before the mark (the mint gate counts them). */
  readonly fixesBefore: number;
}

export interface Walk {
  readonly key: string;
  readonly place: Place;
  readonly era: number | null;
  readonly skipped?: string;
  readonly zero?: LatLong;
  readonly fixes?: readonly WalkFix[];
  readonly marks?: readonly WalkMark[];
  readonly actionTypes?: Record<string, number>;
  readonly portraitShare?: number;
}

export const MINT_GATE_FIXES = 3;

/** How a name collision is told apart from GPS error without GPS. */
export interface CollisionRule {
  /** One name marked further apart than this within ONE walk (odometry)
   *  names several spots. Within-walk repeats of one spot measure 0.1-3.4 m
   *  in this corpus, the smallest multi-spot name 21.5 m. */
  readonly withinWalkM: number;
  /** Two walks' odometry distances between two shared points disagree
   *  beyond pairAbsM + pairRel x the distance (odometry drift grows with
   *  distance; agreeing distances measure median 0.8 m, p90 2.5 m). */
  readonly pairAbsM: number;
  readonly pairRel: number;
}

export const COLLISION_RULE: CollisionRule = {
  withinWalkM: 10,
  pairAbsM: 10,
  pairRel: 0.05,
};

export function loadWalks(): Walk[] {
  if (!fs.existsSync(CACHE_DIR)) return [];
  return fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map(
      (f) =>
        JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), "utf8")) as Walk,
    );
}

/** Raw WebXR position to odometry-NUE (north, up, east). */
export const nueOdom = (p: Vector3): [number, number, number] => [
  -p[2],
  p[1],
  p[0],
];

export function nueToOtherZero(
  position: readonly number[],
  from: LatLong,
  to: LatLong,
): [number, number, number] {
  const geo = calcGpsCoords(from, [position[0]!, position[1]!, position[2]!]);
  const nue = calcRelativeCoordsInMeters(to, geo, 0, 0);
  return [nue[0], position[1]!, nue[2]];
}

/** The UTC day of a walk, from its file name; null when it has none. */
export function dayOf(walkKey: string): string | null {
  return /(\d{4}-\d{2}-\d{2})_\d{2}-\d{2}-\d{2}utc$/.exec(walkKey)?.[1] ?? null;
}

export type Obs = { readonly w: Walk; readonly m: WalkMark };

/** The marks the pairs are built from: with an alignment, past the mint
 *  gate, on a walk with a zero. */
export function usableMarks(walks: readonly Walk[]): Obs[] {
  return walks.flatMap((w) =>
    w.zero === undefined
      ? []
      : (w.marks ?? [])
          .filter((m) => m.a !== null && m.fixesBefore >= MINT_GATE_FIXES)
          .map((m) => ({ w, m })),
  );
}

/** A mark's horizontal odometry position (north, east) in its own walk. */
interface MarkSite {
  readonly key: string;
  readonly walk: string;
  readonly n: number;
  readonly e: number;
}

export const pairId = (a: string, b: string, key: string): string =>
  a < b ? `${a}|${b}|${key}` : `${b}|${a}|${key}`;

/**
 * Name collisions found WITHOUT GPS (see COLLISION_RULE): `ambiguous` names
 * label several spots within one walk; `inconsistent` holds pairId(walkA,
 * walkB, name) where that name's odometry distances to the other points
 * both walks marked disagree for MORE than half of them. With exactly two
 * shared points that disagree, both are flagged: odometry cannot tell
 * which one moved. With one shared point there is nothing to compare.
 */
export function nameCollisions(
  sites: readonly MarkSite[],
  rule: CollisionRule,
): { ambiguous: Set<string>; inconsistent: Set<string> } {
  const byWalk = new Map<string, Map<string, MarkSite[]>>();
  for (const s of sites) {
    const keys = byWalk.get(s.walk) ?? new Map<string, MarkSite[]>();
    keys.set(s.key, [...(keys.get(s.key) ?? []), s]);
    byWalk.set(s.walk, keys);
  }
  const ambiguous = new Set<string>();
  const centres = new Map<string, Map<string, readonly [number, number]>>();
  for (const [walk, keys] of byWalk) {
    const c = new Map<string, readonly [number, number]>();
    for (const [key, list] of keys) {
      for (const a of list)
        for (const b of list)
          if (Math.hypot(a.n - b.n, a.e - b.e) > rule.withinWalkM)
            ambiguous.add(key);
      c.set(key, [
        list.reduce((x, s) => x + s.n, 0) / list.length,
        list.reduce((x, s) => x + s.e, 0) / list.length,
      ]);
    }
    centres.set(walk, c);
  }
  const inconsistent = new Set<string>();
  const walks = [...centres.keys()].sort();
  const dist = (p: readonly [number, number], q: readonly [number, number]) =>
    Math.hypot(p[0] - q[0], p[1] - q[1]);
  for (let i = 0; i < walks.length; i += 1) {
    const A = centres.get(walks[i]!)!;
    for (let j = i + 1; j < walks.length; j += 1) {
      const B = centres.get(walks[j]!)!;
      const shared = [...A.keys()].filter((k) => B.has(k) && !ambiguous.has(k));
      if (shared.length < 2) continue;
      for (const P of shared) {
        let disagree = 0;
        for (const Q of shared) {
          if (Q === P) continue;
          const dA = dist(A.get(P)!, A.get(Q)!);
          const dB = dist(B.get(P)!, B.get(Q)!);
          if (
            Math.abs(dA - dB) >
            rule.pairAbsM + rule.pairRel * Math.max(dA, dB)
          )
            disagree += 1;
        }
        if (disagree > (shared.length - 1) / 2)
          inconsistent.add(pairId(walks[i]!, walks[j]!, P));
      }
    }
  }
  return { ambiguous, inconsistent };
}

export function markSites(walks: readonly Walk[]): MarkSite[] {
  return usableMarks(walks).map(({ w, m }) => {
    const o = nueOdom(m.position);
    return { key: m.key, walk: w.key, n: o[0], e: o[2] };
  });
}
