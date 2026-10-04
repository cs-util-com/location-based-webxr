import { describe, expect, it } from "vitest";
import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";

import {
  createStationPrefetch,
  decodeDivisor,
  MAX_DECODE_SIDE_PX,
  PREFETCH_LEAD_M,
  stationAssetIds,
} from "./station-prefetch";

/**
 * Why these tests matter: a story should start the moment its station is
 * found, which needs its media read while the visitor walks up - but a
 * long tour must not fill a phone's memory, a station far away must cost
 * nothing, and a read that failed must not be served from a cache as if it
 * had worked.
 */

const assets = new Map<string, TourAsset>([
  ["knight", { id: "knight", path: "content/knight.png", kind: "image" }],
  ["voice", { id: "voice", path: "content/voice.mp3", kind: "audio" }],
  ["arch", { id: "arch", path: "content/arch.glb", kind: "model" }],
  ["big", { id: "big", path: "content/big.png", kind: "image" }],
  ["film", { id: "film", path: "content/film.mp4", kind: "video" }],
]);

function station(id: string, assetIds: string[]): TourStation {
  return {
    id,
    anchor: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 } },
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps: assetIds.map((asset, i) => ({
      id: `s${String(i)}`,
      block: { kind: "image", asset },
      advance: { mode: "tap" },
    })),
  };
}

function harness(budgetBytes = 1000, sizes: Record<string, number> = {}) {
  const reads: string[] = [];
  /** The open tour (identity is what counts). */
  let tour: object | null = { name: "castle" };
  const pending: {
    path: string;
    resolve: (b: Blob) => void;
    reject: (e: Error) => void;
  }[] = [];
  const prefetch = createStationPrefetch({
    assets: () => assets,
    read: (path) => {
      reads.push(path);
      return new Promise((resolve, reject) =>
        pending.push({ path, resolve, reject }),
      );
    },
    budgetBytes,
    tour: () => tour,
  });
  const land = async (size?: number) => {
    const next = pending.shift()!;
    next.resolve(new Blob([new Uint8Array(size ?? sizes[next.path] ?? 10)]));
    await new Promise((r) => setTimeout(r, 0));
  };
  const openTour = (t: object | null) => (tour = t);
  return { prefetch, reads, pending, land, openTour };
}

describe("stationAssetIds", () => {
  it("lists what a story reads, in step order, once each: figures and voices, pictures, sounds, models", () => {
    const s: TourStation = {
      ...station("gate", []),
      steps: [
        {
          id: "a",
          block: {
            kind: "character",
            name: "K",
            image: "knight",
            caption: "c",
            voice: "voice",
          },
          advance: { mode: "tap" },
        },
        {
          id: "b",
          block: { kind: "text", text: "t" },
          advance: { mode: "tap" },
        },
        {
          id: "c",
          block: { kind: "model", asset: "arch" },
          advance: { mode: "tap" },
        },
        {
          id: "d",
          block: {
            kind: "character",
            name: "K",
            image: "knight",
            caption: "c",
          },
          advance: { mode: "tap" },
        },
      ],
    };
    expect(stationAssetIds(s)).toEqual(["knight", "voice", "arch"]);
  });

  it("never lists a video: K4 shows its transcript, and a video may be 256 MiB (R3)", () => {
    // Why this test matters (K4 review R3): the prefetch read video files
    // nothing played, up to the K0 entry cap each, over a phone's data.
    const s: TourStation = {
      ...station("gate", ["knight"]),
      steps: [
        {
          id: "v",
          block: { kind: "video", asset: "film", transcript: "t" },
          advance: { mode: "tap" },
        },
        ...station("gate", ["knight"]).steps,
      ],
    };
    expect(stationAssetIds(s)).toEqual(["knight"]);
  });
});

describe("decodeDivisor", () => {
  it("scales a figure above the cap down to it, and leaves the rest alone", () => {
    expect(decodeDivisor({ width: 1000, height: 2000 })).toBe(1);
    expect(decodeDivisor({ width: MAX_DECODE_SIDE_PX, height: 10 })).toBe(1);
    expect(decodeDivisor({ width: 3000, height: 8000 })).toBe(4);
    expect(decodeDivisor(undefined)).toBe(1);
    expect(decodeDivisor({ width: Number.POSITIVE_INFINITY })).toBe(1);
  });
});

