import { describe, expect, it } from "vitest";

import { createWalkToast } from "./walk-toast";

/**
 * Why these tests matter (visitor walk W4 build plan M2, §1.4): the
 * visitor's status is re-rendered on every camera frame, so news routed to
 * the toast ("Tour placed by GPS (less exact)") would restart the toast -
 * and be announced again - sixty times a second. Said once per AR entry it
 * reads as news; a new entry may say it again.
 */
/** The next task: what one render said is joined until then. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

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
  it("says a news item once per AR entry, and again after a new entry", async () => {
    const f = fakeToast();
    const t = createWalkToast(f.toast);
    t.say([], ["Tour placed by GPS (less exact)"]);
    await nextTask();
    t.say([], ["Tour placed by GPS (less exact)"]);
    await nextTask();
    t.say([], ["2 items could not load."]);
    await nextTask();
    expect(f.shown).toEqual([
      "Tour placed by GPS (less exact)",
      "2 items could not load.",
    ]);
    t.reset();
    expect(f.clears()).toBe(1);
    t.say([], ["Tour placed by GPS (less exact)"]);
    expect(f.shown).toHaveLength(3);
  });

  it("says an event every time, and never an empty text", async () => {
    const f = fakeToast();
    const t = createWalkToast(f.toast);
    t.say(["Skipped The well."]);
    await nextTask();
    t.say(["Skipped The well."]);
    await nextTask();
    t.say([""]);
    t.say([], [""]);
    t.say([]);
    expect(f.shown).toEqual(["Skipped The well.", "Skipped The well."]);
  });

  // Why (W4 M2 review): the framework's toast shows one message; a second
  // show in the same render replaced the first before anyone read it,
  // and the lost news counted as said, so it never came back. One
  // render's words are one toast.
  it("joins one render's events and news into one toast, and marks only what it showed as said", async () => {
    const f = fakeToast();
    const t = createWalkToast(f.toast);
    t.say(
      ["Skipped The well.", "Welcome back - your progress is kept."],
      ["Tour placed by GPS (less exact)", "Tour placed by GPS (less exact)"],
    );
    expect(f.shown).toEqual([
      "Skipped The well. Welcome back - your progress is kept. Tour placed by GPS (less exact)",
    ]);
    await nextTask();
    t.say([], ["Tour placed by GPS (less exact)", "1 item could not load."]);
    expect(f.shown.at(-1)).toBe("1 item could not load.");
    expect(f.shown).toHaveLength(2);
  });
});

describe("createWalkToast - two call sites in one frame", () => {
  // Why: the status (its news, "Tour placed by GPS (less exact)") and the
  // sheet (its events, the welcome back) each say their words, and on a
  // tour of stories both run in the same frame - the sheet's first render
  // re-renders the status. A second show replaced the first unread, and
  // the lost news counted as said, so it never came back that entry
  // (`visitor-walk.spec.js`, coming back to a tour placed by GPS).
  it("joins the words of every say in one task into one toast, and starts afresh in the next", async () => {
    const f = fakeToast();
    const t = createWalkToast(f.toast);
    t.say([], ["Tour placed by GPS (less exact)"]);
    t.say(["Welcome back - your progress is kept."]);
    expect(f.shown.at(-1)).toBe(
      "Tour placed by GPS (less exact) Welcome back - your progress is kept.",
    );
    // A word said twice in one task is shown once.
    t.say(["Welcome back - your progress is kept."]);
    expect(f.shown.at(-1)).toBe(
      "Tour placed by GPS (less exact) Welcome back - your progress is kept.",
    );
    await nextTask();
    t.say(["Skipped The well."]);
    expect(f.shown.at(-1)).toBe("Skipped The well.");
  });

  it("a say with nothing left to say keeps the frame's toast as it is", () => {
    const f = fakeToast();
    const t = createWalkToast(f.toast);
    t.say([], ["Tour placed by GPS (less exact)"]);
    t.say([], ["Tour placed by GPS (less exact)"]);
    t.say([]);
    expect(f.shown).toEqual(["Tour placed by GPS (less exact)"]);
  });

  it("a reset ends the frame's toast: the next say starts afresh", () => {
    const f = fakeToast();
    const t = createWalkToast(f.toast);
    t.say(["Skipped The well."]);
    t.reset();
    t.say(["Welcome back - your progress is kept."]);
    expect(f.shown.at(-1)).toBe("Welcome back - your progress is kept.");
  });
});

describe("createWalkToast - the words no other region announces", () => {
  // Why (W4 M2 review): the toast's root is aria-hidden, since the status
  // and the station line announce its words already - all but the welcome
  // back, which only the toast says. Without its own region a screen
  // reader would never hear it; reset() empties the region, so a later
  // entry's same words are announced again.
  it("writes an announced-only-here text to its live region, and empties it on reset", () => {
    const f = fakeToast();
    const live = { textContent: "" as string | null };
    const t = createWalkToast(f.toast, live);
    t.announce("Welcome back - your progress is kept.");
    expect(live.textContent).toBe("Welcome back - your progress is kept.");
    t.announce("");
    expect(live.textContent).toBe("Welcome back - your progress is kept.");
    t.reset();
    expect(live.textContent).toBe("");
    expect(f.shown).toEqual([]);
  });

  it("announces nothing without a live region", () => {
    const f = fakeToast();
    const t = createWalkToast(f.toast);
    expect(() => {
      t.announce("Welcome back - your progress is kept.");
    }).not.toThrow();
  });
});
