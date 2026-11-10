import { describe, expect, it } from "vitest";

import { PROMPT_EMPTY, promptText } from "./maker-prompt.js";

describe("maker-prompt", () => {
  // Why: the author's words go into the prompt as written; with none, the
  // placeholder says what to write, so a copied empty prompt still works.
  it("puts the description into the prompt, or the placeholder", () => {
    expect(promptText("  a fox  ")).toContain("Character: a fox\n");
    expect(promptText(" ")).toContain(PROMPT_EMPTY);
  });

  // Why: the cut needs four poses on transparency or flat white, in this
  // order; the prompt is what asks the image AI for that.
  it("asks for the four poses the cut expects", () => {
    const p = promptText("x");
    for (const pose of [
      "1. IDLE",
      "2. TALKING A",
      "3. TALKING B",
      "4. POINTING",
    ]) {
      expect(p).toContain(pose);
    }
    expect(p).toContain("Transparent background");
  });
});
