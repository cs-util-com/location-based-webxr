# character-look.ts

## Purpose

The three.js look of a recurring character standing at a station: a die-cut card figure that turns toward the visitor, a speech bubble near him, a name tag far away, a pulsing ring (portrait view), with a frames sheet his mouth moving while the voice plays and the bubble reading along word by word, the beckon toward the next station (two-stations view), and the folding pop-up stage with a scroll (popup view). Which parts show is decided by `character-views.ts`; the painting is done by `character-canvas.ts`, injected as `CharacterPainters` so node tests run without a canvas.

## Public API

- `createCharacterLook({view, name, line, figure, sheet?, heightM?, restYaw?, voiced?, painters?})` returns a `CharacterLook`:
  - `sheet`: `figure` is a frames sheet (idle, talk-a, talk-b, beckon in four equal cells, `painters.frames`); one that does not slice into four is drawn whole as one pose. Default false;
  - `restYaw`: the creator's facing (rad about Up, 0 facing +Z; the block pose's yaw, `restYawOf`), default 0; `voiced`: his line has a voice, which a tap plays (the footers say so), default false;
  - `root`: the group to add at the station's position. It is not rotated by the caller; the look turns its own inner group.
  - `parts`: `figure`, `bubble`, `pip`, `scroll` and `popup`, for tests and checks.
  - `update({nowMs, camera, snap?})`: once per frame. `snap` jumps every ease to its target (first frame, tests).
  - `setBeckon({dx, dz, title} | null)`: the offset to the next station (in root-local NUE metres) and its title.
  - `setVoice("idle" | "speaking" | "spoken", durationMs?)`. `"spoken"` also marks him heard, which stays when the voice goes back to idle (the prototype's `spoken`). With `"speaking"` and a clip length, the read-along's word times are scaled to it (`scaleWordTimes`); without one they are the estimate.
  - `tapTargets()`: the parts that show, for a tap - the figure (front and back, the mesh named `character-back` included) while it shows, the bubble while it shows, the name tag while it shows, the pop-up's stage only once more than half unfolded - its backdrop (`character-backdrop`), his figure on it (`character-popfigure`) and the scroll while it shows, never the whole group, whose ground shadow (3.3 m by 1.9 m), base and tab would take taps on the ground around him. three's raycaster ignores `visible`, so a hidden part must not be offered at all.
  - `setRestYaw(yaw)`: the creator's facing, once the stage knows the station's rotation (a non-finite yaw is ignored).
  - `toggleBubble()`: a tap in the bubble view shuts its bubble, or opens it again; no effect in any other view.
  - `setPresence(alpha)`: the fade. Use it instead of `setSubtreeOpacity`, which caches material opacities that the look changes every frame.
  - `state()`: the bubble and pip openness, the unfold, the turn, the side, `beckoning`, the footer, `distanceM`, `frames` (4 or 1), `frame` (0 idle, 1 talk-a, 2 talk-b, 3 beckon), `mirrored` and `activeWord` (null while the voice does not play).
  - `dispose()`: frees the geometries, materials and textures. A later `update` is a no-op.
- `CANVAS_PAINTERS` (module-internal): the real painters, the default when none are injected.

## Invariants and rules

- Distances are horizontal, from the camera to the root.
- Facing:
  - He rests at the creator's facing and turns toward the camera by at most 60 degrees (`facingYaw`, eased at 4 per second; the first frame snaps).
  - The beckon does not turn him: a flat cut-out turned away from the visitor reads as a squashed card.
  - The pop-up rests at the creator's facing.
- The beckon needs all of these:
  - the view beckons;
  - a beckon is set;
  - the voice is not speaking;
  - he has been heard, or the bubble has been open for 6 s;
  - the camera is within 14 m.
- The pose (with a sheet; without one he keeps his one pose):
  - while the voice plays his mouth follows `talkFrameAt` from the voice's start (the clock of the last update before `setVoice("speaking")`), except in the bubble view, whose line is read, not voiced;
  - while beckoning, the beckon frame, mirrored when the next station lies on the screen's left (`right . toNext < 0`, the camera's right in his parent's frame, the prototype's rule); the back face is mirrored the other way;
  - otherwise idle. Every pose's texture is made once; the pop-up's figure shows the same pose.
- The read-along: while the voice plays the bubble is repainted per word with `activeWordAt` (also without a sheet); the bubble's texture key includes the word.
- No arrows are drawn on the ground: the beckon is the footer and his beckon frame. Arrows on the ground are the creator's own blocks, so a second, automatic set would double them.
- The bubble:
  - opens and closes at 2.6 per second;
  - hangs by its tail tip beside the head (at 0.86 of the height), on the side `bubbleSide` picks from the head's screen position, and is then slid back onto the screen from where its placed edges project (`slideOnScreen`; one wider than the screen is centred);
  - is camera-facing, with depthTest off and renderOrder 20 (the pip 19);
  - grows by `readingFloor(distance)`.
- The bubble's footer reads "Next: <title>" while beckoning and "Speaking" while the voice plays; in the speak view with a voice, "Tap to hear him" ("Tap to hear again" once heard); otherwise there is none. The scroll's footer (popup) reads "Speaking", or with a voice "Tap the stage to hear him" ("... again" once heard). A texture is repainted only when its key changes.
- With presence 0, nothing is visible.

## Deviations from the prototype

- The word timing is the prototype's estimate (`lineWordTimes`), started when the voice starts and, once the clip's length is known, stretched or shrunk by one factor (clip length over the estimate's last word end). That is no real sync: a clip with a long silence spreads the words by its share, and a voice that speeds up mid-line still drifts.
- The beckon has no ground chevrons (owner decision: arrows on the ground are blocks the creator places).
- The prototype swaps frames by a texture offset over one sheet texture; here each pose is its own die-cut texture (the cut edge is painted per pose).
- The bubble is slid back onto the screen from its measured edges; the prototype's estimate left out the gap between his head and the tail's tip, so its bubble ran off a 390 px phone.
- The backdrop has no keep.

## Tests

- `character-look.test.ts` (node, fake painters): near and far, the open rate, the bubble placement and facing, its growth with distance, presence, facing the camera, the beckon rules with no arrow drawn, the beckon staying once heard, the 60 degree turn from the creator's facing, the footers and the bubble's tap, the bubble staying on a narrow phone's screen, the 6 s beckon, no beckon in other views, the portrait ring, the pop-up hysteresis and facing, dispose, and the frames sheet (four poses sliced, the mouth and the read-along while speaking, the beckon frame and its mirror, one pose without a sheet, the bubble view's still mouth, the pop-up figure's mouth, the read-along scaled to a clip's length), and the tap targets (only the visible parts, the pop-up only unfolded).
- `playwright-tests/character-views.spec.js`: the look in a browser, at three viewports.
