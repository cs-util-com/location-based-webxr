/**
 * The "my location" button, in the map's corner.
 *
 * NO NEW DEPENDENCY. Leaflet has no built-in locate BUTTON, but `map.locate()`
 * is built in and wraps `navigator.geolocation` with the events below — so the
 * control is a div, a click handler and two listeners rather than a plugin.
 *
 * All the decisions live in `locate-state.ts` and are tested without a browser.
 * This file is the DOM and the Leaflet wiring.
 *
 * @see locate-control.ts.md
 */

import L from "leaflet";

import { labelFor, stateForError, type LocateState } from "./locate-state.js";

export interface LocateControlOptions {
  readonly map: L.Map;
  /**
   * Called with the fix. The caller decides what a new position means.
   *
   * `accuracyM` is the browser's reported horizontal accuracy — §4 predicts
   * this, not rendering, is the binding constraint on whether AR "feels right",
   * so milestone 4 puts it on screen rather than leaving it to be guessed at.
   * Leaflet forwards it as `event.accuracy`; `undefined` when it is absent.
   */
  readonly onLocated: (position: LocatedFix) => void;
  /** Called with a human-readable failure, for the app's error channel. */
  readonly onError: (message: string) => void;
}

/**
 * A fix, whole — every field the framework's `GpsPosition` carries.
 *
 * **WIDENED 2026-08-14.** This used to be `{ lat, lng, accuracyM? }`, which was
 * enough for the map and the refetch gate and silently insufficient for the
 * fusion: `gps-registration.ts` turns these into `recordGpsEvent`, and without
 * `altitude`/`altitudeAccuracy` the separate 1-D vertical solve has nothing to
 * fit. The horizontal alignment would have looked correct while every object
 * sat at the wrong height, reported as a confident `0.00 m`.
 *
 * `lng` rather than `lon` because that is this demo's convention throughout;
 * `gps-registration.ts` does the one-line rename at the framework boundary,
 * where `ar-origin.ts` already documents the same mismatch.
 */
export interface LocatedFix {
  readonly lat: number;
  readonly lng: number;
  /** Horizontal accuracy in metres, or `undefined` when the browser omits it. */
  readonly accuracyM?: number | undefined;
  /** Metres above the WGS-84 ellipsoid on Android — see `ar-origin.ts`. */
  readonly altitude: number | null;
  readonly altitudeAccuracy: number | null;
  readonly heading: number | null;
  readonly speed: number | null;
  readonly timestamp: number;
}

/** A finite number, or `null` — the shape `GpsPosition` wants for absent data. */
function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** How long to wait for a fix before giving up, ms. */
const LOCATE_TIMEOUT_MS = 15_000;

/** How long a terminal message stays before the button returns to idle, ms. */
const MESSAGE_LINGER_MS = 4_000;

/**
 * The Google-Maps-style pin: round on top, pointed at the bottom.
 *
 * Hand-written rather than downloaded, as the feedback asked. `currentColor` so
 * the button's own colour drives it and the state styling in `index.html` needs no
 * second selector; `aria-hidden` because the accessible name is on the button.
 */
const MAP_PIN_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Z"/>
  <circle cx="12" cy="9" r="2.6" fill="#171b26"/>
