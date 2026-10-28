/**
 * The altitude band's per-frame step (one-scene plan §3; round-6 plan
 * G6-1), moved out of the globe lab: the relief's share of the pixels and
 * the release of a carrier that left the band.
 *
 * - `createBandShare`: the altitude's target share (`carrierShareAt`, or a
 *   fixed share), gated by the carriers' readiness (`nextDrawnShare`,
 *   `topLevelReady`), with the hold, the edge and the share's 0.1 steps
 *   reported to the caller's log and marks.
 * - `createBandRelease`: a carrier out of the band for `releaseMs` has its
 *   tile cache drained a few tiles a frame (or released at once), keeping
 *   its coarsest tiles; a return before then cancels it. Its per-carrier
 *   record is what the smokes read.
 *
 * Both keep the lab's state shapes, so its readers stay as they were.
 *
 * @see globe-band-step.ts.md
 */

import { nextDrawnShare, topLevelReady } from "./globe-band-gate.js";
import { carrierShareAt } from "./globe-flight.js";
import {
  drainTileCache,
  releaseTileCache,
  type TileCache,
} from "./globe-tile-cache.js";

/** What the gate reads of a tile set (3d-tiles-renderer's `TilesRenderer`). */
type BandTiles = Parameters<typeof topLevelReady>[0];

/** A rare event for the debug log: its kind and its detail. */
type BandLog = (kind: string, detail: Record<string, unknown>) => void;
/** A recorder mark: its kind and, for the debug log, its detail. */
type BandMark = (kind: string, detail?: Record<string, unknown>) => void;

export interface BandShareOptions {
  globeTiles: BandTiles;
  reliefTiles: BandTiles;
  /** Whether the relief's view is refined: nothing of it loading or queued. */
  reliefSettled: () => boolean;
  log: BandLog;
  mark: BandMark;
}

interface BandShareFrame {
  /** The camera's altitude (m), not negative. */
  altitudeM: number;
  /** A fixed share in [0, 1] in place of the altitude's, or null. */
  fixedShare: number | null;
  /** The band's top and bottom (m), `lowM < highM`. */
  highM: number;
  lowM: number;
  /** False: the share follows the target at once, ungated. */
  gate: boolean;
  /** False: the relief need not be refined before it takes its first pixels. */
  sharp: boolean;
}

export interface BandShare {
  /** The frame's drawn share, from the frame before's and the readiness. */
  step(nowMs: number, frame: BandShareFrame): number;
  /** The drawn share (1 before the first step: the relief's). */
  share(): number;
  /** The altitude's share before the gate (0 before the first step). */
  target(): number;
}

/**
 * The relief's share of the pixels, gated by readiness. The first gated
 * frame starts on the globe (it draws from orbit); a frame gap counts at
 * most 250 ms, so a stall never jumps the cross-fade.
 */
export function createBandShare(options: BandShareOptions): BandShare {
  const { globeTiles, reliefTiles, reliefSettled, log, mark } = options;
  let share = 1;
  let target = 0;
  let lastGateAt: number | null = null;
  let held = false;
  let lastShare = share;
  let loggedShare: number | null = null;
  /** The share moved toward `targetShare` as far as the carriers allow. */
  const gated = (nowMs: number, targetShare: number, sharp: boolean) => {
    // The relief starts taking pixels only once its view is refined (no
    // flash from the globe's sharp imagery to the relief's coarse first
    // tiles); once it has pixels it keeps them while its top tiles are
    // loaded, so a pan at a low altitude never hands the frame back and
    // forth.
    const reliefReady =
      topLevelReady(reliefTiles) && (share > 0 || !sharp || reliefSettled());
    const globeReady = topLevelReady(globeTiles);
    const nowHeld = !reliefReady || !globeReady;
    if (nowHeld !== held) {
      held = nowHeld;
      log(held ? "band.hold" : "band.go", {
        reliefReady,
        globeReady,
        target: targetShare,
        drawn: share,
      });
    }
    return nextDrawnShare({
      drawn: lastGateAt === null ? 0 : share,
      target: targetShare,
      reliefReady,
      globeReady,
      dtMs: lastGateAt === null ? 0 : Math.min(nowMs - lastGateAt, 250),
    });
  };
  /** The frame's edge and mixed marks and the share's new 0.1 step. */
  const report = (altitudeM: number) => {
    if (share > 0 !== lastShare > 0 || share < 1 !== lastShare < 1) {
      mark("band.edge", { share, altKm: altitudeM / 1000 });
    }
    if (share > 0 && share < 1) mark("band.mixed");
    const shareStep = Math.round(share * 10) / 10;
    if (shareStep !== loggedShare) {
      loggedShare = shareStep;
      log("band.share", { share: shareStep, altKm: altitudeM / 1000 });
    }
    lastShare = share;
  };
  return {
    step(nowMs, frame) {
      const { altitudeM, fixedShare, highM, lowM, gate, sharp } = frame;
      const targetShare =
        fixedShare ?? carrierShareAt(altitudeM, { highM, lowM });
      share =
        fixedShare !== null || !gate
          ? targetShare
          : gated(nowMs, targetShare, sharp);
      lastGateAt = nowMs;
      target = targetShare;
      report(altitudeM);
      return share;
    },
    share: () => share,
    target: () => target,
  };
}

