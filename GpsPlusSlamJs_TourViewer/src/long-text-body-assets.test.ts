import { describe, expect, it } from "vitest";

import { bodyPictureAssets } from "./long-text-body-assets.js";

describe("the pictures a long text's body shows", () => {
  // Why this test matters: a write keeps exactly the assets something
  // names, and a body names its pictures only inside its Markdown. A
  // picture missed here is a file every Finish deletes; one counted that
  // never shows is a file every copy carries for nothing.
  it("lists every picture block at any depth, in order, each once", () => {
    expect(bodyPictureAssets("Just words.")).toEqual([]);
    expect(
      bodyPictureAssets(
        [
          "Intro.",
          "![The gate](asset:gate)",
          "- one\n\n  ![The mill](asset:mill)",
          "> ![The bell](asset:bell)",
          "![The gate again](asset:gate)",
        ].join("\n\n"),
      ),
    ).toEqual(["gate", "mill", "bell"]);
  });

  // Why this test matters: an inline picture shows its alt text only (the
  // Markdown subset, design 5.3), so it names no asset to keep.
  it("lists no inline picture", () => {
    expect(bodyPictureAssets("Look ![x](asset:a) here.")).toEqual([]);
  });
});
