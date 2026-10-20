# tour-relocation.ts

## Purpose

The test switch `?relocate=here` (owner decision S-D9, 2026-10-05, scan-pass
plan `GpsPlusSlamJs_Docs/docs/2026-10-05-1240-tour-scan-pass-desktop-editor-and-partial-download-plan.md`
§7): the sample tour sits at Marienplatz in Munich, a well-known public
place, so that no private location reaches the public repository; the switch
moves its stations to wherever the phone is, so the owner can try stations
anywhere. Nothing about the phone's position is stored or sent.

## Public API

- `RELOCATE_LEAD_NORTH_M` (15): how far north of the phone the first moved
  station stands.
- `relocationRequested(search): boolean` - true only for `relocate=here`.
- `relocateStations(stations, target): TourStation[]` - the first station
  moves to 15 m north of `target`, at the target's altitude; every other
  station keeps its north / east / up offset from that one (heading
  included). Since version 3 every station has a geo pose, so every one
  moves. An empty list stays empty. The moved list feeds the station guide
  only (`visitor-stations.ts`); the content playback
  (`viewer-placement.ts`) draws the file's stations, so a relocated
  tour's pins and photos stay where the file puts them. The switch is
  test-only and the sample tour has no items. A
  target altitude that is not finite (a fix without altitude) keeps the
  stations' own heights.
- `firstDeviceFix(points): RelocationTarget | null` - the first point of a
  GPS history whose source is a device fix (`gpsPointSourceOf`), as a
  target; null while none is stored. A code's synthetic votes are skipped:
  since QR-first M1 a code scanned before any fix stores its votes first,
  on a 30 m ring around the code, and the relocation once latched one of
  them (M1 review #3).
- `createStationRelocator(enabled, onRelocated?)` - for an open page: off,
  stations pass through; on, `null` until the first fix, which is then kept
  as the target (a later fix never drags the tour), `onRelocated` told
  once. The same input list gives back the same moved list, because the
  guide reads the tour every frame.

## Invariants & assumptions

- Offsets are taken on a local flat earth at the first station: about 1 %
  over the few hundred metres a tour spans (the property test's bound).
- The move is in memory, for the open page only; it never touches the zip,
  the draft or any storage.
- Off unless the URL says `relocate=here`: a real tour is never moved on
  its own (the e2e without the switch pins it).

## Examples

```ts
const relocate = createStationRelocator(
  relocationRequested(location.search),
  () => {
    note.hidden = false;
  },
);
const stations = relocate(manifest.stations, firstFix()); // null until a fix
```

## Tests

`tour-relocation.test.ts` (unit and property: distances kept for any layout
and target, every station moved, an empty tour left empty, the fix kept); `playwright-tests/sample-tour.spec.js` (the sample tour moved to
the fakes' first fix offers its first station about 15 m away and shows the
note; without the switch it stays about 230 km away).
