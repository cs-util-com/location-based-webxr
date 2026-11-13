# `placement/placement-rows.ts` - what placing means per kind and view

## Purpose

One table that says, for every view of every block kind (and for a plain
folder and a station), what the 3D editor's handles do with it:

- `posed` - the drawing reads the pose. False for `card`: the file keeps
  the pose, but nothing in the world shows it, so the block gets no
  handles.
- `turns` - turning it shows. False for what faces the camera or the
  viewer (a pin's label, a sound's icon and circle, a reading sign's
  plate): no turn knob, and turning keys do nothing.
- `lifts` - its height is its own. False for a station, whose height is
  the ground's.
- `extent` - what its dots change (absent: no dots). Three meanings,
  never mixed: `size` (a real size of the drawing, which scales with it:
  a model's `sizeM`, a picture's `widthM`), `reach` (a distance that is
  no scale of the drawing: a station's `foundRadiusM`) and `factor` (a
  uniform scale of a whole frame: a folder's `scale`).

The rows are per VIEW, not per kind, because a block may stand in the
world in one view and be a card in another (a video gaining a screen
view would be the first such kind).

## Public API

- `ExtentSpec` - `{ kind: "size" | "reach" | "factor", field, label, meaning, min, max }`
  (`meaning`: what the value is in the creator's words, the inspector's
  note under a size field).
  `min` and `max` are inclusive; metres for `size` and `reach`, a ratio for
  `factor`.
- `ViewPlacement` - `{ posed, turns, lifts, extent? }`.
- `BLOCK_PLACEMENT` - the block table, `satisfies` one row for every view in
  `TOUR_KINDS[kind].views`: a view joining the format is a compile error
  until it gets a row.
- `CONTAINER_PLACEMENT` - every plain folder: posed, turning, lifting, a
  `factor` extent on `scale` from 0.1 to 10.
- `STATION_PLACEMENT` - a station: posed, turning, not lifting, a `reach`
  extent on `foundRadiusM` from 2 to 300 m.
- `blockPlacement(kind, view)` - the row, or null for a kind or view the
  table does not know (an own property check: `toString` is no view).

## The rows

- `shortText`: `pin` posed, facing (the label faces the camera); `card` poseless.
- `longText`: `lectern` posed, turning (the stand keeps its turn about up);
  `reading` posed, facing (the plate turns to the viewer); `card` poseless.
- `picture`: `plane` posed, turning, `size` on `widthM`
  (`TOUR_PICTURE_MIN_WIDTH_M` to `TOUR_PICTURE_MAX_WIDTH_M`); `card` poseless.
- `video`: `card` poseless (no world view yet).
- `audio`: `spot` and `zone` posed, facing, no dots (a sound's reach is
  set in the inspector); `card` poseless.
- `model`: every world view posed, turning, `size` on `sizeM`
  (`TOUR_MODEL_MIN_SIZE_M` to `TOUR_MODEL_MAX_SIZE_M`); `card` poseless.
- `character`: every figure view posed; the flat-figure views (bubble,
  speak, two-stations, portrait) facing (he faces the camera fully, so a
  turn shows nothing: no knob, no Heading field), the pop-up turning (the
  stage set keeps his facing);
  `card` poseless.
- Every posed block lifts.

## Invariants

- A row is a fact about the editor's drawing, and the contract test
  holds it there: a posed view is drawn; a turning view's drawing changes
  with its heading and a facing one's does not; a `size` doubles the
  drawing when doubled.
- A placeable has at most one extent.
- No behaviour lives here: no hooks, no per-kind preview.

## Tests

- `placement.contract.test.ts` - the rows against the format (every
  view, a literal table of every row, `card` exactly poseless, the
  bounds equal to the format's constants) and against the editor's
  drawing through the stations layer and the page's world door (drawn,
  turning at 45, 90 and 135 degrees, a size doubled over its range, set
  through the row's own `extent.field`).
- `placement-consumers.contract.test.ts` - the inspector against `turns`:
  every posed (kind, view) shows a Heading field and writes a typed
  heading as a turn exactly when its row turns.
- `list-rows.contract.test.ts` - every item of a document holding every
  (kind, view), free, in nested plain folders and in a story, has exactly
  one row in the tree, and every free one exactly one in the object list.

## Short text views

`sign` turns (its heading is the creator's, a turning gizmo); `edgeHint` faces the camera like a pin.
