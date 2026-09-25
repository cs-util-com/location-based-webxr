# src/app/viewing — Goal-2 composition, Viewing mode

The visitor's half of the app (TASK.md §2.4): a scanned QR link becomes a
running AR tour. Composition code only — every component keeps its own demo
and its own tests; nothing here is imported by `src/components/`.

```
?tour=<zipUrl>  →  cloud-loader (6)  →  onboarding gate (9)  →  Enter AR  →  AR scene (8)
                                                          └→ Desktop preview (11) ↗  + proximity (4)
                                                                              + map (7)
                                         (entry screen measures the visitor's distance to the
                                          tour's start and decides which of the two is offered)
```

Plan: [`plans/2026-08-14-viewing-composition-plan.md`](../../../plans/2026-08-14-viewing-composition-plan.md)
· contract: [`plans/Shared-Contract.md`](../../../plans/Shared-Contract.md).

## Modules

| Path                  | What lives here                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `viewing-app.ts`      | The sequencer: screens, error states, the AR entry gesture, session lifecycle, progress persistence. The only stateful file here.     |
| `ar-seams.ts`         | The three seams component 8 injects — `createAnchor`, `toWorld`, `getUserWorldPos`. The single geo→world step §2.5.1 permits.         |
| `ar-scene-runtime.ts` | Builds/tears down the live scene inside a session: alignment binding, audio listener, adapter (incl. the XR select ray), frame tick.  |
| `audio-listener.ts`   | Hands the gate's unlocked `AudioContext` to three the one way that actually works (see below).                                        |
| `progress-store.ts`   | Visited waypoints in `localStorage`, so a reload or an evicted tab does not lose the visitor's place.                                 |
| `screens.ts`          | The non-immersive screens. Plain DOM, no store, no framework.                                                                         |
| `start-distance.ts`   | Pure: how far the visitor is from the tour's start (near / mid / far / unknown) and `deriveEntryView`, the whole entry-screen policy. |
| `locate-visitor.ts`   | A short-lived `watchPosition` read for the entry screen, on its own handle — not the framework's singleton `startGpsWatch`.           |

The in-session HUD (`mountHud`) lives in
[`src/components/shared/hud.ts`](../../components/shared/hud.ts), not here —
the desktop-preview demo (component 11) mounts the identical HUD, and a
component may not import from `src/app/`. The app pushes _state_ into the HUD
(`setMapVisible` keeps `mapVisible` and the Map button in sync;
`setOsmBuildingsStatus` replaces the old label helper), and End tour now needs
a confirm click.

Where a device cannot run AR (any desktop), the entry screen offers the
desktop preview instead of a dead end: `viewing-app.ts` swaps component 11's
session in as the `ArRuntime` + seams and `startArScene` builds the _same_
scene — same proximity, same assets, same audio, same taps. `&preview=1`
offers it even where AR works.

The entry screen also decides by **distance** (plan
[`2026-09-20-start-distance-gate-plan.md`](../../../plans/2026-09-20-start-distance-gate-plan.md)).
After the gate, one short GPS read measures the visitor against the tour's
start (`tourStartCoord`: the trailhead, else the first stop):

| Visitor → start     | Entry screen                                                      |
| ------------------- | ----------------------------------------------------------------- |
| under 50 m          | Unchanged: Enter AR                                               |
| 50–300 m            | Enter AR **and** Preview here, with "The start … is 140 m away."  |
| over 300 m          | **Preview here only** — AR removed, nothing there could ever fire |
| no fix / coarse fix | Unchanged: Enter AR. A missing fix never takes AR away.           |

"Far" needs only a lower bound (`distance − accuracy > 300 m`), so a coarse
indoor fix from another continent is still far; near/mid need accuracy ≤ 50 m.
Decided once per entry-screen mount; returning from the preview re-checks.
Skipped where AR is unsupported.

## Three things that are easy to get wrong here

All three were found while planning/building this directory, and all three fail
**silently** — green unit tests, broken tour in the field. Each is pinned by a
test named after it.

1. **Waypoint anchors must pass `skipBootstrap: true`.** `GpsAnchorOptions
.getCurrentGpsPoint` is optional, and when omitted the framework anchor
   bootstraps from _the object's own pose_ and commits that median as its
   `gpsPoint`. AnchorStarter wants that (it is placing a new anchor); a tour
   already knows the coordinate, so bootstrapping would silently relocate the
   waypoint. → `ar-seams.ts`, `ar-seams.test.ts`.

2. **`isFullyAnchored` must be re-derived, not forwarded.** A `skipBootstrap`
   anchor reports `isFullyAnchored === true` from frame one — while its object
   still sits at the AR origin and no alignment matrix exists. Component 8
   feeds exactly the anchors reporting anchored to the proximity driver, so
   forwarding the raw flag puts every waypoint on top of the visitor at session
   entry: the whole tour activates, spawns and is marked visited in the first
   second. The wrapper reports anchored only once the object has actually been
   committed to its computed target. It then **latches**: the anchor only
   applies corrections above `2 m × (1 + distance/10)`, so re-checking a 2 m
   tolerance every frame would freeze the zone of any stop whose correction
   fell in between. → `ar-seams.ts`, `ar-seams.test.ts`.

