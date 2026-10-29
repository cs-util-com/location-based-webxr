# character-look.ts

## Purpose

The three.js look of a recurring character standing at a station: a die-cut card figure that turns toward the visitor, a speech bubble near him, a name tag far away, a pulsing ring (portrait view), the beckon toward the next station (two-stations view), and the folding pop-up stage with a scroll (popup view). Which parts show is decided by `character-views.ts`; the painting is done by `character-canvas.ts`, injected as `CharacterPainters` so node tests run without a canvas.

## Public API

- `createCharacterLook({view, name, line, figure, heightM?, painters?})` returns a `CharacterLook`:
  - `root`: the group to add at the station's position. It is not rotated by the caller; the look turns its own inner group.
  - `parts`: `figure`, `bubble`, `pip`, `scroll` and `popup`, for tests and checks.
  - `update({nowMs, camera, snap?})`: once per frame. `snap` jumps every ease to its target (first frame, tests).
  - `setBeckon({dx, dz, title} | null)`: the offset to the next station (in root-local NUE metres) and its title.
  - `setVoice("idle" | "speaking" | "spoken")`.
  - `setPresence(alpha)`: the fade. Use it instead of `setSubtreeOpacity`, which caches material opacities that the look changes every frame.
  - `state()`: the bubble and pip openness, the unfold, the turn, the side, `beckoning`, the footer and `distanceM`.
  - `dispose()`: frees the geometries, materials and textures. A later `update` is a no-op.
- `CANVAS_PAINTERS` (module-internal): the real painters, the default when none are injected.

## Invariants and rules

- Distances are horizontal, from the camera to the root.
- Facing:
  - The figure turns toward the camera.
  - The beckon does not turn him: a flat cut-out turned away from the visitor reads as a squashed card.
  - The pop-up keeps the facing it had when it first showed.
- The beckon needs all of these:
  - the view beckons;
  - a beckon is set;
  - the voice is not speaking;
  - he has been heard, or the bubble has been open for 6 s;
  - the camera is within 14 m.
- The beckon's chevrons (`parts.arrow`): a 0.9 x 4.6 m ground plane of gold chevrons (`paintChevrons`, faded at both ends by `paintFade`), from beside him toward the next station, scrolling that way at 0.22 per second, easing in and out at 1.2 per second to 0.85 opacity (`state().arrow`), as in the prototype.
- The bubble:
  - opens and closes at 2.6 per second;
  - hangs by its tail tip beside the head (at 0.86 of the height), on the side `bubbleSide` picks from the head's screen position, and is then slid back onto the screen from where its placed edges project (`slideOnScreen`; one wider than the screen is centred);
  - is camera-facing, with depthTest off and renderOrder 20 (the pip 19);
  - grows by `readingFloor(distance)`.
- The footer reads "Next: <title>" while beckoning and "Speaking" while the voice plays; otherwise there is none. A texture is repainted only when its key changes.
- With presence 0, nothing is visible.

## Deviations from the prototype

- There are no sprite frames and no word timing.
- The beckon is the chevrons plus the footer text, without the prototype's beckoning sprite frame.
- He always faces the visitor; the prototype clamps his facing to 60 degrees from his rest pose.
- The bubble is slid back onto the screen from its measured edges; the prototype's estimate left out the gap between his head and the tail's tip, so its bubble ran off a 390 px phone.
- The backdrop has no keep.
- There is no tap toggle.

## Tests

- `character-look.test.ts` (node, fake painters): near and far, the open rate, the bubble placement and facing, its growth with distance, presence, facing the camera, the beckon rules and its chevrons, the bubble staying on a narrow phone's screen, the 6 s beckon, no beckon in other views, the portrait ring, the pop-up hysteresis and facing, and dispose.
- `playwright-tests/character-views.spec.js`: the look in a browser, at three viewports.
