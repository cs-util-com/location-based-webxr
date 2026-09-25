# onboarding/view — the browser-facing adapter + DOM view

The only impure half of component 9. Two files, two jobs: talk to the
framework's permission functions, and render/wire the checklist UI.

## `onboarding-adapter.ts`

```ts
checkExistingPermissions(deps: OnboardingAdapterDeps): Promise<void>  // non-prompting, on mount
requestPermissions(deps: OnboardingAdapterDeps): Promise<void>        // prompting, on Grant Access
```

`OnboardingAdapterDeps` takes an optional `required` kind list (default camera +
GPS); when `camera` is not required the camera calls are skipped and may be
omitted. It injects the four framework calls
(`checkCameraPermission`, `checkGeolocationPermission`,
`requestCameraPermission`, `requestGeolocationPermission`, from
`gps-plus-slam-app-framework/sensors`) plus `dispatch`. `requestPermissions`
requests **camera before geolocation**, sequentially — not
`Promise.all` — so the two native permission prompts never stack; this
mirrors RecorderApp's existing `requestAllPermissions()` precedent. A
rejected framework call is caught and mapped to a `denied` result instead of
propagating.

## `onboarding-view.css`

Skins the classes `onboarding-view.ts` assigns (`.perm-row`, `.perm-icon*`,
`.perm-body`, `.perm-name`, `.perm-explanation`) plus `.gate-card`, which the
caller applies to the host element it passes to `mountOnboardingGate`.
Colocated here (not in `src/app/app.css`) so the component demo and Goal-2
composition (`viewing-app.ts`, `authoring-app.ts`) render the identical
checklist look; `app.css` pulls it in via `@import`.

## `onboarding-view.ts`

```ts
mountOnboardingGate(root: HTMLElement, deps: OnboardingGateDeps): { destroy(): void }
```

Renders a checklist row per required kind (camera + GPS by default; GPS only
when `deps.required` is `['gps']`), a Grant Access button, and a Start
button, all driven by an internal `gateReducer` instance — the view holds no
permission logic of its own. On mount, calls the non-prompting
`checkExistingPermissions` so a returning visitor who already granted both in
an earlier session sees Start enabled immediately. `destroy()` clears the
mounted DOM and stops the internal `dispatch` from doing anything further,
so a permission promise that resolves after teardown is a no-op.

**The audio-unlock gesture (O7):** the Start click handler calls
`deps.createAudioContext().resume()` as its first synchronous statement,
before any `await` — the Web Audio autoplay policy requires the `resume()`
call itself to be inside the click's call stack. `onComplete(audioContext)`
fires once, only after the resumed context reports `'running'`.

`onStateChange?: (state: GateState) => void` is an optional hook, not used by
Goal-2 composition — it exists for the demo's live state log.

## Tests

`onboarding-adapter.test.ts` — the granted/denied/unsupported mapping, the
camera-before-geolocation call order (a `Promise.all` regression would still
pass every other assertion, so order gets its own test), and rejection
handling. `onboarding-view.test.ts` (`@vitest-environment jsdom`) — Start's
disabled state tracking `canStart`, the red explanation rendering only for a
denied row, the Grant Access sequencing reflected in the DOM, the
synchronous `resume()` call, `onComplete` firing exactly once and never on a
still-suspended context, the `onStateChange` hook, and `destroy()`.
