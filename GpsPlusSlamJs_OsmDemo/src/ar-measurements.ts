/**
 * What AR mode reports about itself — the numbers, formatted.
 *
 * **WHY MILESTONE 4 NEEDS AN INSTRUMENT BEFORE IT NEEDS A MEASUREMENT.** §4
 * makes four predictions ("GPS fix quality, not rendering, is the binding
 * constraint"; "the Y-baseline jump will be visible"; "nothing will z-fight";
 * "the alignment will look good enough to be pleasant and not good enough to
 * measure") and the plan is explicit that they are stated so they can be wrong
 * in public. None of them can be checked from a desk: they need a phone, in a
 * street, showing its own numbers.
 *
 * The desktop status line already reports draw cost — and it reports
 * `BuildingView`'s renderer, which is **not the one AR draws with**. The
 * framework's session builds a second `WebGLRenderer`, and `renderer.info` is
 * per-renderer, so the number on screen during a session would describe a
 * renderer that is not producing the frames. The plan names this outright:
 * "Needs a draw-cost readout on the AR renderer, which does not exist."
 *
 * **PURE, for the same reason `draw-cost.ts` is**: `renderer.info` needs a
 * `WebGLRenderer`, so the values come from the caller and the SENTENCE is built
 * here, where it can be pinned without a GPU.
 *
 * @see ar-measurements.ts.md
 */

import { describeDrawCost, type DrawCost } from "./draw-cost.js";

/**
 * The widest a HUD line may be before it wraps on a 390 px phone.
 *
 * Characters rather than pixels, deliberately: the readout is a monospace-ish
 * run of short tokens at 0.9 rem, and a pixel measurement here would be the
 * load-sensitive kind of assertion this repo has spent two sessions removing
 * from its gates.
 */
const MAX_LINE_CHARS = 40;

/**
 * Two readouts on one line, or whichever one exists (Q7).
 *
 * **Not an all-or-nothing group**, and that is the whole reason this is a
 * function rather than a template literal at each site: the halves of a pair
 * become available at different times — fps from the first frame, the draw cost
 * only once something has rendered — so joining them unconditionally would blank
 * a number that is already known while it waits for a partner.
 *
 * `·` rather than a comma because both halves are independent quantities rather
 * than items in a list, and a middle dot survives being read at arm's length
 * against a camera feed better than punctuation that sits on the baseline.
 */
function pair(left: string, right: string): string[] {
  if (left === "") return right === "" ? [] : [right];
  if (right === "") return [left];
  const merged = `${left} · ${right}`;
  // FALLS BACK TO TWO LINES RATHER THAN OVERFLOWING (PR #333 review). The height
  // pair carries an optional `± N m` accuracy suffix that phones routinely
  // report, and with it the merged line reaches 43 characters against a budget
  // of 40 — so the ordinary case, not an extreme, wrapped on a 390 px screen.
  //
  // Wrapping is worse than not pairing: a merged line that wraps costs the same
  // two rows AND loses the alignment that made the pair readable. Pairing is an
  // optimisation, so it declines when it would not pay.
  return merged.length <= MAX_LINE_CHARS ? [merged] : [left, right];
}

