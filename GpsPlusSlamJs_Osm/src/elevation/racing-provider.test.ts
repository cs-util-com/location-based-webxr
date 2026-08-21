/**
 * `racingProvider` — both DEM sources at once, the faster one published, the
 * better one swapped in when it lands.
 *
 * WHY THIS EXISTS AND WHY THESE TESTS MATTER. Measured 2026-08-19 from one
 * machine: Mapterhorn (LiDAR-derived, the source worth having) returned four
 * z13 tiles in 3.0–21.7 s while AWS Open Data returned the same four in ~1.0 s,
 * with the CDN reporting a cache hit. Under `fallbackProvider` that produced a
 * 15 s stall and no elevation at all, because the fallback is consulted only
 * for positions the primary returned `undefined` for — a SLOW primary leaves no
 * gap, so the fallback was unreachable rather than broken.
 *
 * The deadline shipped in round one fixed the stall by cutting the primary off
 * at 3 s. On that connection every Mapterhorn tile exceeds 3 s, so the fix
 * traded the good heights away permanently. This is the composition that
 * removes the trade instead of moving it: publish whatever arrives first, and
 * upgrade in place when the better source lands.
 *
 * The failure mode being guarded is silence. An upgrade that never fires, or
 * fires with nothing, looks exactly like a working race — the map still shows
 * terrain, just always the coarse kind. Several tests below therefore assert
 * the UPGRADE, not merely that the first answer arrived.
 */

import { describe, it, expect, vi } from "vitest";

import type { ElevationProvider } from "./elevation-provider.js";
import { racingProvider } from "./racing-provider.js";

const POSITIONS = [
  { lat: 50.94, lng: 6.95 },
  { lat: 50.95, lng: 6.96 },
];

type Deferred = ElevationProvider & {
  resolve: (heights: readonly (number | undefined)[]) => void;
  reject: (error: Error) => void;
};

/** A provider whose answer is released by hand, so the race order is exact. */
function deferredProvider(sourceId: string): Deferred {
  let settle!: (heights: readonly (number | undefined)[]) => void;
  let fail!: (error: Error) => void;
  const pending = new Promise<readonly (number | undefined)[]>(
    (resolvePromise, rejectPromise) => {
      settle = resolvePromise;
      fail = rejectPromise;
    },
  );
  // The rejection is attached here so a `reject` that nothing has awaited yet
  // does not surface as an unhandled rejection and fail an unrelated test.
  pending.catch(() => undefined);
  return {
    attribution: sourceId,
    sourceId,
    elevationAt: () => pending,
    resolve: settle,
    reject: fail,
  };
}

