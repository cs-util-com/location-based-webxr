/**
 * Why these tests matter: the inspector's "File" row is where a creator
 * sees which file an item shows and where a dropped file replaces it; it
 * must appear for every block made from a file, free or in a story, carry
 * the block's id for the drop, and show the name the file came in under.
 *
 * @vitest-environment jsdom
 */
import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { fileDropTarget } from "../file-drop.js";
import { fileFieldPart, inspectorFileOf } from "./inspector-file.js";

const ASSETS = [
  { id: "a1", kind: "audio", path: "content/a1.ogg" },
  { id: "p1", kind: "image", path: "content/p1.webp" },
] as unknown as TourAsset[];

const STATION = {
  id: "s1",
  children: [
    { id: "snd", kind: "audio", audio: "a1", title: "Bells" },
    { id: "txt", kind: "shortText", caption: "Hi" },
    { id: "lost", kind: "audio", audio: "gone" },
    {
      id: "st1",
      kind: "folder",
      role: "story",
      title: "Legend",
      children: [{ id: "pic", kind: "picture", image: "p1", view: "card" }],
    },
  ],
} as unknown as TourStation;

describe("inspectorFileOf", () => {
  it("names a free block's and a story block's file", () => {
    expect(
      inspectorFileOf("snd", [STATION], ASSETS, (id) =>
        id === "a1" ? "church bells.wav" : undefined,
      ),
    ).toEqual({ blockId: "snd", name: "church bells.wav" });
    expect(inspectorFileOf("pic", [STATION], ASSETS)).toEqual({
      blockId: "pic",
      name: "p1.webp",
    });
  });

  it("is null for nothing, a station, a story, words and an unlisted file", () => {
    for (const id of [null, "station:s1", "st1", "txt", "lost", "none"]) {
      expect(inspectorFileOf(id, [STATION], ASSETS)).toBeNull();
    }
  });
});

describe("fileFieldPart", () => {
  it("draws the name and Replace, and is a drop target for its block", () => {
    const row = fileFieldPart({ blockId: "snd", name: "bells.wav" });
    document.body.replaceChildren(row);
    expect(row.querySelector(".fname")?.textContent).toBe("bells.wav");
    expect(row.querySelector('[data-act="file"]')?.textContent).toBe(
      "Replace...",
    );
    const tree = document.createElement("div");
    expect(fileDropTarget(row.querySelector(".fname"), tree)).toEqual({
      kind: "item",
      id: "snd",
    });
  });
});
