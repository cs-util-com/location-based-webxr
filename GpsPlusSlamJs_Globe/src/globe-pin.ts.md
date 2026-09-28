# globe-pin.ts - the globe's pin button

- Purpose: round-2 plan 2026-09-26-2055 M3g (DEC-FB2-2/3). The phases and
  labels of the button that finds the user, flies the globe down to them and
  hands over to the OSM demo's city; pure, so CLAUDE.md's async-feedback
  rule is tested without a browser. The failure's words come from the
  framework's `utils/locate-state.ts` (`labelFor`, `locateAdvice`); the lab
  joins the two (this package does not depend on the framework).
- Public API:
  - `GLOBE_PIN_PHASES`: `idle`, `locating`, `flying`, `handingOver`.
  - `GLOBE_PIN_EVENTS`: `press` (the pin), `touch` (the controls took the
    camera), `located`, `failed`, `arrived` (the dive reached the hand-over
    altitude), `held` (the dive ended with the lab's hand-over off).
  - `nextPinPhase(phase, event)`:
    - idle + press -> locating;
    - locating + located -> flying; + failed -> idle; + press -> idle (a
      tap cancels the wait: `locateOnce` can stay pending while a
      permission prompt is open); a touch on the globe changes nothing (the
      fix still flies);
    - flying + press or touch -> idle (the flight stops, the controls keep
      the camera); + arrived -> handingOver; + held -> idle;
    - handingOver: terminal, the page is leaving;
    - anything else leaves the phase as it is, so a late fix or arrival after
      a cancel starts nothing.
  - `globePinView(phase)` -> `{ label, disabled, busy }`: "Fly to my
    location" (enabled), "Finding you... - tap to cancel" (enabled, busy), "Flying to you -
    tap to stop" (enabled, busy), "Opening the city..." (disabled, busy).
- Label choice: "Finding you..." rather than OsmDemo's "locating…"
  (`labelFor`): the globe's pin shows its phase as visible text in a
  status line (OsmDemo's icon button keeps its words in `aria-label`), and
  the round-2 plan named this text; the failures reuse OsmDemo's labels and
  add the framework's `locateAdvice`.
- Tests: `globe-pin.test.ts` - the granted path; a held dive back to idle; a failure back to idle; a
  press cancels the wait; a press and a touch stop the flight;
  a touch while locating does not cancel; handing over is terminal; late
  events after a cancel change nothing; any event sequence stays in the
  known phases (fast-check); every phase its own label; the locating,
  flying, idle and handing-over views.
