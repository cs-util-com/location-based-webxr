/**
 * Prefetch on approach (tour kit plan K4, §8 P2; DEC-F4 found its consumer
 * here): a station's media are read from the tour - over the network, for a
 * linked tour streamed by range - while the visitor walks up to it, so its
 * story starts without "Loading…". The story's own reads go through the
 * same cache, so a prefetch in flight is joined, never repeated.
 *
 * Two triggers: `approach` (an offered station within its activation
 * radius plus `PREFETCH_LEAD_M`) and `ahead` (K4 review R5: the station
 * that comes next in a fixed or branch order, from the moment the current
 * station is found, so its story is read while the current one plays).
 *
 * Bounded, because a long tour must not fill a phone's memory:
 * - ONE prefetch read in flight, in the order asked (the tour session reads
 *   one entry at a time anyway);
 * - a byte budget for everything held (`PREFETCH_BUDGET_BYTES`): an asset is
 *   held for every station that asked for it and released only once all of
 *   them are done, the one whose last station was done longest ago first
 *   (K4 review R11: an asset tied to the first station that asked was
 *   released while a second still needed it, and never fetched again);
 * - a read that failed, or did not fit the budget, is not kept and not
 *   asked again for the stations that asked (R4: offline, the guide's
 *   per-frame ticks retried it every frame); another station asking tries
 *   once more, and the story's own read always tries and says what failed;
 * - video is never prefetched (R3): K4 shows a video step's transcript, and
 *   a video may be as large as the tour's entry cap;
 * - the cache lives with the open tour (R15): kept across AR sessions,
 *   dropped when the tour closes or another opens.
 */

