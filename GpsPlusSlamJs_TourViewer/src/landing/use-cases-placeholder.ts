/**
 * The use cases' stand-in until their pictures land: the host keeps the
 * short static list that `index.html` writes in it. It implements the use
 * cases' mount interface (`landing-mount.ts`), so the page wires the real
 * section by changing one import.
 *
 * @see use-cases-placeholder.ts.md
 */
import type { LandingPart } from "./landing-mount.js";

export function mountUseCases(host: HTMLElement): LandingPart {
  host.dataset["uses"] = "static";
  return {
    destroy() {
      delete host.dataset["uses"];
    },
  };
}
