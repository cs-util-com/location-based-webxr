/**
 * The AR experimental-compass panel (DEC-Y10, Q2 step 5).
 *
 * Five controls for mechanisms the library ships OFF or at other values, two of
 * them documented there as not field-validated. They exist so the trade is
 * measured on a street rather than argued in a document.
 *
 * **BEHIND A GEAR, CLOSED BY DEFAULT — forced by arithmetic, not taste.** On a
 * 390 px phone the elevation control alone measures ~149 px and the compass
 * slider exceeds its own `max-width` before anything is added; five
 * always-visible controls against a camera feed is a layout that does not exist.
 *
 * **AND IT CLOSES ITSELF ON A CHANGE.** A control here is changed in order to
 * look at the buildings, so a panel still covering them defeats the purpose —
 * which is precisely what G9 reported about the compass slider being in the
 * middle of the view.
 *
 * @see ar-experiment-panel.ts.md
 */

import {
  COMPASS_EXPERIMENT_DEFAULTS,
  type CompassExperiments,
  type CompassTrustGateMode,
} from "./compass-influence.js";
import { COMPASS_TRUST_GATE_MODES } from "gps-plus-slam-app-framework/state";

/**
 * The gate modes, in the library's own order. Derived from the exported const
 * since 2026-09-02 rather than mirrored: a mirrored list is how a fourth mode
 * (`latch`, core 1.23.0) would have compiled everywhere and appeared nowhere.
 */
const GATE_MODES: readonly CompassTrustGateMode[] = COMPASS_TRUST_GATE_MODES;

/**
 * The tolerances the 2026-08-20 census actually swept.
 *
 * 8 is the library default and the RecorderApp's, where trust rarely latches on
 * a real phone (55 of 81 corpus recordings); 15 is what this demo ships (64 of
 * 81); 25 is the widest measured arm (74 of 81). A value outside this set would
 * have no baseline to be read against.
 */
const TOLERANCES_DEG: readonly number[] = [8, 15, 25];

/**
 * Annotations shown in the dropdown but NOT part of the stored value.
 *
 * 25 is above the library's default `compassTrustDropToleranceDeg` of 20, and
 * the demo never sets that, so at this arm the hysteresis DEAD BAND is
 * inverted: every sample within 25° agrees (so trust is never lost — the corpus
 * measured compass-vs-GPS offsets of −4.3…+18.8°, all inside 25°), and every
 * sample that does disagree is by definition also outside 20° (so trust drops
 * at once). The `ramp` gate's HOLD branch, which exists to ride that band, is
 * unreachable there.
 *
 * The arm is KEPT rather than replaced, because the 2026-08-20 census swept
 * exactly these three values and 25 is the one with the 74-of-81 baseline —
 * substituting 19 would buy a working dead band at the cost of a number nothing
 * has ever measured. What was actually wrong is that the panel offered the
 * degenerate arm without saying so, which is the part this label fixes.
 *
 * See `GpsPlusSlamJs_Docs/docs/2026-08-20-2015-agree-tolerance-can-invert-the-trust-dead-band-followup.md`.
 */
const OPTION_NOTES: Readonly<Record<string, string>> = {
  "25": "(no dead band)",
};

export interface ArExperimentPanelOptions {
  readonly root: HTMLElement;
  readonly initial?: CompassExperiments;
  /** Called with the WHOLE configuration on any single change. */
  readonly onChange: (experiments: CompassExperiments) => void;
}

export interface ArExperimentPanel {
  /** Mount the gear and its (closed) panel. Idempotent. */
  attach(): void;
  /** Current values, for a caller that needs them without waiting for a change. */
  values(): CompassExperiments;
  /** Take it down and release the DOM. Idempotent. */
  dispose(): void;
}

let panelSeq = 0;

