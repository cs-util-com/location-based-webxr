/**
 * Why this test matters: the band's per-frame step moved out of the globe
 * lab as a pure refactor (the globe must look and behave exactly as
 * before). Its order and its state are the contract: the first gated frame
 * starts on the globe, a gap counts at most 250 ms, the hold, the edges
 * and the 0.1 steps reach the log once each, and a carrier out of the band
 * is drained only after the wait, keeping what `keep` names, cancelled by
 * a return and never while the share is frozen.
 */

import { describe, expect, it } from "vitest";

import { nextDrawnShare } from "./globe-band-gate.js";
import { createBandRelease, createBandShare } from "./globe-band-step.js";
import { carrierShareAt } from "./globe-flight.js";
import type { TileCache } from "./globe-tile-cache.js";

/** A tile set whose one top-level tile is loaded (or not) and in view. */
function tilesReady(ready: { now: boolean }) {
  const child = {
    traversal: { lastFrameVisited: 1, inFrustum: true },
    get internal() {
      return { loadingState: ready.now ? 4 : 1 };
    },
  };
  return { root: { children: [child] }, frameCount: 1 };
}

function band() {
  const relief = { now: true };
  const globe = { now: true };
  const logs: string[] = [];
  const marks: string[] = [];
  let settled = true;
  const share = createBandShare({
    globeTiles: tilesReady(globe),
    reliefTiles: tilesReady(relief),
    reliefSettled: () => settled,
    log: (kind) => logs.push(kind),
    mark: (kind) => marks.push(kind),
  });
  return {
    share,
    relief,
    globe,
    logs,
    marks,
    unsettle: () => (settled = false),
  };
}

const frame = {
  altitudeM: 1000,
  fixedShare: null,
  highM: 8000,
  lowM: 2000,
  gate: true,
  sharp: true,
};

describe("createBandShare", () => {
  it("starts on the relief, and the first gated frame starts on the globe", () => {
    const { share, logs, marks } = band();
    expect(share.share()).toBe(1);
    expect(share.target()).toBe(0);
    // A low camera's target is 1, but the first frame has no time to move.
    expect(share.step(0, frame)).toBe(0);
    expect(share.target()).toBe(1);
    expect(marks).toEqual(["band.edge"]);
    expect(logs).toEqual(["band.share"]);
  });

  it("moves by nextDrawnShare, a gap counting at most 250 ms", () => {
    const { share } = band();
    share.step(0, frame);
    const want = nextDrawnShare({
      drawn: 0,
      target: 1,
      reliefReady: true,
      globeReady: true,
      dtMs: 250,
    });
    expect(share.step(10_000, frame)).toBe(want);
    expect(want).toBeGreaterThan(0);
    expect(want).toBeLessThan(1);
  });

  it("follows a fixed share or an ungated target at once", () => {
    const { share } = band();
    expect(share.step(0, { ...frame, fixedShare: 0.3 })).toBe(0.3);
    expect(share.step(16, { ...frame, gate: false, altitudeM: 5000 })).toBe(
      carrierShareAt(5000, { highM: 8000, lowM: 2000 }),
    );
  });

  // Why: the relief takes its first pixels only once refined; the log
  // names a hold and its end once each, not every frame.
  it("holds the share while the relief is unrefined, logging the hold once", () => {
    const b = band();
    b.unsettle();
    b.share.step(0, frame);
    expect(b.share.step(500, frame)).toBe(0);
    expect(b.share.step(1000, frame)).toBe(0);
    expect(b.logs.filter((k) => k === "band.hold")).toHaveLength(1);
    b.relief.now = false;
    b.globe.now = false;
    b.share.step(1500, frame);
    expect(b.logs.filter((k) => k === "band.hold")).toHaveLength(1);
  });

  it("marks each mixed frame and logs only the share's 0.1 steps", () => {
    const { share, marks, logs } = band();
    share.step(0, frame);
    for (let t = 16; t <= 160; t += 16) share.step(t, frame);
    const mixed = marks.filter((k) => k === "band.mixed").length;
    expect(mixed).toBe(10);
    expect(logs.filter((k) => k === "band.share").length).toBeLessThan(mixed);
  });
});

/** A cache of `n` items; a drain removes them, an item named "keep" stays. */
function cacheOf(items: string[]) {
  const list = [...items];
  const cache = {
    get cachedBytes() {
      return list.length * 100;
    },
    minSize: 0,
    maxSize: 1000,
    minBytesSize: 0,
    maxBytesSize: 1e9,
    itemList: list,
    markAllUnused() {},
    unloadUnusedContent() {
      list.splice(0, list.length);
    },
    remove(item: unknown) {
      const i = list.indexOf(item as string);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    },
  };
  return cache as unknown as TileCache;
}

function release(drainTiles = 2) {
  const globe = cacheOf(["g1", "g2", "g3", "keep"]);
  const relief = cacheOf(["r1"]);
  const logs: string[] = [];
  const marks: string[] = [];
  let t = 0;
  const r = createBandRelease({
    globe: { cache: globe, keep: () => (item) => item === "keep" },
    relief: { cache: relief, keep: () => () => false },
    log: (kind) => logs.push(kind),
    mark: (kind) => marks.push(kind),
    clock: () => (t += 1),
  });
  const at = (nowMs: number, share: number, more = {}) =>
    r.step(nowMs, {
      share,
      altitudeM: 1000,
      frozen: false,
      releaseMs: 1000,
      drainTiles,
      ...more,
    });
  return { r, globe, relief, logs, marks, at };
}

describe("createBandRelease", () => {
  it("drains a carrier out of the band after the wait, keeping what keep names", () => {
    const { r, globe, logs, marks, at } = release();
    at(0, 1);
    at(999, 1);
    expect(globe.itemList).toHaveLength(4);
    expect(r.settled()).toBe(false);
    at(1000, 1);
    expect(marks).toEqual(["release.globe", "drain.globe"]);
    at(1016, 1);
    expect(globe.itemList).toEqual(["keep"]);
    expect(r.outOfBand.globe).toMatchObject({ since: 0, done: true });
    expect(r.outOfBand.globe.last).toMatchObject({
      leftAt: 0,
      releasedAt: 1000,
      drainedAt: 1016,
      frames: 2,
      maxPerFrame: 2,
      releaseMs: 2,
      worstFrameMs: 1,
      bytes: 300,
    });
    expect(r.released).toEqual({ globe: 300, relief: 0 });
    expect(logs).toEqual(["drained.globe"]);
    expect(r.settled()).toBe(true);
    // Done: nothing more until the carrier comes back.
    at(2000, 1);
    expect(marks).toHaveLength(3);
  });

  it("cancels the wait on a return, and restarts it while frozen", () => {
    const { r, globe, at } = release();
    at(0, 1);
    at(500, 0.5);
    expect(r.outOfBand.globe.since).toBeNull();
    at(600, 1, { frozen: true });
    at(5000, 1, { frozen: true });
    expect(globe.itemList).toHaveLength(4);
    expect(r.outOfBand.globe.since).toBeNull();
  });

  it("releases the relief's whole cache at once with a drain step of 0", () => {
    const { r, relief, at } = release(0);
    at(0, 0);
    at(1000, 0);
    expect(relief.itemList).toHaveLength(0);
    expect(r.outOfBand.relief.done).toBe(true);
    // Back in the band: a later exit is a new release.
    at(1100, 0.5);
    expect(r.outOfBand.relief.done).toBe(false);
    at(1200, 0);
    at(2200, 0);
    expect(r.outOfBand.relief.last?.leftAt).toBe(1200);
  });
});
