# globe-city-step.ts

- Purpose: the globe city's per-frame step (globe city plan
  2026-10-05-0040 §12.5 C4): which place to load and when, the retry of a
  failed build, the fade by altitude, the flight's warm-up, and the gates
  the lab's test hooks read. Moved out of the globe lab's frame loop
  (`labs/globe/globe-lab.js`) as a pure refactor (editor-on-the-full-globe
  plan `2026-10-27-1850-editor-on-the-full-globe-plan.md`, primary repo,
  the city slice).
- Public API:
  - `GLOBE_CITY_RETRY` `{ afterMs: 10000, times: 3 }` (frozen): a failed
    build is asked for again after 10 s, three loads at most (r790
    milestone review F6).
  - `createGlobeCityStep({ city, now? })` (`city` a `GlobeCity`'s `load`,
    `setFade` and `state`; `now` the retry's clock, default
    `performance.now`) returns a `GlobeCityStep`:
    - `step(frame)`, a `GlobeCityFrame` of `place`, `arrival`,
      `altitudeM`, `topM`, `zoom` and `law`: loads `place`
      (`city.load(place, { zoom })`) when it is not the place last asked
      for, no warm-up runs (`arrival` with a null `outcome`), the ground
      is at true heights (`exaggerationAt(0, law) === 1`) and the city is
      wanted (a flight, `arrival` set, or the camera below `topM`); then
      sets the fade: `cityShareAt(altitudeM, topM)` where the relief is at
      true heights at the camera's altitude now, else 0 (R14, review F8);
    - `warmUp(target, { zoom, law })`: the flight's warm-up, a fresh load
      (`{ zoom, fresh: true }`) where the ground is at true heights, else
      null;
    - `gate()`: `idle` (not asked for yet), `ended` (every stage and retry
      done), `gave-up` (the load `unavailable`, or failed with every try
      spent) or `loading`;
    - `ready()`: no load running and the shown share within 1e-3 of the
      asked fade (the view's readiness).
- Invariants & assumptions:
  - Nothing is downloaded from orbit without a flight, nothing twice for
    one place (a load of a place that runs or ran is the same load), and
    nothing where the relief stands exaggerated on the ground.
  - The retry: a failure of the asked place is timed from the first frame
    that sees it; once the pause has passed (strictly more than `afterMs`)
    and fewer than `times` loads were made for the place, the place is
    forgotten so the same frame asks again. **Kept from the lab as it
    was:** when the retry falls due in a frame that does not want the
    city (above `topM` without a flight), the place is forgotten without
    a load, and the next frame counts the tries from 0 again, so the cap
    can be passed that way (`globe-city-step.test.ts` pins it). Changing
    it is a behaviour change, not part of the move.
  - Every frame reads `city.state()` once and the clock once, whatever
    the branch, as the lab did.
  - The fade follows the frame's load in the frame (the order the lab
    called them).
- Example (the lab's frame loop):

  ```ts
  const { located, arrival } = pin.state();
  cityStep.step({
    place: located ?? params.url,
    arrival,
    altitudeM,
    topM: params.cityKm * 1000,
    zoom: reliefGlobalZoom,
    law: heightLaw(),
  });
  ```

- Tests: `globe-city-step.test.ts` (a recording fake city and a clock:
  when a place loads and when not, the retry's pause and cap, the kept
  reset of the tries, the fade by altitude and height law, the warm-up,
  the gate and the readiness). The city's look is the design system's
  city smokes.
