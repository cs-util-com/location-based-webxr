# globe-pin.ts - the globe's pin button

- Purpose: round-2 plan 2026-09-26-2055 M3g (DEC-FB2-2/3). The phases and
  labels of the button that finds the user and flies the globe down to them,
  landing in the globe's own city; pure, so CLAUDE.md's async-feedback rule
  is tested without a browser. The failure's words come from the
  framework's `utils/locate-state.ts` (`labelFor`, `locateAdvice`); the lab
  joins the two (this package does not depend on the framework). It used to
  hand over to the OSM demo's city in its own page; that hand-over was
  removed (globe city plan 2026-10-05-0040 §12.5 C6, the owner's D-K3), and
  with it the `handingOver` phase and the `arrived` and `returned` events.
- Public API:
  - `GLOBE_PIN_PHASES`: `idle`, `locating`, `flying`.
  - `GLOBE_PIN_EVENTS`: `press` (the pin), `touch` (the controls took the
    camera), `located`, `failed`, `held` (the dive landed: its only end).
  - `nextPinPhase(phase, event)`:
    - idle + press -> locating;
    - locating + located -> flying; + failed -> idle; + press -> idle (a
      tap cancels the wait: `locateOnce` can stay pending while a
      permission prompt is open); a touch on the globe changes nothing (the
      fix still flies);
    - flying + press or touch -> idle (the flight stops, the controls keep
      the camera); + held -> idle (landed, pressable again);
    - anything else leaves the phase as it is, so a late fix or landing
      after a cancel starts nothing.
  - `globePinView(phase)` -> `{ label, disabled, busy }`: "Fly to my
    location" (enabled), "Finding you... - tap to cancel" (enabled, busy),
    "Flying to you - tap to stop" (enabled, busy). No phase is disabled.
  - Both take `{ moving }` (`PinOptions`): with the continuous flight
    (`flight=2`, continuous-flight plan 2026-10-07-0941 CF3, cold review
    finding 8) the camera moves from the press, holding above the band
    while the fix is found, so a touch cancels while locating too (-> idle),
    and the label reads "Finding you, descending - tap to cancel". Without
    it, today's dive keeps its rule until the switch's default changes.
- Label choice: "Finding you..." rather than OsmDemo's "locating…"
  (`labelFor`): the globe's pin shows its phase as visible text in a
  status line (OsmDemo's icon button keeps its words in `aria-label`), and
  the round-2 plan named this text; the failures reuse OsmDemo's labels and
  add the framework's `locateAdvice`.
- Tests: `globe-pin.test.ts` - the granted path ending in the landing; a
  failure back to idle; a press cancels the wait; a press and a touch stop
  the flight; a touch while locating does not cancel; every phase can
  return to idle; late events after a cancel change nothing; any event
  sequence stays in the known phases (fast-check); every phase its own
  label; the locating and flying views; never disabled. The test file's
  header lists the hand-over tests that were deleted and what replaced
  each.
