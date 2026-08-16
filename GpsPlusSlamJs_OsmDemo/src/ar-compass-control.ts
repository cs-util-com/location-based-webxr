/**
 * The compass-influence slider in the AR overlay (DEC-E2).
 *
 * **What it is for.** A 0–1 control over how much say the compass has in yaw:
 * `0` ignores it entirely and leaves yaw to GPS, `1` gives it a full vote. The
 * arithmetic of what "0" and "1" actually require lives in
 * `compass-influence.ts` and is the interesting half — see its header.
 *
 * **THE `#ar-root` TRAP, followed here as in `ar-elevation-control.ts`.** That
 * element is `position: fixed; inset: 0` and hidden only while `:empty`, so
 * anything left attached keeps a full-viewport layer over the page whenever AR
 * is not running — a regression that has shipped here once already.
 *
 * **DISABLED UNTIL THERE IS A FIX.** Every one of these setters is a **silent
 * no-op before `setZeroPos`** — the reducer returns state unchanged while it is
 * null. A slider that accepts a drag and quietly discards it is worse than one
 * that is visibly not ready yet, so the control is disabled until
 * {@link ArCompassControl.setReady} says a fix has landed. The value the user
 * left is **latched and re-applied** at that moment rather than dropped.
 *
 * **AND IT WILL NOT SNAP.** The applied bearing is smoothed at
 * `coldStartSnapAlpha = 0.15` per GPS event, so a slider move takes roughly
 * **15–30 fixes** to express — half a minute of walking. The control says so on
 * screen, because an instrument that looks broken for 30 seconds gets dragged
 * again, which restarts the smoothing.
 *
 * @see ar-compass-control.ts.md
 */

import {
  COMPASS_INFLUENCE_DEFAULT,
  COMPASS_INFLUENCE_STEP,
  compassSettingsFor,
  describeCompassInfluence,
  type CompassSettings,
} from "./compass-influence.js";

export interface ArCompassControlOptions {
  /** The SAME element passed to `initAR` — see the trap above. */
  readonly root: HTMLElement;
  /**
   * Apply the settings. Called only when they can actually take effect, i.e.
   * never before {@link ArCompassControl.setReady}`(true)`.
   */
  readonly onChange: (settings: CompassSettings) => void;
  /** Starting influence. Defaults to {@link COMPASS_INFLUENCE_DEFAULT}. */
  readonly initialInfluence?: number | undefined;
}

export interface ArCompassControl {
  /** Put the control on screen. Idempotent. */
  attach(): void;
  /** The current influence, 0–1. */
  influence(): number;
  /**
   * Tell the control whether the store can accept settings yet.
   *
   * Passing `true` for the first time **flushes the latched value**, so a drag
   * made before the first fix is applied rather than lost.
   */
  setReady(ready: boolean): void;
  /** Take it down and release the DOM. Idempotent. */
  dispose(): void;
}

export function createArCompassControl(
  options: ArCompassControlOptions,
): ArCompassControl {
  let influence = clamp(options.initialInfluence ?? COMPASS_INFLUENCE_DEFAULT);
  let ready = false;
  let attached = false;
  /** Set while a change arrived before the store could take it. */
  let pending = false;

  const element = document.createElement("div");
  element.className = "ar-compass";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "ar-compass-slider";
  slider.min = "0";
  slider.max = "1";
  slider.step = String(COMPASS_INFLUENCE_STEP);
  slider.value = String(influence);
  // AN ACCESSIBLE NAME. `#ar-root` is no longer inert (r510 review), so its
  // contents are reachable, and a bare range input announces only a number.
  slider.setAttribute("aria-label", "Compass influence on heading");
  slider.disabled = true;

  const readout = document.createElement("span");
  readout.className = "ar-compass-value";
  // ANNOUNCED politely: this changes only when dragged, unlike the HUD.
  readout.setAttribute("aria-live", "polite");

  const hint = document.createElement("span");
  hint.className = "ar-compass-hint";

  const render = (): void => {
    readout.textContent = describeCompassInfluence(influence);
    // THE TWO STATES A USER WOULD OTHERWISE READ AS A BROKEN CONTROL: not
    // accepting input yet, and accepting it but taking half a minute to show.
    hint.textContent = ready
      ? "takes ~15–30 fixes to express"
      : "waiting for a GPS fix";
  };

  const apply = (): void => {
    if (!ready) {
      // LATCHED, NOT DROPPED. Every setter is a no-op while the store's gps
      // state is null, so dispatching here would silently discard the drag.
      pending = true;
      return;
    }
    pending = false;
    options.onChange(compassSettingsFor(influence));
  };

  // `input`, not `change`: on a range control `change` fires only when the
  // finger lifts, so the readout would lag the thumb across the whole drag.
  slider.addEventListener("input", () => {
    influence = clamp(Number.parseFloat(slider.value));
    render();
    apply();
  });

  render();
  element.append(slider, readout, hint);

  return {
    attach() {
      if (attached) return;
      options.root.append(element);
      attached = true;
    },
    influence() {
      return influence;
    },
    setReady(next: boolean) {
      const wasReady = ready;
      ready = next;
      slider.disabled = !next;
      render();
      // THE FLUSH. A value chosen before the first fix is applied the moment one
      // arrives; without this the control silently disagrees with the store for
      // the rest of the session.
      if (next && !wasReady && pending) apply();
    },
    dispose() {
      if (!attached) return;
      element.remove();
      attached = false;
    },
  };
}

/** Range inputs cannot produce a bad value; a restored preference can. */
function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
