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
  type CompassLiveState,
  type CompassExperiments,
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
  /**
   * The experimental options to send alongside the weight, read at dispatch
   * time rather than captured — the gear panel owns them and they change while
   * this control is alive.
   */
  readonly experiments?: () => CompassExperiments;
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
  /**
   * Publish what the solve last reported, so the readout can show the LIVE
   * weight beside the target. Cheap and idempotent; call it at the HUD's own
   * ~1 Hz rather than per frame — a per-fix readout flickers.
   */
  setLive(next: CompassLiveState): void;
  /**
   * Re-send the current slider position with the caller's current experiments.
   * For the gear panel, whose changes must not drop the weight.
   */
  republish(): void;
  /** Take it down and release the DOM. Idempotent. */
  dispose(): void;
}

export function createArCompassControl(
  options: ArCompassControlOptions,
): ArCompassControl {
  let influence = clamp(options.initialInfluence ?? COMPASS_INFLUENCE_DEFAULT);
  let ready = false;
  let attached = false;
  /**
   * Whether the shown value still has to reach the store.
   *
   * **STARTS `true`, and that is the fix for PR #311's finding 2.** The control
   * shows a value from the moment it is built, so until something dispatches it
   * the readout and the store disagree — and they disagree about
   * `coldStartOverrideEnabled`, whose library default is ON while every slider
   * position clears it. A session that never touched the slider was therefore
   * measuring settings the UI did not describe.
   */
  let pending = true;

  /**
   * The solve's last published compass state, for the readout (DEC-Y12).
   *
   * `undefined` until something calls {@link ArCompassControl.setLive}, which is
   * how the readout distinguishes "not measured yet" from "measured as zero" —
   * a distinction that matters here more than almost anywhere, because an
   * untrusted vote reads as 0 for every slider position.
   */
  let live: CompassLiveState | undefined;

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
    readout.textContent = describeCompassInfluence(influence, live);
    // THE TWO STATES A USER WOULD OTHERWISE READ AS A BROKEN CONTROL: not
    // accepting input yet, and accepting it but taking half a minute to show.
    // SHORTENED FOR THE ROW IT NOW SHARES (DEC-J8). "takes ~15–30 fixes to
    // express" is 29 characters against ~208 px of cell beside a 9 rem slider —
    // it fits by arithmetic with roughly 40 px to spare, which is thin enough
    // that a wider font or a narrower phone would wrap it and put the box back
    // to three rows, i.e. undo the change. At 20 characters the slack is ~90 px.
    hint.textContent = ready ? "~15–30 fixes to show" : "waiting for a GPS fix";
  };

  /**
   * Re-send the current position with whatever the experiment panel now holds.
   *
   * `compassSettingsFor` maps the influence AND the experiments together, so a
   * panel change must resend the weight — otherwise the store would take the new
   * experiments alongside a default weight nobody chose.
   */
  const republish = (): void => {
    apply();
  };

  const apply = (): void => {
    if (!ready) {
      // LATCHED, NOT DROPPED. Every setter is a no-op while the store's gps
      // state is null, so dispatching here would silently discard the drag.
      pending = true;
      return;
    }
    pending = false;
    options.onChange(compassSettingsFor(influence, options.experiments?.()));
  };

  // `input`, not `change`: on a range control `change` fires only when the
  // finger lifts, so the readout would lag the thumb across the whole drag.
  slider.addEventListener("input", () => {
    influence = clamp(Number.parseFloat(slider.value));
    render();
    apply();
  });

  render();
  // HINT BEFORE READOUT (J5, DEC-J8), so the box is two rows rather than three:
  // the hint shares the slider's row and only the 40-character readout takes a
  // line of its own (DEC-Y12 is untouched — it still cannot share).
  //
  // DOM ORDER RATHER THAN A CSS `order`. The hint explains the control it
  // follows, so a screen reader should meet them in that sequence; reordering
  // visually would leave the reading order as slider, readout, then an
  // explanation of the slider.
  element.append(slider, hint, readout);

  return {
    attach() {
      if (attached) return;
      options.root.append(element);
      attached = true;
    },
    influence() {
      return influence;
    },
    republish,
    setLive(next: CompassLiveState) {
      live = next;
      render();
    },
    setReady(next: boolean) {
      const wasReady = ready;
      ready = next;
      slider.disabled = !next;
      render();
      // THE FLUSH, AND THE INITIAL DISPATCH — one mechanism, because they are
      // the same failure. `pending` starts TRUE, so becoming ready applies
      // whatever the control is showing even if nobody has dragged it.
      //
      // Without that, the readout said `compass 0.10` while the store still
      // held the LIBRARY defaults — and those differ in kind, not just degree:
      // `coldStartOverrideEnabled` defaults ON, and `compassSettingsFor` clears
      // it at every position precisely so the slider is the thing being
      // measured. So a session that never touched the slider was measuring
      // something the UI did not describe. Found in review of PR #311.
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
