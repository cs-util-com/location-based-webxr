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
 *
 * **DELIBERATELY NOT DOUBLED WITH THE FALL (DEC-L2).** When the seventeenth
 * session asked for the whole animation to take twice as long, the literal
 * reading was 4 s + 8 s. A motionless picture is precisely the ambiguity the
 * waiting line (DEC-J11) exists to cover, so the extra six seconds would have
 * bought the worst kind of time; all of it went into the fall instead.
 */
export const DESCENT_HOLD_S = 2;

/**
 * How long the fall itself takes, from the starting height to zero.
 *
 * **4 → 10 BY DEC-L2 (2026-08-23), from a field session that watched the 6 s
 * total on a phone and asked for double.** The reason is not only that it looks
 * better: the auto-elevation correction glides in at `AUTO_APPLY_RATE_M_PER_S`
 * (1.5 m/s), so a 10 m residual takes ~6.7 s from the moment the estimator
 * engages. Against a 6 s animation that correction landed AFTER the veil was
 * gone and was visible as late movement; a 12 s animation is long enough to
 * hide it in the common case.
 *
 * ⚠️ **It does not GUARANTEE that.** The 6.7 s runs from engagement, not from
 * the first frame, and how long engagement takes while standing still has never
 * been measured — the open question in
 * `2026-08-21-1120-ar-entry-gate-fallback-may-be-the-normal-path-followup.md`,
 * which this change improves the odds of and does not settle.
 *
 * **`entryVeilAlpha` runs on this same clock**, so the sphere and the fly-in
 * cannot drift apart. It no longer tracks this animation's PROGRESS, though
 * (DEC-M3): it holds at fully opaque until `DESCENT_HOLD_S + DESCENT_FALL_S`
 * and fades only afterwards, because the field session's point was that the
 * camera coming in before the city has arrived shows two unrelated pictures.
 * Lengthening the fall therefore lengthens the opaque period rather than
 * stretching a fade.
 */
export const DESCENT_FALL_S = 10;

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
 * 10 m residual takes 6.7 s.
 *
 * **DEC-L2 CHANGED THE COMPARISON, not the conclusion.** Against the 6 s
 * descent this paragraph was written for, that correction outlasted the whole
 * animation; against 12 s a 10 m residual now fits inside it. It is still not
 * settled: the 6.7 s runs from ENGAGEMENT, so on this fallback path — descent
 * from `firstFrame + 3 s`, landing at `firstFrame + 15 s` — the correction is
 * hidden only if the estimator engages within ~8.3 s of the first frame, and a
 * 20 m residual outlasts the animation at any engagement time. Filed with the
 * arithmetic and the field measurement to take, in
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
