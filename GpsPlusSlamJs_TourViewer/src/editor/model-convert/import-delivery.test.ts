/**
 * Why these tests matter: a converted model must end up exactly where it
 * was dropped - on the shelf, in the item whose file field it was dropped
 * on, or as a new item of a station or a story - and only once it is in
 * the tour's files. A model the tour refuses must come back as words for
 * its row, never as a silent nothing, and a delivery after the tour was
 * closed must add nothing to the next one.
 */
import { describe, expect, it, vi } from "vitest";

import { FILE_ADD_FAILED } from "../add-file-item.js";
import { importDelivery, type ImportDeliveryDeps } from "./import-delivery.js";

const ID = "c".repeat(64);
const made = new File(["glb"], "bust.glb", { type: "model/gltf-binary" });
const about = { from: "bust.gltf", notes: [] };

function deps(over: Partial<ImportDeliveryDeps> = {}) {
  return {
    open: () => true,
    addFile: vi.fn<ImportDeliveryDeps["addFile"]>(() =>
      Promise.resolve({ kind: "added", asset: { id: ID }, backedUp: true }),
    ),
    use: vi.fn(),
    shelved: vi.fn(),
    notKept: vi.fn(),
    ...over,
  };
}

describe("importDelivery", () => {
  it("puts a model dropped on no row on the shelf, and says so", async () => {
    const d = deps();
    expect(await importDelivery(null, d)(made, about)).toEqual({
      kind: "added",
      id: ID,
    });
    expect(d.addFile).toHaveBeenCalledWith(made);
    expect(d.shelved).toHaveBeenCalledWith(ID, "bust.glb");
    expect(d.use).not.toHaveBeenCalled();
  });

  it("uses a model where it was dropped: an item's file field, a station's or a story's row", async () => {
    for (const target of [
      { kind: "item", id: "block-1" },
      { kind: "station", stationId: "s1" },
      { kind: "story", storyId: "st1" },
    ] as const) {
      const d = deps();
      await importDelivery(target, d)(made, about);
      expect(d.use).toHaveBeenCalledWith(target, ID, "bust.glb");
      expect(d.shelved).not.toHaveBeenCalled();
    }
  });

  it("says when the tour could not keep a copy of the model", async () => {
    const d = deps({
      addFile: () =>
        Promise.resolve({ kind: "added", asset: { id: ID }, backedUp: false }),
    });
    await importDelivery(null, d)(made, about);
    expect(d.notKept).toHaveBeenCalledTimes(1);
  });

  it("hands a refusal back in words, and an unforeseen error as the add's failure", async () => {
    const refused = deps({
      addFile: () =>
        Promise.resolve({ kind: "refused", reason: "It is too large." }),
    });
    expect(await importDelivery(null, refused)(made, about)).toEqual({
      kind: "refused",
      reason: "It is too large.",
    });
    const broken = deps({ addFile: () => Promise.reject(new Error("disk")) });
    expect(await importDelivery(null, broken)(made, about)).toEqual({
      kind: "refused",
      reason: FILE_ADD_FAILED,
    });
    expect(refused.shelved).not.toHaveBeenCalled();
    expect(broken.shelved).not.toHaveBeenCalled();
  });

  it("adds nothing once the tour it was dropped in is closed", async () => {
    let open = true;
    const d = deps({
      open: () => open,
      addFile: vi.fn<ImportDeliveryDeps["addFile"]>(() => {
        open = false;
        return Promise.resolve({
          kind: "added",
          asset: { id: ID },
          backedUp: true,
        });
      }),
    });
    expect(await importDelivery(null, d)(made, about)).toEqual({
      kind: "stopped",
    });
    expect(d.shelved).not.toHaveBeenCalled();
    open = false;
    const later = deps({ open: () => false });
    expect(await importDelivery(null, later)(made, about)).toEqual({
      kind: "stopped",
    });
    expect(later.addFile).not.toHaveBeenCalled();
  });
});
