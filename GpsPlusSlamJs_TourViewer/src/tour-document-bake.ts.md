# tour-document-bake.ts

## Purpose

The tour document's bake at open: a creator's page opens a tour with its
recording's photos already in its stations, so every station exists from
the open on, the station HUD names the stations a Finish will write, and
the Finish assigns nothing. The bake is a deterministic replay of the file
(`capture-bake.ts`), so it runs once per open, never at a save. Both
creator pages call it: `archive-open.ts` (the phone, creator mode only)
and `editor/editor-open.ts` (the desktop editor).

It is a module of its own, beside the document (`tour-document.ts`) and
its save (`tour-document-save.ts`), because it applies one of the
document's rules - the station rule for the walk's photos
(`withWalkPhotos` of `tour-content.ts`) - and the pages may reach those
rules only through the document's modules (the
`document-rules-through-tour-document` boundary rule in
`config/.dependency-cruiser.cjs`).

## Public API

- `walkAtOpen(tour, manifest, options?) -> Promise<WalkAtOpen>` - the
  bake at open: `{ manifest, photos }`, the tour with the recording's
  photos in its stations (`withWalkPhotos` of `tour-content.ts`: the
  station rule, `walk-N` ids) and what the bake decided
  (`RebuildPhotoSpots`, below). The tour as given when the photos were
  not placed (its own spots, no recording, a decline). Never rejects: a
  read failure, a cap's refusal or a failed integrity check (which the
  session reports on its own) becomes `notPlaced`. Both pages call it
  when they open a tour (`archive-open.ts` for a creator,
  `editor/editor-open.ts`); a save never bakes. `WalkBake` is the
  phone's view of it (`ctx.walkBake`: `{ kind: "baking", done, total }`
  or `{ kind: "decided", photos }`).
- `keepsWalkByDefault(photos) -> boolean` - the keep-the-walk switch's
  default for an open that decided `photos`: true exactly when they could
  not be placed (`notPlaced`). A Finish or a Save leaves the walk out
  unless kept and a visitor shows baked photos only, so a lean copy of
  such a tour would hold neither the photos nor the walk a later open
  could bake them from. The phone's Finish (`creator-finish.ts`) and the
  desktop's Save (`editor/edit-main.ts`) start their switch from it; the
  creator may untick it.
- `captureSpotsForRebuild(tour, manifest, options?)` (M6 E0b) - the
  photos' spots, in the world (`worldCaptureSpots`): the manifest's own, else baked from the
  recording (`capture-bake.ts`, `options` passes its `shouldContinue` and
  `onChunk`), else none (`{}`); a bake that declines or a recording that
  cannot be read is `{ notPlaced: reason }` (a read that failed also
  carries `readFailed: true`: another open may work), except a walk that places
  nothing (the bake's `placesNothing`), which is `{}` with no reason (there
  are no photos to speak of). The result type is
  `RebuildPhotoSpots`. `ArchiveLimitError` and
  `TourIntegrityError` are rethrown (`walkAtOpen` makes them a
  reason). Called once per open, through `walkAtOpen`.

## Invariants & assumptions

- **Never fails an open.** Every failure of the read (a cap, a failed
  integrity check, an unreadable entry) is the reason the tour opens
  without its walk photos; the session reports a cap or an integrity
  failure on its own.
- **Once per open.** A tour that already carries photo spots is opened as
  it is, without reading the recording; a decline is final for that open
  (the Finish replays nothing).
- **The rule is the document's.** The photos join a station whose own
  found radius holds them, or start `walk-N` stations, in capture order
  (`withWalkPhotos`), so the result is the same on both pages.
- Untrusted input: the recording is external data; its read inflates
  under the session's budget (`capture-bake.ts`).

## Examples

```ts
const { manifest, photos } = await walkAtOpen(
  session,
  opened ?? createEmptyTourManifest(),
);
document.open(manifest); // the walk's photos are in its stations
if (photos.notPlaced !== undefined) say(photos.notPlaced);
```

## Tests

`tour-document-bake.test.ts`: `walkAtOpen` (the sample recording baked
into the tour's stations and the result read back by the format, a tour
with its photos opened as it is without a read, a decline, a cap or an
integrity failure as the reason and never a failed open, no recording)
and `captureSpotsForRebuild` (own spots without a read, none without a
recording, a read failure as the reason, a cap and an integrity failure
rethrown, a decline as the reason, a walk naming no photo of the tour as
`{}` with no reason) and `keepsWalkByDefault` (ticked for a decline or a
failed read, unticked for placed photos or none). The pages' use is pinned in
`archive-open-file.test.ts` and `editor/editor-open.test.ts`.
