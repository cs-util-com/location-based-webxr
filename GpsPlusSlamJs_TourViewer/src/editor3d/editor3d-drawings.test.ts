/**
 * Why these tests matter: the flat view and the globe view each handed
 * the stations layer their own list of builders, and the two lists
 * drifted: the globe, the default view, never got the reading sign's
 * builder, so a long text shown as a sign was drawn in the flat view
 * only. One list, used by both views, cannot drift; these pin that it
 * carries every builder the layer draws an item with, the same ones the
 * visitor's page uses.
 */
import { describe, expect, it } from "vitest";

import { loadGlbModel } from "../glb-model.js";
import { mountLectern } from "../lectern-view.js";
import { createPinLabel } from "../pin-label.js";
import { worldPartOf } from "../play-kinds.js";
import { mountReadingSign } from "../reading-sign.js";
import { editorDrawings } from "./editor3d-drawings.js";

describe("editorDrawings", () => {
  it("carries every item builder: pins, reading stands, reading signs, models and the world door", () => {
    const drawings = editorDrawings(() => Promise.resolve(new Blob([])));
    expect(drawings.makeLabel).toBe(createPinLabel);
    expect(drawings.makeLectern).toBe(mountLectern);
    expect(drawings.makeReadingSign).toBe(mountReadingSign);
    expect(drawings.loadGlbModel).toBe(loadGlbModel);
    expect(drawings.worldPart).toBe(worldPartOf);
  });

  it("reads a photo and a content entry through the page's loader", async () => {
    const read: string[] = [];
    const drawings = editorDrawings((entry) => {
      read.push(entry);
      return Promise.reject(new Error("offline"));
    });
    await expect(drawings.loadContent("content/a.glb")).rejects.toThrow(
      "offline",
    );
    await expect(drawings.loadPhotoTexture("content/p.jpg")).rejects.toThrow(
      "offline",
    );
    expect(read).toEqual(["content/a.glb", "content/p.jpg"]);
  });
});
