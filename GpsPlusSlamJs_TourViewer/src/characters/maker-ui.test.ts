// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { busy, offerUndo } from "./maker-ui.js";

function button(label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  document.body.append(b);
  return b;
}

describe("maker-ui", () => {
  // Why: the async rule: every import and save shows its in-progress state
  // for the time it takes and comes back when it settles, also on failure.
  it("shows the busy state while the work runs and restores it", async () => {
    const b = button("Save");
    let release!: () => void;
    const work = busy(
      b,
      "Saving...",
      () => new Promise<string>((r) => (release = () => r("ok"))),
    );
    expect([b.textContent, b.disabled, b.getAttribute("aria-busy")]).toEqual([
      "Saving...",
      true,
      "true",
    ]);
    release();
    await expect(work).resolves.toBe("ok");
    expect([b.textContent, b.disabled, b.getAttribute("aria-busy")]).toEqual([
      "Save",
      false,
      null,
    ]);
  });

  it("restores the button when the work fails", async () => {
    const b = button("Import");
    await expect(
      busy(b, "Reading...", () => Promise.reject(new Error("bad"))),
    ).rejects.toThrow("bad");
    expect([b.textContent, b.disabled]).toEqual(["Import", false]);
  });

  // Why: two overlapping runs on one button (an import waiting for a name
  // while a second starts) keep the first idle label and release last.
  it("keeps the idle label across overlapping runs", async () => {
    const b = button("Import");
    let first!: () => void;
    const one = busy(
      b,
      "Reading...",
      () => new Promise<void>((r) => (first = r)),
    );
    let second!: () => void;
    const two = busy(
      b,
      "Saving...",
      () => new Promise<void>((r) => (second = r)),
    );
    first();
    await one;
    expect(b.disabled).toBe(true);
    second();
    await two;
    expect([b.textContent, b.disabled]).toEqual(["Import", false]);
  });

  // Why: "Start over" and "Discard" can be undone for a few seconds; the
  // offer runs its undo once and then goes away, or lapses on its own.
  it("offers an undo that runs once or lapses", () => {
    vi.useFakeTimers();
    const box = document.createElement("div");
    const run = vi.fn();
    offerUndo(box, "Started over", run);
    const undo = box.querySelector("button")!;
    expect(box.textContent).toContain("Started over");
    undo.click();
    expect(run).toHaveBeenCalledOnce();
    expect(box.children).toHaveLength(0);
    offerUndo(box, "Discarded", run);
    vi.advanceTimersByTime(6000);
    expect(box.children).toHaveLength(0);
    vi.useRealTimers();
  });
});