/** A carrier's last release, for the smokes. */
interface BandReleaseRecord {
  /** When it left the band, its release started and its drain ended. */
  leftAt: number;
  releasedAt: number;
  drainedAt: number | null;
  /** Frames the drain ran, and the most tiles one of them removed. */
  frames: number;
  maxPerFrame: number;
  /** The drain's total and worst-frame cost (ms), and the bytes it freed. */
  releaseMs: number;
  worstFrameMs: number;
  bytes: number;
}

/** When a carrier left the band (null while it has pixels), and since. */
interface BandOutOfBand {
  since: number | null;
  done: boolean;
  last: BandReleaseRecord | null;
}

type BandCarrier = "globe" | "relief";

/** A carrier as the release sees it. */
interface BandReleaseCarrier {
  cache: TileCache;
  /** The tiles a drain keeps, asked anew each frame. */
  keep: () => (item: unknown) => boolean;
}

export interface BandReleaseOptions {
  globe: BandReleaseCarrier;
  relief: BandReleaseCarrier;
  log: BandLog;
  mark: BandMark;
  /** The drain's own clock (ms), for its cost. Defaults to `performance.now`. */
  clock?: () => number;
}

interface BandReleaseFrame {
  /** The drawn share this frame. */
  share: number;
  /** The camera's altitude (m), for the release's mark. */
  altitudeM: number;
  /** The share is held for a smoke: nothing is released, a wait restarts. */
  frozen: boolean;
  /** How long a carrier stays out before its release (ms). */
  releaseMs: number;
  /** Tiles drained a frame; 0 releases the whole cache at once. */
  drainTiles: number;
}

export interface BandRelease {
  step(nowMs: number, frame: BandReleaseFrame): void;
  /** Each carrier's state (live objects, the lab's readers' shape). */
  readonly outOfBand: Readonly<Record<BandCarrier, BandOutOfBand>>;
  /** The bytes released per carrier so far (a live object). */
  readonly released: Readonly<Record<BandCarrier, number>>;
  /** No carrier waits for, or is in, a release. */
  settled(): boolean;
}

/**
 * The release of a carrier out of the band (review 2026-10-03-1835 major 4:
 * outside the band the inactive carrier's tiles are unloaded, not only left
 * undrawn). The globe is out at a share of 1, the relief at 0.
 */
export function createBandRelease(options: BandReleaseOptions): BandRelease {
  const { log, mark } = options;
  const clock = options.clock ?? (() => performance.now());
  const carriers = { globe: options.globe, relief: options.relief };
  const outOfBand: Record<BandCarrier, BandOutOfBand> = {
    globe: { since: null, done: false, last: null },
    relief: { since: null, done: false, last: null },
  };
  const released: Record<BandCarrier, number> = { globe: 0, relief: 0 };
  /**
   * Whether `key`'s cache is drained this frame: out of the band (and not
   * frozen) for `releaseMs`, and not drained yet. A return or a freeze
   * restarts the wait.
   */
  const due = (key: BandCarrier, nowMs: number, frame: BandReleaseFrame) => {
    const out = key === "globe" ? frame.share >= 1 : frame.share <= 0;
    const o = outOfBand[key];
    if (!out || frame.frozen) {
      if (!out) o.done = false;
      o.since = null;
      return false;
    }
    if (o.done) return false;
    o.since ??= nowMs;
    return nowMs - o.since >= frame.releaseMs;
  };
  /** One frame of `key`'s drain, with its record and events. */
  const drain = (key: BandCarrier, nowMs: number, frame: BandReleaseFrame) => {
    const { cache } = carriers[key];
    const keep = carriers[key].keep();
    const o = outOfBand[key];
    const since = o.since ?? nowMs;
    if (o.last?.leftAt !== since) {
      o.last = {
        leftAt: since,
        releasedAt: nowMs,
        drainedAt: null,
        frames: 0,
        maxPerFrame: 0,
        releaseMs: 0,
        worstFrameMs: 0,
        bytes: 0,
      };
      mark(`release.${key}`, { altKm: frame.altitudeM / 1000 });
    }
    const t0 = clock();
    const items = cache.itemList.length;
    // The drain keeps the carrier's coarsest tiles: cheap, and what lets
    // it draw again at once when the view returns.
    let left = 0;
    let bytes: number;
    if (frame.drainTiles === 0) {
      bytes = releaseTileCache(cache);
    } else {
      const drained = drainTileCache(cache, frame.drainTiles, keep);
      bytes = drained.freedBytes;
      left = drained.left;
    }
    const ms = clock() - t0;
    const l = o.last;
    l.frames++;
    l.maxPerFrame = Math.max(l.maxPerFrame, items - cache.itemList.length);
    l.releaseMs += ms;
    l.worstFrameMs = Math.max(l.worstFrameMs, ms);
    l.bytes += bytes;
    released[key] += bytes;
    mark(`drain.${key}`);
    if (left === 0) {
      o.done = true;
      l.drainedAt = nowMs;
      log(`drained.${key}`, { frames: l.frames, mib: l.bytes / 2 ** 20 });
    }
  };
  return {
    outOfBand,
    released,
    settled: () =>
      Object.values(outOfBand).every((o) => o.since === null || o.done),
    step(nowMs, frame) {
      for (const key of ["globe", "relief"] as const) {
        if (due(key, nowMs, frame)) drain(key, nowMs, frame);
      }
    },
  };
}