3. **Never assign `listener.context` after constructing an `AudioListener`.**
   Three's constructor builds `gain` on — and connects it to — whatever context
   was global at that moment, so a later re-assignment leaves every
   `PositionalAudio` rendering into a graph nobody hears. Use
   `AudioContext.setContext(unlocked)` _before_ `new AudioListener()`.
   → `audio-listener.ts`, `audio-listener.test.ts`.

Also: **stops stand on the visitor's floor, not at their stored altitude**
(contract D6). GPS-world `y` is absolute altitude, so `0` is the ellipsoid
(~100 m underground) and a stored altitude is one noisy fix. `ar-seams.ts`
uses the AR frame's own floor (`y = 0` of `local-floor`, mapped through the
alignment) instead, independent of how high the phone is held, and
`startArScene` registers `seams.update()` before the scene so the anchors see
the refreshed floor every frame.

And one that is easy to _omit_: **`startSession()` (the recording slice) must be
dispatched before the GPS watch starts**, or the GPS coordinator never feeds
alignment, no waypoint ever anchors, and the tour shows nothing forever. With
the default `NullStorageBackend` nothing is written anywhere — the dispatch is
purely what turns GPS fixes into alignment input. AnchorStarter carries the same
call for the same reason.

## Failure states, by design

| Situation                                | What the visitor sees                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| No `?tour=`                              | "No tour link" — scan the QR / open the shared link. No retry.            |
| CORS-blocked, 404, or a share _page_ URL | Named cause + what to fix, with a retry that re-opens the tour.           |
| Corrupt zip / invalid `tour.json`        | "This tour file is damaged" — **no** retry; retrying cannot fix it.       |
| No WebXR on this device                  | Enter AR disabled, **desktop preview offered**, map still usable.         |
| Permission denied / `initAR` failure     | Inline reason on the entry screen, still retryable.                       |
| Alignment not converged yet              | The framework's own coaching ("walk a few metres"), no empty camera.      |
| Session ended by the system back gesture | Back to the entry screen with tour, progress and warm cache intact.       |
| Story audio blocked                      | HUD notice asking for one tap.                                            |
| Buildings failed to load                 | HUD notice: "Buildings couldn't load. Tap the buildings button to retry." |
| Map tiles unreachable (offline)          | One-shot notice; stops, position and statuses keep working.               |

## Tests

- `ar-seams.test.ts` — the geo→world math against the framework's own
  primitives, plus the two blockers above.
- `ar-scene-runtime.test.ts` (jsdom) — the floor refresh is registered before
  the scene creates its anchors and runs first each frame.
- `audio-listener.test.ts` — asserts `listener.gain.context`, the assertion the
  wrong idiom fails.
- `progress-store.test.ts` — round-trip, corrupt values, private-mode throws.
- `viewing-app.test.ts` (jsdom) — the screen sequence and every failure state,
  with the real gate and the real store. `openRemoteTour` is substituted here
  because the loader's own integration suite already drives it against a real
  range-serving server, and the replay e2e below drives the real one end to end.
- `viewing-replay.e2e.test.ts` — **the §2.4 composed-flow test**: component 5
  packs a real zip, a real HTTP server serves it with real 206/Range, component
  6 opens it for real, and a real Task 1 walk is played through the real store,
  proximity machine and orchestrator. Asserts the knights that appear are
  exactly those the route reaches (the near-miss at 17 m prefetches but never
  appears), ordering is build-before-show, visited matches, and outstanding
  asset references return to zero.

Run: `pnpm exec vitest run src/app/viewing/` (fast) or `pnpm test` (full gate).

## Device checklist (what the machine cannot prove)

The replay e2e substitutes the rendering layer and, with it, GPS anchoring —
a real `GpsAnchor` needs an alignment matrix that only exists inside a session.
So `initAR` + `enableArWorldGroupAlignment` + `createGpsAnchor` wiring is proven
by hand. Walk this list on an Android/Chrome phone, outdoors, against a tour
authored with Authoring mode:

1. Scan the QR from the pack-and-share panel → the tour opens (name + stop count).
2. Grant camera + location → Start → Enter AR.
3. Coaching appears; **nothing spawns at the origin** while it does.
4. Walk toward a waypoint: it appears at roughly its active radius, not before.
5. Tap it → the story is **audible** and the transcript shows.
6. Toggle the map in AR → it composites over the camera feed and tracks you.
7. System back gesture → entry screen, progress kept; re-enter → the nearby
   knight must be re-approached, not already active.
8. Reload the page → visited stops are still visited.
9. Wait for "offline-ready", enable airplane mode → the tour keeps working
   (map tiles degrade with a notice).
