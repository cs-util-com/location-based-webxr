/**
 * Why these tests matter: Paste and a folder's Duplicate read pictures
 * before they write, and while a draft is undecided their edit waits for
 * the creator's answer. The page must show that work is running (a held
 * toast marked busy, the busy flag that keeps a second paste out), clear
 * both however it ends, say a refusal, and never say "Pasted" for an
 * edit that has not landed - nor for one dropped, nor into a tour the
 * creator switched away from.
 */
import { describe, expect, it } from "vitest";

import type { EditorHeld } from "./editor-session.js";
import {
  EDIT_STILL_RUNNING,
  type HeldEditFlow,
  runHeldEdit,
} from "./held-edit-flow.js";

interface Made {
  readonly kind: "made";
  readonly id: string;
}

type Outcome =
  | Made
  | EditorHeld<Made>
  | { readonly kind: "refused"; readonly reason: string };

/** A flow over `outcome`, recording what the page was told, in order. */
function harness(outcome: () => Promise<Outcome>) {
  const log: string[] = [];
  let current = true;
  const flow: HeldEditFlow<Made> = {
    working: "Pasting...",
    run: outcome,
    current: () => current,
    running: () => false,
    busy: (on) => log.push(`busy ${String(on)}`),
    toast: (text, held) => {
      log.push(`toast ${text}${held ? " (held)" : ""}`);
      return {
        setAttribute: (name, value) => log.push(`${name}=${value}`),
        remove: () => log.push(`removed ${text}`),
      };
    },
    refresh: () => log.push("refresh"),
    made: (result) => log.push(`made ${result.id}`),
  };
  return { flow, log, switchTour: () => (current = false) };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("an edit that reads first", () => {
  it("shows a busy held toast while it runs, then says what it made", async () => {
    const read = deferred<Outcome>();
    const { flow, log } = harness(() => read.promise);
    const running = runHeldEdit(flow);
    expect(log).toEqual([
      "busy true",
      "toast Pasting... (held)",
      "aria-busy=true",
    ]);
    read.resolve({ kind: "made", id: "c1" });
    await running;
    expect(log.slice(3)).toEqual([
      "refresh",
      "made c1",
      "removed Pasting...",
      "busy false",
    ]);
  });

  // An unreadable picture is the paste's own failure: said, nothing made.
  it("says a refusal, such as an unreadable picture, and makes nothing", async () => {
    const { flow, log } = harness(() =>
      Promise.resolve({
        kind: "refused",
        reason: "The picture could not be read",
      }),
    );
    await runHeldEdit(flow);
    expect(log).toContain("toast The picture could not be read");
    expect(log.some((l) => l.startsWith("made"))).toBe(false);
    expect(log.slice(-2)).toEqual(["removed Pasting...", "busy false"]);
  });

  it("clears the busy flag and the toast when the edit throws", async () => {
    const { flow, log } = harness(() => Promise.reject(new Error("boom")));
    await expect(runHeldEdit(flow)).rejects.toThrow("boom");
    expect(log.slice(-2)).toEqual(["removed Pasting...", "busy false"]);
  });

  it("says nothing for a tour switched while it ran", async () => {
    const read = deferred<Outcome>();
    const { flow, log, switchTour } = harness(() => read.promise);
    const running = runHeldEdit(flow);
    switchTour();
    read.resolve({ kind: "made", id: "c1" });
    await running;
    expect(log.slice(3)).toEqual(["removed Pasting...", "busy false"]);
  });
});

// Why: a second Paste or Duplicate while one still reads its pictures
// would make nothing; the Edit menu says so, and the key must say the
// same instead of nothing at all.
describe("an edit asked for while another runs", () => {
  it("says that one still runs and runs nothing", async () => {
    const { flow, log } = harness(() => {
      throw new Error("must not run");
    });
    await runHeldEdit({ ...flow, running: () => true });
    expect(log).toEqual([`toast ${EDIT_STILL_RUNNING}`]);
  });
});

describe("an edit held by the draft question", () => {
  it("says nothing until it lands, then what it made; the busy flag is off meanwhile", async () => {
    const landing = deferred<Made | null>();
    const { flow, log } = harness(() =>
      Promise.resolve({ kind: "held", landed: landing.promise }),
    );
    const running = runHeldEdit(flow);
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual([
      "busy true",
      "toast Pasting... (held)",
      "aria-busy=true",
      "refresh",
      "removed Pasting...",
      "busy false",
    ]);
    landing.resolve({ kind: "made", id: "c1" });
    await running;
    expect(log.slice(6)).toEqual(["refresh", "made c1"]);
  });

  it("says nothing when it is dropped, or lands in a tour switched away from", async () => {
    for (const end of ["dropped", "switched"] as const) {
      const landing = deferred<Made | null>();
      const { flow, log, switchTour } = harness(() =>
        Promise.resolve({ kind: "held", landed: landing.promise }),
      );
      const running = runHeldEdit(flow);
      await Promise.resolve();
      if (end === "switched") switchTour();
      landing.resolve(end === "dropped" ? null : { kind: "made", id: "c1" });
      await running;
      expect(log.some((l) => l.startsWith("made"))).toBe(false);
      expect(log.at(-1)).toBe("busy false");
    }
  });
});