/** Everything the AR readout can show. Every field optional and independent. */
export interface ArMeasurements {
  /** From the AR renderer's `info.render` — NOT the desktop view's. */
  readonly drawCost?: DrawCost | undefined;
  /**
   * Frames per second, AVERAGED over the sampling window.
   *
   * The average is the caller's job and it is not optional. A single frame's
   * `1/dt` spikes routinely on a phone — GC, a worker message, the terrain
   * field landing — so at a 2 Hz readout the reciprocal of one arbitrary frame
   * out of thirty flickers between plausible and alarming with no way to tell a
   * sustained drop from a hiccup. Telling those apart is exactly what §4's "is
   * rendering the constraint?" question needs.
   */
  readonly fps?: number | undefined;
  /** The last fix's reported horizontal accuracy, metres. */
  readonly fixAccuracyM?: number | undefined;
  /** How far the user is from where the session was anchored, metres. */
  readonly metresFromAnchor?: number | undefined;
  /**
   * The alignment's vertical term — `arWorldGroup.matrix[13]`, metres.
   *
   * **THE AXIS BOTH OPEN QUESTIONS LIVE ON** (r510 review). §4 predicts "the
   * Y-baseline jump will be visible" and names this element as the term that
   * causes it; §2.5 asks how the DEM relief and the session's own ground-plane
   * estimate blend. Neither is answerable from a photograph, and neither was
   * answerable at all until this number was on screen — a milestone called
   * "measure, then choose" that could not see the axis its own predictions are
   * about would have shipped an instrument with a hole in it.
   */
  readonly worldBaselineY?: number | undefined;
  /**
   * The last fix's REPORTED altitude, metres — raw, before any alignment.
   *
   * **On screen because the height residual is not diagnosable without it.** The
   * field report is a ~10 m offset, repeatable across reloads, and two filed
   * defects already account for it — including a library one where the vertical
   * solve needs a single pair, runs no outlier rejection, and weights at
   * `1/accuracy⁵`, so one bad fix owns `worldBaselineY`. With only the aligned
   * baseline visible, "the GPS altitude is wrong" and "the solve mishandled a
   * good altitude" look identical. This is the term that separates them, and the
   * findings doc that diagnosed the residual ranked showing it **ahead** of the
   * manual offset buttons for exactly that reason.
   */
  readonly altitudeM?: number | undefined;
  /** The fix's reported VERTICAL accuracy, metres. Often absent. */
  readonly altitudeAccuracyM?: number | undefined;
  /**
   * The camera's height above the floor plane, metres — its `y` in the WebXR
   * `local-floor` reference space.
   *
   * **The only quantity on this readout that answers "how high am I holding
   * the phone".** `gps-dem` cannot: it is GPS altitude minus DEM and no pose
   * reaches it. `alt - worldBaselineY` cannot either: `alt` carries the same
   * +/-10-20 m GNSS vertical noise, and `worldBaselineY` is the AR ORIGIN, which
   * moves only when the alignment is re-solved.
   *
   * Absent before the first pose. A zero here would claim the phone is on the
   * ground.
   */
  readonly cameraHeightM?: number | undefined;
  /**
   * The DEM height under the user, **ellipsoidal** metres (DEC-H1).
   *
   * Already comparable to {@link altitudeM} with no conversion at the call
   * site: in AR the terrain field is sampled with
   * `absoluteDatum: { undulationMetres: N }`, so `heightAt` returns
   * orthometric + `N` rather than relief.
   *
   * **A PROXY FOR WHAT THE BUILDINGS STAND ON, NOT THE SAME THING.** The
   * buildings were extruded against the field the WORKER held at mesh-build
   * time, baked into vertices; this is the main thread's current field. They are
   * normally identical and can diverge — that divergence is the class
   * `worker/terrain-gate.ts` exists to prevent. Labelled `terrain`, never
   * "building ground", for that reason.
   */
  readonly terrainHeightM?: number | undefined;
  /**
   * Which DEM composition produced {@link terrainHeightM} — e.g.
   * `mapterhorn+terrarium`, the worker provider's own `sourceId`.
   *
   * **COMPOSED, NOT PER-SAMPLE.** The `ElevationProvider` seam returns heights
   * with no per-position provenance, so this names the composition that was
   * asked, never which member answered a given post — the honest claim, and
   * the one that makes a screenshot checkable against the right upstream at
   * the right resolution (national LiDAR and ~30 m SRTM differ by an order of
   * magnitude, so "which DEM" changes what counts as a residual).
   */
  readonly demSourceId?: string | undefined;
  /**
   * Which member of the composition actually served, as position counts —
   * the worker's snapshot of the provider's cumulative serving stats.
   *
   * **THE HALF {@link demSourceId} CANNOT SAY.** The composed id names what
   * was asked; these counters say what answered, which is what lets a field
   * session tell "this walk stood on national LiDAR" from "everything
   * quietly fell back to ~30 m SRTM" — the residuals against those two
   * differ by an order of magnitude. Rendered as the primary's share of
   * answered posts on the terrain line; absent keeps the composed-id-only
   * behaviour.
   */
  readonly demStats?:
    | {
        /** `sourceId` of the source the CURRENT field came from. */
        readonly servedBy: string;
        /** How many batches have been upgraded to the preferred source. */
        readonly upgrades: number;
      }
    | undefined;
  /**
   * Whether the DEM actually loaded.
   *
   * **THE MOST IMPORTANT FLAG IN THIS INTERFACE.** `heightfieldFrom` returns a
   * sampler that is **flat zero** when `hasData` is false, so a failed terrain
   * load renders as a perfectly plausible `0.0 m` — and then a residual against
   * it reads as a confident hundred-metre error. False suppresses both the
   * height and the residual and says `no DEM` instead.
   */
  readonly terrainHasData?: boolean | undefined;
  /**
   * The automatic elevation offset the estimator currently publishes, metres —
   * `baseline + robust(floor − DEM)`, from `ar-elevation-auto.ts`.
   *
   * **PUBLISHED, NOT NECESSARILY APPLIED** — {@link autoEngaged} is what says
   * whether the content actually carries it.
   *
   * **THE OTHER HALF OF THE PAIR {@link terrainHeightM}'s residual opens.**
   * `above terrain` is the RAW GPS-vs-DEM residual and is untouched by the
   * offset; this line is the estimator's view of the same axis. Their
   * difference exposes the fused-vertical error live — and once auto engages,
   * the city can look right while `above terrain` still reads +7 m, which is
   * why both are on screen and which line means what is worth stating in the
   * field protocol.
   *
   * Absent whenever the estimator publishes nothing (cold start, kill switch,
   * no alignment) — never rendered as `+0.0 m`, per this module's one rule.
   */
  readonly autoOffsetM?: number | undefined;
  /** The estimator's confidence in {@link autoOffsetM}, 0..1. */
  readonly autoConfidence?: number | undefined;
  /**
   * Whether {@link autoOffsetM} is actually APPLIED to the content — the
   * demo's confidence gate (`ar-elevation-auto.ts`, cold-review F1).
   *
   * False renders as `low` (or `not applied` with no confidence to qualify),
   * because the alternative is a readout that shows a correction the city
   * never received and reads as the feature silently failing. Undefined makes
   * no claim either way — this module never invents a state.
   */
  readonly autoEngaged?: boolean | undefined;
  /**
   * True while the freeze layer holds the offset — the user is climbing
   * man-made structure (tower, stairs, bridge) and the world must not ride
   * up with them. Named on the line because the M5 tower walk needs to SEE
   * the freeze engage, and nothing else on screen says so.
   */
  readonly autoFrozen?: boolean | undefined;
  /**
   * Geoid undulation `N` at the AR origin, metres.
   *
   * A **session constant**, not something that moves: `N` varies about 1 m per
   * 100 km, so it is uniform to centimetres across a city. It is on screen to
   * make one catastrophic state visible — `ZERO_GEOID` still in place in a build
   * rendering absolute heights puts the whole scene ~46 m out in central Europe,
   * and nothing else on the readout would say so.
   */
  readonly geoidUndulationM?: number | undefined;
  /** The active geoid model's identity, from the library's `describeGeoid`. */
  readonly geoidModelId?: string | undefined;
  /**
   * Where the user is.
   *
   * **THE LINE THAT MAKES A SCREENSHOT FALSIFIABLE.** Without coordinates a
   * screenshot cannot be checked against an external elevation service, returned
   * to, or correlated with another screenshot — every other number on the
   * readout stays unverifiable while this one is missing.
   */
  readonly position?:
    | { readonly lat: number; readonly lng: number }
    | undefined;
  /**
   * How long ago the last fix arrived, milliseconds.
   *
   * A stale fix and a fresh one are **indistinguishable** on the rest of the
   * readout, and a large share of "the alignment drifted" observations are
   * really "no fix has arrived for 40 s".
   */
  readonly fixAgeMs?: number | undefined;
  /**
   * The alignment's own answer to "which way is north", degrees.
   *
   * **TAKE IT IN WORLD SPACE.** The hierarchy is `scene (GPS-world NUE) →
   * arWorldGroup (receives the alignment) → basisChangeNode → arpose → camera`,
   * so the camera is a **descendant** of the aligned group and its **world**
   * transform already carries the alignment.
   *
   * A direction taken **relative to `arWorldGroup`** would be in the AR-odometry
   * frame — the alignment's *domain*, i.e. un-aligned — and would report a
   * plausible number that is not north. An earlier version of this comment said
   * exactly that, which made it the third statement of a distinction
   * `ar-scene-hierarchy.ts` already records two readers getting backwards. Use
   * `ar-origin.ts`'s `nueBearingDeg`, which carries the axis convention and its
   * tests, rather than an `atan2` at a call site.
   *
   * Read beside the library's compass bearing once that is exposed (DEC-H3/H6).
   * The two differing by tens of degrees says the compass is being outvoted or
   * is wrong; either line alone says nothing.
   */
  readonly fusedBearingDeg?: number | undefined;
}

