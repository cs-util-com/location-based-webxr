/**
 * The AR entry fly-down (H5, round four Q5).
 *
 * "Dass man dann im AR-Modus erstmal auf der gleichen Kamerahöhe startet, wie
 * man in der 3D-Szene gerade war ... und dann so nach ein paar Sekunden fängt er
 * dann an langsam runterzufaden ... fliegt dann, bis sie irgendwann bei 0 ist."
 *
 * Pure on purpose, like `elevation-nudge.ts` and `map-zoom-to-camera.ts`: the
 * curve is the part worth testing, and it should be testable without a session,
 * a renderer or a clock.
 *
 * **THE DESCENT IS A THIRD TERM IN THE ELEVATION COMPOSITION, never a write to
 * the shared field.** `applyElevation` SETS rather than accumulates, and the
 * frame loop re-applies the composition whenever the eased auto value moves — so
 * a descent written the obvious way is CLOBBERED within a frame or two rather
 * than merely contended with. `composeElevationM(auto, trim, descent)` is what
 * makes the two compose instead of fight.
 *
 * @see ar-descent.ts.md
 */

/**
 * How long the view holds at the starting height before falling.
 *
 * The request says "nach ein paar Sekunden". The hold is what makes the descent
 * legible as a deliberate move rather than a slow load: without it the scene is
 * already falling before a user has looked up from the button they pressed.
 */
export const DESCENT_HOLD_S = 2;

/** How long the fall itself takes, from the starting height to zero. */
export const DESCENT_FALL_S = 4;

/**
 * The largest height the descent will start from.
 *
 * A bound rather than free travel, for the same reason `NUDGE_LIMIT_M` is
 * bounded: the 3D view can be zoomed to a kilometre, and starting the AR session
 * a kilometre up means the user is looking at nothing, cannot tell the session
 * from a failed load, and has no control that brings it back quickly.
 *
 * **AT OR BELOW `NUDGE_LIMIT_M`, and that is a real constraint rather than a
 * coincidence — it was 120 against a nudge reach of 100 until a test caught
 * it.** If the descent may begin above what the manual nudge can reach, an
 * INTERRUPTED descent leaves the user unable to walk the scene back UP by
 * hand — the city is left low, not high (DEC-Y14 inverted the frame; the
 * constraint is unchanged because `NUDGE_LIMIT_M` is symmetric): exactly the unrecoverable state the nudge's own limit exists to
 * prevent, arriving by a route that limit was not written for. The relationship
 * is asserted in `elevation-nudge.test.ts`.
 *
 * An automatic move gets the tighter bound of the two, deliberately: the user
 * did not ask for this height and has not been given a reason to expect it.
 */
export const DESCENT_MAX_START_M = 100;

/** Smoothstep — zero slope at both ends, so neither the start nor the landing steps. */
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

export interface DescentInput {
  /** Seconds since the descent began. */
  readonly elapsedS: number;
  /** Height the session started at, metres above the final position. */
  readonly startM: number;
}

/**
 * The descent's contribution to the elevation composition, metres.
 *
 * **`-startM`** at `elapsedS <= DESCENT_HOLD_S`, easing to exactly `0` at
 * `DESCENT_HOLD_S + DESCENT_FALL_S` and staying there. The return is NEGATIVE
 * or zero: the city sits BELOW the user and rises to meet them (DEC-Y14), while
 * `startM` itself stays a positive height. See the body for why the frame is
 * converted here rather than at the call sites.
 *
 * **Every non-finite or negative input collapses to 0**, i.e. to "no descent",
 * rather than propagating: this value is added to the elevation the city is
 * drawn at, and a `NaN` there puts the whole scene at an undefined position with
 * no error raised anywhere — the failure would look like "AR is empty", which is
 * indistinguishable from half a dozen other causes.
 */
export function descentOffsetM(input: DescentInput): number {
  const { elapsedS, startM } = input;
  if (!Number.isFinite(elapsedS) || !Number.isFinite(startM)) return 0;
  const start = Math.min(DESCENT_MAX_START_M, Math.max(0, startM));
  if (start === 0) return 0;
  // NEGATIVE, and that is the whole point (DEC-Y14). `applyElevation` writes
  // `up: geometricOffset.up + offsetM`, so a POSITIVE term raises the city over
  // the user's head — which is what r541 shipped and what the field reported as
  // "genau falsch rum". The intent is that the CAMERA starts high; since the XR
  // camera is the device pose and cannot be moved, the world is moved instead,
  // and a camera at +H above the world is the world at −H below the camera.
  //
  // `startM` stays a POSITIVE height in the API — the caller passes the height
  // it was looking from, and the frame conversion happens here, once.
  if (elapsedS <= DESCENT_HOLD_S) return -start;
  const t = (elapsedS - DESCENT_HOLD_S) / DESCENT_FALL_S;
  if (t >= 1) return 0;
  return -start * (1 - smoothstep(t));
}

