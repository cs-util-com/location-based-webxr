/**
 * "Did the USER move the map?" — the one bit the map-pan camera follow turns on
 * (DEC-L4).
 *
 * Pure on purpose, like `map-zoom-to-camera.ts` beside it: the interesting part
 * is a two-state machine, and it should be testable without Leaflet, a map or a
 * DOM.
 *
 * **WHY A LATCH AND NOT JUST `moveend`.** Leaflet raises `moveend` for
 * programmatic moves too, and this demo has three that must NOT drag the 3D
 * camera with them:
 *
 * - a quest search calls `panTo` and then aims the camera at the beacon's own
 *   height (`placement.y`, a PR #344 review finding) — a blanket rule would
 *   re-aim at ground level immediately afterwards and undo it;
 * - the locate button calls `centreOn`, and the position subscriber already
 *   recentres the camera on the user;
 * - the site picker calls `centreOn` for a declared place change.
 *
 * **WHY THE CENTRE IS NEVER READ AT `dragend`.** It fires when the finger
 * lifts, before Leaflet's inertia glide finishes, so the centre there is not
 * where the map ends up. Arming at the gesture's end and reading on `moveend`
 * is inertia-safe by construction: Leaflet's drag end raises `moveend` on both
 * branches — directly when inertia is off, and via the inertia animation's end
 * when it is not — and fires `dragend` BEFORE either, so the drag's own
 * `moveend` always finds the latch armed.
 *
 * **WHY ARMING WAITS FOR `dragend` rather than starting at `dragstart`** (PR
 * #347 review): a latch armed for the whole gesture is stolen by any
 * programmatic `moveend` that lands mid-drag. The locate fix arriving while
 * the user dragged consumed it — the camera was re-aimed by the programmatic
 * recentre, and the user's own drag was then not followed. Armed only once
 * the gesture ends, a mid-drag programmatic move finds it unarmed.
 *
 * @see map-drag-latch.ts.md
 */

export interface MapDragLatch {
  /**
   * Arm it — the user's gesture has finished moving the map.
   *
   * ⚠️ **Wired to `dragend` ONLY, and `zoomstart` is the trap.** Arming on
   * `zoomstart` looks right — it covers a one-finger drag that gains a second
   * finger, which makes Leaflet finish the drag mid-gesture — but Leaflet
   * raises `moveend` for a ZOOM as well as for a pan, so every wheel or button
   * zoom would consume the latch and snap the camera target to the map centre.
   * Measured at ~100 m in the e2e fixture. The pinch imprecision is the
   * smaller cost by a wide margin (`Draggable.finishDrag` still fires
   * `dragend` when a pinch interrupts a drag). And `dragstart` is the other
   * trap — see the header: armed that early, a mid-drag programmatic
   * `moveend` steals the latch.
   */
  gestureStarted(): void;
  /**
   * Read and clear: `true` exactly once per armed gesture.
   *
   * **READ-AND-CLEAR IS THE DESIGN, not a convenience.** A latch left armed
   * would fire on the next `moveend`, which is very likely to be a programmatic
   * one — i.e. it would fail into precisely the behaviour this exists to
   * prevent, one event later.
   */
  moveEnded(): boolean;
}

export function createMapDragLatch(): MapDragLatch {
  let armed = false;
  return {
    gestureStarted(): void {
      armed = true;
    },
    moveEnded(): boolean {
      const wasArmed = armed;
      armed = false;
      return wasArmed;
    },
  };
}
