/**
 * The colour-scheme dropdown (colour schemes plan 2026-11-10-0841 section 4.4,
 * D6): fills the select, shows the switch in progress, and reverts a switch
 * whose build failed.
 *
 * WHY "DONE" IS THE ECHO, NOT THE DISPATCH. A switch is a full rebuild in the
 * worker (D1), and a pass already in flight with the old scheme also ends in a
 * full mesh. So the in-progress state clears only on a drawn mesh BUILT in
 * the chosen scheme (`TransferableMesh.colourScheme`), which is the durable
 * end state the root CLAUDE.md asks the final state to reflect.
 *
 * WHY ONLY THE SCHEME'S OWN BUILD FAILURE REVERTS. An Overpass error or a
 * pass aborted by a GPS fix says nothing about the scheme; the next pass
 * carries the choice again and finishes the switch. A city build that failed
 * in the chosen colours does: the select goes back to what is drawn, and the
 * error itself stays on the status line (the existing error channel).
 *
 * @see colour-scheme-switch.ts.md
 */

import {
  COLOUR_SCHEME_NAMES,
  DEFAULT_COLOUR_SCHEME,
  colourSchemeOf,
  failedColourSchemeOf,
  isColourSchemeName,
  type ColourSchemeName,
} from "./colour-schemes.js";

export interface ColourSchemeSwitchOptions {
  readonly select: HTMLSelectElement;
  /** A polite live region beside the select: "Applying <label>...". */
  readonly status: HTMLElement;
  /** The scheme the page boots with (the store's, from the link). */
  readonly initial: ColourSchemeName;
  /** Records the choice (the store dispatch); the rebuild follows from it. */
  readonly choose: (name: ColourSchemeName) => void;
}

export interface ColourSchemeSwitch {
  /** The store's choice changed (a pick, a revert): the select follows it. */
  show(name: ColourSchemeName): void;
  /** A full mesh was drawn, built in `scheme` (absent means the default). */
  meshDrawn(scheme: string | undefined): void;
  /** The refresh failed with `message` (the status line's error). */
  failed(message: string): void;
  /** AR draws the default whatever is chosen (D9): the select is disabled. */
  setArActive(active: boolean): void;
  /** The scheme being applied, or `undefined` when none is. */
  pending(): ColourSchemeName | undefined;
}

/** Why the select is disabled in AR; also its tooltip. */
export const AR_REASON = "AR always shows the default colours";

/** Wires the select. Fills it once; the caller keeps it in the page. */
export function attachColourSchemeSwitch(
  options: ColourSchemeSwitchOptions,
): ColourSchemeSwitch {
  const { select, status, choose } = options;
  if (!isColourSchemeName(options.initial)) {
    throw new RangeError(`unknown colour scheme: ${String(options.initial)}`);
  }
  for (const name of COLOUR_SCHEME_NAMES) {
    const option = select.ownerDocument.createElement("option");
    option.value = name;
    option.textContent = colourSchemeOf(name).label;
    select.append(option);
  }
  select.value = options.initial;

  /** The store's choice, as last shown. */
  let chosen: ColourSchemeName = options.initial;
  /** The scheme the drawn city was built in: what a failed switch reverts to. */
  let drawn: ColourSchemeName = options.initial;
  let waitingFor: ColourSchemeName | undefined;
  let arActive = false;

  const paint = (): void => {
    select.disabled = arActive || waitingFor !== undefined;
    select.title = arActive ? AR_REASON : "";
    status.textContent =
      waitingFor === undefined
        ? ""
        : `Applying ${colourSchemeOf(waitingFor).label}...`;
  };

  select.addEventListener("change", () => {
    const name = select.value;
    // Only the table's names are offered; anything else is a tampered page,
    // and the select goes back to what is drawn rather than asking for it.
    if (!isColourSchemeName(name) || name === chosen) {
      select.value = chosen;
      return;
    }
    waitingFor = name;
    paint();
    choose(name);
  });

  paint();
  return {
    show(name) {
      chosen = name;
      select.value = name;
    },
    meshDrawn(scheme) {
      if (scheme !== undefined && !isColourSchemeName(scheme)) return;
      drawn = scheme ?? DEFAULT_COLOUR_SCHEME;
      if (waitingFor !== undefined && drawn === waitingFor) {
        waitingFor = undefined;
        paint();
      }
    },
    failed(message) {
      if (waitingFor === undefined) return;
      if (failedColourSchemeOf(message) !== waitingFor) return;
      waitingFor = undefined;
      select.value = drawn;
      paint();
      choose(drawn);
    },
    setArActive(active) {
      if (active === arActive) return;
      arActive = active;
      // AR's entry pass builds the default, so the chosen scheme's echo will
      // not come before the exit pass, which builds it unasked.
      if (active) waitingFor = undefined;
      paint();
    },
    pending() {
      return waitingFor;
    },
  };
}