/** How the readout is being shown — DEC-H2's one collapsible surface. */
export interface ArReadoutOptions {
  /**
   * Show everything, rather than the walking set.
   *
   * **ONE LIST AND ONE BOOLEAN, not two tiers.** Two membership lists would need
   * a test that one stays a subset of the other; collapse/expand makes the
   * expanded state *the screenshot state* rather than a mode to remember to
   * leave.
   */
  readonly expanded?: boolean | undefined;
}

/**
 * Above this age a fix is called out as stale, milliseconds.
 *
 * A GPS watch delivers roughly 1 Hz, so 15 s without one is not slow — it is
 * broken, or the user is indoors. Chosen well above the ordinary jitter so the
 * warning stays rare enough to mean something.
 */
const STALE_FIX_MS = 15_000;

/**
 * One line per measurement that has a value, in a fixed order.
 *
 * **LINES RATHER THAN A SENTENCE**, unlike the desktop status line. This is read
 * at arm's length, outdoors, over a camera feed, by someone who is walking — a
 * single run-on string is unreadable there, and the reader is looking for one
 * number at a time rather than an overview.
 *
 * **A MISSING VALUE IS OMITTED, NEVER SHOWN AS ZERO.** "No fix accuracy yet" and
 * "an accuracy of 0 m" are different claims and the second is impossible; a
 * readout that renders unmeasured things as `0` is how a measurement session
 * produces confident wrong numbers. `describeDrawCost` already makes the same
 * distinction for the same reason.
 */
