/**
 * Why these tests matter: the folder tree helpers are what every folder
 * action of the tour document goes through. A lifted folder that kept its
 * old pose would jump by its holder's pose; a title rule looser than the
 * format's would let a save fail; a refusal line without its reason
 * would leave the creator guessing.
 */
import { composeTourFolderPose } from "gps-plus-slam-app-framework/ar/tour-folder-pose";
import type { TourLocalPose } from "gps-plus-slam-app-framework/ar/tour-items";
import type {
  TourFolder,
  TourStationChild,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import {
  FOLDER_NOT_POSSIBLE,
  folderRefusalLine,
  folderTitle,
  withFolder,
  withFolderAdded,
  withoutFolder,
  type FolderRefusal,
} from "./tour-folder-edit.js";

const TURN: TourLocalPose = {
  position: [5, 1, -2],
  rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
};
const TILT: TourLocalPose = {
  position: [0, 0.5, 3],
  rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
};

const inner: TourFolder = {
  id: "inner",
  kind: "folder",
  pose: TILT,
  children: [],
};
const bare: TourFolder = { id: "bare", kind: "folder", children: [] };
const outer: TourFolder = {
  id: "outer",
  kind: "folder",
  title: "Courtyard",
  pose: TURN,
  children: [inner, bare],
};
const tree: TourStationChild[] = [
  outer,
  { id: "spare", kind: "folder", children: [] },
];

describe("the folder tree", () => {
  it("lifts a removed folder's folders into its holder at the poses that keep them in place", () => {
    const lifted = withoutFolder(tree, "outer", true);
    expect(lifted.map((c) => c.id)).toEqual(["inner", "bare", "spare"]);
    expect((lifted[0] as TourFolder).pose).toEqual(
      composeTourFolderPose(outer, TILT),
    );
    // A folder with no pose stands at its holder's: it takes the holder's.
    expect((lifted[1] as TourFolder).pose).toEqual(TURN);
  });

  it("lifts nothing out of a folder with no pose: its folders keep theirs", () => {
    const { pose: _pose, ...unposed } = outer;
    const plain: TourStationChild[] = [unposed];
    const lifted = withoutFolder(plain, "outer", true);
    expect(lifted).toEqual([inner, bare]);
  });

  it("drops a folder with its folders, and leaves an unknown id's tree as it is", () => {
    expect(withoutFolder(tree, "outer", false).map((c) => c.id)).toEqual([
      "spare",
    ]);
    expect(withoutFolder(tree, "inner", false)[0]).toEqual({
      ...outer,
      children: [bare],
    });
    expect(withoutFolder(tree, "nothing", true)).toBe(tree);
  });

  it("changes and adds a folder at any depth, and leaves the tree when the id is unknown", () => {
    const renamed = withFolder(tree, "inner", (f) => ({ ...f, title: "Well" }));
    expect(((renamed[0] as TourFolder).children[0] as TourFolder).title).toBe(
      "Well",
    );
    expect(withFolder(tree, "nothing", (f) => f)).toBe(tree);
    const added = withFolderAdded(tree, {
      id: "new",
      kind: "folder",
      children: [],
    });
    expect(added.map((c) => c.id)).toEqual(["outer", "spare", "new"]);
    const nested = withFolderAdded(
      tree,
      { id: "new", kind: "folder", children: [] },
      "outer",
    );
    expect((nested[0] as TourFolder).children.map((c) => c.id)).toEqual([
      "inner",
      "bare",
      "new",
    ]);
  });
});

describe("a folder's title and a refusal's line", () => {
  it("takes a trimmed title within 80 code points, and refuses a blank or longer one", () => {
    expect(folderTitle("  Benches ")).toBe("Benches");
    expect(folderTitle("x".repeat(80))).toBe("x".repeat(80));
    // Code points, not UTF-16 units: 80 emoji fit.
    expect(folderTitle("\u{1F332}".repeat(80))).toBe("\u{1F332}".repeat(80));
    expect(folderTitle("x".repeat(81))).toBeNull();
    expect(folderTitle("   ")).toBeNull();
    expect(folderTitle("")).toBeNull();
  });

  it("says 'Not possible here' and why, for every reason", () => {
    const reasons: FolderRefusal[] = [
      "storyIntoFolder",
      "folderIntoStory",
      "folderIntoItself",
      "oneLevel",
      "notHere",
    ];
    const lines = reasons.map(folderRefusalLine);
    for (const line of lines) {
      expect(line.startsWith(`${FOLDER_NOT_POSSIBLE}: `)).toBe(true);
      expect(line.length).toBeGreaterThan(FOLDER_NOT_POSSIBLE.length + 10);
    }
    expect(new Set(lines).size).toBe(reasons.length);
  });
});
