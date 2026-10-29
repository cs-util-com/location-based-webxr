# character-views.ts

## Purpose

The rules for a recurring character's five world views (`bubble`, `speak`, `two-stations`, `portrait`, `popup`), kept pure so the three.js look (`character-look.ts`) and its tests use one table. The table says which parts each view draws, the distances where it opens and folds, when he beckons and how long a line takes to read. The numbers come from the station-blocks-7 prototype (`public/prototypes/station-blocks-7-character/index.html`).

## Public API

- Constants:
  - `BUBBLE_OPEN_M` 9;
  - `POPUP_UNFOLD_M` 12 and `POPUP_CLOSE_M` 16 (hysteresis);
  - `READING_FLOOR_M` 2.4 (module-internal, read through `readingFloor`);
  - `BECKON_WITHIN_M` 14;
  - `BECKON_AFTER_MS` 6000.
- `StageCharacterView` (the framework's `TourCharacterView`) and `isStageCharacterView(v)`, against the framework's `TOUR_CHARACTER_VIEWS` (`gps-plus-slam-app-framework/ar/tour-blocks`), the one list. `card` and `stage` are not world views and are not in it.
- `MAX_TURN_DEG` 60; `restYawOf(q)`: the yaw a quaternion `[x, y, z, w]` turns +Z to (0 for a malformed or zero quaternion, or one pointing straight up or down); `facingYaw(rest, toCamera, turns)`: `rest` turned toward the camera by at most 60 degrees, or `rest` itself when the view does not turn.
- `characterViewLook(view)` returns `CharacterViewLook`, with these flags: `figure`, `bubble`, `footer`, `pip`, `ring`, `portrait`, `popup`, `turns`, `beckons`.
- `bubbleOpens(d)`: true when `d` is finite and under 9 m.
- `popupUnfolds(d, unfolded)`: true under 12 m, or under 16 m once it has unfolded.
- `readingFloor(d)`: `max(1, d / 2.4)`; a non-finite `d` gives 1.
- `beckonNext(walk, currentId)`: he points along the tour order when exactly one next station exists; otherwise there is no beckon (`null`).
  - Under a fixed order: the first undone other station.
  - Under any order: the one undone station that is left, if there is only one.
- `bubbleSide({x, width, last})` returns `{side, overflow}`, the prototype's `auto` side choice:
  - it starts toward the middle of the screen;
  - it flips when the chosen side overflows by more than 0.08 beyond the other;
  - it keeps the last side unless the other is better by 0.12 or more;
  - `overflow` is signed in NDC (screen units, + to the right).
- `lineReadingMs(text)`: the prototype's narration timing plus its tail, bounded to 1.5-60 s. It is the `lineEnd` wait for a line with no voice.

## Invariants

- Every function is total: non-finite and non-string inputs fall back to safe values. Nothing throws.
- `beckonNext` never returns the current station or one that is done.

## Tests

- `character-views.test.ts`: the table, the distances, the side choice, the reading time, `restYawOf` and `facingYaw`.
- `character-views.property.test.ts`:
  - `facingYaw` never turns more than 60 degrees from rest, and faces a camera inside that cone exactly;
  - the beckon only points at an undone other station;
  - the reading time and the floor are bounded.
