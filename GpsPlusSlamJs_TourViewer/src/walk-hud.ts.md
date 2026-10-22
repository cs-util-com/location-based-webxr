# walk-hud.ts

## Purpose

The walk's HUD markers in two looks: the station the walk is about (the
focus) in the walk's orange and larger, the other nearest stations in the
walk's white. The framework's wayfinding HUD colours and sizes every
marker of one instance alike, so the walk runs two instances over the
guide's one list of targets; no framework change (`indicatorColor` and
`indicatorScale` are per HUD).

## Public API

- `type WalkHudLook = "focus" | "others"`.
- `splitWalkHudTargets(targets, focusId) => { focus, others }`
  - the target whose `id` is `focusId` (at most one; ids are the HUD's
    keys) goes to `focus`, every other one to `others` in its own order;
  - no focus, or a focus not among the targets (found, or none): every
    target is the others'. The guide keeps the focus among its targets
    however far it is (`station-guide.ts` `hudTargets`), so a chosen
    station farther than the nearest five still gets its marker.
- `startWalkHuds({ create, targets, focusId }) => { dispose } | null`
  - starts one HUD per look through `create({ getTargets, look })`, each
    polling its half of `targets()` split by `focusId()` every frame, so
    a focus change reaches both HUDs on the next frame without a restart;
  - builds the split once a frame for both: a HUD that reads a split it
    has read already starts the next one, so `targets()` (the guide's
    positions, bands and nearest five) runs once a frame, not twice;
  - null while either cannot start (no camera yet): the other is disposed
    again, so the guide's retry starts both together;
  - `dispose()` disposes both.

## Invariants & assumptions

- The halves are disjoint and their union is the guide's list in its
  order (the property test): never a station with two markers, never one
  the single HUD marked left without one, never more than the guide's
  five (`HUD_NEAREST_STATIONS`).
- The looks are the seam's (`seams.ts` `createWayfindingHud`'s `look`):
  the focus `WALK_RADAR_COLOURS.accent` (`#fb923c`) at 1.25 times the
  indicator scale, the others `WALK_RADAR_COLOURS.left` (`#f3f5f7`) at
  1.0. The prototype draws 1.25 against 0.85; the others stay at the
  HUD's own size because each still carries its distance label and edge
  arrow (a named difference, the builder's; the phone decides).
- The station guide does not know about the split: it hands
  `startHud(getTargets, focusId)` its targets and its focus
  (`visitor-stations.ts` wires `startWalkHuds` there).

## The pop on a focus change, measured (shipped: two HUDs)

A station that becomes the focus, or stops being it, moves to the other
HUD and is a fresh target there. `walk-hud.pop.test.ts` drives the real
framework HUD, with the shipped looks (`WALK_HUD_LOOKS`, the focus at
1.25 times), through that move (a portrait phone, 390 px wide, a 60
degree vertical view, stations 30 m off), sweeping the turn rate (0, 15,
30, 60 degrees a second) at 30 and 60 frames a second:

- the marker never blinks and never doubles: one marker per HUD in every
  frame, the switching frame included;
- held still it does not move;
- while turning it jumps in the switching frame by the old circle's
  smoothing lag (the HUD's damping, 9 a second, about 0.11 s of the turn):
  17.5 px at 15 degrees a second, 35 px at 30, 66 px at 60, the same at
  both frame rates - about 3 frames' motion at 30 frames a second and 7 at
  60;
- the arrival band is forgotten (a fresh target shows past `distanceMin`,
  not `distanceMax`); in the walk a station inside its found radius is
  found on that tick and leaves the targets, so the case does not occur.

Verdict: two HUDs, no framework per-target colour. The jump happens only
while the phone turns, in the frame the marker turns orange and larger -
itself the change the visitor is meant to see - and a focus changes when
the nearest station changes, mostly while walking. A per-target colour
would keep the smoothing and remove the jump, at the price of a framework
change every dependent app's gate pays for. What would reverse it: a
field tester seeing the jump as a pop on the phone, most likely at a fast turn (60 degrees a second, 66 px).

## Examples

```ts
const hud = startWalkHuds({
  create: ({ getTargets, look }) =>
    seams.createWayfindingHud({ getTargets, look }),
  targets: getTargets,
  focusId: () => guide.view()?.focusId ?? null,
});
hud?.dispose();
```

## Tests

- `walk-hud.test.ts` - the split (the focus alone in its half, the other
  four in order; no focus, a focus not among the targets, no targets);
  the property that the halves are disjoint, at most one focus, and their
  union is the targets in order; `startWalkHuds` polling each half live,
  building the targets once a frame for both, and starting both or
  neither.
- `walk-hud.pop.test.ts` - the pop, measured on the real framework HUD
  with the shipped looks (above); `WALK_HUD_POP_OUT=<file>` writes the table.
