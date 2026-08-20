# `ar-experiment-panel.ts`

## Purpose

The AR gear panel: five controls for the experimental compass mechanisms, so the
trade is measured on a street rather than argued in a document (DEC-Y10, round
four Q2 step 5).

## Public API

- `createArExperimentPanel({ root, initial?, onChange }): ArExperimentPanel`
- `ArExperimentPanel` — `attach()`, `values()`, `dispose()`, all idempotent.
- `onChange(experiments)` is called with the **whole** `CompassExperiments`
  object on any single change.

## The five controls, and what each reaches

- **permanent compass** → `useCompassRotationPrior`. The master switch. Off
  falls back to the **validated** Stage 0 the RecorderApp ships — and
  `compass-influence.ts` flips `coldStartOverrideEnabled` back on for exactly
  that reason, or "off" would mean "no compass at all" rather than "the
  baseline".
- **trust gate** → `compassTrustGateMode`, `off | binary | ramp`.
- **pair re-solve** → `useCompassPairSelection`. An unvalidated re-solve of the
  alignment on compass-weighted pairs; library default OFF.
- **trust tolerance °** → `compassTrustAgreeToleranceDeg`, `8 | 15 | 25`. Only
  the values the 2026-08-20 census swept: 8 is the library and RecorderApp
  default (trust latches on 55 of 81 corpus recordings), 15 is what this demo
  ships (64 of 81), 25 is the widest measured arm (74 of 81). A value outside
  that set would have no baseline to be read against.
  - **The 25 arm is labelled `25 (no dead band)` in the dropdown**, because it
    is above the library's default `compassTrustDropToleranceDeg` of 20 and this
    demo never sets that. There, every sample within 25° agrees (so trust is
    never lost — the corpus's compass-vs-GPS offsets span −4.3…+18.8°, all
    inside 25°) and any real disagreement is also outside 20° (so trust drops at
    once), which makes the `ramp` gate's HOLD branch unreachable. The arm is
    kept rather than replaced so the census baseline still applies; the label is
    what stops a panel built to COMPARE trust gating from silently offering an
    arm with the gating switched off. The annotation lives only in the option's
    text — the `value` stays bare so `Number.parseInt` still round-trips it.
    Background: `GpsPlusSlamJs_Docs/docs/2026-08-20-2015-agree-tolerance-can-invert-the-trust-dead-band-followup.md`.
- **compass health gate** → `requireCompassWebXRConsistency`.

Labelled by what they do, not by their config-field names: this is read outdoors
on a phone, where `useCompassPairSelection` means nothing.

## Invariants & assumptions

- **Closed on attach**, and that is arithmetic rather than taste. At 390 px the
  elevation control is ~149 px with round-four's tap targets and the compass
  slider already exceeds its own width; five always-visible controls against a
  camera feed is a layout that does not exist.
- **It closes itself on a change.** A control here is changed in order to look
  at the buildings, so a panel still covering them defeats the purpose — which
  is exactly what G9 reported about the compass slider sitting in the middle of
  the view.
- **One callback carrying everything**, never per-control deltas:
  `compassSettingsFor` consumes the whole set, and a partial update would leave
  the store describing a mixture of two configurations.
- **The panel opens UPWARD and is absolutely positioned.** The gear sits at the
  bottom of the screen, so a downward panel would be off it; and a panel that
  reflowed the row would move the slider out from under the thumb that just
  pressed the gear.
- **The gear carries an `aria-label` and `aria-controls`.** `#ar-root` is not
  inert (r510 review), so a bare glyph button would announce as "button, gear".
- Each panel instance gets a unique `id` for its body, so two live panels cannot
  collide on `aria-controls`.

## What this panel does NOT do

It does not dispatch. `ar-mode.ts` routes a change back through the compass
control's `republish()`, because `compassSettingsFor` maps the influence **and**
the experiments together — publishing the experiments alone would send the store
a weight nobody chose.

## Tests

`ar-experiment-panel.test.ts` (jsdom):

- closed on attach, opens and closes on the gear;
- the accessible name and the `aria-controls` pairing;
- **closes itself on a control change** — the property with a recorded defect
  behind it;
- reports every control's value on any single change;
- the gate modes and tolerances are exactly the sets above, starting at what the
  demo ships rather than at the library default;
- dispose releases the DOM and is idempotent.

Layout is covered by the 390 px AR-overlay e2e in `boot-and-shell.spec.js`,
which builds the real class names against the real CSS and asserts the two-row
stack fits and clears the toast band.
