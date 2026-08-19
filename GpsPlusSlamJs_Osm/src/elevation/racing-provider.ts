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
    void work.finally(() => pending.delete(work));
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

      const won = await firstUsable([
        preferredAnswer.then((heights) => ({
          id: preferred.sourceId,
          heights,
        })),
        fastAnswer.then((heights) => ({ id: fast.sourceId, heights })),
      ]);

      // Checked before anything is published: an aborted load must not look
      // like a DEM hole, which is the distinction `consensusProvider` makes the
      // same argument for.
      signal?.throwIfAborted();

      if (won === undefined) {
        stats.emptyBatches += 1;
        return positions.map(() => undefined);
      }

      stats.servedBy = won.id;

      if (won.id === preferred.sourceId) {
        // The good source won outright. Nothing to upgrade to.
        stats.preferredWins += 1;
        return won.heights;
      }

      stats.fastWins += 1;
      const sink = options.onUpgrade;
      if (sink !== undefined) {
        track(
          preferredAnswer.then((better) => {
            // "It answered" is not "it has data". Replacing measured heights
            // with a batch of `undefined` turns a working window into a hole.
            if (!usable(better)) return;
            stats.upgrades += 1;
            stats.servedBy = preferred.sourceId;
            sink(positions, better);
          }),
        );
      }
      return won.heights;
    },
  };
}
