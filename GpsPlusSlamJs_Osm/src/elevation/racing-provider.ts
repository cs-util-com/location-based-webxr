/**
 * Two DEM sources asked at once: publish the first usable answer, upgrade in
 * place when the better one lands.
 *
 * @see racing-provider.ts.md
 */

import type { LatLng } from "../model/osm-feature.js";
import type { ElevationProvider } from "./elevation-provider.js";

/** Heights delivered for one batch, in the order the positions were asked. */
export type Heights = readonly (number | undefined)[];

/**
 * Which source the field on screen is standing on, and how often it has been
 * upgraded.
 *
 * DELIBERATELY NOT `FallbackProviderStats`. That type counts
 * `primaryAnswered` against `fallbackAnswered` and the AR overlay renders their
 * ratio — a partition that only means something when the two sources answer
 * DISJOINT sets of positions, which is exactly what `fallbackProvider`
 * guarantees and a race destroys. Under a race both sources answer every
 * position, so the ratio stops being arithmetically defined; reporting it
 * anyway would be a confident wrong number rather than a missing one.
 *
 * What is still true, and is what a person in the field actually wants, is
 * which source the current heights came from.
 */
export interface RacingProviderStats {
  /** `sourceId` of the source whose heights are current, or `"none"`. */
  servedBy: string;
  /** Batches published by the fast source and later replaced. */
  upgrades: number;
  /** Batches where the preferred source won outright. */
  preferredWins: number;
  /** Batches the fast source published first. */
  fastWins: number;
  /** Batches where neither source had usable data. */
  emptyBatches: number;
}

export type RacingElevationProvider = ElevationProvider & {
  readonly stats: RacingProviderStats;
  /** Upgrades asked for and not yet delivered to `onUpgrade`. */
  readonly upgradesPending: number;
  /**
   * Resolves once every pending upgrade has been delivered.
   *
   * This is what the worker's `terrainUpgrade` RPC awaits. It resolves
   * immediately when nothing is pending, so a caller that asks speculatively
   * does not hang.
   */
  awaitUpgrades(): Promise<void>;
};

export interface RacingProviderOptions {
  readonly sourceId?: string;
  /**
   * Hard bound on how long `elevationAt` may take to PUBLISH, ms.
   *
   * WHY THE COMPOSITION NEEDS ITS OWN BOUND, and why per-source deadlines are
   * not enough. `firstUsable` waits for a usable answer from EITHER arm and
   * gives up only when BOTH are spent — so a fast source that answers "no
   * coverage" at its 8 s deadline does not end the batch, it leaves the caller
   * waiting on the preferred arm for up to ITS deadline, which the race raised
   * to 30 s. The consumer's terrain gate is 15 s. That combination re-creates
   * the exact defect this work exists to remove: the gate fires, the mesh is
   * built flat, and the user sees no elevation.
   *
   * The first version of this file shipped without it and asserted the
   * opposite in four places, including `lessons-learned.md`. Caught by the
   * milestone review.
   *
   * On expiry the batch publishes whatever the fast arm managed (or nothing)
   * and **still registers the upgrade**, so the preferred source's late answer
   * is not thrown away — it simply arrives as an upgrade rather than as the
   * first answer. Omit for an unbounded wait, which is what tests that drive
   * the arms by hand want.
   */
  readonly publishTimeoutMs?: number;
  /**
   * Called when the preferred source lands after the fast one already
   * published, with the same positions and the better heights.
   *
   * **Late binding is expected.** The worker builds the provider before the
   * terrain field that consumes the upgrade, so this is normally a closure over
   * a `let` the caller assigns afterwards rather than the final sink itself.
   */
  readonly onUpgrade?: (positions: readonly LatLng[], heights: Heights) => void;
}

/** Whether an answer carries at least one real height. */
function usable(heights: Heights | undefined): heights is Heights {
  return heights !== undefined && heights.some((h) => h !== undefined);
}

interface Tagged {
  readonly id: string;
  readonly heights: Heights | undefined;
}

/** A {@link Tagged} whose heights have been proven usable. */
interface Answered {
  readonly id: string;
  readonly heights: Heights;
}

