/**
 * Why these tests matter: the add of a file's item is one flow behind the
 * add menu, the palette and a drop, and each way out of it is something
 * the creator sees. A cancelled picker must add nothing and say nothing; a
 * file must show that it works while it is read and stop showing it on
 * every outcome (a toast left spinning is a lie); a refusal or an error
 * must place nothing and come back as words; and the place step must make
 * the kind's item, at a station or a story's end, or refuse with the
 * kind's own reason (a video at a station).
 */
import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-assets";
import type {
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it, vi, type Mock } from "vitest";

import "../test-support/tour-of.js";
import type { FileAddKind } from "../kinds/edit-kinds.js";
import { stationContent, storyOf } from "../test-support/station-content.js";
import {
  addFileItem,
  FILE_ADD_FAILED,
  FILE_STATION_GONE,
  FILE_STORY_GONE,
  placeFileItem,
  type FileAddDeps,
  type FileAddTarget,
} from "./add-file-item.js";

const ASSET: TourAsset = {
  id: "snd1",
  path: "content/snd1.wav",
  kind: "audio",
};
const POSTER: TourAsset = {
  id: "pst1",
  path: "content/pst1.jpg",
  kind: "image",
  width: 16,
  height: 9,
};
const AT_STATION = { kind: "station", stationId: "s" } as const;

function deps(over: Partial<Record<keyof FileAddDeps, Mock>> = {}) {
  const ended = vi.fn();
  const all = {
    pick: vi.fn<FileAddDeps["pick"]>(() =>
      Promise.resolve(new File(["RIFF"], "bells.wav")),
    ),
    busy: vi.fn<FileAddDeps["busy"]>(() => ended),
    addFile: vi.fn<FileAddDeps["addFile"]>(() =>
      Promise.resolve({ kind: "added", asset: ASSET, backedUp: true }),
    ),
    place: vi.fn<FileAddDeps["place"]>(() => ({ kind: "added", id: "new" })),
    ...over,
  };
  return { deps: all, ended };
}

