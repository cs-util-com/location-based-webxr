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
    new Control({ position: "bottomleft" }).addTo(this.map);

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

  private setState(state: LocateState): void {
    this.state = state;
    this.button.textContent = labelFor(state);
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
