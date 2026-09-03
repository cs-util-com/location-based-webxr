/**
 * The plus/minus elevation control in the AR overlay (DEC-E1).
 *
 * **Why it is a separate module from the HUD.** The HUD is a read-only readout
 * sampled twice a second; this is interactive, lives for the session, and owns a
 * value. Folding a control into a formatter would make the value untestable
 * without a frame loop.
 *
 * **The `#ar-root` trap, which this follows the HUD in avoiding.** That element
 * is `position: fixed; inset: 0` and is hidden only while `:empty`, so anything
 * left attached keeps a full-viewport layer over the page whenever AR is not
 * running — a regression that has shipped here once already. So the control
 * attaches on {@link ArElevationControl.attach} and removes itself on
 * {@link ArElevationControl.dispose}, and is never attached speculatively.
 *
 * @see ar-elevation-control.ts.md
 */

import { NUDGE_STEP_M, describeNudge, nudged } from "./elevation-nudge.js";

export interface ArElevationControlOptions {
  /** The SAME element passed to `initAR` — see the trap above. */
  readonly root: HTMLElement;
  /**
   * Called with the new offset in metres whenever it changes.
   *
   * Fired only on an actual change: pressing `−` at the lower bound must not
   * re-attach the whole city for no movement.
   */
  readonly onChange: (offsetM: number) => void;
}

export interface ArElevationControl {
  /** Put the control on screen. Idempotent. */
  attach(): void;
  /** The current offset, metres. */
  offsetM(): number;
  /** Take it down and release the DOM. Idempotent. */
  dispose(): void;
}

/** One button, styled by class rather than inline so CSS owns the look. */
function button(label: string, title: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "ar-elevation-button btn btn--icon btn--glyph";
  element.textContent = label;
  // A TITLE AND AN ACCESSIBLE NAME. The glyph alone is meaningless to a screen
  // reader, and `#ar-root` is no longer inert (r510 review), so its contents are
  // reachable.
  element.title = title;
  element.setAttribute("aria-label", title);
  return element;
}

export function createArElevationControl(
  options: ArElevationControlOptions,
): ArElevationControl {
  let offset = 0;
  let attached = false;

  const element = document.createElement("div");
  element.className = "ar-elevation hud-elevation plate";

  const down = button("−", `Lower the map by ${NUDGE_STEP_M} m`);
  const up = button("+", `Raise the map by ${NUDGE_STEP_M} m`);
  const readout = document.createElement("span");
  readout.className = "ar-elevation-value num";
  // ANNOUNCED, unlike the HUD. This one changes only when pressed, so a polite
  // live region reports the result of the user's own action rather than
  // narrating a number twice a second.
  readout.setAttribute("aria-live", "polite");

  const render = () => {
    readout.textContent = describeNudge(offset);
  };

  const step = (direction: 1 | -1) => () => {
    const next = nudged(offset, direction);
    // NO EVENT AT THE BOUND. `onChange` re-attaches the content, so firing it
    // for a press that moved nothing would rebuild the transform for free.
    if (next === offset) return;
    offset = next;
    render();
    options.onChange(offset);
  };

  down.addEventListener("click", step(-1));
  up.addEventListener("click", step(1));

  render();
  element.append(down, readout, up);

  return {
    attach() {
      if (attached) return;
      options.root.append(element);
      attached = true;
    },
    offsetM() {
      return offset;
    },
    dispose() {
      if (!attached) return;
      element.remove();
      attached = false;
    },
  };
}
