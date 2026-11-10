/**
 * Why these tests matter: a dropped file must go where it was dropped. A
 * station's row adds the item at the station, a story's row at the story's
 * end, an item's file field gives the item that file, and anything else
 * only puts it on the shelf; a file of a kind a tour does not take must be
 * refused before it is read, not after.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";

import { dragHasFiles, fileAddKindOf, fileDropTarget } from "./file-drop.js";

afterEach(() => {
  document.body.replaceChildren();
});

function page(): { tree: HTMLElement; at: (q: string) => Element } {
  document.body.innerHTML = `
    <aside id="tree">
      <button data-select="station:s1"><span class="name">Gate</span></button>
      <button data-select="station:s1" class="pic">picture</button>
      <button data-select="story:st1"><span class="name">Legend</span></button>
      <button data-select="b7">An item</button>
      <button data-select="station:">broken</button>
      <div class="sec">Codes</div>
    </aside>
    <aside id="insp">
      <div data-filefield="b7"><span class="fname">bells.mp3</span></div>
      <div data-filefield="">empty</div>
    </aside>
    <div id="map"></div>`;
  const tree = document.getElementById("tree") as HTMLElement;
  return {
    tree,
    at: (q) => {
      const found = document.querySelector(q);
      if (found === null) throw new Error(q);
      return found;
    },
  };
}

describe("fileAddKindOf", () => {
  it("names the item kind by the extension, any case, and nothing else", () => {
    expect(fileAddKindOf("photo.JPG")).toBe("picture");
    expect(fileAddKindOf("bells.mp3")).toBe("audio");
    expect(fileAddKindOf("flood.webm")).toBe("video");
    expect(fileAddKindOf("statue.glb")).toBe("model");
    expect(fileAddKindOf("notes.txt")).toBeNull();
    expect(fileAddKindOf("README")).toBeNull();
    expect(fileAddKindOf("tour.zip")).toBeNull();
  });
});

describe("fileDropTarget", () => {
  it("reads a station's row, its picture row and a story's row, from any child", () => {
    const { tree, at } = page();
    expect(
      fileDropTarget(at('[data-select="station:s1"] .name'), tree),
    ).toEqual({ kind: "station", stationId: "s1" });
    expect(fileDropTarget(at(".pic"), tree)).toEqual({
      kind: "station",
      stationId: "s1",
    });
    expect(fileDropTarget(at('[data-select="story:st1"] .name'), tree)).toEqual(
      { kind: "story", storyId: "st1" },
    );
  });

  it("reads an item's file field, wherever it stands", () => {
    const { tree, at } = page();
    expect(fileDropTarget(at(".fname"), tree)).toEqual({
      kind: "item",
      id: "b7",
    });
  });

  // Why: a drop on an item's row, a header, an empty id or the map is not
  // a place to use the file; it lands on the shelf only.
  it("is null for an item's row, a broken id, a header, the map and nothing", () => {
    const { tree, at } = page();
    expect(fileDropTarget(at('[data-select="b7"]'), tree)).toBeNull();
    expect(fileDropTarget(at('[data-select="station:"]'), tree)).toBeNull();
    expect(fileDropTarget(at('[data-filefield=""]'), tree)).toBeNull();
    expect(fileDropTarget(at(".sec"), tree)).toBeNull();
    expect(fileDropTarget(at("#map"), tree)).toBeNull();
    expect(fileDropTarget(null, tree)).toBeNull();
  });

  it("reads no row outside the tree", () => {
    const { at } = page();
    const elsewhere = document.createElement("div");
    expect(
      fileDropTarget(at('[data-select="station:s1"]'), elsewhere),
    ).toBeNull();
  });
});

describe("dragHasFiles", () => {
  it("is true only for a drag that carries files", () => {
    const withTypes = (types: string[] | null): DragEvent =>
      ({
        dataTransfer: types === null ? null : { types },
      }) as unknown as DragEvent;
    expect(dragHasFiles(withTypes(["Files"]))).toBe(true);
    expect(dragHasFiles(withTypes(["text/plain"]))).toBe(false);
    expect(dragHasFiles(withTypes(null))).toBe(false);
  });
});
