import { describe, expect, it } from "vitest";

import { createMapDragLatch } from "./map-drag-latch.js";

/**
 * Why these tests matter: this latch is the ONLY thing separating "the user
 * moved the map" from "code moved the map", and the difference is not cosmetic.
 * A quest search pans the map programmatically and then aims the 3D camera at
 * the beacon's own height — a correction made in the PR #344 review. If a
 * programmatic pan could reach the camera-follow, it would re-aim at ground
 * level immediately afterwards and silently undo that fix. The locate button
 * and the site picker have the same shape.
 *
 * Every case below is therefore about the answer being `false` when it should
 * be, which is the direction that protects the existing behaviour.
 */

describe("the map drag latch (DEC-L4)", () => {
  it("says NO when nothing was dragged", () => {
    // The programmatic pan: `panTo`, `centreOn`, `setView` from a shared link.
    // Leaflet raises `moveend` for all of them, and none of them may move the
    // 3D camera.
    const latch = createMapDragLatch();

    expect(latch.moveEnded()).toBe(false);
  });

  it("says YES once after a gesture, and only once", () => {
    // READ-AND-CLEAR is the whole design. A latch that stayed armed would fire
    // on the NEXT `moveend`, which is very likely to be a programmatic one —
    // exactly the case above, arriving one event later.
    const latch = createMapDragLatch();

    latch.gestureStarted();
    expect(latch.moveEnded()).toBe(true);
    expect(latch.moveEnded()).toBe(false);
  });

  it("still says YES once when a drag turns into a pinch", () => {
    // The case the cold review found. A one-finger drag that gains a second
    // finger makes Leaflet finish the drag mid-gesture (`Draggable._onDown`
    // calls `finishDrag()`), so `dragstart` and `zoomstart` both arrive before
    // any `moveend`. Two arms then one read must still be one move, or the
    // camera would be re-aimed at the mid-pinch centre AND again at the end.
    const latch = createMapDragLatch();

    latch.gestureStarted();
    latch.gestureStarted();

    expect(latch.moveEnded()).toBe(true);
    expect(latch.moveEnded()).toBe(false);
  });

  it("is not stolen by a programmatic move that lands mid-drag", () => {
    // The PR #347 review finding, as a sequence: the user presses locate, the
    // fix takes seconds, the user drags while waiting. Armed on `dragstart`,
    // the locate's `centreOn` fired `moveend` first, consumed the latch (the
    // camera re-aimed by the RECENTRE), and the drag's own end found the latch
    // clear (the DRAG not followed) — both halves inverted. Armed on
    // `dragend`, the programmatic `moveend` arrives while unarmed and the
    // drag's own `moveend` still reads true.
    const latch = createMapDragLatch();

    expect(latch.moveEnded()).toBe(false); // centreOn's moveend, mid-drag
    latch.gestureStarted(); // the drag's dragend
    expect(latch.moveEnded()).toBe(true); // the drag's own moveend
  });

  it("can be armed again for the next gesture", () => {
    // The ordinary case: a user drags, looks, drags again.
    const latch = createMapDragLatch();

    latch.gestureStarted();
    expect(latch.moveEnded()).toBe(true);

    latch.gestureStarted();
    expect(latch.moveEnded()).toBe(true);
  });
});
