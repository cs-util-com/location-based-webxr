/**
 * The use cases' height as this tab last measured it, kept for the next
 * load of the page. The page reserves the section's height before its
 * chunk arrives, so a reload that restores the scroll to the setup below it
 * is not pushed down when the section mounts. The page's own reservation
 * is a lower bound measured in one face; a wider face (another platform's
 * fallback) sets the section taller. The height this browser measured
 * itself, at the same width, is exact in any face. A classic inline script
 * in `index.html` (`#landing-uses-height`) reads it before the first paint;
 * `uses-height.test.ts` holds that copy to `keptUsesHeight`.
 *
 * @see uses-height.ts.md
 */

/** Where the height is kept (session storage: this tab, across reloads). */
export const USES_HEIGHT_KEY = "tour-viewer.landing.uses-height";

/** A kept height above this is not a section's height. */
const MAX_HEIGHT_PX = 20000;

/** The stored form of a measured height at a window width. */
export function encodeUsesHeight(width: number, height: number): string {
  return JSON.stringify({ width, height });
}

/**
 * The height to reserve at window width `width` from the stored value,
 * or null: nothing stored, another width, or a value that is not a
 * positive height below 20 000 px.
 */
export function keptUsesHeight(
  stored: string | null,
  width: number,
): number | null {
  if (stored === null) return null;
  let kept: unknown;
  try {
    kept = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof kept !== "object" || kept === null) return null;
  const { width: w, height: h } = kept as { width?: unknown; height?: unknown };
  if (w !== width || typeof h !== "number") return null;
  return h > 0 && h < MAX_HEIGHT_PX ? h : null;
}

/** The parts of the window `keepUsesHeight` uses. */
export interface UsesHeightEnv {
  readonly storage: Pick<Storage, "setItem"> | null;
  readonly width: () => number;
  /** Listens to the window's resize; returns the unlisten. */
  readonly onWindowResize: (listener: () => void) => () => void;
}

/**
 * Drops the reservation the inline script set on the mounted section's
 * host (its own height holds the place now) and keeps the host's height
 * for the next load, again whenever the host or the window resizes
 * (storage is written only when the kept value would change). The window
 * too: the value is keyed by its width, and on a wide window the capped
 * section keeps its size when only that width changes. Returns the unwatch. Storage that
 * throws (site data blocked, full) keeps nothing.
 */
export function keepUsesHeight(
  host: HTMLElement,
  env: UsesHeightEnv,
): () => void {
  host.style.removeProperty("min-height");
  let written: string | null = null;
  const keep = (): void => {
    const height = host.getBoundingClientRect().height;
    if (!(height > 0)) return;
    const value = encodeUsesHeight(env.width(), height);
    if (value === written) return;
    try {
      env.storage?.setItem(USES_HEIGHT_KEY, value);
      written = value;
    } catch {
      // nothing kept: the next load reserves the page's lower bound
    }
  };
  keep();
  const unlisten = env.onWindowResize(keep);
  if (typeof ResizeObserver !== "function") return unlisten;
  const watch = new ResizeObserver(keep);
  watch.observe(host);
  return () => {
    unlisten();
    watch.disconnect();
  };
}
