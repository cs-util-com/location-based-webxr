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
  /** Called with the fix. The caller decides what a new position means. */
  readonly onLocated: (position: { lat: number; lng: number }) => void;
  /** Called with a human-readable failure, for the app's error channel. */
  readonly onError: (message: string) => void;
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
      this.setState("located");
      options.onLocated({ lat: event.latlng.lat, lng: event.latlng.lng });
      this.scheduleReset();
    });

    this.map.on("locationerror", (event: L.ErrorEvent) => {
      // Leaflet forwards the browser's error code as `code`; its own timeout
      // path sets 3 to match.
      const next = stateForError(
        (event as L.ErrorEvent & { code?: number }).code,
      );
      this.setState(next);
      options.onError(labelFor(next));
      this.scheduleReset();
    });
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
