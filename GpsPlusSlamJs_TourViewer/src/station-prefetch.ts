/**
 * Prefetch on approach (tour kit plan K4, §8 P2; DEC-F4 found its consumer
 * here): a station's media are read from the tour - over the network, for a
 * linked tour streamed by range - while the visitor walks up to it, so its
 * story starts without "Loading…". The story's own reads go through the
 * same cache, so a prefetch in flight is joined, never repeated.
 *
 * Bounded, because a long tour must not fill a phone's memory:
 * - ONE prefetch read in flight, in the order the stations were approached
 *   (the tour session reads one entry at a time anyway);
 * - a byte budget for everything held (`PREFETCH_BUDGET_BYTES`), released
 *   from the station done longest ago, never from a station still offered;
 * - a failed read is not kept: the story's own read tries again and says
 *   what failed.
 */

import type {
  TourAsset,
  TourStation,
  TourStep,
} from "gps-plus-slam-app-framework/ar/tour-stations";

/**
 * Start prefetching this far beyond the station's activation exit radius:
 * 80 m, about a minute at a 1.4 m/s walk, which has a 5 MB story read at
 * 1 Mbit/s and a 20 MB one at 5 Mbit/s before the visitor arrives, at every
 * speed swept (`station-prefetch.sweep.test.ts`; 60 m misses the 5 MB
 * story at 1.8 m/s on a tightly banded station).
 */
export const PREFETCH_LEAD_M = 80;

/** Everything held at once: 64 MiB, a dozen castle stations of pictures
 *  and voice clips (about 5 MB each), far below a phone's tab budget. */
export const PREFETCH_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * The decode cap's size: a figure's texture is at most 2048 px along its
 * longer side. A 1.7 m figure 2 m away covers about 1840 px of a 2400 px
 * tall phone screen with a 60 degree view (`station-prefetch.sweep.test.ts`),
 * so 2048 keeps it sharp from 2 m on, at 16 MB of texture at most; 1024
 * would show soft closer than about 3.7 m.
 */
export const MAX_DECODE_SIDE_PX = 2048;

/** The decode divisor that brings a figure within the cap (1 when its size
 *  is not stated: the tour's asset record is the only size known before
 *  decoding). */
export function decodeDivisor(size?: {
  readonly width?: number;
  readonly height?: number;
}): number {
  const side = Math.max(size?.width ?? 0, size?.height ?? 0);
  return Number.isFinite(side) && side > MAX_DECODE_SIDE_PX
    ? Math.ceil(side / MAX_DECODE_SIDE_PX)
    : 1;
}

/** The asset ids a station's story reads, in step order, deduplicated. */
export function stationAssetIds(station: TourStation): string[] {
  const ids = station.steps.flatMap((step: TourStep): string[] => {
    const block = step.block;
    switch (block.kind) {
      case "image":
      case "audio":
      case "video":
      case "model":
        return [block.asset];
      case "character":
        return block.voice === undefined
          ? [block.image]
          : [block.image, block.voice];
      default:
        return [];
    }
  });
  return [...new Set(ids)];
}

export interface StationPrefetch {
  /** The visitor is `distanceM` from this offered station; prefetch it when
   *  inside its prefetch radius (`activateExitM + PREFETCH_LEAD_M`). */
  approach(
    station: TourStation,
    distanceM: number,
    activateExitM: number,
  ): void;
  /** A station is done: its media may be released first. */
  done(stationId: string): void;
  /** Read an asset: from the cache, joining a read in flight, or now. */
  load(path: string): Promise<Blob>;
  /** Bytes held (for the budget's test). */
  heldBytes(): number;
  /** Drop everything (the tour closed). */
  clear(): void;
}

export function createStationPrefetch(deps: {
  readonly assets: () => ReadonlyMap<string, TourAsset>;
  read(path: string): Promise<Blob>;
  readonly budgetBytes?: number;
}): StationPrefetch {
  const budget = deps.budgetBytes ?? PREFETCH_BUDGET_BYTES;
  /** Held blobs by path, with the station that asked first. */
  const held = new Map<string, { blob: Blob; stationId: string }>();
  const inFlight = new Map<string, Promise<Blob>>();
  const requested = new Set<string>();
  const doneOrder: string[] = [];
  let queue: { path: string; stationId: string }[] = [];
  let reading = false;
  let generation = 0;

  const heldBytes = (): number =>
    [...held.values()].reduce((sum, h) => sum + h.blob.size, 0);

  /** Release blobs of done stations, oldest done first, until `need` fits. */
  function makeRoom(need: number): boolean {
    for (const stationId of [...doneOrder]) {
      if (heldBytes() + need <= budget) break;
      for (const [path, h] of held) {
        if (h.stationId === stationId) held.delete(path);
      }
      doneOrder.splice(doneOrder.indexOf(stationId), 1);
    }
    return heldBytes() + need <= budget;
  }

  /** Read once; `stationId` null: the story's own read, not kept. */
  function read(path: string, stationId: string | null): Promise<Blob> {
    const cached = held.get(path);
    if (cached !== undefined) return Promise.resolve(cached.blob);
    const pending = inFlight.get(path);
    if (pending !== undefined) return pending;
    const mine = generation;
    const promise = deps.read(path).then(
      (blob) => {
        inFlight.delete(path);
        if (stationId !== null && mine === generation && makeRoom(blob.size)) {
          held.set(path, { blob, stationId });
        }
        return blob;
      },
      (err: unknown) => {
        inFlight.delete(path);
        requested.delete(path);
        throw err;
      },
    );
    inFlight.set(path, promise);
    return promise;
  }

  function pump(): void {
    if (reading) return;
    const next = queue.shift();
    if (next === undefined) return;
    reading = true;
    const mine = generation;
    void read(next.path, next.stationId)
      .catch(() => undefined)
      .finally(() => {
        if (mine !== generation) return;
        reading = false;
        pump();
      });
  }

  return {
    approach(station, distanceM, activateExitM) {
      if (!(distanceM <= activateExitM + PREFETCH_LEAD_M)) return;
      const assets = deps.assets();
      for (const id of stationAssetIds(station)) {
        const asset = assets.get(id);
        if (asset === undefined || requested.has(asset.path)) continue;
        requested.add(asset.path);
        queue.push({ path: asset.path, stationId: station.id });
      }
      pump();
    },
    done(stationId) {
      if (!doneOrder.includes(stationId)) doneOrder.push(stationId);
    },
    load: (path) => read(path, null),
    heldBytes,
    clear() {
      generation += 1;
      held.clear();
      inFlight.clear();
      requested.clear();
      doneOrder.length = 0;
      queue = [];
      reading = false;
    },
  };
}
