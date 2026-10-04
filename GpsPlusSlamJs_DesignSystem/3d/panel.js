/**
 * The look-dev control plate's collapse (programme plan 2026-09-26-0539,
 * W1 M2): on a phone the plate covered the scene. Its header folds the whole
 * body, each `<details>` section folds on its own, the choice survives a
 * reload, and a narrow screen starts folded. The error box sits outside the
 * body, so a folded plate never hides an error.
 *
 * It also installs the framework's slider guard for the whole page (owner
 * report 2026-09-30): a vertical swipe that starts on one of the plate's
 * sliders scrolls the plate instead of editing the value. Every page that
 * loads this module (the look-dev page, the globe and terrain labs) gets it.
 *
 * @see panel.js.md
 */
import { guardSlidersIn } from "/fw/utils/slider-scroll-guard.js";

/** Namespaced: the page shares its origin with every app on the preview. */
export const PANEL_STORAGE_KEY = "lookdev.panel";

/** Below this width the plate starts folded (unless the user chose). */
export const NARROW_QUERY = "(max-width: 600px)";

/** The stored choice, or null when there is none or storage is refused. */
function readChoice(storage) {
  try {
    const value = storage?.getItem(PANEL_STORAGE_KEY);
    return value === "open" || value === "collapsed" ? value : null;
  } catch {
    return null;
  }
}

function writeChoice(storage, value) {
  try {
    storage?.setItem(PANEL_STORAGE_KEY, value);
  } catch {
    // Private windows can refuse storage; the fold still works this visit.
  }
}

/**
 * Wires the header button to the body. Does nothing when the page lacks
 * either (a lab page without a plate).
 *
 * @param {Document} doc
 * @param {{ storage?: Storage | null, narrow?: boolean }} [options]
 */
export function initPanel(doc, options = {}) {
  const head = doc.querySelector(".lookdev-head");
  const body = doc.getElementById("lookdev-body");
  if (!head || !body) return;
  const storage = "storage" in options ? options.storage : safeStorage();
  const narrow =
    options.narrow ?? globalThis.matchMedia?.(NARROW_QUERY).matches ?? false;
  const set = (open) => {
    head.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
  };
  const choice = readChoice(storage);
  set(choice === null ? !narrow : choice === "open");
  head.addEventListener("click", () => {
    const open = body.hidden;
    set(open);
    writeChoice(storage, open ? "open" : "collapsed");
  });
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

initPanel(document);
guardSlidersIn(document);