/**
 * The first answer that actually carries heights, or `undefined` if neither
 * does.
 *
 * WRITTEN AS A LOOP RATHER THAN `Promise.race`, and the difference is a real
 * defect the tests caught. A plain race returns the first to SETTLE, which may
 * be a source reporting "no coverage" — publishing that would hand the layer
 * above a hole to mean-fill into a permanent wrong height. Awaiting one arm
 * first instead (the shape this replaced) is worse still: it hangs the whole
 * batch whenever that arm never settles, so one stuck source could stall a load
 * the other had already answered. This waits for a usable answer from EITHER,
 * in whichever order they arrive, and gives up only when both are spent.
 */
async function firstUsable(
  arms: readonly Promise<Tagged>[],
): Promise<Answered | undefined> {
  const remaining = new Set(arms);
  while (remaining.size > 0) {
    const done = await Promise.race(
      [...remaining].map((arm) => arm.then((value) => ({ arm, value }))),
    );
    remaining.delete(done.arm);
    // Rebuilt rather than returned as-is so the proven-usable heights survive
    // the narrowing into the return type; `Tagged.heights` stays optional
    // because an arm that failed genuinely has none.
    const { id, heights } = done.value;
    if (usable(heights)) return { id, heights };
  }
  return undefined;
}

/**
 * Resolves to `undefined` if `work` has not settled within `ms`.
 *
 * A plain timer rather than an `AbortSignal`: the losing arm must keep running
 * so its answer can still arrive as an upgrade. Cancelling it would turn a slow
 * source into no source, which is the trade the race exists to remove.
 */
