/**
 * What the AR button shows, derived rather than imperatively toggled.
 *
 * **DEC-12's shape: locate-me first, then an AR button that appears once GPS is
 * live — and the map STAYS.** That last clause is why this is a derivation and
 * not a copy of `WayfindingHudDemo`'s pattern, which is
 * `startArButton.hidden = !arSupported; simNote.hidden = arSupported`. Applied
 * literally here, **any WebXR-capable phone loses the map view** — the primary
 * interface, and today the only way to drive the data.
 *
 * **WHY A PURE FUNCTION.** The button has four inputs (support, a GPS fix, a
 * live session, an error) and they interact: "supported but no fix yet" and
 * "unsupported" are different messages, and only one of them is temporary.
 * Toggling attributes at four call sites is how a UI ends up in a state nobody
 * designed — and none of it is reachable by a unit test once it lives in
 * `main.ts`, which needs a DOM, a map and a worker to construct.
 *
 * @see ar-button-state.ts.md
 */

/** Whether the device can do immersive AR at all. */
export type ArSupport = "checking" | "supported" | "unsupported";

export interface ArButtonInputs {
  readonly support: ArSupport;
  /**
   * Whether the framework has a `zero` yet.
   *
   * The gate is a GPS FIX, not a map click. The demo's position moves on every
   * click; `zero` is taken from the first fix and is what the alignment matrix
   * is expressed against. See `ar-origin.ts`.
   */
  readonly hasFix: boolean;
  /** Whether a session is currently running. */
  readonly active: boolean;
}

export interface ArButtonState {
  /** Hidden entirely — there is nothing useful to offer. */
  readonly hidden: boolean;
  readonly disabled: boolean;
  readonly label: string;
  /**
   * Why the button is disabled, for a title/aria attribute.
   *
   * `undefined` when the button is usable. A disabled control with no
   * explanation is the thing users report as "the button is broken".
   */
  readonly hint?: string;
}

/**
 * Derive the button from what is known.
 *
 * ORDER MATTERS and is not arbitrary: `active` wins over everything because a
 * running session must always offer a way out, and `unsupported` beats "no fix"
 * because waiting for a fix on a device that can never enter AR is a promise
 * that will not be kept.
 */
export function arButtonState(inputs: ArButtonInputs): ArButtonState {
  if (inputs.active) {
    // ALWAYS ENABLED. The Android back gesture also exits, but a button the
    // user can see is the one they will look for, and a disabled exit on a
    // full-screen session reads as being trapped.
    return { hidden: false, disabled: false, label: "Exit AR" };
  }
  if (inputs.support === "checking") {
    // Hidden rather than disabled: the probe resolves in milliseconds, and a
    // control that flickers disabled→enabled on every load is worse than one
    // that appears once.
    return { hidden: true, disabled: true, label: "AR" };
  }
  if (inputs.support === "unsupported") {
    // HIDDEN, NOT DISABLED. There is no action the user can take, and the map
    // is the whole app on this device — a permanently greyed control just
    // advertises something they cannot have.
    return { hidden: true, disabled: true, label: "AR" };
  }
  if (!inputs.hasFix) {
    // VISIBLE BUT DISABLED, which is the one case where the distinction earns
    // its keep: this state is temporary and self-resolving, so the button has
    // to be discoverable before it becomes usable — otherwise it appears
    // without warning under the user's thumb.
    return {
      hidden: false,
      disabled: true,
      label: "AR",
      hint: "Waiting for a GPS fix",
    };
  }
  return { hidden: false, disabled: false, label: "Enter AR" };
}
