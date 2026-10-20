# tour-items.ts

## Purpose

A station's ITEMS in `tour.json` version 3 (tour editor plan
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`,
W3): the text pins and captured photos placed at a station, each at a LOCAL
pose relative to it. Also the kind-specific field rules shared with the
world-view object of `tour-manifest.ts`, so the two can never disagree about
what a pin or a photo is (DEC-H3).

## Public API

- Types: `TourLocalPose` (= `qr-pose.ts` `Pose`: `position` metres along
  the station's rotated North, Up, East axes; `rotation` a unit quaternion
  `[x, y, z, w]` relative to the station's), `TourPinFields`,
  `TourPhotoFields`, `TourContentFields`, `TourPinItem`, `TourPhotoItem`,
  `TourItem` (fields plus `pose`).
- `TOUR_ITEM_MAX_OFFSET_M` (10 000) - the sanity bound per axis.
- `parseTourContentFields(value, at, { fail, lenient? }): TourContentFields | null`
  - a pin (`id`, `createdAtIso`, non-blank `label`) or a photo (`image`
    `content/<its id>.<image ext>`, positive integer `imageWidth` /
    `imageHeight`, optional `label`); null when a lenient read meets an
    unknown kind or image type.
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
  refusing it, the order kept.
- Through the manifest and station tests (`tour-manifest.test.ts`,
  `tour-stations.test.ts`, `tour-manifest.property.test.ts`).