/** Lets the microtask queue drain so a settled race can propagate. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("whichever source answers first is published", () => {
  it("publishes the fast source's heights without waiting for the preferred one", async () => {
    // The whole point of the round: the user sees ground immediately rather
    // than staring at a 15 s gate.
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const provider = racingProvider(preferred, fast);

    const answer = provider.elevationAt(POSITIONS);
    fast.resolve([100, 101]);

    expect(await answer).toEqual([100, 101]);
  });

  it("publishes the preferred source's heights when it wins, and schedules no upgrade", async () => {
    // On a fast connection the good source simply wins. Nothing further should
    // happen — an upgrade fired here would rewrite the lattice with strictly
    // worse data.
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const onUpgrade = vi.fn();
    const provider = racingProvider(preferred, fast, { onUpgrade });

    const answer = provider.elevationAt(POSITIONS);
    preferred.resolve([200, 201]);

    expect(await answer).toEqual([200, 201]);
    fast.resolve([100, 101]);
    await flush();
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("does not let an EMPTY fast answer win the race", async () => {
    // A source that answers instantly with "no coverage here" has not answered.
    // Letting it win would publish a hole and then mean-fill it, which is the
    // permanent-wrong-height hazard one layer up.
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const provider = racingProvider(preferred, fast);

    const answer = provider.elevationAt(POSITIONS);
    fast.resolve([undefined, undefined]);
    await flush();
    preferred.resolve([200, 201]);

    expect(await answer).toEqual([200, 201]);
  });
});

describe("the upgrade — the half that silently does nothing if it is wrong", () => {
  it("calls onUpgrade when the preferred source lands after the fast one won", async () => {
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const onUpgrade = vi.fn();
    const provider = racingProvider(preferred, fast, { onUpgrade });

    const answer = provider.elevationAt(POSITIONS);
    fast.resolve([100, 101]);
    expect(await answer).toEqual([100, 101]);

    preferred.resolve([200, 201]);
    await provider.awaitUpgrades();

    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onUpgrade).toHaveBeenCalledWith(POSITIONS, [200, 201]);
  });

  it("does NOT upgrade when the preferred source lands with no usable data", async () => {
    // Replacing measured heights with a batch of `undefined` would turn a
    // working window into a hole. "It answered" is not "it has data".
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const onUpgrade = vi.fn();
    const provider = racingProvider(preferred, fast, { onUpgrade });

    const answer = provider.elevationAt(POSITIONS);
    fast.resolve([100, 101]);
    await answer;

    preferred.resolve([undefined, undefined]);
    await provider.awaitUpgrades();

    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("does NOT upgrade when the preferred source fails", async () => {
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const onUpgrade = vi.fn();
    const provider = racingProvider(preferred, fast, { onUpgrade });

    const answer = provider.elevationAt(POSITIONS);
    fast.resolve([100, 101]);
    await answer;

    preferred.reject(new Error("timed out"));
    await provider.awaitUpgrades();

    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("reports an upgrade as pending until it has been delivered", async () => {
    // The worker's `terrainUpgrade` RPC is only issued when this says there is
    // something to wait for. A flag that clears too early means the page never
    // asks and the upgrade is applied where nothing can see it.
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const provider = racingProvider(preferred, fast, { onUpgrade: () => {} });

    const answer = provider.elevationAt(POSITIONS);
    fast.resolve([100, 101]);
    await answer;

    expect(provider.upgradesPending).toBe(1);
    preferred.resolve([200, 201]);
    await provider.awaitUpgrades();
    expect(provider.upgradesPending).toBe(0);
  });

  it("awaitUpgrades resolves immediately when nothing is pending", async () => {
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const provider = racingProvider(preferred, fast);

    await expect(provider.awaitUpgrades()).resolves.toBeUndefined();
  });
});

describe("failure and cancellation stay distinguishable", () => {
  it("falls back to the preferred source when the fast one fails", async () => {
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const provider = racingProvider(preferred, fast);

    const answer = provider.elevationAt(POSITIONS);
    fast.reject(new Error("503"));
    await flush();
    preferred.resolve([200, 201]);

    expect(await answer).toEqual([200, 201]);
  });

  it("returns undefined everywhere when BOTH sources fail, rather than throwing", async () => {
    // The seam's contract: providers do not throw for missing data. A DEM
    // outage must degrade the ground, not break the mesh build.
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const provider = racingProvider(preferred, fast);

    const answer = provider.elevationAt(POSITIONS);
    preferred.reject(new Error("timed out"));
    fast.reject(new Error("503"));

    expect(await answer).toEqual([undefined, undefined]);
  });

  it("re-raises an abort so 'cancelled' stays distinct from 'no coverage'", async () => {
    // `consensusProvider` makes exactly this argument: `allSettled` swallows an
    // abort like any other rejection, and the caller could then not tell a
    // cancelled load from a DEM hole. Those need opposite handling.
    const controller = new AbortController();
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const provider = racingProvider(preferred, fast);

    const answer = provider.elevationAt(POSITIONS, controller.signal);
    controller.abort();
    preferred.reject(new Error("aborted"));
    fast.reject(new Error("aborted"));

    await expect(answer).rejects.toThrow();
  });
});

describe("stats say which source the CURRENT field came from", () => {
  it("names the fast source before an upgrade and the preferred one after", async () => {
    // The AR overlay reads this. Under `fallbackProvider` it showed a ratio of
    // primary-served to fallback-served positions, which a race makes
    // arithmetically meaningless: BOTH sources answer every position, so the
    // ratio no longer partitions anything. What is still true and still useful
    // is which source the field on screen is standing on.
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const provider = racingProvider(preferred, fast, { onUpgrade: () => {} });

    expect(provider.stats.servedBy).toBe("none");

    const answer = provider.elevationAt(POSITIONS);
    fast.resolve([100, 101]);
    await answer;
    expect(provider.stats.servedBy).toBe("aws");

    preferred.resolve([200, 201]);
    await provider.awaitUpgrades();
    expect(provider.stats.servedBy).toBe("mapterhorn");
    expect(provider.stats.upgrades).toBe(1);
  });

  it('goes back to "none" when a later batch has no heights at all', async () => {
    // Why this test matters: `servedBy` is documented as "the source whose
    // heights are current, or `none`", and the empty path used to leave the
    // PREVIOUS batch's id in place. The AR readout then named a DEM for a field
    // it had no data from — a stale attribution, which is worse than an absent
    // one because it reads as working. Found in review of PR #330.
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const provider = racingProvider(preferred, fast, { onUpgrade: () => {} });

    const first = provider.elevationAt(POSITIONS);
    fast.resolve([100, 101]);
    await first;
    expect(provider.stats.servedBy).toBe("aws");

    // Second batch: both arms spent with nothing usable.
    const emptyPreferred = deferredProvider("mapterhorn");
    const emptyFast = deferredProvider("aws");
    const empty = racingProvider(emptyPreferred, emptyFast, {
      onUpgrade: () => {},
    });
    const second = empty.elevationAt(POSITIONS);
    emptyFast.resolve([undefined, undefined]);
    emptyPreferred.resolve([undefined, undefined]);
    await second;

    expect(empty.stats.emptyBatches).toBeGreaterThan(0);
    expect(empty.stats.servedBy).toBe("none");
  });
});

describe("the publish deadline — the bound the composition needs (F2)", () => {
  /**
   * WHY THIS EXISTS. The per-source deadlines do not bound the composition.
   * `firstUsable` waits for a usable answer from EITHER arm and gives up only
   * when BOTH are spent, so a fast source that answers "no coverage" at its own
   * deadline leaves the caller waiting on the preferred arm until ITS deadline —
   * which the race raised from 3 s to 30 s. The consumer's terrain gate is 15 s.
   *
   * That combination re-creates the exact bug this whole round removes: the gate
   * fires, the mesh is built flat, and the user sees no elevation. The first
   * version of this file shipped without the bound and asserted the opposite in
   * four places, including the curated lessons-learned doc.
   */

  it("publishes an absence rather than waiting past the deadline", async () => {
    vi.useFakeTimers();
    try {
      const preferred = deferredProvider("mapterhorn");
      const fast = deferredProvider("aws");
      const provider = racingProvider(preferred, fast, {
        publishTimeoutMs: 5_000,
      });

      const answer = provider.elevationAt(POSITIONS);
      // The fast source has no coverage here; the preferred one is still out.
      fast.resolve([undefined, undefined]);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(await answer).toEqual([undefined, undefined]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still delivers the preferred answer as an UPGRADE after the deadline", async () => {
    // The deadline must bound the wait, not discard the work. A source that was
    // merely slow still has the better heights, and throwing them away would
    // reintroduce the trade the race exists to remove.
    vi.useFakeTimers();
    try {
      const preferred = deferredProvider("mapterhorn");
      const fast = deferredProvider("aws");
      const onUpgrade = vi.fn();
      const provider = racingProvider(preferred, fast, {
        publishTimeoutMs: 5_000,
        onUpgrade,
      });

      const answer = provider.elevationAt(POSITIONS);
      fast.resolve([undefined, undefined]);
      await vi.advanceTimersByTimeAsync(5_000);
      await answer;

      preferred.resolve([200, 201]);
      await provider.awaitUpgrades();

      expect(onUpgrade).toHaveBeenCalledWith(POSITIONS, [200, 201]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait for the deadline when an answer arrives first", async () => {
    // The deadline is a ceiling, not a delay. If this ever became a floor, every
    // load would pay it.
    vi.useFakeTimers();
    try {
      const preferred = deferredProvider("mapterhorn");
      const fast = deferredProvider("aws");
      const provider = racingProvider(preferred, fast, {
        publishTimeoutMs: 5_000,
      });

      const answer = provider.elevationAt(POSITIONS);
      fast.resolve([100, 101]);

      expect(await answer).toEqual([100, 101]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave a superseded upgrade to write after an abort", async () => {
    // The publish path re-raises an abort, but the upgrade continuation
    // outlives it by design — it is waiting for a source still in flight — so
    // it needs its own check rather than inheriting one.
    const controller = new AbortController();
    const preferred = deferredProvider("mapterhorn");
    const fast = deferredProvider("aws");
    const onUpgrade = vi.fn();
    const provider = racingProvider(preferred, fast, { onUpgrade });

    const answer = provider.elevationAt(POSITIONS, controller.signal);
    fast.resolve([100, 101]);
    await answer;

    controller.abort();
    preferred.resolve([200, 201]);
    await provider.awaitUpgrades();

    expect(onUpgrade).not.toHaveBeenCalled();
  });
});

describe("distinct sourceIds are a precondition, not a convention", () => {
  /**
   * Why this test matters: `racingProvider` tells its two arms apart by
   * `sourceId` alone (`won.id === preferred.sourceId`). Give both the same id
   * and a FAST-arm win is misread as a preferred win, so it takes the
   * `preferredWins` branch, never calls `trackUpgrade()`, and the preferred
   * source's better heights are fetched, resolved and thrown away. The stats
   * are wrong the same way. All of it silent.
   *
   * This is not hypothetical: `TerrariumProvider` defaults `sourceId` to
   * `"terrarium"`, so the natural two-arm construction gives both the same id,
   * and that is what this repo ran until 2026-08-19. The demo now names its
   * arms explicitly, so nothing is broken today — but nothing stopped the next
   * caller repeating it, and neither this file nor the property spec ever
   * constructed a same-id pair.
   *
   * Found by a PR review bot on #329 and fixed as its own commit.
   */
  it("throws at construction when both arms carry the same sourceId", () => {
    const arm = (sourceId: string): ElevationProvider => ({
      sourceId,
      attribution: "test",
      elevationAt: () => Promise.resolve([]),
    });

    expect(() => racingProvider(arm("terrarium"), arm("terrarium"))).toThrow(
      /distinct sourceIds/i,
    );
    // The message must name the offending id, or a caller with several
    // providers has to bisect to find which pair collided.
    expect(() => racingProvider(arm("terrarium"), arm("terrarium"))).toThrow(
      /terrarium/,
    );
  });

  it("accepts distinct ids, which is the shipped configuration", () => {
    const arm = (sourceId: string): ElevationProvider => ({
      sourceId,
      attribution: "test",
      elevationAt: () => Promise.resolve([]),
    });
    expect(() =>
      racingProvider(arm("mapterhorn"), arm("aws-open-data")),
    ).not.toThrow();
  });
});

describe("servedBy across overlapping batches (PR #334 review)", () => {
  /**
   * A provider that hands out a FRESH controllable answer per call, so two
   * `elevationAt` batches can be in flight at once. `deferredProvider` above
   * settles once and cannot express this.
   */
  function queuedProvider(sourceId: string) {
    const settles: ((h: readonly (number | undefined)[]) => void)[] = [];
    return {
      attribution: sourceId,
      sourceId,
      elevationAt: () =>
        new Promise<readonly (number | undefined)[]>((r) => settles.push(r)),
      /** Release the nth call's answer, 0-based. */
      release: (n: number, heights: readonly (number | undefined)[]) => {
        const settle = settles[n];
        if (settle === undefined) throw new Error(`no call ${n}`);
        settle(heights);
      },
    };
  }

  it("does not let an OLD batch's late PUBLISH claim a newer batch's readout", async () => {
    // WHY THIS TEST MATTERS. The PR #334 fix guarded the UPGRADE continuation
    // and left the two publish-path writes unconditional, so the same defect
    // stayed open through the other door — found in review of PR #336. No
    // upgrade is involved here at all:
    //
    //   1. batch A dispatched, then batch B dispatched
    //   2. B's preferred arm wins first  -> servedBy = mapterhorn, B's heights
    //      are what the field is rebuilt from
    //   3. A's fast arm finally wins     -> servedBy = aws            <-- WRONG
    //
    // Nothing forces two in-flight `elevationAt` calls to resolve in dispatch
    // order, and the worker's terrain-upgrade path deliberately overlaps them.
    const preferred = queuedProvider("mapterhorn");
    const fast = queuedProvider("aws");
    const provider = racingProvider(preferred, fast);

    const batchA = provider.elevationAt(POSITIONS);
    const batchB = provider.elevationAt(POSITIONS);

    // B publishes FIRST, on the preferred arm.
    preferred.release(1, [210, 211]);
    expect(await batchB).toEqual([210, 211]);
    expect(provider.stats.servedBy).toBe("mapterhorn");

    // A publishes SECOND, on the fast arm. Its heights are stale; its
    // attribution must not replace the newer batch's.
    fast.release(0, [200, 201]);
    expect(await batchA).toEqual([200, 201]);
    expect(provider.stats.servedBy).toBe("mapterhorn");
  });

  it("does not let an OLD batch's empty publish blank a newer batch's readout", async () => {
    // The `servedBy = "none"` write has the same shape as the one above: a
    // stale batch that finds nothing usable would blank a readout that has
    // already moved on. `emptyBatches` stays unconditional, because it counts
    // batches, not what is on screen.
    const preferred = queuedProvider("mapterhorn");
    const fast = queuedProvider("aws");
    const provider = racingProvider(preferred, fast);

    const batchA = provider.elevationAt(POSITIONS);
    const batchB = provider.elevationAt(POSITIONS);

    preferred.release(1, [210, 211]);
    expect(await batchB).toEqual([210, 211]);
    expect(provider.stats.servedBy).toBe("mapterhorn");

    // A finds nothing on either arm.
    preferred.release(0, [undefined, undefined]);
    fast.release(0, [undefined, undefined]);
    expect(await batchA).toEqual([undefined, undefined]);
    expect(provider.stats.emptyBatches).toBe(1);
    expect(provider.stats.servedBy).toBe("mapterhorn");
  });
  it("does not let an OLD batch's late upgrade claim a newer batch's readout", async () => {
    // WHY THIS TEST MATTERS. `trackUpgrade`'s continuation outlives its own
    // call by design -- it is waiting for a source still in flight -- and it
    // used to write `servedBy` unconditionally. The interleaving below is the
    // one the PR #334 review described, and it is reachable with the current
    // wiring:
    //
    //   1. batch A: fast wins        -> servedBy = aws, upgrade tracked
    //   2. batch B: fast wins        -> servedBy = aws
    //   3. batch A's preferred lands -> servedBy = mapterhorn  <-- WRONG
    //
    // The heights on screen are batch B's Terrarium ones, while the readout
    // names Mapterhorn. That inverts the one property `servedBy` promises, and
    // `demServingLabel` is the only signal a field session has for "am I
    // standing on LiDAR or on the 30 m fallback?".
    const preferred = queuedProvider("mapterhorn");
    const fast = queuedProvider("aws");
    const onUpgrade = vi.fn();
    const provider = racingProvider(preferred, fast, { onUpgrade });

    const batchA = provider.elevationAt(POSITIONS);
    fast.release(0, [100, 101]);
    expect(await batchA).toEqual([100, 101]);
    expect(provider.stats.servedBy).toBe("aws");

    const batchB = provider.elevationAt(POSITIONS);
    fast.release(1, [110, 111]);
    expect(await batchB).toEqual([110, 111]);
    expect(provider.stats.servedBy).toBe("aws");

    // B's preferred answer settles with NO usable data, so B contributes no
    // upgrade of its own and cannot be the thing that sets `servedBy` below.
    // Released first only so `awaitUpgrades` has something to resolve on -- a
    // still-pending B would hang the flush rather than test anything.
    preferred.release(1, [undefined, undefined]);

    // A's preferred answer finally lands, long after B published.
    preferred.release(0, [200, 201]);
    await provider.awaitUpgrades();

    // THE UPGRADE STILL FIRES -- the caller may still want those heights, and
    // the count still counts a batch that was upgraded.
    expect(onUpgrade).toHaveBeenCalledWith(POSITIONS, [200, 201]);
    expect(provider.stats.upgrades).toBe(1);
    // BUT THE ATTRIBUTION STAYS WITH WHAT IS ACTUALLY ON SCREEN.
    expect(
      provider.stats.servedBy,
      "an older batch's upgrade renamed the current source",
    ).toBe("aws");
  });

  it("still attributes the upgrade when its batch IS the newest", async () => {
    // The other direction, so the guard cannot be satisfied by never writing:
    // with one batch in flight the upgrade must still claim the readout.
    const preferred = queuedProvider("mapterhorn");
    const fast = queuedProvider("aws");
    const provider = racingProvider(preferred, fast, { onUpgrade: vi.fn() });

    const only = provider.elevationAt(POSITIONS);
    fast.release(0, [100, 101]);
    expect(await only).toEqual([100, 101]);

    preferred.release(0, [200, 201]);
    await provider.awaitUpgrades();

    expect(provider.stats.servedBy).toBe("mapterhorn");
  });
});
