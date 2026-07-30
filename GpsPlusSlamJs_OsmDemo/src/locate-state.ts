/**
 * What the "my location" button says, and why.
 *
 * WHY THE BUTTON EXISTS. The demo starts at Cologne cathedral and the only
 * override is `?lat=&lng=`. On a phone that makes it untestable at the place the
 * user is actually standing, which is the one thing a phone is good for here.
 *
 * WHY THE STATES ARE SPLIT THIS FINELY. Geolocation fails in three ways with
 * three different remedies: `denied` is fixed in browser settings, `timeout` by
 * walking somewhere with a view of the sky, and `unavailable` not at all. One
 * shared "location failed" would hide the only useful part of the message.
 *
 * Kept pure and separate from the Leaflet control so the labels and the error
 * mapping can be tested without a browser — the control itself is twenty lines
 * of DOM around this.
 *
 * @see locate-state.ts.md
 */

export type LocateState =
  | "idle"
  | "locating"
  | "located"
  | "denied"
  | "timeout"
  | "unavailable";

/**
 * The button's accessible label for a state.
 *
 * Every state has a distinct, non-empty label — including `locating`, which is
 * the in-progress state `CLAUDE.md`'s async-feedback rule requires for anything
 * that takes more than a few hundred ms. A GPS fix routinely takes seconds.
 *
 * SINCE DEC-R2-3 THIS IS NO LONGER THE VISIBLE TEXT. The button is a square icon
 * (a map pin), so these strings live in `title` and `aria-label` instead of in
 * `textContent`. They are still the only place the four states are spelled out,
 * and the two visible channels are the icon's animated in-progress state and the
 * status line — see `locate-control.ts`.
 */
export function labelFor(state: LocateState): string {
  switch (state) {
    case "idle":
      return "my location";
    case "locating":
      return "locating…";
    case "located":
      return "my location";
    case "denied":
      return "location permission denied";
    case "timeout":
      return "location timed out";
    case "unavailable":
      return "location unavailable";
  }
}

/**
 * Maps a `GeolocationPositionError.code` to a state.
 *
 * Unknown codes degrade to `unavailable` rather than throwing. The codes are a
 * fixed set in the spec, but this is a browser API and the error object is
 * whatever the browser hands over — and a button that throws inside its own
 * error handler leaves the UI stuck on "locating…" forever, which is the one
 * outcome worse than a wrong message.
 */
export function stateForError(code: number | undefined): LocateState {
  switch (code) {
    case 1:
      return "denied";
    case 3:
      return "timeout";
    default:
      return "unavailable";
  }
}
