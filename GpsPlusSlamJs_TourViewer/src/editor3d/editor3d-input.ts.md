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
    `say(text)`, `groundMenu(point, place | null)`, `keysFree(event)`.
  - Returns `frame()` (each frame: a drag waiting for its ground tries
    again; a gesture whose selection changed meanwhile is cancelled),
    `cancel()` (a gesture under way ends unwritten: an undo or a redo),
    `gesture()` (its handle, `"key"`, or null), `dispose()`.
- `INPUT` - a click moved less than 4 px (a tap 8 px); a double tap within
  400 ms and 30 px.
- `TWO_FINGER_CANCEL` - the toast a second finger's cancel says.
- Types `InputScene`, `InputPage` (the input itself is `ReturnType<typeof createSceneInput>`).

## Invariants & assumptions

- **The ground menu:** a `contextmenu` on the canvas never opens the
  browser's menu. It opens the page's ground menu (`groundMenu`) with the
  ground's place under the pointer (`GestureWorld`: the sampled ground's
  point, its place and the ground's ellipsoidal height there; null where
  none has loaded) - unless the press moved (a right drag pans: the
  browser sends its `contextmenu` after the release, so the last ended
  press is kept until the next) or was part of two fingers. A
  `contextmenu` sent while a mouse button is still down (some systems do)
  waits for the release and opens only if the press did not move; a
  finger's long press opens it at once, and its release then selects
  nothing. Nothing during a gizmo drag; a dock's press is the dock's.

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
  events, so its own bookkeeping of the pointers stays whole. A press on a
  handle locks it BEFORE the gesture reads the pointer: the lock stops a
  flight and the orbit's coast, so the camera stands still from the press
  on (a press that finds nothing to grab unlocks again).
- A drag waiting for its ground shows a `progress` cursor until the
  ground arrives (then `grabbing` again).
- The handle under the mouse is looked for only when the pointer is over
  the scene itself (the canvas), never over a dock.
- When the selection changes during a gesture (Esc, a click elsewhere,
  the tree), a drag is cancelled, but a key hold is written: its nudges
  were already shown. A key arriving for another selection before the
  next frame writes the old hold first.
- Keys are ignored during a drag, and wherever `keysFree` says no (a
  field, a menu, the pattern's keys on a menu's button, a dialog). T, F, Home, Esc, Ctrl+Z and Ctrl+Y are left to the
  shell and the page; the arrows are taken even with nothing selected (Q,
  E, PageUp and PageDown then are not).
- A code has no target: no handles, no Del, no Ctrl+D (read-only in the
  3D view, as on the map).
- A locked station (`poseLocked`) takes no nudge, turn or lift key: the press is refused and said once (`STATION_LOCKED`; a held key's repeats say nothing more). Delete and copy keys still work on it.

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
dialogs, codes, and keys during a drag; with nothing selected only the
arrows are taken from the page. A cancel (an undo) and a pointercancel
write nothing; the right button and a press during a key hold start no
drag; a window blur, a selection change and a key for another selection
write a held key's edit; the camera is locked before the ground is read;
the hover asks only over the scene; a progress cursor while a drag waits.
Its implementation was written before these tests; each of these mutants
turns it red: a dispatch per move, a commit on the second finger, a commit
per key press, no click threshold, a cancel or a pointercancel that
commits, no right-button or key-hold guard, a blur or a selection change
that discards a hold.

`editor3d-input.test.ts` also covers the keys on a locked station: nothing committed, said once a press, delete still works.
