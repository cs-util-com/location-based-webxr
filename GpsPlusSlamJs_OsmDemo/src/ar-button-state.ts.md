# `ar-button-state.ts`

## Purpose

Derives the AR button's appearance from what is known about the device, the GPS
fix and the session — rather than toggling attributes at four call sites.

## Why it exists

**DEC-12: locate-me first, then an AR button that appears once GPS is live, and
the map STAYS.** That last clause is why this is a derivation rather than a copy
of the reference consumer's pattern, which is
`startArButton.hidden = !arSupported; simNote.hidden = arSupported`. Applied
literally here, **any WebXR-capable phone loses the map view** — the primary
interface, and today the only way to drive the data.

The button has four interacting inputs, and "supported but no fix yet" and
"unsupported" are different messages of which only one is temporary. Toggling
attributes imperatively is how a UI reaches a state nobody designed, and none of
it is reachable by a unit test once it lives in `main.ts`, which needs a DOM, a
map and a worker to construct.

## Public API

- `ArSupport` — `"checking" | "supported" | "unsupported"`.
- `ArButtonInputs` — `{ support, willLocateFirst, active }`.
- `ArButtonState` — `{ hidden, disabled, label, hint? }`.
- `arButtonState(inputs): ArButtonState` — pure.

## Invariants & assumptions

- **Precedence is deliberate: `active` first, then `unsupported`, then
  `willLocateFirst`.** A running session must always offer a way out, and waiting for a
  fix on a device that can never enter AR is a promise that will not be kept.
- **Hidden and disabled mean different things here, and the difference is
  whether the state resolves itself.**
  - `checking` → hidden. Resolves in milliseconds; a control that flickers
    disabled→enabled on every load is worse than one that appears once.
  - `unsupported` → hidden. No action the user can take, and a permanently
    greyed control advertises something they cannot have.
  - a press that will locate first → **visible and ENABLED**, with a hint.
    THIS WAS "visible but disabled" UNTIL ROUND THREE (G6, DEC-W2), and the
    argument for it was sound: the state is temporary and self-resolving, so the
    control has to be discoverable before it is usable. The outcome was still
    wrong. The thirteenth session met exactly that — a discoverable control that
    did nothing when discovered — and reported it as broken, because the
    explanation lived in `title`/`aria-label` and a phone shows neither. The
    press now performs the step it was waiting for, so there is nothing left to
    disable, and the hint became a promise ("finds your location first") rather
    than an excuse. **A test asserts NO reachable visible state is disabled**,
    because the plan first designed a disabled-but-tappable button that no input
    could have produced.
  - (historical, for the reader of the paragraph above) waiting for a fix →
    visible but disabled, with a hint. Temporary and
    self-resolving, so the button must be discoverable before it becomes
    usable — hidden until the fix lands, it appears without warning under the
    user's thumb.
- **The exit is never disabled**, including when support reports `unsupported`
  mid-session or the fix is lost. A disabled exit on a full-screen AR view reads
  as being trapped, and the Android back gesture is not discoverable enough to
  be the only way out.
- **This module says NOTHING about the map, and that is enforced.** It exposes
  no `showMap`/`hideMap` and a test asserts its whole surface stays that way, so
  the map cannot become a function of AR support by accident — which is exactly
  what copying the reference pattern would do.
- Pure. No DOM, no store, no session.

## Examples

```ts
const state = arButtonState({
  support,
  willLocateFirst: arPressAction(...).kind === "locate",
  active,
});
button.hidden = state.hidden;
button.disabled = state.disabled;
button.textContent = state.label;
if (state.hint !== undefined) button.title = state.hint;
```

## Tests

`ar-button-state.test.ts` — each state and why it is hidden rather than
disabled or the reverse; the exit staying enabled under every hostile input
(including support flipping to `unsupported` mid-session and the fix being
lost); and two exhaustive sweeps over all twelve input combinations — one
asserting the module never grows a map-visibility field, one asserting no
combination renders a blank label.