import type {
  TourAsset,
  TourStation,
  TourStep,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { imageInfoOfBlob } from "gps-plus-slam-app-framework/utils/image-header";

/**
 * Start prefetching this far beyond the station's activation radius:
 * 80 m, about a minute at a 1.4 m/s walk, which has at least a 5 MB story
 * read at 1 Mbit/s and 25 MB at 5 Mbit/s before the visitor arrives, at
 * every speed swept (`station-prefetch.sweep.test.ts`; 60 m leaves 3.75 MB
 * at 1.8 m/s on a tightly banded station). It decides only for a station
 * approached from afar: under a fixed order at castle spacing the next
 * station is offered inside any lead, and `ahead` reads it during the
 * current story instead (K4 review R5).
 */
export const PREFETCH_LEAD_M = 80;

/** Everything held at once: 64 MiB, a dozen castle stations of pictures
 *  and voice clips (about 5 MB each), far below a phone's tab budget. */
const PREFETCH_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * The decode cap's size: a figure's texture is at most 2048 px along its
 * longer side. A 1.7 m figure 2 m away covers about 1840 px of a 2400 px
 * tall phone screen with a 60 degree view (`station-prefetch.sweep.test.ts`),
 * so 2048 keeps it sharp from 2 m on, at 16 MB of texture at most; 1024
 * would show soft closer than about 3.7 m.
 */
export const MAX_DECODE_SIDE_PX = 2048;

/** The decode divisor that brings a figure of this size within
 *  `MAX_DECODE_SIDE_PX` along its longer side. */
export function decodeDivisor(size: {
  readonly width: number;
  readonly height: number;
}): number {
  const side = Math.max(size.width, size.height);
  return Number.isFinite(side) && side > MAX_DECODE_SIDE_PX
    ? Math.ceil(side / MAX_DECODE_SIDE_PX)
    : 1;
}

/**
 * Decode a figure within the caps (K4 review R2): its size read from its
 * own header, never from the size the tour declares; never decoded over
 * the tour pixel cap (`TOUR_MAX_IMAGE_PIXELS`) or when its size cannot be
 * read (null); otherwise decoded at the divisor that brings it within
 * `MAX_DECODE_SIDE_PX`.
 */
export async function decodeFigure<T>(
  blob: Blob,
  decode: (blob: Blob, divisor: number) => Promise<T | null>,
): Promise<T | null> {
  const info = await imageInfoOfBlob(blob);
  if (info === null || info.width * info.height > TOUR_MAX_IMAGE_PIXELS) {
    return null;
  }
  return decode(blob, decodeDivisor(info));
}

/** The asset ids a station's story reads, in step order, deduplicated.
 *  Never a video (K4 review R3): K4 shows a video step's transcript, and a
 *  video may be as large as the tour's entry cap allows. */
export function stationAssetIds(station: TourStation): string[] {
  const ids = station.steps.flatMap((step: TourStep): string[] => {
    const block = step.block;
    switch (block.kind) {
      case "image":
      case "audio":
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
   *  inside its prefetch radius (`activateM + PREFETCH_LEAD_M`). */
  approach(station: TourStation, distanceM: number, activateM: number): void;
  /** The station that comes next in a fixed or branch order, while the
   *  current story plays: prefetch it from any distance (K4 review R5). */
  ahead(station: TourStation): void;
  /** A station is done: the media only it needed may be released. */
  done(stationId: string): void;
  /** Read an asset: from the cache, joining a read in flight, or now. */
  load(path: string): Promise<Blob>;
  /** Bytes held (for the budget's test). */
  heldBytes(): number;
  /** Drop everything now if the open tour changed or closed (the page
   *  calls it when it stops the stations; every other call checks too). */
  sync(): void;
}

export function createStationPrefetch(deps: {
  readonly assets: () => ReadonlyMap<string, TourAsset>;
  read(path: string): Promise<Blob>;
  /** The open tour, compared by identity: the cache is keyed by entry
   *  path, which the next tour reuses, so a different value (or null, the
   *  tour closed) drops everything. A session end keeps it (R15). */
  tour(): unknown;
  readonly budgetBytes?: number;
  /** The lead beyond the activation radius; `PREFETCH_LEAD_M` unless a
   *  sweep sets it (`station-prefetch.sweep.test.ts`). */
  readonly leadM?: number;
}): StationPrefetch {
  const budget = deps.budgetBytes ?? PREFETCH_BUDGET_BYTES;
  const leadM = deps.leadM ?? PREFETCH_LEAD_M;
  /** Held blobs by path. */
  const held = new Map<string, Blob>();
  /** The stations that asked for each queued, in-flight or held path: an
   *  asset is held for all of them (K4 review R11). */
  const needers = new Map<string, Set<string>>();
  /** The stations a path was given up for - its read failed, or it did not
   *  fit the budget: not asked again for them (K4 review R4: the guide
   *  ticks on every camera frame); another station asking tries once more,
   *  and the story's own read always tries. */
  const givenUpFor = new Map<string, Set<string>>();
  /** Done stations, by the order they were done in. */
  const doneSeq = new Map<string, number>();
  let doneCount = 0;
  const inFlight = new Map<string, Promise<Blob>>();
  let queue: string[] = [];
  let reading = false;
  let generation = 0;
  let tourKey: unknown = deps.tour();

  const heldBytes = (): number =>
    [...held.values()].reduce((sum, blob) => sum + blob.size, 0);

  function clear(): void {
    generation += 1;
    held.clear();
    needers.clear();
    givenUpFor.clear();
    doneSeq.clear();
    inFlight.clear();
    queue = [];
    reading = false;
  }

  function sync(): void {
    const key = deps.tour();
    if (key === tourKey) return;
    tourKey = key;
    clear();
  }

  /** When the last station needing a held path was done, or null while
   *  any of them is not done. */
  function releasableAt(path: string): number | null {
    let latest = -1;
    for (const id of needers.get(path) ?? []) {
      const at = doneSeq.get(id);
      if (at === undefined) return null;
      latest = Math.max(latest, at);
    }
    return latest;
  }

  /** Release held assets no station still needs, the one whose last
   *  station was done longest ago first, until `need` fits. */
  function makeRoom(need: number): boolean {
    const candidates = [...held.keys()]
      .map((path) => ({ path, at: releasableAt(path) }))
      .filter((c): c is { path: string; at: number } => c.at !== null)
      .sort((a, b) => a.at - b.at);
    for (const { path } of candidates) {
      if (heldBytes() + need <= budget) break;
      held.delete(path);
      needers.delete(path);
    }
    return heldBytes() + need <= budget;
  }

  /** A path not held after its read: not asked again for its askers. */
  function giveUp(path: string): void {
    const askers = needers.get(path);
    if (askers === undefined) return;
    const givenUp = givenUpFor.get(path) ?? new Set<string>();
    for (const id of askers) givenUp.add(id);
    givenUpFor.set(path, givenUp);
    needers.delete(path);
  }

  /** Read once; kept only while a station asked for it (a story's own
   *  read of an asset nobody prefetched is not kept). */
  function read(path: string): Promise<Blob> {
    const cached = held.get(path);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = inFlight.get(path);
    if (pending !== undefined) return pending;
    const mine = generation;
    const promise = deps.read(path).then(
      (blob) => {
        if (mine !== generation) return blob;
        inFlight.delete(path);
        if (needers.has(path) && makeRoom(blob.size)) {
          held.set(path, blob);
        } else {
          giveUp(path);
        }
        return blob;
      },
      (err: unknown) => {
        if (mine === generation) {
          inFlight.delete(path);
          giveUp(path);
        }
        throw err;
      },
    );
    inFlight.set(path, promise);
    return promise;
  }

  function pump(): void {
    if (reading) return;
    const path = queue.shift();
    if (path === undefined) return;
    reading = true;
    const mine = generation;
    void read(path)
      .catch(() => undefined)
      .finally(() => {
        if (mine !== generation) return;
        reading = false;
        pump();
      });
  }

  /** Ask for a station's media: each path once, held for every station
   *  that asked; a path given up for this station is not asked again. */
  function request(station: TourStation): void {
    const assets = deps.assets();
    for (const id of stationAssetIds(station)) {
      const asset = assets.get(id);
      if (asset === undefined) continue;
      const path = asset.path;
      if (givenUpFor.get(path)?.has(station.id) === true) continue;
      const askers = needers.get(path);
      if (askers !== undefined) {
        askers.add(station.id);
        continue;
      }
      needers.set(path, new Set([station.id]));
      if (!held.has(path) && !inFlight.has(path)) queue.push(path);
    }
    pump();
  }

  return {
    approach(station, distanceM, activateM) {
      sync();
      if (!(distanceM <= activateM + leadM)) return;
      request(station);
    },
    ahead(station) {
      sync();
      request(station);
    },
    done(stationId) {
      sync();
      if (!doneSeq.has(stationId)) doneSeq.set(stationId, (doneCount += 1));
    },
    load(path) {
      sync();
      return read(path);
    },
    heldBytes,
    sync,
  };
}
