# globe-band-gate.ts

- Purpose: the band's hand-over between the globe and the relief, gated by
  readiness (round-6 plan 2026-10-04-1050 G6-1, DEC-G6-2). The owner saw the
  whole Earth turn blue at the switch, both ways: the relief took pixels by
  altitude before it had a tile there, and the globe gave its pixels away
  after its tiles were released.
- Public API:
  - `topLevelReady({ root, frameCount })`: a tile set can draw the whole
    view when every top-level tile (the root's children: an image-tiled
    set's coarsest level) its last update visited in view has loaded. Below
    that level the library keeps a parent drawn until its children are
    ready. False before any top-level tile was visited.
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
  and missing tiles.
