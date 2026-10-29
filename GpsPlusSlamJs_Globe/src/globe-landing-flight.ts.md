# globe-landing-flight.ts

- Purpose: the approach's landing, the pin's flight down to a place from
  the camera as it is: the fixed dive and the continuous flight
  (`/globe/pin-flight.ts`), its place, its ground and the relief's
  revisions of it. Moved out of the globe lab's pin (`bindPin`) as a pure
  refactor (editor-on-the-full-globe plan, the approach slice); the pin's
  button, phases and lines stay in the lab.
- Public API: `createGlobeLandingFlight({ approach, ellipsoid, controls,
ecefCamera, placeCameraEcef, resetSpeed, groundOf, drawnGroundM,
reliefGroundM, diveFloorM, now? })`:
  - `located`, `locate(place)`: the flight's place (a copy), or null;
  - `fly(place | null, params, { fromAltitudeM? })`: releases the
    controls and presses the pin flight (`pressPin`) from the camera, to
    `place` if known, landing `landAglM` above its read ground as drawn;
    with `fromAltitudeM` the camera is placed out there first (on the
    meteor's line for a link with `meteorDeg` below 90, else along its own
    direction) and the speed dust reset;
  - `aim()`: the located place named to the approach (`aimPin`), the
    flight on to it (`pinFix`) and its ground read (`groundOf`), the
    flight replanned onto that ground (`pinGround`) if it still flies
    there;
  - `dive(params, clock)`: the fixed dive to the located place, down to
    `max(landKm km, diveFloorM(place))` over `diveMs` on `clock`;
  - `followGround(progress)`: per frame, the pace on `progress()` (read
    only while a pin flight runs) and the relief's revision
    (`groundRevisionM`), counted when the flight took it;
  - `flightState()`: the lab's `pin.state().flight`, null without one.
- Invariants & assumptions:
  - The camera is placed before the flight is pressed, so no frame shows
    the intro's camera first; a placement is never read as a speed.
  - `aim`, `dive` and `followGround` do nothing before `locate`.
  - `ecefCamera()` returns a fresh copy (the lab's `ecefPoseOf`).
  - `pressPin`, `pinFix` and `pinGround` throw `RangeError` on a time or
    ground that is not finite, as before.
- Example:
  ```ts
  const landing = createGlobeLandingFlight({ approach: flight, ellipsoid, ... });
  landing.locate(place);
  landing.dive(params, arrival.start(place, params));
  ```
- Tests: `globe-landing-flight.test.ts` (a recording approach with the
  real `pressPin` flights: the call order of each start, the meteor's
  start, the ground read and a stale or unread one dropped, the dive's
  options and the camera's orbit pose, a revision taken and one not
  taken, the state).