export function createArExperimentPanel(
  options: ArExperimentPanelOptions,
): ArExperimentPanel {
  let current: CompassExperiments =
    options.initial ?? COMPASS_EXPERIMENT_DEFAULTS;
  let attached = false;

  const element = document.createElement("div");
  element.className = "ar-gear-wrap";

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "ar-gear btn btn--icon";
  // A GLYPH ANNOUNCES NOTHING. `#ar-root` is not inert (r510 review), so this
  // button is reachable by a screen reader, which would otherwise read it as
  // "button, gear".
  gear.setAttribute("aria-label", "Compass experiment settings");
  gear.setAttribute("aria-expanded", "false");
  gear.textContent = "⚙";

  const body = document.createElement("div");
  body.className = "ar-experiments exp-panel plate";
  panelSeq += 1;
  body.id = `ar-experiments-${String(panelSeq)}`;
  body.hidden = true;
  gear.setAttribute("aria-controls", body.id);

  /** Read every control at once — the callback carries a whole configuration. */
  const read = (): CompassExperiments => ({
    rotationPriorEnabled: prior.checked,
    trustGateMode: gate.value as CompassTrustGateMode,
    pairSelectionEnabled: pairs.checked,
    trustToleranceDeg: Number.parseInt(tolerance.value, 10),
    webXRConsistencyEnabled: consistency.checked,
  });

  /**
   * Publish, then close.
   *
   * ONE CALLBACK PER CHANGE CARRYING EVERYTHING, not per-control deltas:
   * `compassSettingsFor` consumes the whole set, and a partial update would
   * leave the store describing a mixture of two configurations.
   */
  const publish = (): void => {
    current = read();
    options.onChange(current);
    setOpen(false);
  };

  const setOpen = (open: boolean): void => {
    body.hidden = !open;
    gear.setAttribute("aria-expanded", String(open));
  };

  const row = (labelText: string, input: HTMLElement): HTMLElement => {
    const label = document.createElement("label");
    label.className = "ar-experiments-row exp-row";
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(input, text);
    return label;
  };

  const checkbox = (id: string, checked: boolean): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = checked;
    input.addEventListener("change", publish);
    return input;
  };

  const select = (
    id: string,
    values: readonly string[],
    selected: string,
  ): HTMLSelectElement => {
    const input = document.createElement("select");
    input.id = id;
    // Carries its own class rather than being styled as a descendant, so the
    // rule cannot outrank the sheet's bare `select` by accident.
    input.className = "ar-experiments-select select select--small";
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      // The VALUE stays bare so it round-trips through parseInt; only the
      // label carries the annotation. See OPTION_NOTES for why one exists.
      const note = OPTION_NOTES[value];
      option.textContent = note === undefined ? value : `${value} ${note}`;
      input.append(option);
    }
    input.value = selected;
    input.addEventListener("change", publish);
    return input;
  };

  const prior = checkbox("ar-exp-prior", current.rotationPriorEnabled);
  const gate = select("ar-exp-gate", GATE_MODES, current.trustGateMode);
  const pairs = checkbox("ar-exp-pairs", current.pairSelectionEnabled);
  const tolerance = select(
    "ar-exp-tolerance",
    TOLERANCES_DEG.map((value) => String(value)),
    String(current.trustToleranceDeg),
  );
  const consistency = checkbox(
    "ar-exp-consistency",
    current.webXRConsistencyEnabled,
  );

  body.append(
    // LABELLED BY WHAT THEY DO, not by their config-field names: this is read
    // outdoors on a phone, and `useCompassPairSelection` means nothing there.
    row("permanent compass", prior),
    row("trust gate", gate),
    row("pair re-solve", pairs),
    row("trust tolerance °", tolerance),
    row("compass health gate", consistency),
  );
  element.append(gear, body);

  gear.addEventListener("click", () => {
    // `hidden` is typed `boolean | string` (the HTML `hidden="until-found"`
    // value), so it is compared rather than passed through.
    setOpen(body.hidden !== false);
  });

  return {
    attach() {
      if (attached) return;
      options.root.append(element);
      attached = true;
    },
    values() {
      return current;
    },
    dispose() {
      if (!attached) return;
      element.remove();
      attached = false;
    },
  };
}
