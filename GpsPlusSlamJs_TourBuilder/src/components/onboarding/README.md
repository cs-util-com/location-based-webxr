# Component 9 — Onboarding gate + audio unlock

The mandatory first screen of both app modes (TASK.md §2.4). A camera/GPS
permissions checklist gates a Start button, and the Start click is the user
gesture that unlocks the Web Audio API so playback works later without a
second gesture. No tour, no store slice (onboarding isn't in the pinned §2.2
slice inventory), no WebXR probing — that stays the framework's job when
actually entering AR.

## Run it

```bash
pnpm dev            # then open http://localhost:8185/src/components/onboarding/
```

Click **Grant Access** — this triggers the real browser camera and GPS
prompts, one after another (not both at once). Start stays disabled until
the browser reports both as **granted**; there is no way to check a box
yourself. A denied item shows its explanation in red. Click **Start** and a
short confirmation beep plays, proving the `AudioContext` is unlocked.

## Layout

| Path         | What lives here                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| `demo.ts`    | Standalone demo entry, wired to the framework's real permission functions.                                     |
| `index.html` | The demo's page (loads `demo.ts`).                                                                             |
| `core/`      | Pure, framework-free reducer + selectors. No browser APIs. See `core/README.md`.                               |
| `view/`      | The impure adapter (wraps the framework's `permission-checker`) + the reusable DOM view. See `view/README.md`. |

## Data flow

```
mount ─▶ checkExistingPermissions (non-prompting) ─▶ permissionResult × 2 ─▶ gateReducer
Grant Access click ─▶ requestPermissions (camera, then gps) ─▶ permissionResult × 2 ─▶ gateReducer
Start click ─▶ AudioContext.resume() [synchronous, the gesture] ─▶ audioUnlocked ─▶ onComplete(ctx)
```

`core/permission-gate.ts` is the single source of truth for whether Start may
be clicked: `canStart(state)` is true only once every _required_ kind reads
`'granted'` (viewing: camera + gps; authoring passes `required: ['gps']` since
it never opens the camera), as reported by the browser via the framework's
`permission-checker`, never by a self-ticked checkbox.

## Reuse

The framework's `gps-plus-slam-app-framework/sensors` module already
implements tested, prompting and non-prompting permission helpers
(`checkCameraPermission`, `requestCameraPermission`,
`checkGeolocationPermission`, `requestGeolocationPermission`). This component
calls those rather than touching `getUserMedia`/`geolocation` directly — see
`plans/2026-08-07-onboarding-plan.md` for why.

## Handing off to Goal-2 composition

`mountOnboardingGate` is reusable, not demo-only: both Authoring and Viewing
bootstrap mount it before anything else. `onComplete(audioContext)` is the
hook — the composed app tears the gate down and hands the unlocked context to
a `THREE.AudioListener` before giving that to component 8, which never unlocks
audio itself (plan `2026-07-31-ar-scene-plan.md`, decision A16).

**How to hand it over (this line used to be wrong):**

```ts
import { AudioContext as ThreeAudioContext, AudioListener } from "three";

ThreeAudioContext.setContext(audioContext); // BEFORE constructing the listener
const listener = new AudioListener();
```

Not `listener.context = audioContext`. `AudioListener`'s constructor builds
`this.gain` on whatever context is global at that moment and connects it to
that context's destination, so assigning `.context` afterwards leaves every
`PositionalAudio` rendering into a graph the visitor cannot hear — with no
error anywhere. See `src/app/viewing/audio-listener.ts` (and its test, which
asserts `listener.gain.context`).

## Tests

Pure logic in `core/` is unit-tested (`*.test.ts`, run by `pnpm test:unit`).
`view/onboarding-adapter.ts` is unit-tested against mocked framework calls.
`view/onboarding-view.ts` is unit-tested under `@vitest-environment jsdom`.
No replay e2e — this component has no movement dependency (TASK.md §2.3 only
requires it where a component depends on movement) — the demo, verified
against real browser permission prompts, stands in for it.
