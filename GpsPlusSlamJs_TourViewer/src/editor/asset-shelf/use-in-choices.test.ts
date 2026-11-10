/**
 * Why these tests matter: "Use in..." is how a phone does what a drop does
 * on a desktop, so its choices must be exactly the drop's places - a
 * station (never for a video, which plays in a story only), a story's end,
 * and the items of the file's kind made from another file - and a chosen
 * key must name the same target a drop would.
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { useInChoices, useInTarget } from "./use-in-choices.js";

const STATIONS = [
  {
    id: "s1",
    title: "Gate",
    children: [
      { id: "snd", kind: "audio", audio: "a1", title: "Bells" },
      { id: "snd2", kind: "audio", audio: "a2", title: "Wind" },
      { id: "pic", kind: "picture", image: "p1", title: "Old gate" },
      {
        id: "st1",
        kind: "folder",
        role: "story",
        title: "Legend",
        children: [{ id: "v1", kind: "video", video: "v9", title: "Flood" }],
      },
    ],
  },
  { id: "s2", title: "Mill", children: [] },
] as unknown as TourStation[];

describe("useInChoices", () => {
  it("offers a sound every station, every story and the other sounds", () => {
    const groups = useInChoices({ id: "a1", kind: "audio" }, STATIONS);
    expect(groups.map((g) => g.head)).toEqual([
      "A new sound in a station",
      "A new entry at the end of a story",
      "Replace the file of",
    ]);
    expect(groups[0]?.choices.map((c) => c.key)).toEqual([
      "station:s1",
      "station:s2",
    ]);
    expect(groups[1]?.choices.map((c) => c.key)).toEqual(["story:st1"]);
    // Bells already shows a1; only Wind takes it as another file.
    expect(groups[2]?.choices).toEqual([
      expect.objectContaining({ key: "item:snd2", icon: "swap" }),
    ]);
  });

  // Why: a video stands in no station; offering one would end in a refusal.
  it("offers a video no station, and the story video's file to replace", () => {
    const groups = useInChoices({ id: "v2", kind: "video" }, STATIONS);
    expect(groups.map((g) => g.head)).toEqual([
      "A new entry at the end of a story",
      "Replace the file of",
    ]);
    expect(groups[1]?.choices.map((c) => c.key)).toEqual(["item:v1"]);
  });

  it("leaves out empty groups, and offers nothing for a kind no item takes", () => {
    const bare = [
      { id: "s2", title: "Mill", children: [] },
    ] as unknown as TourStation[];
    expect(
      useInChoices({ id: "p2", kind: "image" }, bare).map((g) => g.head),
    ).toEqual(["A new picture in a station"]);
    expect(
      useInChoices({ id: "t", kind: "timing" as never }, STATIONS),
    ).toEqual([]);
  });
});

describe("useInTarget", () => {
  it("reads each key, and nothing else", () => {
    expect(useInTarget("station:s1")).toEqual({
      kind: "station",
      stationId: "s1",
    });
    expect(useInTarget("story:st1")).toEqual({ kind: "story", storyId: "st1" });
    expect(useInTarget("item:snd")).toEqual({ kind: "item", id: "snd" });
    for (const key of ["station:", "nothing", "code:c1", ""]) {
      expect(useInTarget(key)).toBeNull();
    }
  });
});