describe("createStationPrefetch", () => {
  it("reads nothing for a station beyond its prefetch radius, then everything one at a time", async () => {
    const h = harness();
    const s = station("gate", ["knight", "arch"]);
    h.prefetch.approach(s, 38 + PREFETCH_LEAD_M + 1, 38);
    expect(h.reads).toEqual([]);
    h.prefetch.approach(s, 38 + PREFETCH_LEAD_M, 38);
    expect(h.reads).toEqual(["content/knight.png"]);
    h.prefetch.approach(s, 30, 38); // asked again: nothing new
    await h.land();
    expect(h.reads).toEqual(["content/knight.png", "content/arch.glb"]);
  });

  it("the story's read joins a prefetch in flight and then hits the cache", async () => {
    const h = harness();
    h.prefetch.approach(station("gate", ["knight"]), 10, 38);
    const story = h.prefetch.load("content/knight.png");
    await h.land(7);
    expect((await story).size).toBe(7);
    expect((await h.prefetch.load("content/knight.png")).size).toBe(7);
    expect(h.reads).toEqual(["content/knight.png"]);
  });

  it("a story read that was never prefetched is not kept", async () => {
    const h = harness();
    const story = h.prefetch.load("content/arch.glb");
    await h.land();
    await story;
    expect(h.prefetch.heldBytes()).toBe(0);
  });

  it("does not keep a failed read: the story's own read tries again", async () => {
    const h = harness();
    h.prefetch.approach(station("gate", ["knight"]), 10, 38);
    h.pending.shift()!.reject(new Error("network"));
    await new Promise((r) => setTimeout(r, 0));
    const again = h.prefetch.load("content/knight.png");
    expect(h.reads).toEqual(["content/knight.png", "content/knight.png"]);
    await h.land();
    await expect(again).resolves.toBeInstanceOf(Blob);
  });

  it("offline: a failed read is not asked again for the same station on every tick; another station tries once more (R4)", async () => {
    // Why this test matters (K4 review R4): the guide ticks on every camera
    // frame, so a read retried on every approach hammered a dead network
    // (or a broken entry) dozens of times a second.
    const h = harness();
    const gate = station("gate", ["knight"]);
    h.prefetch.approach(gate, 10, 38);
    h.pending.shift()!.reject(new Error("offline"));
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 50; i += 1) h.prefetch.approach(gate, 10, 38);
    expect(h.reads).toEqual(["content/knight.png"]);
    // A different station needing the same picture: one more try.
    h.prefetch.approach(station("well", ["knight"]), 10, 38);
    expect(h.reads).toEqual(["content/knight.png", "content/knight.png"]);
  });

  it("holds an asset shared by two stations until both are done, and fetches it again once released (R11)", async () => {
    // Why this test matters (K4 review R11): the K4 build tied an asset to
    // the first station that asked, so it was released when that station
    // was done - while the second still needed it - and never fetched again.
    const h = harness(100);
    h.prefetch.approach(station("a", ["knight"]), 10, 38);
    h.prefetch.approach(station("b", ["knight"]), 10, 38);
    await h.land(60);
    h.prefetch.done("a");
    // Room for c's picture would need the knight released: b still needs it.
    h.prefetch.approach(station("c", ["big"]), 10, 38);
    await h.land(60);
    expect(h.prefetch.heldBytes()).toBe(60);
    // b's story reads the knight from the cache: no third read.
    const story = h.prefetch.load("content/knight.png");
    expect(h.reads).toEqual(["content/knight.png", "content/big.png"]);
    expect((await story).size).toBe(60);
    // Once b is done too, the knight may go; a later station reads it again.
    h.prefetch.done("b");
    h.prefetch.approach(station("d", ["arch"]), 10, 38);
    await h.land(60);
    h.prefetch.approach(station("e", ["knight"]), 10, 38);
    expect(h.reads.at(-1)).toBe("content/knight.png");
  });

  it("keeps the cache across a session end, and drops it when the tour closes or changes (R15)", async () => {
    // Why this test matters (K4 review R15): the cache was dropped at every
    // AR session end, so a visitor who left AR for a moment read the next
    // story again; it is keyed by entry path, so it must go with the tour.
    const h = harness();
    h.prefetch.approach(station("gate", ["knight"]), 10, 38);
    await h.land(7);
    expect(h.prefetch.heldBytes()).toBe(7);
    // A session end is not a tour change: nothing here clears.
    expect((await h.prefetch.load("content/knight.png")).size).toBe(7);
    h.openTour(null);
    h.prefetch.sync();
    expect(h.prefetch.heldBytes()).toBe(0);
    h.openTour({ name: "abbey" });
    void h.prefetch.load("content/knight.png");
    expect(h.reads).toEqual(["content/knight.png", "content/knight.png"]);
  });

  it("stays within its byte budget, releasing a done station first and never an offered one", async () => {
    const h = harness(100);
    h.prefetch.approach(station("a", ["knight"]), 10, 38);
    await h.land(60);
    h.prefetch.approach(station("b", ["arch"]), 10, 38);
    await h.land(60);
    // a is still offered: b does not fit, and is not kept - nor read again
    // on every tick while it would still not fit (its story reads it).
    expect(h.prefetch.heldBytes()).toBe(60);
    for (let i = 0; i < 20; i += 1) {
      h.prefetch.approach(station("b", ["arch"]), 10, 38);
    }
    expect(h.reads).toEqual(["content/knight.png", "content/arch.glb"]);
    h.prefetch.done("a");
    h.prefetch.approach(station("c", ["big"]), 10, 38);
    await h.land(60);
    expect(h.prefetch.heldBytes()).toBe(60);
    // c replaced a; a's picture is read again if ever needed.
    void h.prefetch.load("content/knight.png");
    expect(h.reads.at(-1)).toBe("content/knight.png");
  });

  it("a tour change drops everything, and a read landing after it is not kept", async () => {
    const h = harness();
    h.prefetch.approach(station("gate", ["knight", "arch"]), 10, 38);
    h.openTour({ name: "abbey" });
    h.prefetch.sync();
    await h.land();
    expect(h.prefetch.heldBytes()).toBe(0);
  });
});