</svg>`;

export class LocateControl {
  private readonly button: HTMLButtonElement;
  private readonly map: L.Map;
  private state: LocateState = "idle";
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether a continuous watch is running — see {@link startWatch}. */
  private watching = false;
  /** Whether the current watch outage has already been reported once. */
  private watchErrorReported = false;

  constructor(options: LocateControlOptions) {
    this.map = options.map;

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "locate-button";
    // A SQUARE ICON BUTTON (DEC-R2-3), not a text label. The old button's width
    // swung from "my location" to "location permission denied", which is both
    // unlike every maps UI and a control that changes size when it fails.
    //
    // The pin is inline SVG rather than an emoji or an image: an emoji renders
    // differently on every platform and cannot inherit the button's colour, and an
    // image would be a network request for four path commands. `aria-hidden`
    // because the accessible name lives on the button itself.
    this.button.innerHTML = MAP_PIN_SVG;
    this.setState("idle");

    const Control = L.Control.extend({
      onAdd: (): HTMLElement => {
        const wrapper = L.DomUtil.create("div", "leaflet-bar locate-control");
        wrapper.append(this.button);
        // Without this, a click on the button also reaches the map underneath
        // and is read as "the user clicked here to move", so pressing
        // "my location" would first teleport them to the button's position.
        L.DomEvent.disableClickPropagation(wrapper);
        return wrapper;
      },
    });
    // BOTTOM RIGHT (DEC-R2-3): the Google Maps convention the feedback named.
    // Leaflet's attribution control also lives in this corner, so the button
    // stacks ABOVE it — the ODbL credit stays visible and unobstructed, which it
    // must.
    new Control({ position: "bottomright" }).addTo(this.map);

    this.button.addEventListener("click", () => {
      this.start();
    });

    this.map.on("locationfound", (event: L.LocationEvent) => {
      // THE POSITION ALWAYS FLOWS; only the BUTTON is conditional. A watch
      // delivers ~1 Hz for the whole AR session, and driving the button from
      // that would flash "Located" once a second and re-arm a reset timer each
      // time — for something the user did not press. The button belongs to the
      // one-shot it was pressed for, which is exactly `state === "locating"`.
      if (this.state === "locating") {
        this.setState("located");
        this.scheduleReset();
      }
      this.watchErrorReported = false;
      options.onLocated({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
        accuracyM: Number.isFinite(event.accuracy) ? event.accuracy : undefined,
        // THE WHOLE FIX, not just the horizontal part (2026-08-14 AR review).
        // These were dropped here, and dropping them is why the vertical solve
        // could never work: `applyAltitudeOverride` fits `ref[1] - odom[1]`
        // weighted by `altitudeAccuracy`, so without either field
        // `alignmentMatrix[13]` stays structurally zero and the AR HUD's
        // `worldBaselineY` reads a confident `0.00 m`. The data was always
        // here — Leaflet copies every numeric `coords` property onto the event
        // — and was discarded at this boundary.
        //
        // `finiteOrNull` rather than a cast: the `@types/leaflet` shape
        // declares these as plain `number`, but Leaflet only copies the
        // properties the browser actually provided, so they are `undefined` on
        // a fix with no altitude — which is most indoor fixes and every
        // desktop one. The framework's `GpsPosition` wants `null` there, and
        // `undefined` reaching the weight maths would produce `NaN` rather than
        // a skipped term.
        altitude: finiteOrNull(event.altitude),
        altitudeAccuracy: finiteOrNull(event.altitudeAccuracy),
        heading: finiteOrNull(event.heading),
        speed: finiteOrNull(event.speed),
        // `Date.now()` rather than a cast for the same reason: Leaflet sets
        // `timestamp` from the browser's fix, but a synthetic `locationfound`
        // (its own `setView` path, or a test) may omit it, and a `NaN`
        // timestamp poisons the library's time weighting.
        timestamp: Number.isFinite(event.timestamp)
          ? event.timestamp
          : Date.now(),
      });
    });

    this.map.on("locationerror", (event: L.ErrorEvent) => {
      // Leaflet forwards the browser's error code as `code`; its own timeout
      // path sets 3 to match.
      const next = stateForError(
        (event as L.ErrorEvent & { code?: number }).code,
      );
      // A PENDING ONE-SHOT ALWAYS WINS THE BUTTON, even while a watch runs.
      // Leaflet fires one event for both sources with no discriminator, and
      // `stopLocate` cannot cancel a one-shot — so swallowing every error while
      // watching would leave a pressed button stuck at `locating`, disabled,
      // with no timer to release it (r509 review). `state === "locating"` is
      // the only evidence that a one-shot is outstanding, and it is exactly the
      // case that must not be swallowed.
      if (this.state === "locating") {
        this.setState(next);
        options.onError(labelFor(next));
        this.scheduleReset();
        return;
      }

      // ONCE PER OUTAGE WHILE WATCHING. `watchPosition` re-fires its error
      // callback on every timeout, so an unguarded path would push a toast a
      // second for as long as the user stayed indoors — burying every other
      // message the app has. Cleared by the next successful fix above, so a
      // second outage is reported again.
      if (this.watching) {
        if (!this.watchErrorReported) {
          this.watchErrorReported = true;
          options.onError(labelFor(next));
        }
        return;
      }
      this.setState(next);
      options.onError(labelFor(next));
      this.scheduleReset();
    });
  }

  /**
   * Follow the user continuously instead of taking one fix (AR milestone 3).
   *
   * WHY IT REUSES `map.locate` RATHER THAN A SECOND GPS PATH. `locationfound`
   * already flows to `onLocated`, which is the one place a new position enters
   * the store. Opening a `navigator.geolocation.watchPosition` alongside it
   * would be a second source for the same fact, and the two could disagree
   * about which fix is current — the class of bug `scene-anchor.ts` exists to
   * prevent one level up.
   *
   * **`watch: true` DOES NOT MEAN "refetch on every fix".** Leaflet delivers
   * roughly 1 Hz; the demo's scoring pass takes 15–90 s and `refresh` is
   * `latestOnly`, so acting on every fix aborts every run and nothing ever
   * publishes. `ar-walk-controller.ts` is what makes this safe to turn on, and
   * turning it on without that controller is the starvation bug in §2.6.
   *
   * Idempotent, and does NOT touch the button's state: this is a background
   * follow, not a user-initiated action, so a pulsing "locating" pin for the
   * whole AR session would be wrong.
   */
  startWatch(): void {
    if (this.watching) return;
    this.watching = true;
    this.map.locate({
      setView: false,
      watch: true,
      timeout: LOCATE_TIMEOUT_MS,
      // MILLISECONDS OF CACHE AGE the caller will accept — `0` means "never
      // hand me a cached fix". An earlier comment here described it as a
      // distance filter, which it is not: the W3C Geolocation API has no
      // distance filter at all (that is Android's native
      // `setSmallestDisplacement`, unreachable from the web), and Leaflet
      // passes these options straight through to `watchPosition` (r509 review).
      //
      // Zero is right for a different reason than the one that was written: a
      // cached fix would make the demo act on a position the user has already
      // left, and the gate downstream measures displacement from the last
      // REFETCH, so a stale fix skews that measurement rather than just being
      // old.
      maximumAge: 0,
      enableHighAccuracy: true,
    });
  }

  /** Stop following. Idempotent, and safe when no watch is running. */
  stopWatch(): void {
    if (!this.watching) return;
    this.watching = false;
    this.watchErrorReported = false;
    // `stopLocate` is `clearWatch(...)` plus a `setView` reset — it CANNOT
    // cancel a pending one-shot, because the Geolocation API offers no way to
    // (r509 review corrected the opposite claim here). That is fine and is why
    // the button is left alone: a one-shot in flight still resolves through
    // `locationfound` or `locationerror`, so the button finishes its own state
    // machine either way.
    this.map.stopLocate();
  }

  private start(): void {
    if (this.state === "locating") return;
    if (this.resetTimer !== undefined) clearTimeout(this.resetTimer);
    this.setState("locating");
    // `setView: false` — moving the map is the app's decision, made from the
    // store once the position lands, not a side effect of asking where we are.
    this.map.locate({ setView: false, timeout: LOCATE_TIMEOUT_MS });
  }

  /**
   * Moves the button to a state, keeping all three feedback channels in step.
   *
   * WHY THREE CHANNELS (DEC-R2-3 / DEC-R2-15). Going icon-only removed the visible
   * text that used to carry every state, so each one now has a home:
   *
   * - `data-state` drives the CSS, which is what makes `locating` visibly
   *   in-progress (a pulsing pin). `CLAUDE.md`'s async-feedback rule requires that
   *   for anything above a few hundred ms, and a GPS fix routinely takes seconds.
   * - `title` and `aria-label` carry the wording — the only place the four states
   *   are actually spelled out, and the only channel available to a screen reader.
   *   A `title` alone would be invisible on touch, which is why it is not alone.
   * - The status line gets the failures, via the caller's `onError`. Because a
   *   collapsed header hides the status line, DEC-R2-15 makes an error expand it,
   *   so a message can never be written into something invisible.
   */
  private setState(state: LocateState): void {
    this.state = state;
    const label = labelFor(state);
    this.button.title = label;
    this.button.setAttribute("aria-label", label);
    // Announced, not just styled: without a live region a screen reader would
    // never learn that "locating…" became "location permission denied", because
    // only an attribute changed.
    this.button.setAttribute("aria-busy", String(state === "locating"));
    this.button.dataset["state"] = state;
    // Disabled only while in flight: every terminal state, including the
    // failures, must be immediately retryable.
    this.button.disabled = state === "locating";
  }

  private scheduleReset(): void {
    if (this.resetTimer !== undefined) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.setState("idle");
    }, MESSAGE_LINGER_MS);
  }

  /** Cancels the pending label reset, so a disposed control cannot fire. */
  dispose(): void {
    if (this.resetTimer !== undefined) clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
  }
}
