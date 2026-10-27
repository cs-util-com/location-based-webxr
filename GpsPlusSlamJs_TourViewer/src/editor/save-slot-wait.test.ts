import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { waitForSaveSlot, type SaveSlotView } from "./save-slot-wait.js";

/** A slot that runs `saves` saves, one after another: each holds it until
 *  the waiter awaits its end, then the next one claims it. `stuck`: the
 *  last one never lets go, though its end has come. */
function slotOf(saves: number, stuck = false) {
  let left = saves;
  let end: Promise<void> = Promise.resolve();
  const slot: SaveSlotView = {
    busy: () => left > 0,
    end: () => end,
    settled: vi.fn(async () => {
      if (left === 0) return;
      await end;
      if (stuck && left === 1) return;
      left -= 1;
      // The next save, if any, claims a new end.
      end = Promise.resolve();
    }),
  };
  return {
    slot,
    startSave: () => {
      left += 1;
      end = Promise.resolve();
    },
  };
}

/**
 * Why these tests matter: the write into the file chosen at a link's open
 * must take the page's one save slot only once no save holds it, with no
 * await between its last check and its claim (a save that started during
 * that await would otherwise run beside it and could adopt another file),
 * and it must never spin the tab on a claim left set on an ended save.
 */
describe("waitForSaveSlot", () => {
  it("answers at once when the slot is free", async () => {
    const { slot } = slotOf(0);
    const still = vi.fn(() => Promise.resolve("file"));
    await expect(waitForSaveSlot(slot, still)).resolves.toBe("file");
    expect(still).toHaveBeenCalledTimes(1);
    expect(slot.settled).not.toHaveBeenCalled();
  });

  it("waits for a running save, then asks again", async () => {
    const { slot } = slotOf(1);
    const still = vi.fn(() => Promise.resolve("file"));
    await expect(waitForSaveSlot(slot, still)).resolves.toBe("file");
    expect(still).toHaveBeenCalledTimes(2);
    expect(slot.busy()).toBe(false);
  });

  it("waits again for a save that claimed the slot during the last ask", async () => {
    const { slot, startSave } = slotOf(1);
    let asks = 0;
    const still = vi.fn(async () => {
      asks += 1;
      await Promise.resolve();
      // A save started while the second ask awaited.
      if (asks === 2) startSave();
      return "file";
    });
    await expect(waitForSaveSlot(slot, still)).resolves.toBe("file");
    expect(still).toHaveBeenCalledTimes(3);
    expect(slot.settled).toHaveBeenCalledTimes(2);
    expect(slot.busy()).toBe(false);
  });

  it("stops waiting on a claim still set on an ended save, never spinning", async () => {
    const { slot } = slotOf(1, true);
    const still = vi.fn(() => Promise.resolve("file"));
    await expect(waitForSaveSlot(slot, still)).resolves.toBe("file");
    expect(slot.settled).toHaveBeenCalledTimes(1);
    expect(still).toHaveBeenCalledTimes(1);
  });

  it("gives null, without waiting, when there is nothing to claim it for", async () => {
    const { slot } = slotOf(2);
    const still = vi.fn(() => Promise.resolve(null));
    await expect(waitForSaveSlot(slot, still)).resolves.toBeNull();
    expect(slot.settled).not.toHaveBeenCalled();
  });

  it("gives null when the reason to claim it went while a save ran", async () => {
    const { slot } = slotOf(1);
    const still = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("file")
      .mockResolvedValueOnce(null);
    await expect(waitForSaveSlot(slot, still)).resolves.toBeNull();
  });

  it("for any run of saves, answers only once the slot is free, asking once per wait", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 20 }), async (saves) => {
        const { slot } = slotOf(saves);
        const still = vi.fn(() => Promise.resolve("file"));
        await expect(waitForSaveSlot(slot, still)).resolves.toBe("file");
        expect(slot.busy()).toBe(false);
        expect(still).toHaveBeenCalledTimes(
          vi.mocked(slot.settled).mock.calls.length + 1,
        );
      }),
    );
  });
});
