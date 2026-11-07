/**
 * The View menu's quality entry.
 *
 * Why this file matters: the choice outlives the page, so what is stored
 * must be read back defensively (private windows throw, old values stay),
 * and a link has to win or a tester's link would silently do nothing.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  globeQualityChoiceToast,
  GLOBE_QUALITY_CHOICE,
  globeQualityChoiceLabel,
  nextGlobeQualityChoice,
  readGlobeQualityChoice,
  type GlobeQualityChoice,
  writeGlobeQualityChoice,
  qualityToOpenWith,
} from "./globe-quality-choice.js";

function memory(value: string | null = null) {
  let stored = value;
  return {
    getItem: () => stored,
    setItem: (_key: string, next: string) => {
      stored = next;
    },
  };
}

const broken = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

describe("readGlobeQualityChoice", () => {
  it("reads what was stored", () => {
    const storage = memory();
    expect(writeGlobeQualityChoice(storage, "low")).toBe(true);
    expect(readGlobeQualityChoice(storage)).toBe("low");
  });

  // Why this test matters: anything unknown is the automatic default,
  // which is the only value that keeps the step-down working.
  it("reads anything else as automatic", () => {
    expect(readGlobeQualityChoice(memory())).toBe("auto");
    expect(readGlobeQualityChoice(memory("ultra"))).toBe("auto");
    expect(readGlobeQualityChoice(broken)).toBe("auto");
    expect(readGlobeQualityChoice(null)).toBe("auto");
  });

  it("says when a choice could not be kept", () => {
    expect(writeGlobeQualityChoice(broken, "low")).toBe(false);
    expect(writeGlobeQualityChoice(null, "low")).toBe(false);
  });
});

describe("nextGlobeQualityChoice", () => {
  // Why this test matters: one menu entry cycles, so every choice must be
  // reachable from every other, automatic among them.
  it("walks through every choice and back", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...GLOBE_QUALITY_CHOICE.choices),
        (start: GlobeQualityChoice) => {
          const seen = new Set<GlobeQualityChoice>();
          let choice = start;
          for (const _ of GLOBE_QUALITY_CHOICE.choices) {
            seen.add(choice);
            choice = nextGlobeQualityChoice(choice);
          }
          expect(choice).toBe(start);
          expect(seen.size).toBe(GLOBE_QUALITY_CHOICE.choices.length);
        },
      ),
    );
  });
});

describe("globeQualityChoiceLabel", () => {
  it("names each choice in the menu's words", () => {
    expect(globeQualityChoiceLabel("auto")).toBe("Quality: Automatic");
    expect(globeQualityChoiceLabel("low")).toBe("Quality: Low");
    expect(globeQualityChoiceLabel("medium")).toBe("Quality: Medium");
    expect(globeQualityChoiceLabel("high")).toBe("Quality: High");
  });
});

describe("globeQualityChoiceToast", () => {
  // Why this test matters: with `quality=` in the link the choice does not
  // apply, and the toast must not say it does.
  it("says what the next open will do", () => {
    expect(globeQualityChoiceToast("High", true, null)).toBe(
      "High applies the next time the 3D view opens",
    );
    expect(globeQualityChoiceToast("High", false, null)).toBe(
      "High applies until this page closes",
    );
    expect(globeQualityChoiceToast("High", true, "low")).toBe(
      "High saved; the link overrides it",
    );
    expect(globeQualityChoiceToast("High", false, "low")).toBe(
      "High kept until this page closes; the link overrides it",
    );
  });
});

describe("qualityToOpenWith", () => {
  // Why this test matters: a link names a tier for a test run; a stored
  // choice must not override it, and automatic must stay "no name" so that
  // the view picks the default and may step down.
  it("takes the link over the choice, and no name for automatic", () => {
    expect(qualityToOpenWith("high", "low")).toBe("high");
    expect(qualityToOpenWith(null, "low")).toBe("low");
    expect(qualityToOpenWith(null, "auto")).toBeNull();
  });
});
