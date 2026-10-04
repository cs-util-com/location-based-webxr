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
  });
  const land = async (size?: number) => {
    const next = pending.shift()!;
    next.resolve(new Blob([new Uint8Array(size ?? sizes[next.path] ?? 10)]));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { prefetch, reads, pending, land };
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

  it("stays within its byte budget, releasing a done station first and never an offered one", async () => {
    const h = harness(100);
    h.prefetch.approach(station("a", ["knight"]), 10, 38);
    await h.land(60);
    h.prefetch.approach(station("b", ["arch"]), 10, 38);
    await h.land(60);
    // a is still offered: b does not fit, and is not kept.
    expect(h.prefetch.heldBytes()).toBe(60);
    h.prefetch.done("a");
    h.prefetch.approach(station("c", ["big"]), 10, 38);
    await h.land(60);
    expect(h.prefetch.heldBytes()).toBe(60);
    // c replaced a; a's picture is read again if ever needed.
    void h.prefetch.load("content/knight.png");
    expect(h.reads.at(-1)).toBe("content/knight.png");
  });

  it("clear drops everything, and a read landing after it is not kept", async () => {
    const h = harness();
    h.prefetch.approach(station("gate", ["knight", "arch"]), 10, 38);
    h.prefetch.clear();
    await h.land();
    expect(h.prefetch.heldBytes()).toBe(0);
  });
});