export function describeArMeasurements(
  measurements: ArMeasurements,
  options: ArReadoutOptions = {},
): readonly string[] {
  const lines: string[] = [];
  /**
   * The two height terms, held rather than pushed so they can share a line.
   *
   * They are read together or not at all — `alt` is what GPS reported and
   * `world floor` is where the alignment put the ground, and the interesting
   * quantity is the relationship between them. Separate lines made a reader do
   * the pairing by eye every time (Q7).
   */
  let altitude = "";
  let worldFloor = "";
  const expanded = options.expanded === true;
  /**
   * Push a line only when the readout is expanded.
   *
   * A DEGRADED value is never routed through this — a warning that appears only
   * when expanded is a warning nobody sees (DEC-H2).
   */
  const pushExpanded = (line: string): void => {
    if (expanded) lines.push(line);
  };

  // PAIRED, NOT LISTED (Q7). The two render-cost numbers answer one question —
  // "is this frame affordable" — and on a phone each occupied a whole line of a
  // readout that is already tall. The field report asked for them side by side.
  //
  // Joined here rather than by a later width-driven merge pass: which lines
  // belong together is semantic, and an auto-merge would pair whatever happened
  // to be adjacent. `pair` also keeps either half usable alone, which matters
  // because fps is live from the first frame while the draw cost only appears
  // once something has rendered — an all-or-nothing group would blank a number
  // that is already known.
  const cost = describeDrawCost(measurements.drawCost);
  const fps = isUsable(measurements.fps)
    ? `${Math.round(measurements.fps)} fps`
    : "";
  lines.push(...pair(cost, fps));

  if (isUsable(measurements.fixAccuracyM)) {
    // ONE DECIMAL BELOW 10 m, none above. The interesting distinction near the
    // bottom of the range is 4.5 versus 8 m; at 30 m nobody cares about the
    // tenth, and the extra digit reads as precision the fix does not have.
    const accuracy =
      measurements.fixAccuracyM < 10
        ? measurements.fixAccuracyM.toFixed(1)
        : Math.round(measurements.fixAccuracyM).toString();
    // `gps`, NOT `fix` (H7). Two different lines both began with `fix` — this
    // one is a horizontal accuracy, the other an age — so a glance at the
    // readout had to parse the rest of the line to know which quantity it was
    // looking at. They now name different things.
    lines.push(`gps ±${accuracy} m`);
  }

  if (isUsable(measurements.metresFromAnchor)) {
    // METRES UNDER A KILOMETRE, kilometres above. The far-travel warning speaks
    // in kilometres because it fires at 2 km; this line is live from the first
    // step, where "0.0 km" would be useless.
    const distance =
      measurements.metresFromAnchor < 1000
        ? `${Math.round(measurements.metresFromAnchor)} m`
        : `${(measurements.metresFromAnchor / 1000).toFixed(1)} km`;
    lines.push(`${distance} from anchor`);
  }

  // SIGNED, like the baseline below and NOT filtered through `isUsable`, whose
  // `>= 0` is right for an accuracy and wrong here: Schiphol, the Dead Sea and
  // any basement are real places at negative altitude, and quietly dropping them
  // would hide the reading exactly where it is most surprising.
  if (
    measurements.altitudeM !== undefined &&
    Number.isFinite(measurements.altitudeM)
  ) {
    // The accuracy is appended only when it is itself usable. Half a line is
    // better than none: vertical accuracy is optional in the Geolocation API and
    // commonly absent, and omitting the altitude because its error bar is
    // missing would hide the number the session is about.
    const accuracy = isUsable(measurements.altitudeAccuracyM)
      ? ` ±${measurements.altitudeAccuracyM.toFixed(1)} m`
      : "";
    altitude = `alt ${measurements.altitudeM.toFixed(1)} m${accuracy}`;
  }

  if (
    measurements.worldBaselineY !== undefined &&
    Number.isFinite(measurements.worldBaselineY)
  ) {
    // NOT filtered on `>= 0`, unlike the others: this one is SIGNED and the
    // sign is the information. A baseline below zero means the alignment has
    // put the world under the user, which is precisely the failure §4 predicts
    // will be visible.
    //
    // Centimetres, because the question is whether it JUMPS. A metre of drift
    // over a walk is expected; ten centimetres between two glances is not, and
    // whole metres would hide it.
    // `world floor`, NOT `baseline` (H7). "Baseline" named nothing a reader
    // could picture; this is the fusion's estimate of where the ground plane
    // sits, and it is the AR ORIGIN rather than anything about the camera.
    worldFloor = `world floor ${measurements.worldBaselineY.toFixed(2)} m`;
  }

  // Emitted here, at the point the second half becomes known, so the height
  // pair keeps its place in the readout's order (Q7).
  lines.push(...pair(altitude, worldFloor));

  // THE DEM'S OWN STATE FIRST, because everything below depends on whether it
  // loaded at all. `false` is a claim; `undefined` is only "not reported".
  const demFailed = measurements.terrainHasData === false;
  if (demFailed) {
    // COLLAPSED TOO. Without the DEM the ground is flat zero, so every building
    // stands at the wrong height — a silent failure that the render cannot
    // distinguish from genuinely flat terrain.
    lines.push("terrain: no DEM");
  }

  const terrainUsable =
    !demFailed && isSignedReading(measurements.terrainHeightM);
  if (terrainUsable) {
    // The SOURCE rides on the height's own line rather than getting one of its
    // own: it only means anything next to the number it qualifies, and the
    // expanded readout is already long. Absent id, absent suffix — "not
    // reported" must not render as an empty separator.
    const source =
      measurements.demSourceId === undefined || measurements.demSourceId === ""
        ? ""
        : ` · ${demServingLabel(measurements.demSourceId, measurements.demStats)}`;
    pushExpanded(
      `terrain ${measurements.terrainHeightM.toFixed(1)} m${source}`,
    );
  }

  // THE LINE THE READOUT EXISTS FOR (DEC-H1/H5), NAMED BY ITS OPERANDS (H8).
  //
  // It was called `above terrain`, which reads as "how high the phone is above
  // the ground" and was reported as incomprehensible. It is not that number and
  // cannot be: this is `altitudeM - terrainHeightM`, GPS altitude minus DEM, and
  // NO POSE REACHES THIS MODULE AT ALL — raising the phone cannot move it. The
  // documentation claiming "chest height reads about +1.5 m" was false in five
  // places, one of them a test NAME. It is deleted rather than reworded: GNSS
  // vertical error is +/-10-20 m, so a 1.5 m target sits far inside the noise of
  // the quantity it was meant to calibrate.
  //
  // A steady +10 m is the reported symptom, and its SIGN separates the two filed
  // causes that need opposite fixes. Always shown, never expanded-only.
  // The REAL holding height is the `camera` line below.
  if (terrainUsable && isSignedReading(measurements.altitudeM)) {
    const residual = measurements.altitudeM - measurements.terrainHeightM;
    lines.push(`gps-dem ${signed(residual)} m`);
  }

  // THE HONEST HOLDING HEIGHT (DEC-Y5), which already existed as a computed
  // value and was discarded one line from here: the camera's `y` in the
  // `local-floor` reference space, whose zero is the floor plane. Unlike
  // `gps-dem` it RESPONDS to raising the phone, and unlike `alt - baseline` it
  // carries no GNSS vertical noise — `baseline` is the AR ORIGIN, not the
  // camera, and moves only when the alignment is re-solved.
  //
  // Centimetres, because the question is "is this about 1.5 m or about 15",
  // and absent rather than zero before the first pose: `camera 0.00 m` would
  // claim the phone is lying on the ground.
  if (isSignedReading(measurements.cameraHeightM)) {
    lines.push(`camera ${measurements.cameraHeightM.toFixed(2)} m`);
  }

  // THE PAIRED LINE, always visible like the residual above: `above terrain`
  // is untouched by the offset, this is the estimator's view, and their
  // difference is the fused-vertical error, live. Absent while the estimator
  // publishes nothing — a zero here would claim measured agreement.
  if (isSignedReading(measurements.autoOffsetM)) {
    // THE STATE TAGS, in the order a reader needs them: how good the number
    // is, whether it is on the content at all, and whether the freeze layer
    // is holding it. `low`/`not applied` is the cold-review F1 line: below
    // the confidence gate the estimator still publishes a real measurement
    // but the city is NOT moved by it, and a bare `auto +1.4 m (conf 0.12)`
    // sends a field observer hunting for a correction that was never made.
    // An ABSENT `autoEngaged` claims nothing either way — this module never
    // invents a state it was not told about.
    const tags: string[] = [];
    const hasConfidence = isUsable(measurements.autoConfidence);
    if (hasConfidence) {
      tags.push(`conf ${measurements.autoConfidence.toFixed(2)}`);
    }
    if (measurements.autoEngaged === false) {
      // `low` reads as "hence not applied" only next to the number it
      // qualifies; without one, state the fact that survives.
      tags.push(hasConfidence ? "low" : "not applied");
    }
    if (measurements.autoFrozen === true) tags.push("frozen");
    const detail = tags.length === 0 ? "" : ` (${tags.join(", ")})`;
    // THE DEM RIDES ON THIS LINE TOO (cold-review F7): the offset is a
    // correction against a SPECIFIC DEM, and the terrain line that names it
    // is expanded-only while this line is in the collapsed walking set — so
    // without the suffix here, a walking screenshot shows a correction with
    // no way to tell LiDAR from ~30 m SRTM. Same guard and same label
    // helper as the terrain line, so the two can never name different DEMs.
    const autoSource =
      measurements.demSourceId === undefined || measurements.demSourceId === ""
        ? ""
        : ` · ${demServingLabel(measurements.demSourceId, measurements.demStats)}`;
    lines.push(
      `auto ${signed(measurements.autoOffsetM)} m${detail}${autoSource}`,
    );
  }

  if (isSignedReading(measurements.geoidUndulationM)) {
    // THE MODEL'S IDENTITY, not just the number. `ZERO_GEOID` reads as a
    // perfectly ordinary `+0.0 m`, and the whole point is that it should not.
    const model =
      measurements.geoidModelId === undefined
        ? ""
        : ` — ${measurements.geoidModelId}`;
    pushExpanded(`geoid N ${signed(measurements.geoidUndulationM)} m${model}`);
  }

  if (isUsable(measurements.fixAgeMs)) {
    const seconds = Math.round(measurements.fixAgeMs / 1000);
    if (measurements.fixAgeMs > STALE_FIX_MS) {
      // COLLAPSED TOO — see `pushExpanded`. A fix this old makes every other
      // number on the readout describe somewhere the user has left.
      lines.push(`gps age ${seconds} s — STALE`);
    } else {
      pushExpanded(`gps age ${seconds} s`);
    }
  }

  if (isSignedReading(measurements.fusedBearingDeg)) {
    // WHOLE DEGREES. The comparison this exists for — fused against the
    // library's compass bearing — is a tens-of-degrees question, and a decimal
    // reads as precision the alignment does not have.
    // NAMED AS A HEADING (H7). `fused 214°` did not say what was fused or what
    // the degrees measure; the comparison this line exists for is against the
    // compass, so it must announce itself as the same kind of quantity.
    pushExpanded(`heading ${Math.round(measurements.fusedBearingDeg)}° fused`);
  }

  const position = measurements.position;
  if (
    position !== undefined &&
    Number.isFinite(position.lat) &&
    Number.isFinite(position.lng)
  ) {
    // SIX DECIMALS — about 0.1 m, finer than any fix, and the precision an
    // external elevation service expects to be handed back.
    // LABELLED RAW (DEC-Y2), and the label is the opposite of what H7 asked
    // for. The session suggested calling it "fused GPS"; it is the last fix
    // straight from the Geolocation API, untouched by the alignment. Renaming
    // raw data as fused would ADD a false claim in the round whose purpose is
    // removing them.
    pushExpanded(
      `raw gps ${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`,
    );
  }

  return lines;
}