/**
 * The camera feed's opacity while the descent runs, `[0,1]`.
 *
 * 0 = the passthrough is fully hidden (the view looks like the desktop 3D
 * scene); 1 = the camera is fully visible. Driven by the same clock as the
 * descent so the two cannot drift apart.
 *
 * **Rendered via `renderer.setClearAlpha`, not a backdrop mesh** (DEC-Y3): AR
 * entry sets `scene.background = null`, and on that path the clear uses the
 * renderer's own `clearColor`/`clearAlpha`, both animatable, with the framework's
 * renderer already built `alpha: true`. One number, no geometry, no render-order
 * discipline, and no risk of a backdrop occluding content. A backdrop mesh is
 * the fallback if this is found not to composite as expected on device; both
 * fail identically on an additive-blend display, so that caveat does not choose
 * between them.
 */
export function cameraFadeAlpha(input: DescentInput): number {
  const offset = descentOffsetM(input);
  const start = Math.min(DESCENT_MAX_START_M, Math.max(0, input.startM));
  if (!Number.isFinite(start) || start <= 0) return 1;
  // Proportional to how far the descent has come, so the camera is fully
  // visible exactly when the scene lands.
  //
  // MAGNITUDE, not the signed value (DEC-Y14). The offset is negative — the
  // city rises from below — and dividing the signed value here would make
  // `remaining` negative, `1 − remaining` exceed 1, and the clamp below pin the
  // alpha at 1 for the whole descent: the camera fully visible from the first
  // frame, with the fade silently gone. That is the invisible bug a bare sign
  // flip would have traded the visible one for.
  const remaining = Math.abs(offset) / start;
  return Math.min(1, Math.max(0, 1 - remaining));
}

/**
 * Whether the descent has finished.
 *
 * **The visible end-state signal the plan requires** (§5): a descent that stalls
 * is otherwise indistinguishable from the recorded "flying roughly 50 m above
 * the OSM buildings" datum bug, and that ambiguity is what would make a field
 * report unactionable. A caller uses this to say so on screen.
 */
export function descentComplete(input: DescentInput): boolean {
  return descentOffsetM(input) === 0;
}

/**
 * How long the entry waits for the elevation estimate before giving up on it.
 *
 * A FALLBACK, NOT A BUDGET. The estimator needs a depth frame and a DEM sample,
 * and on a device that supplies neither it never engages at all — so a wait with
 * no ceiling is a black screen with no way out, which is a worse failure than
 * the jump this gate exists to remove.
 *
 * **THREE SECONDS IS A GUESS, and it may well be too short.** The estimator
 * engages at `AUTO_ENGAGE_CONFIDENCE`, and its confidence is built from depth
 * observations that need MOTION -- `ar-mode.test.ts` reaches an engaged state
 * only by walking for ~5 s, and a user entering AR is standing still. If that
 * is representative, this fallback is the NORMAL path rather than the
 * exception, and the correction then arrives through the ease at 1.5 m/s: a
 * 10 m residual takes 6.7 s against a 6 s descent, so it lands mid-descent and
 * outlasts it. Filed with the arithmetic and the field measurement to take, in
 * `2026-08-21-1120-ar-entry-gate-fallback-may-be-the-normal-path-followup.md`.
 *
 * It is NOT raised speculatively: a longer black screen is a real cost, and
 * without the engagement distribution any other value is the same guess.
 */
export const DESCENT_ESTIMATE_WAIT_S = 3;

export interface DescentStartGate {
  /** Seconds since the session's first frame. */
  readonly waitedS: number;
  /**
   * Whether the elevation estimator has produced an ENGAGED value.
   *
   * Engaged, not merely present: an unengaged estimate contributes zero to the
   * composition, so starting on one would start on the same 0 the jump comes
   * from.
   */
  readonly estimateReady: boolean;
}

/**
 * Whether the entry descent may begin.
 *
 * **THE JUMP THIS REMOVES** (r543 field report): "das erste Mal ... starte ich
 * bei Altitude null ... wodurch ich dann erstmal sehr weit unter der Open Street
 * Map Welt bin und dann wird meine Altitude gefixt, so dass ich dann auf einmal
 * über die OSM Welt springe". The descent used to start on the first frame,
 * when the auto elevation term is still 0 because no estimate has arrived. The
 * city was therefore placed by an uncorrected datum, and the correction landed
 * mid-descent as a jump. The second entry looked fine because the estimate was
 * already warm.
 *
 * **Non-finite `waitedS` collapses to "not yet"**, never to "go": a `NaN` clock
 * reading that started the descent would place the city from the same zeroed
 * estimate this gate exists to wait for, i.e. it would fail back into precisely
 * the reported bug.
 */
export function descentMayStart(gate: DescentStartGate): boolean {
  if (gate.estimateReady) return true;
  return (
    Number.isFinite(gate.waitedS) && gate.waitedS >= DESCENT_ESTIMATE_WAIT_S
  );
}
