/**
 * Why these tests matter: the globe polls the table's version once a
 * frame to learn of new thumbnails. A set or a clear that left the
 * version alone would leave a thumbnail undrawn (or a cleared one drawn)
 * until something else changed; a clear of an empty table that bumped it
 * would make every view redraw its atlas for nothing.
 */

import { describe, expect, it } from "vitest";
import { createDebugThumbs } from "./debug-thumbs.js";

const img = () => ({}) as HTMLImageElement;

describe("createDebugThumbs", () => {
  it("keeps a thumbnail by its capture's name, and changes its version", () => {
    const t = createDebugThumbs();
    const v0 = t.version();
    const a = img();
    t.set("images/a.jpg", a);
    expect(t.get("images/a.jpg")).toBe(a);
    expect(t.size).toBe(1);
    expect(t.version()).not.toBe(v0);
  });

  it("a clear forgets every thumbnail and changes the version; an empty one does not", () => {
    const t = createDebugThumbs();
    t.set("a", img());
    const v1 = t.version();
    t.clear();
    expect(t.get("a")).toBeUndefined();
    expect(t.size).toBe(0);
    const v2 = t.version();
    expect(v2).not.toBe(v1);
    t.clear();
    expect(t.version()).toBe(v2);
  });

  it("ignores a thumbnail without a name", () => {
    const t = createDebugThumbs();
    t.set("", img());
    expect(t.size).toBe(0);
    expect(t.version()).toBe(0);
  });
});
