/**
 * A header checkbox whose choice rebuilds the city (the invented roofs, the
 * zebras and pedestrian areas): shows the switch in progress, ends it on the
 * mesh built with the choice, and reverts a switch whose own build failed.
 *
 * It follows the colour-scheme dropdown (`colour-scheme-switch.ts`) on
 * purpose, so the header controls behave alike:
 *
 * - "Done" is the ECHO, not the dispatch: the switch is a full rebuild in the
 *   worker, and a pass already in flight with the old choice also ends in a
 *   full mesh, so the in-progress state clears only on a drawn mesh built with
 *   the chosen value (absent meaning on, every such choice defaulting on).
 * - Every failure ends the switch; only a failed city build WITH the chosen
 *   value reverts it to what is drawn. The error itself goes to the page's
 *   existing error channel.
 *
 * @see build-choice-switch.ts.md
 */

export interface BuildChoiceSwitchOptions {
  /** Names the switch in its errors. */
  readonly name: string;
  readonly box: HTMLInputElement;
  /** A polite live region beside the box. */
  readonly status: HTMLElement;
  /** The choice the page boots with (the store's, from the link). */
  readonly initial: boolean;
  /** Records the choice (the store dispatch); the rebuild follows from it. */
  readonly choose: (on: boolean) => void;
  /** The status while a choice is applied, e.g. "Applying flat roofs...". */
  readonly applying: (on: boolean) => string;
}

export interface BuildChoiceSwitch {
  /** The store's choice changed (a toggle, a revert): the box follows it. */
  show(on: boolean): void;
  /** A full mesh was drawn, built with `on` (absent means on). */
  meshDrawn(on: boolean | undefined): void;
  /**
   * A refresh failed. `failedOn` is the choice the failed city build used,
   * absent for any other failure.
   */
  failed(failedOn?: boolean): void;
  /** The choice being applied, or `undefined` when none is. */
  pending(): boolean | undefined;
}

/** Wires the checkbox; the caller keeps it in the page. */
export function attachBuildChoiceSwitch(
  options: BuildChoiceSwitchOptions,
): BuildChoiceSwitch {
  const { box, status, choose, applying } = options;
  if (typeof options.initial !== "boolean") {
    throw new TypeError(`${options.name}: initial must be a boolean`);
  }
  box.checked = options.initial;

  let chosen = options.initial;
  /** The choice the drawn city was built with: what a failed switch reverts to. */
  let drawn = options.initial;
  let waitingFor: boolean | undefined;

  const paint = (): void => {
    box.disabled = waitingFor !== undefined;
    status.textContent = waitingFor === undefined ? "" : applying(waitingFor);
  };

  box.addEventListener("change", () => {
    const on = box.checked;
    if (on === chosen) return;
    waitingFor = on;
    paint();
    choose(on);
  });

  paint();
  return {
    show(on) {
      chosen = on;
      box.checked = on;
    },
    meshDrawn(on) {
      if (on !== undefined && typeof on !== "boolean") return;
      drawn = on ?? true;
      if (waitingFor !== undefined && drawn === waitingFor) {
        waitingFor = undefined;
        paint();
      }
    },
    failed(failedOn) {
      if (waitingFor === undefined) return;
      const ownBuild = failedOn === waitingFor;
      waitingFor = undefined;
      paint();
      if (!ownBuild) return;
      box.checked = drawn;
      choose(drawn);
    },
    pending() {
      return waitingFor;
    },
  };
}
