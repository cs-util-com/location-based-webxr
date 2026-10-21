# globe-band-gate.ts

- Purpose: the band's hand-over between the globe and the relief, gated by
  readiness (round-6 plan 2026-10-04-1050 G6-1, DEC-G6-2). The owner saw the
  whole Earth turn blue at the switch, both ways: the relief took pixels by
  altitude before it had a tile there, and the globe gave its pixels away
  after its tiles were released.
- Public API:
  - `topLevelReady({ root, frameCount })`: a tile set can draw the whole
    view when its last update visited its top level (the root's children:
    an image-tiled set's coarsest level) and every top-level tile it found
    in view has loaded. Below that level the library keeps a parent drawn
    until its children are ready. False when the last update visited no
    top-level tile (a set never updated).
    - **Nothing in view is ready.** A camera under the relief that looks
      steeply down sees none of it: 3d-tiles-renderer 0.5.3
      (`markUsedTiles`) clears `inFrustum` on a REPLACE tile none of whose
      children is in view, so from below the finer tiles' bounding volumes
      the flag is cleared up to the top level. The gate read that as "not
      ready", the relief never took a pixel, and the clearance (which lifts
      the camera only where the relief draws) never got the camera out: a
      deadlock (the lab's steep first views below the ground, found by the
      relief budget sweep, 2026-10-18; reproduced under a synthetic peak, the
      top-level tile visited and out of view for 187 s, settled, share 0).
      With nothing of the set in view nothing is missing from the view, so
      it is ready; the relief takes the view and the clearance lifts the
      camera in the same frame. A top-level tile in view that is still
      loading still blocks, and the library keeps it in view while it
      loads: the terrain plugin creates a tile's children before its
      content loads (`TerrainRGBMeshPlugin.preprocessNode`), and the
      traversal descends without loaded content (`canTraverse`), but a
      tile whose heights have not loaded carries the placeholder bounding
      volume of the whole elevation range (`createBoundingVolume` and
      `_updateBoundingVolume`, MIN to MAX elevation x the height scale),
      which reaches up past any camera over the ground. Once a tile's
      heights load, its volume shrinks to their measured range (padded by
      its geometric error), and only then can a camera under the volumes
      see none of them (all read in 3d-tiles-renderer 0.5.3's source).
    - **So the hand-over is one-way while the relief's top level stays
      out of view**: with the globe ready too, `nextDrawnShare` walks the
      share to a low camera's target (1), and nothing in the gate takes it
      back while the relief draws nothing. That is the intended escape,
      not a consequence: the whole top level leaves the view only for a
      camera under every top-level volume in front of it, the share at the
      relief is what lets its tiles load, and the clearance (which lifts
      the camera only where the relief draws) then lifts the camera above
      the relief's ground, where the top level is in view again; looking
      away from the ground, nothing of either carrier is missing. Not
      built: a bound on how long the share may sit at the relief while it
      draws nothing, falling back to the globe - it needs a case where the
      clearance does not close the loop, and none is known.
  - `topLevelInView({ root, frameCount })`: whether the last update found
    any top-level tile in view. The globe's first look ends on
    `topLevelReady && topLevelInView` (`globe-surface.ts`), so a camera
    that starts looking away from the Earth keeps it until the globe has
    drawn a view that holds some of it (with "nothing in view is ready"
    alone, turning to the Earth would show the holes it fills).
  - `nextDrawnShare({ drawn, target, reliefReady, globeReady, dtMs })`: the
    relief's drawn share for the next frame.
    - Both carriers ready: toward the altitude's `target` by at most
      `GLOBE_BAND_GATE.sharePerS` (1) a second, so the cross-fade never
      pops.
    - Only one ready: that one takes every pixel at once (a hole is worse
      than a quick swap).
    - Neither ready: the share holds.
    - RangeError for a share outside 0-1, or a non-finite or negative time.
- Invariants: the share never moves toward a carrier that cannot draw, and
  while both can it moves monotonically toward the target at the bounded
  rate (property-tested).
- Measured (the globe lab's `globe-handover.smoke.spec.mjs`, frames cleared
  magenta, SwiftShader), with the stencil fill (`globe-stencil-fill.ts`):
  - a dive: 0 frames with a hole, against 51-61 of 54-65 frames with the
    old rule;
  - zooming out after the globe's release: 0, against 3 (up to the whole
    lower frame) with the old rule.
- Tests: `globe-band-gate.test.ts`: each rule, the refusals, the property
  over random states, and `topLevelReady` over in-view, out-of-view, stale
  and missing tiles, and a set visited with nothing in view (ready) against
  one not visited this frame (not); the pair pinned as a decision (a
  relief top level out of view and a globe in it, a low target: the share
  walks to the relief at the bounded rate and stays there);
  `topLevelInView` over in-view,
  out-of-view, stale and missing tiles. In the browser: the globe lab's
  `globe-editor-blocks.smoke.spec.mjs` "a steep first view from under the
  relief hands over and lifts the camera to eye height".
