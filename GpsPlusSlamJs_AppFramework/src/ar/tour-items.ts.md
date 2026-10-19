# tour-items.ts

## Purpose

A station's ITEMS in `tour.json` version 3 (tour editor plan
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`,
W3): the text pins, captured photos and (minor 1) placed 3D models at a
station, each at a LOCAL pose relative to it. Also the kind-specific field rules shared with the
world-view object of `tour-manifest.ts`, so the two can never disagree about
what a pin or a photo is (DEC-H3).

## Public API

- Types: `TourLocalPose` (= `qr-pose.ts` `Pose`: `position` metres along
  the station's rotated North, Up, East axes; `rotation` a unit quaternion
  `[x, y, z, w]` relative to the station's), `TourPinFields`,
  `TourPhotoFields`, `TourModelFields`, `TourContentFields`,
  `TourPinItem`, `TourPhotoItem`, `TourModelItem`, `TourItem` (fields
  plus `pose`).
- `TOUR_ITEM_MAX_OFFSET_M` (10 000) - the sanity bound per axis.
- `TOUR_MODEL_MIN_SIZE_M` (0.05) and `TOUR_MODEL_MAX_SIZE_M` (500) - the
  bound of a placed model's size, both inclusive.
- `parseTourContentFields(value, at, { fail, lenient? }): TourContentFields | null`
  - a pin (`id`, `createdAtIso`, non-blank `label`) or a photo (`image`
    `content/<its id>.<image ext>`, positive integer `imageWidth` /
    `imageHeight`, optional `label`) or a model (`asset` an id, `sizeM`
    within the bound, optional `label`); null when a lenient read meets an
    unknown kind or image type, or a model's positive size beyond the
    bound.
- `parseTourLocalPose(value, at, fail): TourLocalPose` - three finite
  offsets within the bound (-0 read as 0) and a unit rotation renormalized
  by the level files' one rule (`renormalizeUnitQuaternion`).
- `parseTourItems(value, at, { fail, lenient? }): TourItem[]` - an array
  of items in order; lenient leaves out what it cannot show.

## Invariants & assumptions

- The caller's `fail` throws its own error (the manifest's), so this
  module needs no error class and no import of its parent.
- Ids are unique per station here (`tour-stations.ts`) and across the
  tour in `tour-manifest.ts`.
- The bound is a sanity check, not a design limit: the editor keeps
  stations far smaller (the plan's 40 m); a station's flat frame means
  nothing kilometres away.
- **A model's size is in METRES, not a factor** (the editor's round-3
  decision, `GpsPlusSlamJs_Docs/docs/2026-10-19-0905-editor3d-prototypes-round-3-plan.md`
  §9): `sizeM` is the scaled model's largest side, so the bound holds
  whatever the model's own size (a factor's sensible range depends on it).
  A renderer scales the decoded model by `sizeM` over its own largest
  side; a model with no extent is the renderer's to refuse. Pins and
  photos have no size.
- **What is refused, and why not clamped.** At this reader's minor a size
  outside 0.05-500 m fails the file: a clamp would make the next save
  rewrite the creator's number without a word. A lenient read (a newer
  minor, which may widen the bound) leaves such a model out. A size that
  is not a positive finite number (0, negative, -0, NaN, infinite, a
  string, absent) fails at EVERY minor: no revision can make it a size.
  An editor clamps its drag to the bound before it dispatches.
- **The model's asset is resolved by `tour-stations.ts`** (which sees the
  assets): here only its id's shape is checked, so the world-view object
  of a draft can carry a model too.
- Reading is exact: a pose reads back as the same numbers (no
  recomputation), which the version 3 round-trip property relies on.

## Examples

```ts
const items = parseTourItems(station.items, 'stations[0].items', { fail });
// [{ id: 'p1', kind: 'pin', label: 'Gate', createdAtIso, pose: {...} }]
```

## Tests

- `tour-items.test.ts` - the local pose (exact, -0, renormalized; each
  refusal), the shared fields (pin and photo, nothing of a placement), the
  lenient read leaving out a newer kind or image type and the strict read
  refusing it, the order kept; the placed model (read with and without a
  label, the bounds themselves accepted, each kind of non-size refused at
  any minor, a size beyond the bound refused strictly and left out
  leniently, an asset that is not an id).
- `tour-items.property.test.ts` - the size bound over every double: inside
  reads back exactly through JSON, the bounds in and one ulp beyond out,
  every positive size outside refused strictly and left out leniently,
  nothing that is not a positive finite number a size at any minor. Each
  property was seen to fail with its comparison weakened (`>=` to `>`,
  `<=` to `<`, `<= 0` to `< 0`, the lenient branch removed).
- Through the manifest and station tests (`tour-manifest.test.ts`,
  `tour-stations.test.ts`, `tour-manifest.property.test.ts`).
