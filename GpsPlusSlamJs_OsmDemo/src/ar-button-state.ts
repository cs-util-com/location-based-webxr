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
   * Whether a press would find the user before starting AR.
   *
   * REPLACED `hasFix`, AND WITH IT THE ONLY DISABLED STATE THIS TYPE HAD
   * (round three, G6, DEC-W2). The button used to be disabled until the
   * framework had a `zero`, with the reason carried in `title`/`aria-label` —
   * neither of which a phone shows. What the thirteenth session met was a
   * faint square that ignored them, and its report is the strongest possible
   * evidence that "visible but disabled, with the reason in the accessible
   * name" does not work on touch.
   *
   * So the press now DOES the thing that had to happen first, and this input
   * says only whether it will. It is `arPressAction(...).kind === "locate"`,
   * which is a wider question than `hasFix` was: a view moved away from the
   * user answers true as well, because AR used to be enterable while the scene
   * was anchored somewhere they are not. See `ar-entry.ts`.
   */
  readonly willLocateFirst: boolean;
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
  if (inputs.willLocateFirst) {
    // ENABLED, and that is the whole change. This used to be the one disabled
    // state — "visible but disabled" while waiting for a fix, on the reasoning
    // that the state is temporary and self-resolving so the control must be
    // discoverable before it is usable. The control WAS discoverable and did
    // nothing when discovered, which is what got reported.
    //
    // The hint survives, and it is now a promise rather than an excuse: press
    // this and it will find you first. It still only reaches the accessible
    // name — no better on touch than before — but nothing rests on it now,
    // because the button works either way.
    return {
      hidden: false,
      disabled: false,
      label: "Enter AR",
      hint: "Finds your location first",
    };
  }
  return { hidden: false, disabled: false, label: "Enter AR" };
}
