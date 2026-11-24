# scenes.ts

## Purpose

The photo test's protocol as plain data. A run is a list of scenes; each scene is a short list of shots that share its first shot (L1, F1, D1, X1). Pairs are never photographed as pairs: they are derived from the shots, so one photo of F1 serves seven measurements. This file holds the scene and shot lists, the derived pair table, the light check per shot, the next open shot, the run zip's name and the summary text. Pure, so the slice (`feature-match-slice.ts`), the plan reducer (`run-plan.ts`), both views and the zip writer (`plan-io.ts`) share one reading.

## Public API

- `SceneKind`: `"light" | "flat" | "deep" | "own"`. `ShotKey`: `L1`-`L4`, `F1`-`F6`, `D1`-`D3`, `X1`, `X2`.
- `MAX_EXTRA` (8): the most own scenes a run can add. The light scene repeats at 1 to `MAX_SPOTS` (3, from `bench-export.ts`) places.
- `sceneList(spots, extra)` -> `Scene[]` (`{ id, kind, spot, title }`): `light-s1`..`light-s<spots>`, then `flat-s1`, `deep-s1`, then `own-1`..`own-<extra>`. Both counts are clamped (a non-finite count reads as the minimum).
- `shotList(spots, extra)` -> `Shot[]`: every shot in the order the run walks them. A shot has `id` (`<scene id>/<key>`, e.g. `flat-s1/F3`), `scene`, `kind`, `spot`, `step` (0 for the scene's first shot), `key`, `text` and `handsOff`.
  - The shots per scene:
    - light: L1 normal light, L2 again unchanged, L3 light dimmed, L4 as dark as possible;
    - flat: F1 upright at 1.5 m, F2 again unchanged, F3 turned 30-45 deg in its own plane (pair `2d`: a turn, not a tilt away from the surface), F4 from 3 m, F5 from 1 m, F6 1 m to one side;
    - deep: D1 a deep scene, D2 again unchanged, D3 1 m to one side;
    - own: X1, X2.
  - `handsOff`: `"still"` for L2, F2 and D2 (nothing changes once the phone rests), `"move"` for F3 (the phone turns first), `null` for the rest (the gyroscope cannot judge a step or a light change): which shots the cockpit may take by itself.
  - One place: 13 shots (L1-L4 at 0-3, F1-F6 at 4-9, D1-D3 at 10-12).
- `previousInScene(list, index)`: the shot before `list[index]` in its scene; undefined for a scene's first shot or an index outside the list.
- `derivedPairs(spots, extra)` -> `DerivedPair[]` in shot-list order. A pair has `id` (`<scene id>/<name>`), `scene`, `spot`, `name`, `a` and `b` (shot ids), `kind`, `legacy` (the protocol key, never null), `axis` and `controlFor`.
- The pair table (name: kind, legacy key, axis, control for):
  - `L1-L2`: real, `1a`, light, control for light.
  - `L1-L3`: real, `1b`, light.
  - `L1-L4`: real, `1c`, light.
  - `F1-F2`: real, `2a`, control, control for scale, side-flat and oblique.
  - `F1-T0`: turn0 (F1's centre square against F2's, unturned), `t0`, rot, control for rot.
  - `F1-T90`: turn90, `t90`, rot.
  - `F1-T180`: turn180, `t180`, rot.
  - `F1-F3`: real, `2d`, oblique.
  - `F1-F4`: real, `3b`, scale.
  - `F5-F4`: real, `3c`, scale.
  - `F1-F6`: real, `4b`, side-flat.
  - `D1-D2`: real, `4c`, side-deep, control for side-deep.
  - `D1-D3`: real, `4d`, side-deep.
  - `X1-X2`: real, `x`, own.
  - The turns are synthetic (made from F1 and F2 by `rotation-square.ts`); the tilt F3 is a real photo. The old duplicate controls `3a` and `4a` are gone: F1-F2 is the one flat control. The synthetic turns have keys of their own: the old `2b` and `2c` named a phone turned by hand.
- `ShotPhotos`: what the pair rules read of each shot's photo (`{ id, greyMean }`), by shot id.
- `pairsUsing(pairs, shot)`: the pairs naming `shot`, i.e. what a retake measures again (F1: 7).
- `readyPairs(pairs, photos)`: the pairs whose two shots have a photo.
- `resultKey(pair, idA, idB)`: `<pair id>@<photo id A>+<photo id B>`, the key a measured result is stored under; any retake makes it stale.
- `readyResultKeys(pairs, photos)`: the result keys of the ready pairs, each with its pair (a `Map` in pair order); the slice keeps results only for these, the store keeps their records and the zip writes one folder per entry.
- `ShotLight` (re-exported from `bench-export.ts`): the `LightCheck` values plus `"not-darker-than-dimmed"`.
- `lightOf(shot, photos)`: a light shot's check against its scene's L1 (L2 by the control rule `1a`, L3 by `1b`, L4 by `1c`), and L4 against L3 (`"not-darker-than-dimmed"` when L4 passes against L1 but is brighter than L3); null for any other shot or while a photo it needs is missing.
- `needsRetake(shot, photos)`: its light check exists and is not `"ok"`.
- `nextOpen(list, photos, from, skipped = empty)`: the first open shot (no photo, not in `skipped`) after `from`, else the first one before it; null when no other shot is open.
- `runZipName(session)`: `feature-match-run-<session>.zip`.
- `summaryText({ session, spots, extra, photos, retakes, results, device })`: the plain-text summary in the zip and on the end screen: session, shots taken of total and places, missing shot ids, pairs ready of total, every light check, retakes (`planRetakes`: the takes past the first), "Pairs measured on this phone: X, failed: Y, pending (to be measured on the PC): Z" over the ready pairs' current result keys, "Timings: N measured beside the camera, M idle, K with the page hidden", the methods line when `methods` is given ("Methods on this phone: SIFT, ALIKED + LightGlue (XFeat is not measured on this phone: it is for the PC)"), the file name, the phone, and a line that no location, time or names are included.

## Invariants and assumptions

- Ids are stable strings built from the scene id and the shot key or pair name; the stored plan keys photos by shot id.
- Every pair's two shots are in the same scene; a pair is ready exactly when both have a photo.
- Pure and deterministic: no DOM, no time, no randomness.

## The run zip

Named `runZipName(session)`; its layout (each shot once under `shots/`, a frames JSON per ready pair under `pairs/<pair id>/`, the summary and the log) is in `run-zip.ts.md`.

## Example

```ts
const pairs = derivedPairs(1, 0);
pairsUsing(pairs, "flat-s1/F1").length; // 7
readyPairs(pairs, { "light-s1/L1": l1, "light-s1/L2": l2 }); // [L1-L2]
runZipName("0a1b2c3d"); // "feature-match-run-0a1b2c3d.zip"
```

## Tests

- `scenes.test.ts`: the scene and shot lists and their clamping, the pair table with its legacy keys and controls, the pairs a retake of F1 redoes, ready pairs, the light check of L2-L4 (L4 against L3), the next open shot with its wrap, the previous shot in a scene, the zip name, the summary text and its measured, failed and pending counts, the timings line and the methods line.
- `scenes.property.test.ts`: for any sizes (clamped ones included), the derived pairs name shots of the list only; a pair is ready exactly when both shots have a photo; a retake changes the result keys of exactly `pairsUsing`; the shot light checks equal the old pair checks on the same means; `nextOpen` finds an open shot inside the list, or none when all are taken.
