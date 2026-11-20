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
// Stand-in pictures hold no blob URL to free; what the table frees is the
// last test's subject.
const keep = (): void => {};

describe("createDebugThumbs", () => {
  it("keeps a thumbnail by its capture's name, and changes its version", () => {
    const t = createDebugThumbs(keep);
    const v0 = t.version();
    const a = img();
    t.set("images/a.jpg", a);
    expect(t.get("images/a.jpg")).toBe(a);
    expect(t.size).toBe(1);
    expect(t.version()).not.toBe(v0);
  });

  it("a clear forgets every thumbnail and changes the version; an empty one does not", () => {
    const t = createDebugThumbs(keep);
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
    const t = createDebugThumbs(keep);
    t.set("", img());
    expect(t.size).toBe(0);
    expect(t.version()).toBe(0);
  });

  // Why: the table is the thumbnails' last holder now that no map marker
  // adopts them; a thumbnail it dropped without freeing would leak one
  // blob URL per capture per opened tour, and one freed while still kept
  // would draw nothing.
  it("frees each thumbnail it drops, once, and none it keeps", () => {
    const freed: HTMLImageElement[] = [];
    const t = createDebugThumbs((p) => freed.push(p));
    const a = img();
    const b = img();
    const c = img();
    t.set("a", a);
    t.set("a", a);
    expect(freed).toEqual([]);
    t.set("a", b);
    expect(freed).toEqual([a]);
    t.set("c", c);
    t.clear();
    expect(freed).toEqual([a, b, c]);
    t.clear();
    expect(freed).toHaveLength(3);
  });
});