describe("addFileItem", () => {
  it("picks, reads and places a file, busy while it reads", async () => {
    const { deps: d, ended } = deps();
    expect(await addFileItem("audio", AT_STATION, d)).toEqual({
      kind: "added",
      id: "new",
      fileName: "bells.wav",
      backedUp: true,
    });
    expect(d.pick).toHaveBeenCalledWith("audio");
    expect(d.busy).toHaveBeenCalledWith("bells.wav");
    // Only the kind's own files are taken.
    expect(d.addFile).toHaveBeenCalledWith(expect.any(File), "bells.wav", [
      "audio",
    ]);
    expect(d.place).toHaveBeenCalledWith(AT_STATION, {
      kind: "audio",
      asset: ASSET,
      fileName: "bells.wav",
    });
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("asks each kind's picker for its own files", async () => {
    for (const [kind, file] of [
      ["picture", "image"],
      ["video", "video"],
      ["model", "model"],
    ] as const) {
      const { deps: d } = deps();
      await addFileItem(kind, AT_STATION, d);
      expect(d.pick).toHaveBeenCalledWith(kind);
      expect(d.addFile.mock.calls[0]?.[2]).toEqual([file]);
    }
  });

  it("adds nothing and shows nothing for a cancelled picker", async () => {
    const { deps: d } = deps({ pick: vi.fn(() => Promise.resolve(null)) });
    expect(await addFileItem("model", AT_STATION, d)).toEqual({
      kind: "cancelled",
    });
    expect(d.busy).not.toHaveBeenCalled();
    expect(d.addFile).not.toHaveBeenCalled();
    expect(d.place).not.toHaveBeenCalled();
  });

  it("takes a dropped file without opening the picker, and passes on a video's poster", async () => {
    const { deps: d } = deps({
      addFile: vi.fn(() =>
        Promise.resolve({
          kind: "added" as const,
          asset: { ...ASSET, kind: "video" as const },
          poster: POSTER,
          backedUp: false,
        }),
      ),
    });
    const dropped = new File(["mp4"], "flood.mp4");
    expect(
      await addFileItem("video", { kind: "story", storyId: "t" }, d, dropped),
    ).toMatchObject({ kind: "added", backedUp: false });
    expect(d.pick).not.toHaveBeenCalled();
    expect(d.place.mock.calls[0]?.[1]).toMatchObject({ poster: POSTER });
  });

  it("places nothing for a file the tour refuses, and ends the busy state", async () => {
    const { deps: d, ended } = deps({
      addFile: vi.fn(() =>
        Promise.resolve({ kind: "refused" as const, reason: "Too big." }),
      ),
    });
    expect(await addFileItem("audio", AT_STATION, d)).toEqual({
      kind: "refused",
      reason: "Too big.",
    });
    expect(d.place).not.toHaveBeenCalled();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("says the place's refusal, and ends the busy state", async () => {
    const { deps: d, ended } = deps({
      place: vi.fn(() => ({ kind: "refused" as const, reason: "Too far." })),
    });
    expect(await addFileItem("audio", AT_STATION, d)).toEqual({
      kind: "refused",
      reason: "Too far.",
    });
    expect(ended).toHaveBeenCalledTimes(1);
  });

  // Why: the flow never rejects - the page awaits it with nothing to
  // catch, and an error must still reach the creator as words.
  it("turns a throw anywhere into words, the busy state ended", async () => {
    for (const over of [
      { pick: vi.fn(() => Promise.reject(new Error("x"))) },
      { addFile: vi.fn(() => Promise.reject(new Error("x"))) },
      {
        place: vi.fn(() => {
          throw new Error("x");
        }),
      },
    ]) {
      const { deps: d, ended } = deps(over);
      expect(await addFileItem("audio", AT_STATION, d)).toEqual({
        kind: "refused",
        reason: FILE_ADD_FAILED,
      });
      expect(ended).toHaveBeenCalledTimes(d.busy.mock.calls.length);
    }
  });
});

describe("placeFileItem", () => {
  const station = {
    id: "s",
    title: "Gate",
    geo: { lat: 48.1371, lon: 11.5751, alt: 520, headingDeg: 0 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    ...stationContent([storyOf("t", [])]),
  } as unknown as TourStation;

  function input(kind: FileAddKind, target: FileAddTarget) {
    return {
      target,
      source: {
        kind,
        asset: {
          ...ASSET,
          kind: kind === "picture" ? "image" : kind,
        } as TourAsset,
        fileName: "bells.wav",
      },
      stations: [station],
      id: "new",
      nowIso: "2026-11-09T10:00:00Z",
      groundAt: () => null,
      place: vi.fn((_: TourObject) => ({ kind: "placed" as const })),
      addEntryToStory: vi.fn((_: string, child: { id: string }) => ({
        kind: "added" as const,
        id: child.id,
      })),
    };
  }

  it("places a station's item through the tour's own check", () => {
    const i = input("audio", AT_STATION);
    expect(placeFileItem(i)).toEqual({ kind: "added", id: "new" });
    expect(i.place.mock.calls[0]?.[0]).toMatchObject({
      id: "new",
      kind: "audio",
      station: "s",
    });
    expect(i.addEntryToStory).not.toHaveBeenCalled();
  });

  it("puts a story's entry at its end", () => {
    const i = input("model", { kind: "story", storyId: "t" });
    expect(placeFileItem(i)).toEqual({ kind: "added", id: "new" });
    expect(i.addEntryToStory).toHaveBeenCalledWith(
      "t",
      expect.objectContaining({ id: "new", kind: "model", view: "card" }),
    );
    expect(i.place).not.toHaveBeenCalled();
  });

  // Why: "Insert step" between two cards adds a file's entry there, so
  // the target's place must reach the session.
  it("puts a story's entry at the target's place", () => {
    const i = input("model", { kind: "story", storyId: "t", at: 0 });
    expect(placeFileItem(i)).toEqual({ kind: "added", id: "new" });
    expect(i.addEntryToStory).toHaveBeenCalledWith(
      "t",
      expect.objectContaining({ id: "new", kind: "model" }),
      0,
    );
  });

  // Why: a story's entry stands at its station's free spot, so the
  // story's station must be found; a story gone meanwhile adds nothing.
  it("refuses a story that is gone, adding nothing", () => {
    const i = input("audio", { kind: "story", storyId: "gone" });
    expect(placeFileItem(i)).toEqual({
      kind: "refused",
      reason: FILE_STORY_GONE,
    });
    expect(i.addEntryToStory).not.toHaveBeenCalled();
  });

  it("refuses a station that is gone, and a video at a station, placing nothing", () => {
    const gone = input("audio", { kind: "station", stationId: "x" });
    expect(placeFileItem(gone)).toEqual({
      kind: "refused",
      reason: FILE_STATION_GONE,
    });
    const video = input("video", AT_STATION);
    expect(placeFileItem(video)).toEqual({
      kind: "refused",
      reason: "A video plays in a story: add it to one.",
    });
    expect(gone.place).not.toHaveBeenCalled();
    expect(video.place).not.toHaveBeenCalled();
  });

  it("passes on the tour's refusal", () => {
    const i = input("audio", AT_STATION);
    i.place.mockReturnValue({ kind: "refused", reason: "Too far." } as never);
    expect(placeFileItem(i)).toEqual({ kind: "refused", reason: "Too far." });
  });
});
