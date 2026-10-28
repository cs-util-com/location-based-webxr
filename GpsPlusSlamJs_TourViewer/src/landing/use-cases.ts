/**
 * Mounts the landing page's use-case section into its host: the thin DOM
 * seam over `use-case-markup.ts`, and the module that brings the section's
 * stylesheet into its chunk.
 *
 * @see use-cases.ts.md
 */
import "./use-cases.css";

import { USE_CASES } from "./use-case-data.js";
import { renderUseCases } from "./use-case-markup.js";

// The height keeper ships in this chunk, so it loads (or fails) with the
// section it keeps; the landing mounts both from this one import.
export { keepUsesHeight } from "./uses-height.js";

export interface MountedUseCases {
  /** Empties the host. Safe to call more than once. */
  destroy(): void;
}

/**
 * Replaces the host's content (the page's placeholder) with the use-case
 * section in the shipped look. Throws a TypeError without a host.
 */
export function mountUseCases(host: HTMLElement): MountedUseCases {
  if (host === null || typeof host !== "object") {
    throw new TypeError("mountUseCases needs a host element");
  }
  // The markup is built from this module's own data, every text escaped
  // (`use-case-markup.ts`), so writing it as HTML is safe.
  host.innerHTML = renderUseCases(USE_CASES);
  let mounted = true;
  return {
    destroy() {
      if (!mounted) return;
      mounted = false;
      host.replaceChildren();
    },
  };
}
