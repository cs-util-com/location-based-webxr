import { describe, expect, it } from "vitest";

import { assetFilename } from "./asset-filename.js";

/**
 * Why these tests matter: this helper is the *convention* half of the packaging
 * contract. The authoring UI calls it to fill `AssetEntry.filename`; `packTour`
 * then writes each asset at that exact path and component 6 range-reads it back
 * by the same string. Nothing re-derives the name later, so a wrong extension or
 * a case-only difference here becomes a ZIP entry the loader cannot find.
 *
 * The two non-obvious rules pinned below — a leading dot is a dotfile, and the
 * extension is lowercased — both exist to stop two different assets resolving to
 * one entry path (which `packTour`'s duplicate check would reject at pack time).
 */

const file = (name: string) => new File([], name);

describe("assetFilename", () => {
  it("puts the asset under assets/ keyed by id, keeping the extension", () => {
    expect(assetFilename("knight", file("model.glb"))).toBe(
      "assets/knight.glb",
    );
    expect(assetFilename("img", file("photo.jpg"))).toBe("assets/img.jpg");
  });

  it("omits the extension entirely when the original name has none", () => {
    // No trailing dot — "assets/id." would be a different (and uglier) key.
    expect(assetFilename("id", file("model"))).toBe("assets/id");
  });

  it("treats a leading dot as a dotfile, not an extension", () => {
    // lastIndexOf(".") === 0 here; a naive includes(".") check would produce
    // "assets/id.glb" from a file that has no extension at all.
    expect(assetFilename("id", file(".glb"))).toBe("assets/id");
  });

  it("uses the last dot when the name has several", () => {
    expect(assetFilename("id", file("model.v2.glb"))).toBe("assets/id.glb");
  });

  it("lowercases the extension so case-only variants cannot collide", () => {
    // "MODEL.GLB" and "model.glb" must map to one key, not two entries that
    // differ only in case (indistinguishable on a case-insensitive filesystem).
    expect(assetFilename("id", file("MODEL.GLB"))).toBe("assets/id.glb");
    expect(assetFilename("id", file("MODEL.GLB"))).toBe(
      assetFilename("id", file("model.glb")),
    );
  });
});
