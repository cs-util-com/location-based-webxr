/**
 * A HUD chip whose label folds to its icon after its first use (polish
 * round M3, the owner's D-P4 on the H1 strip): remembered per device, and
 * a long press shows the label again.
 *
 * @see folding-label.ts.md
 */

/** A press at least this long unfolds the label instead of acting. */
export const LONG_PRESS_MS = 500;

const KEY_PREFIX = "tour-viewer.hud.folded.";

/** The storage it remembers in (`localStorage`); null: none. */
export interface FoldStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The chip, structurally (the unit tests pass a plain object). */
export interface FoldingButton {
  dataset: Record<string, string | undefined>;
  setAttribute(name: string, value: string): void;
  addEventListener(
    type: string,
    handler: (event: {
      preventDefault(): void;
      stopImmediatePropagation(): void;
    }) => void,
    options?: { capture?: boolean },
  ): void;
}

/** Storage that throws (a private window, blocked site data) is no
 *  storage: the chip keeps working, unfolded. */
function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

/**
 * Wire `button` (it carries its icon and a `.chip-label`; CSS hides the
 * label while `data-folded` is set). A tap acts and folds; a press held for
 * `LONG_PRESS_MS` unfolds while the finger is still down - on a phone a
 * long press ends in the context menu and no click, so the unfold cannot
 * wait for the click (M3 review #6). Any click that still follows a long
 * press is swallowed in the capture phase, so it never also places a pin.
 * At the target, capture listeners run before bubble ones whatever the
 * registration order (the DOM spec since 2021; measured in Chromium 153,
 * PR #598 review), so this does not depend on being wired first.
 */
export function wireFoldingLabel(deps: {
  button: FoldingButton;
  key: string;
  label: string;
  store: FoldStore | null;
  /** A one-shot timer; returns its cancel (`setTimeout` on the page). */
  schedule: (fn: () => void, ms: number) => () => void;
}): void {
  const { button, store } = deps;
  const key = KEY_PREFIX + deps.key;
  button.setAttribute("aria-label", deps.label);

  function show(folded: boolean): void {
    if (folded) button.dataset["folded"] = "true";
    else delete button.dataset["folded"];
  }
  show(safely(() => store?.getItem(key) === "1", false));

  let cancelPress: (() => void) | null = null;
  let longPressed = false;
  function endPress(): void {
    cancelPress?.();
    cancelPress = null;
  }
  button.addEventListener("pointerdown", () => {
    endPress();
    longPressed = false;
    cancelPress = deps.schedule(() => {
      cancelPress = null;
      longPressed = true;
      safely(() => store?.setItem(key, "0"), undefined);
      show(false);
    }, LONG_PRESS_MS);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    button.addEventListener(type, endPress);
  }
  // A phone's long press would open the context menu over the chip.
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  button.addEventListener(
    "click",
    (event) => {
      if (longPressed) {
        // The long press unfolded; it is not also a tap on the chip.
        longPressed = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      safely(() => store?.setItem(key, "1"), undefined);
      show(true);
    },
    { capture: true },
  );
}
