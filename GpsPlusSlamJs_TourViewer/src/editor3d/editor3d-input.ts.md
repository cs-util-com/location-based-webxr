# editor3d-input.ts

## Purpose

The 3D view's pointer, touch and keys for editing (the design's): select
first, then drag a handle of the gizmo; a click selects what is under the
pointer (nothing: none); a double click or a double tap frames it; the
keys nudge, turn, lift, delete and duplicate the selection; two fingers
move the camera only, and a second finger during a drag cancels it.

## Public API

- `createSceneInput({ element, surface, scene, page })` -> the input,
  listening until `dispose`:
  - `element` - the view's box (its presses are read in the capture phase,
    before OrbitControls on the canvas sees them);
  - `surface` - the canvas: only a press on it is the scene's (the docks
    over the view keep theirs), and pointer positions are read against it;
  - `scene: InputScene` - `target(selection)`, `handleAt(pointer)`,
    `pickAt(pointer)`, `world`, `preview(target, preview | null)`,
    `hover(handle)`, `lockCamera(on)`, `twoFingerStart()`,
    `twoFinger(mode, last, now)`, `frame(selection)`;
  - `page: InputPage` - `dispatch`, `selected()`, `select(id)`,
    `commit(edit)`, `remove(selection)`, `duplicate(selection)`,
    `say(text)`, `keysFree(event)`.
  - Returns `frame()` (each frame: a drag waiting for its ground tries
    again; a gesture whose selection changed meanwhile is cancelled),
    `cancel()` (a gesture under way ends unwritten: an undo or a redo),
    `gesture()` (its handle, `"key"`, or null), `dispose()`.
- `INPUT` - a click moved less than 4 px (a tap 8 px); a double tap within
  400 ms and 30 px.
- `TWO_FINGER_CANCEL` - the toast a second finger's cancel says.
- Types `InputScene`, `InputPage` (the input itself is `ReturnType<typeof createSceneInput>`).

## Invariants & assumptions

- **What it writes, and nothing else:** `gestureStarted` at a drag's press
  or a key hold's first press, `gestureEnded` when it ends, and the one
  edit of a finished gesture through `page.commit` (one undo step). On a
  release the store is told first, then the edit is written, then the
  preview is dropped, so no frame shows the old pose.
- A held key is one gesture: its repeats move the preview; letting go of
  every held key (or the window losing focus) writes one edit. A press
  and release is one step. (The design merged quick repeats of a key
  into one undo step; here a hold is the unit.)
- OrbitControls is locked (`lockCamera`) during a drag and while two
  fingers are down - until the last is up - rather than kept from the
  events, so its own bookkeeping of the pointers stays whole.
- Keys are ignored during a drag, and wherever `keysFree` says no (a
  field, a dialog). T, F, Home, Esc, Ctrl+Z and Ctrl+Y are left to the
  shell and the page; the arrows are taken even with nothing selected.
- A code has no target: no handles, no Del, no Ctrl+D (read-only in the
  3D view, as on the map).

## Examples

```ts
const input = createSceneInput({ element: box, surface: canvas, scene, page });
// each frame:
input.frame();
```

## Tests

`editor3d-input.test.ts` (jsdom): a drag dispatches its start and end and
writes one edit, nothing during twenty frames, in that order; a second
finger cancels it, writes nothing, says so, then tilts the camera and
keeps it locked until the last finger lifts; a selection change cancels a
drag; a press off the gizmo, or on a code, starts nothing; a click selects
what is under it or nothing, a moved press selects nothing; a double tap
and a double click frame; every key of the design, a held key as one
gesture, Del, Backspace and Ctrl+D, the keys left to others, fields and
dialogs, codes, and keys during a drag. Its implementation was written
before these tests: four mutants (a dispatch per move, a commit on the
second finger, a commit per key press, no click threshold) each turn it
red.
