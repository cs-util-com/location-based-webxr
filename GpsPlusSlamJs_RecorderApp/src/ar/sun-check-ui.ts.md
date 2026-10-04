# sun-check-ui.ts

## Purpose

The recorder's AR sun check UI (sun-overlay plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-0100-ar-sun-overlay-heading-check-plan.md`
§4.1, M3). It shows:

- the HUD status line;
- the safety reminder;
- the **Mark** button with its in-progress state;
- the last three results.

It sits on top of the framework's `startSunCheck` controller
(`gps-plus-slam-app-framework/ar/sun-check`).

## Public API

- `createSunCheckUi(deps): SunCheckUi`
  - `deps.root`: the `#app` dom-overlay root (the panel must composite in AR).
  - `deps.startCheck()`: starts the framework controller on the live scene.
    If it throws, the check turns off with an error toast.
  - `deps.confirmSafety()`: the first-enable safety note. Resolves true when
    the user acknowledges it.
  - `deps.showToast(message, { severity, duration })`.
  - `deps.recorderAtPress()`: called at the Mark's PRESS. It returns that
    Mark's recorder, bound to the recording current then, which returns
    `'recorded' | 'not-recording'`. If binding or recording throws, an error
    toast says "measured but could not be recorded".
  - `deps.onEnabledChange(enabled)` (optional): the check turned itself off
    because it could not start when a session attached. `setEnabled` reports
    its own result instead, so this covers only the attach path, and it
    keeps the wheel's box honest.
  - `deps.every(ms, f)`: the status refresh timer (default `setInterval`).
- `SunCheckUi`:
  - `setEnabled(on)`, which resolves to the state actually reached;
  - `isEnabled()`;
  - `attach()` / `detach()`, which follow the AR session's life;
  - `dispose()`.
- `describeSunStatus(status)` and `describeSunMark(result, recorded)`: the
  texts, as pure functions.
- `SUN_SAFETY_NOTE`: the first-enable note (plan §4.3).

## Invariants & assumptions

- **The check runs only while it is enabled AND attached.** The toggle lives
  in the debug wheel, which exists before any AR session, but the check needs
  the session's scene. `detach()` disposes the controller and removes the
  panel.
- **Safety (owner default Q11).**
  - The note appears on the first enable per page and must be acknowledged.
    Declining keeps the check off.
  - A reminder stays on screen while the check runs.
  - The panel sits at the BOTTOM of the screen, because text at the top edge
    would pull the gaze up toward the sun.
- **The toast says where the CONTENT sits, not the sign of the error (owner
  default Q13).**
  - `h > 0` means the app's azimuths are too large. That draws the virtual
    sun, and all content with it, to the LEFT of true.
  - `v > 0` draws it LOW.
  - Errors below 0.05° read "on true heading" or "level".
  - The signed numbers are kept in the logged note.
- **Async UI (repo rule).**
  - A Mark disables the button, sets `aria-busy`, and changes the label to
    "Hold still… 1 s".
  - Every outcome (accepted, refused, or failed to record) restores the
    button.
  - A second tap while a Mark is running is ignored.
  - Refusals are warnings; a failed record or a failed start is an error.
- **Warnings keep the measurement** (high sun, target changed, alignment
  moving, and a low sun below 5°, where refraction dominates), but raise the
  toast's severity to a warning. The high-sun warning does not state the
  heading resolution that owner default Q6 asked for: no formula for it is
  implemented yet (a deviation, listed in the plan's §13c).
- The result types are named through `SunCheck`, because the framework keeps
  them unexported until an app imports them by name (see `sun-check.ts.md`).

## Example

```ts
const ui = createSunCheckUi({
  root,
  startCheck,
  confirmSafety,
  showToast,
  recordSighting,
});
await ui.setEnabled(true); // the wheel's box
ui.attach(); // after Enter-AR
```

## Tests

`sun-check-ui.test.ts` runs in jsdom against a stub controller. It covers:

- the texts and their signs, every refusal named, and warnings raising the
  severity;
- the safety note shown once per page, and declining it;
- the check starting only when enabled and attached, and disposed on detach
  and on disable;
- the status refresh;
- the Mark's in-progress state, and its restore on success, on a refusal,
  and on a failed record;
- the three-line history;
- a failed start;
- dispose.