/** `+1.5` / `-10.0` — the sign is explicit on both, because it is the reading. */
function signed(valueM: number): string {
  return `${valueM >= 0 ? "+" : ""}${valueM.toFixed(1)}`;
}

/**
 * The terrain line's source suffix: which DEM actually served, when known.
 *
 * WHY A SHARE AND NOT THE RAW COUNTERS. The question a field session asks is
 * "am I standing on the LiDAR or on the ~30 m fallback?", and the primary's
 * share of ANSWERED posts is that question's number — `mapterhorn 98%`. Two
 * states are words instead:
 *
 * - **`terrarium (fallback)`** when the primary answered nothing — the one
 *   share that changes what the height MEANS, stated so it cannot be skimmed
 *   past as a percentage.
 * - **The composed id** when the stats are absent or have counted nothing
 *   yet, or when the id does not carry the `primary+fallback` shape this
 *   derives its names from — the pre-stats behaviour, kept.
 *
 * The names come from splitting {@link ArMeasurements.demSourceId} at its
 * first `+`, so the label can only ever name the composition that produced
 * the field — a hardcoded name here would keep agreeing with itself after the
 * worker's wiring changed.
 */
function demServingLabel(
  sourceId: string,
  stats: ArMeasurements["demStats"],
): string {
  if (stats === undefined || stats.servedBy === "none") return sourceId;
  return stats.servedBy;
}

/**
 * Present and finite, with **no `>= 0` guard**.
 *
 * The counterpart to {@link isUsable} for the values where a negative is a real
 * place or a real direction rather than an impossibility: terrain and altitude
 * (the Dead Sea, any basement), and the geoid undulation, which is about −30 m
 * over India and −50 m south of Sri Lanka. Routing those through `isUsable`
 * would drop exactly the readings that are most surprising.
 */
function isSignedReading(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

/**
 * Present, finite and not negative.
 *
 * Non-finite is the realistic case rather than a theoretical one: an fps
 * computed from a zero `dt` is `Infinity`, and the framework hands `dt: 0` on
 * the first frame after a reset by documented contract.
 */
function isUsable(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}
