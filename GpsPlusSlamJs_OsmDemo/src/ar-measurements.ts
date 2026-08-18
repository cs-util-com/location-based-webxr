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

  const cost = describeDrawCost(measurements.drawCost);
  if (cost !== "") lines.push(cost);

  if (isUsable(measurements.fps)) {
    lines.push(`${Math.round(measurements.fps)} fps`);
  }

  if (isUsable(measurements.fixAccuracyM)) {
    // ONE DECIMAL BELOW 10 m, none above. The interesting distinction near the
    // bottom of the range is 4.5 versus 8 m; at 30 m nobody cares about the
    // tenth, and the extra digit reads as precision the fix does not have.
    const accuracy =
      measurements.fixAccuracyM < 10
        ? measurements.fixAccuracyM.toFixed(1)
        : Math.round(measurements.fixAccuracyM).toString();
    lines.push(`fix ±${accuracy} m`);
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
    lines.push(`alt ${measurements.altitudeM.toFixed(1)} m${accuracy}`);
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
    lines.push(`baseline ${measurements.worldBaselineY.toFixed(2)} m`);
  }

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
        : ` · ${measurements.demSourceId}`;
    pushExpanded(
      `terrain ${measurements.terrainHeightM.toFixed(1)} m${source}`,
    );
  }

  // THE LINE THE READOUT EXISTS FOR (DEC-H1/H5). Chest height should read about
  // +1.5 m; a steady +10 m is the reported symptom, and its SIGN separates the
  // two filed causes that need opposite fixes. Always shown, never expanded-only.
  if (terrainUsable && isSignedReading(measurements.altitudeM)) {
    const residual = measurements.altitudeM - measurements.terrainHeightM;
    lines.push(`above terrain ${signed(residual)} m`);
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
      lines.push(`fix ${seconds} s ago — STALE`);
    } else {
      pushExpanded(`fix ${seconds} s ago`);
    }
  }

  if (isSignedReading(measurements.fusedBearingDeg)) {
    // WHOLE DEGREES. The comparison this exists for — fused against the
    // library's compass bearing — is a tens-of-degrees question, and a decimal
    // reads as precision the alignment does not have.
    pushExpanded(`fused ${Math.round(measurements.fusedBearingDeg)}°`);
  }

  const position = measurements.position;
  if (
    position !== undefined &&
    Number.isFinite(position.lat) &&
    Number.isFinite(position.lng)
  ) {
    // SIX DECIMALS — about 0.1 m, finer than any fix, and the precision an
    // external elevation service expects to be handed back.
    pushExpanded(`${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`);
  }

  return lines;
}

/** `+1.5` / `-10.0` — the sign is explicit on both, because it is the reading. */
function signed(valueM: number): string {
  return `${valueM >= 0 ? "+" : ""}${valueM.toFixed(1)}`;
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
