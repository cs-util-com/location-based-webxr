# Pin world look: follow-ups

The pin's world look (`src/kinds/short-text/pin.ts`: a head on a stem
over a pulsing ground ring) is drawn wherever a page passes the world
door to the station renderer: the visitor's AR view and the editor's 3D
view. These items were left open when it was built.

## Creator previews still draw the plain label

- **What:** while a creator places a pin on the phone, the preview
  (`src/creator-previews.ts`, `renderTourObjects`) draws the old pill
  label (`src/pin-label.ts`), not the head on a stem the visitor will
  see.
- **Why it was not done with the look:** it is not a one-line pass of
  the door.
  - `renderTourObjects` draws tour objects, not station blocks; its
    `drawnObject` has no door, and `worldPartOf` takes a `TourBlock`.
  - A preview would need a `WorldEnv` (mode, canvas textures, reduced
    motion) and the per-frame `update` of world parts, which the
    creator's preview loop does not run today. Without it the head
    would not turn and the ring would not pulse.
- **Suggested shape:** give `TourObjectRendererDeps` an optional
  `worldPart`, send a pin object to it as `renderStationBlocks` does for
  a block, and run mounted parts' `update` from the creator's frame loop;
  test that a placed pin's preview is the part named `short-text-pin`.

## Smaller items

- Each pin paints its own halo texture for the pulse; one shared
  texture per page would do.
- At large reading distances the pulse's fill grows with the ground
  mark; check on a phone whether it reads as a stain rather than a
  pulse.
- The default reading distance of 4 m sets the head at 2.1 m; check it
  in the field against the prototype's sizes.
- `pinPart` and its `update` sit just over the lint complexity warning
  (11 and 12); splitting the turn and the arrow into helpers would
  clear it.
