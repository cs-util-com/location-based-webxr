/**
 * The hero film's stand-in until the film lands: the host keeps the
 * static still that `index.html` draws in it, and nothing moves. It
 * implements the film's mount interface (`landing-mount.ts`,
 * `LandingFilmOptions`), so the page wires the real film by changing one
 * import.
 *
 * @see film-placeholder.ts.md
 */
import type { LandingFilmOptions, LandingPart } from "./landing-mount.js";

export function mountLandingFilm(
  host: HTMLElement,
  options: LandingFilmOptions,
): LandingPart {
  host.dataset["film"] = "still";
  // Nothing to stop: the still uses no GPU. Registered all the same, so
  // the page's AR signal is exercised the way the film will use it.
  const unregister = options.onArStarting(() => undefined);
  return {
    destroy() {
      unregister();
      delete host.dataset["film"];
    },
  };
}