async function withPublishDeadline(
  work: Promise<Answered | undefined>,
  ms: number,
): Promise<Answered | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    // Cleared on every path, or a node process holds the event loop open for
    // the full deadline after the work is long done.
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Races `preferred` against `fast`.
 *
 * WHY A RACE AND NOT A DEADLINE. A deadline on the preferred source (round
 * one's M1) makes the fallback reachable but pays for it permanently: measured
 * from one machine, every Mapterhorn tile exceeded the 3 s deadline, so the
 * LiDAR-derived heights were never served at all. A larger deadline only moves
 * the trade. Racing removes it — the user waits for the FASTER source and
 * receives the BETTER one.
 *
 * WHY NOT {@link consensusProvider}. A median of two samples is their average,
 * which blends a LiDAR height with a coarse global one and throws the
 * resolution advantage away. Precedence is right when one source is strictly
 * better where it has data.
 *
 * **The empty answer does not win.** A source that resolves instantly with all
 * `undefined` has reported "no coverage", not an answer; letting it win would
 * publish a hole that the layer above mean-fills into a plausible permanent
 * wrong height.
 *
 * **Neither source throwing for missing data is the seam's contract**, so a
 * double failure resolves to `undefined` everywhere rather than rejecting. An
 * abort is different and is re-raised, for the reason `consensusProvider`
 * states: `allSettled` would otherwise make a cancelled load indistinguishable
 * from a DEM hole.
 */
export function racingProvider(
  preferred: ElevationProvider,
  fast: ElevationProvider,
  options: RacingProviderOptions = {},
): RacingElevationProvider {
  // THE ARMS ARE TOLD APART BY `sourceId` ALONE — `won.id === preferred.sourceId`
  // below is the only discriminator — so identical ids make a FAST win look like
  // a preferred win: it takes the `preferredWins` branch, never calls
  // `trackUpgrade()`, and the preferred source's better heights are fetched,
  // resolved and discarded. The stats are wrong the same way, and all of it is
  // silent.
  //
  // NOT HYPOTHETICAL. `TerrariumProvider` defaults `sourceId` to "terrarium", so
  // the natural two-arm construction gives both the same id — and that is what
  // shipped until 2026-08-19, when `dem-provider.ts` started naming them. That
  // fix is downstream; nothing here stopped the next caller repeating it.
  //
  // Checked at construction rather than per call: the ids are known here, this
  // runs once, and a throw at wiring time is findable in a way a silently
  // disabled upgrade path is not.
  if (preferred.sourceId === fast.sourceId) {
    throw new Error(
      `racingProvider needs distinct sourceIds to tell the arms apart; both are "${preferred.sourceId}"`,
    );
  }

  const stats: RacingProviderStats = {
    servedBy: "none",
    upgrades: 0,
    preferredWins: 0,
    fastWins: 0,
    emptyBatches: 0,
  };

  /** In-flight upgrade waits, so `awaitUpgrades` can join all of them. */
  const pending = new Set<Promise<void>>();

  const track = (work: Promise<void>): void => {
    pending.add(work);
    // `.catch` BEFORE `.finally`, and the order matters. `finally` returns a
    // NEW promise that rejects with the original reason, and `awaitUpgrades`
    // attaches `allSettled` to `work` rather than to that derived promise — so
    // a throwing sink produced an unhandled rejection inside a worker, which is
    // to say nowhere anyone would see it.
    void work.catch(() => undefined).finally(() => pending.delete(work));
  };

  return {
    attribution: [preferred.attribution, fast.attribution]
      .filter((a) => a !== "")
      .join(" · "),
    sourceId: options.sourceId ?? `${preferred.sourceId}|${fast.sourceId}`,
    stats,

    get upgradesPending(): number {
      return pending.size;
    },

    async awaitUpgrades(): Promise<void> {
      // Snapshotted rather than looped: an upgrade registered WHILE we wait
      // belongs to a later batch and to a later call, and joining it here would
      // let a steady stream of loads keep one RPC open indefinitely.
      await Promise.allSettled([...pending]);
    },

    async elevationAt(positions, signal) {
      // Both dispatched before either is awaited — that is the race. A `for
      // await` here would serialise them and quietly restore `fallbackProvider`
      // behaviour with worse code.
      const preferredAnswer = preferred
        .elevationAt(positions, signal)
        .catch(() => undefined);
      const fastAnswer = fast
        .elevationAt(positions, signal)
        .catch(() => undefined);

      const arms = [
        preferredAnswer.then((heights) => ({
          id: preferred.sourceId,
          heights,
        })),
        fastAnswer.then((heights) => ({ id: fast.sourceId, heights })),
      ];

      /**
       * Registers the preferred source's late answer as an upgrade.
       *
       * Called from BOTH exits that publish something other than the preferred
       * source's own heights — the fast arm winning, and the publish deadline
       * expiring. The second was missing in the first version, which meant a
       * batch that timed out threw the better answer away entirely.
       */
      const trackUpgrade = (): void => {
        const sink = options.onUpgrade;
        if (sink === undefined) return;
        track(
          preferredAnswer.then((better) => {
            // "It answered" is not "it has data". Replacing measured heights
            // with a batch of `undefined` turns a working window into a hole.
            if (!usable(better)) return;
            // AN ABORTED LOAD MUST NOT WRITE EITHER. The publish path re-raises
            // an abort, but this continuation outlives it by design — it is
            // waiting for a source that is still in flight — so it needs its
            // own check rather than inheriting one.
            if (signal?.aborted === true) return;
            stats.upgrades += 1;
            stats.servedBy = preferred.sourceId;
            sink(positions, better);
          }),
        );
      };

      const won = await (options.publishTimeoutMs === undefined
        ? firstUsable(arms)
        : withPublishDeadline(firstUsable(arms), options.publishTimeoutMs));

      // Checked before anything is published: an aborted load must not look
      // like a DEM hole, which is the distinction `consensusProvider` makes the
      // same argument for.
      signal?.throwIfAborted();

      if (won === undefined) {
        // Either both arms are spent with nothing usable, or the publish
        // deadline expired first. Both publish an absence — and both still want
        // the upgrade, because the preferred arm may yet answer.
        stats.emptyBatches += 1;
        // AND THE CURRENT SOURCE IS NOW NOTHING. Leaving the previous batch's
        // id in place made the AR readout name a DEM for a batch it has no
        // heights from — the interface documents `or "none"` for exactly this
        // state, and `servedBy` is described as "which source the current
        // heights came from", of which there are none. A stale attribution is
        // worse than an absent one here, because it reads as working.
        stats.servedBy = "none";
        trackUpgrade();
        return positions.map(() => undefined);
      }

      stats.servedBy = won.id;

      if (won.id === preferred.sourceId) {
        // The good source won outright. Nothing to upgrade to.
        stats.preferredWins += 1;
        return won.heights;
      }

      stats.fastWins += 1;
      trackUpgrade();
      return won.heights;
    },
  };
}
