import { describe, expect, it } from "vitest";

import { createWalkToast } from "./walk-toast";

/**
 * Why these tests matter (visitor walk W4 build plan M2, §1.4): the
 * visitor's status is re-rendered on every camera frame, so news routed to
 * the toast ("Tour placed by GPS (less exact)") would restart the toast -
 * and be announced again - sixty times a second. Said once per AR entry it
 * reads as news; a new entry may say it again.
 */
function fakeToast() {
  const shown: string[] = [];
  let clears = 0;
  return {
    shown,
    clears: () => clears,
    toast: {
      show: (text: string) => {
        shown.push(text);
      },
      clear: () => {
        clears += 1;
      },
    },
  };
}

describe("createWalkToast", () => {
  it("says a news item once per AR entry, and again after a new entry", () => {
    const f = fakeToast();
    const t = createWalkToast(f.toast);
    t.sayOnce("Tour placed by GPS (less exact)");
    t.sayOnce("Tour placed by GPS (less exact)");
    t.sayOnce("2 items could not load.");
    expect(f.shown).toEqual([
      "Tour placed by GPS (less exact)",
      "2 items could not load.",
    ]);
    t.reset();
    expect(f.clears()).toBe(1);
    t.sayOnce("Tour placed by GPS (less exact)");
    expect(f.shown).toHaveLength(3);
  });

  it("says an event every time, and never an empty text", () => {
    const f = fakeToast();
    const t = createWalkToast(f.toast);
    t.say("Skipped The well.");
    t.say("Skipped The well.");
    t.say("");
    t.sayOnce("");
    expect(f.shown).toEqual(["Skipped The well.", "Skipped The well."]);
  });
});
