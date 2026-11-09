import { describe, expect, it } from "vitest";
import type {
  TourFolder,
  TourStationChild,
  TourStory,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { createScenePlayer } from "./scene-player";
import { createStoryChoices, playableStories } from "./story-choice";
import { playableStory, storyOf } from "./test-support/station-content.js";

/**
 * Why these tests matter: the story picker and the scene player walk a
 * station's STORIES and nothing else. A plain folder is a container too
 * (same `kind: 'folder'`), so a walker that asked "is it a folder?" where
 * it meant "is it a story?" would offer a folder in the picker, or count
 * it as a second story and show a picker where one story should start,
 * or play its blocks as a scene. None of these walkers descends into a
 * folder, and these tests hold that explicitly.
 */

const pin = (id: string) =>
  ({
    id,
    kind: "shortText",
    view: "pin",
    caption: id,
    pose: { position: [1, 0, 0], rotation: [0, 0, 0, 1] },
  }) as const;

const inner: TourFolder = {
  id: "inner",
  kind: "folder",
  children: [pin("deep")],
};
const plain: TourFolder = {
  id: "plain",
  kind: "folder",
  pose: { position: [2, 0, 0], rotation: [0, 0, 0, 1] },
  scale: 1,
  children: [pin("loose"), inner],
};
const folderIds = ["plain", "inner", "loose", "deep"];

const story = storyOf("tale", [
  { ...pin("one"), view: "card" },
  { ...pin("two"), view: "card" },
]);

describe("a plain folder next to a story", () => {
  const stations: { name: string; children: TourStationChild[] }[] = [
    { name: "folder first", children: [plain, story] },
    { name: "folder last", children: [story, plain] },
  ];

  for (const { name, children } of stations) {
    it(`is never offered in the picker (${name})`, () => {
      expect(playableStories({ children }).map((s) => s.id)).toEqual(["tale"]);
    });

    it(`does not turn one story into a picker (${name})`, () => {
      expect(
        createStoryChoices().panelOf({ id: "s", children }, false),
      ).toEqual({ show: "story", story });
    });
  }

  it("is not played: the scene walks the story's own children only", () => {
    const [picked] = playableStories({ children: [plain, story] }) as [
      TourStory,
    ];
    const player = createScenePlayer(picked.children);
    const seen: string[] = [];
    for (let c = player.current(); c !== null; c = player.next()) {
      seen.push(c.id);
    }
    expect(seen).toEqual(["one", "two"]);
    expect(seen.some((id) => folderIds.includes(id))).toBe(false);
  });

  it("alone, with no story, leaves the panel to the card or nothing", () => {
    const choices = createStoryChoices();
    expect(choices.panelOf({ id: "s", children: [plain] }, true)).toEqual({
      show: "card",
    });
    expect(choices.panelOf({ id: "s", children: [plain] }, false)).toEqual({
      show: "nothing",
    });
  });

  it("does not hide a second story from the picker", () => {
    const other = playableStory("other");
    const panel = createStoryChoices().panelOf(
      { id: "s", children: [story, plain, other] },
      false,
    );
    expect(panel.show).toBe("picker");
    expect(
      panel.show === "picker" ? panel.picks.map((p) => p.story.id) : [],
    ).toEqual(["tale", "other"]);
  });
});
