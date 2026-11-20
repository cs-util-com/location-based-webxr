/**
 * "Start on this phone now, share later": one tap saves a new, empty tour
 * zip and opens it as the tour, before any AR.
 *
 * Why these tests matter: placing needs an open tour, so this tap is what
 * makes placing possible on this path. The zip must be SAVED before it is
 * opened - the saved file is the tour the work is written into at Done, so
 * opening an unsaved zip would let a maker place work into a tour with no
 * file behind it. A cancelled save picker is the maker's choice, not an
 * error, and must leave the button ready for another try; a failure must
 * reach the error channel and also revert the button (async UI feedback).
 */
import { describe, expect, it } from "vitest";

import type { OpenOutcome } from "./scan-open.js";
import { STARTER_OPEN_LABELS, wireStarterOpen } from "./starter-open.js";

class FakeButton {
  disabled = false;
  textContent: string | null = "";
  private click: (() => void) | undefined;
  addEventListener(type: string, fn: () => void) {
    if (type === "click") this.click = fn;
  }
  fire() {
    this.click?.();
  }
}

function setup(opts: {
  saved?: boolean | Error;
  opened?: OpenOutcome | Error;
  packed?: Blob | Error;
}) {
  const button = new FakeButton();
  const calls: string[] = [];
  const errors: string[] = [];
  const opened: File[] = [];
  const labels: (string | null)[] = [];
  const starter = wireStarterOpen({
    button,
    pack: () => {
      calls.push("pack");
      const packed = opts.packed ?? new Blob(["zip"]);
      return packed instanceof Error
        ? Promise.reject(packed)
        : Promise.resolve(packed);
    },
    save: (blob, filename) => {
      calls.push(`save ${filename}`);
      labels.push(button.textContent);
      const saved = opts.saved ?? true;
      void blob;
      return saved instanceof Error
        ? Promise.reject(saved)
        : Promise.resolve(saved);
    },
    open: (file) => {
      calls.push("open");
      labels.push(button.textContent);
      opened.push(file);
      const outcome = opts.opened ?? { kind: "opened" };
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
    onError: (message) => {
      errors.push(message);
    },
  });
  return { button, starter, calls, errors, opened, labels };
}

describe("wireStarterOpen", () => {
  it("shows the idle label and is enabled at first", () => {
    const { button } = setup({});
    expect(button.textContent).toBe(STARTER_OPEN_LABELS.idle);
    expect(button.disabled).toBe(false);
  });

  it("saves the starter zip BEFORE opening it, then opens that same zip as the tour", async () => {
    const { starter, calls, opened, labels, button, errors } = setup({});
    const outcome = await starter.run();
    expect(outcome).toBe("opened");
    expect(calls).toEqual(["pack", "save tour.zip", "open"]);
    expect(labels).toEqual([
      STARTER_OPEN_LABELS.saving,
      STARTER_OPEN_LABELS.opening,
    ]);
    expect(opened[0]?.name).toBe("tour.zip");
    expect(opened[0]?.type).toBe("application/zip");
    expect(await opened[0]?.text()).toBe("zip");
    expect(button.textContent).toBe(STARTER_OPEN_LABELS.opened);
    expect(button.disabled).toBe(false);
    expect(errors).toEqual([]);
  });

  it("opens nothing when the save is cancelled, and is ready to try again", async () => {
    const { starter, calls, button, errors } = setup({ saved: false });
    expect(await starter.run()).toBe("cancelled");
    expect(calls).toEqual(["pack", "save tour.zip"]);
    expect(button.textContent).toBe(STARTER_OPEN_LABELS.cancelled);
    expect(button.disabled).toBe(false);
    expect(errors).toEqual([]);
  });

  it("reports a failed save or pack and reverts the button", async () => {
    for (const failing of [
      { saved: new Error("disk full") },
      { packed: new Error("zip") },
    ]) {
      const { starter, calls, button, errors } = setup(failing);
      expect(await starter.run()).toBe("failed");
      expect(calls).not.toContain("open");
      expect(button.textContent).toBe(STARTER_OPEN_LABELS.failed);
      expect(button.disabled).toBe(false);
      expect(errors).toHaveLength(1);
    }
  });

  it("says the zip is saved when only the open fails, so the maker opens the saved file", async () => {
    for (const opened of [
      { kind: "failed", cause: "other" } as const,
      new Error("boom"),
    ]) {
      const { starter, button, errors } = setup({ opened });
      expect(await starter.run()).toBe("failed");
      expect(button.textContent).toBe(STARTER_OPEN_LABELS.openFailed);
      expect(button.disabled).toBe(false);
      expect(errors).toHaveLength(1);
    }
  });

  it("leaves the label to the newer open when this one was superseded or cancelled", async () => {
    for (const kind of ["superseded", "cancelled"] as const) {
      const { starter, button, errors } = setup({ opened: { kind } });
      expect(await starter.run()).toBe("cancelled");
      expect(button.textContent).toBe(STARTER_OPEN_LABELS.idle);
      expect(errors).toEqual([]);
    }
  });

  it("is disabled while it runs, so a second tap cannot save a second zip", async () => {
    const { starter, button, calls } = setup({});
    const first = starter.run();
    expect(button.disabled).toBe(true);
    expect(await starter.run()).toBe("busy");
    await first;
    expect(calls.filter((c) => c === "pack")).toHaveLength(1);
  });

  it("runs on a click", async () => {
    const { button, calls } = setup({});
    button.fire();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["pack", "save tour.zip", "open"]);
  });
});
