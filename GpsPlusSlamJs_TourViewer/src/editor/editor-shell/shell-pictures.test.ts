// @vitest-environment jsdom
/**
 * Why these tests matter: the tree is drawn again on every selection and
 * fold, each time with new card elements. A picture read once must show
 * on the new card at once (else every click blanks every card picture
 * until it is read again - a flicker on every redraw), and the replaced
 * cards must stop being watched (else every redraw leaves the observer
 * holding the cards it drew before). The pictures are read only when a
 * card comes into view, and let go when the shell is hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createShellPictures } from "./shell-pictures.js";

/** A 1 x 1 PNG: a picture whose size its header gives. */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/** The observer the pictures use, driven by the test. */
class FakeObserver {
  static last: FakeObserver | null = null;
  readonly watched = new Set<Element>();
  constructor(
    private readonly callback: (entries: IntersectionObserverEntry[]) => void,
  ) {
    FakeObserver.last = this;
  }
  observe(el: Element) {
    this.watched.add(el);
  }
  unobserve(el: Element) {
    this.watched.delete(el);
  }
  disconnect() {
    this.watched.clear();
  }
  /** `el` scrolls into view. */
  see(el: Element) {
    this.callback([
      {
        target: el,
        isIntersecting: true,
      } as unknown as IntersectionObserverEntry,
    ]);
  }
}

let made = 0;
const revoked: string[] = [];

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  made = 0;
  revoked.length = 0;
  URL.createObjectURL = () => {
    made += 1;
    return `blob:picture-${String(made)}`;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every pending read settled. */
async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function card(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

describe("createShellPictures", () => {
  it("reads a picture once its card is in view, and shows it", async () => {
    const load = vi.fn(() =>
      Promise.resolve(new Blob([PNG], { type: "image/png" })),
    );
    const pictures = createShellPictures({ load });
    const el = card();
    pictures.show(el, "content/gate.png");
    expect(load).not.toHaveBeenCalled();
    FakeObserver.last?.see(el);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(el.style.backgroundImage).toBe('url("blob:picture-1")');
  });

  it("shows a picture read before on a redrawn card at once, and stops watching the old card", async () => {
    const load = vi.fn(() =>
      Promise.resolve(new Blob([PNG], { type: "image/png" })),
    );
    const pictures = createShellPictures({ load });
    const first = card();
    pictures.show(first, "content/gate.png");
    FakeObserver.last?.see(first);
    await settle();
    // A redraw: the old card leaves, a new one takes its place.
    const unseen = card();
    pictures.show(unseen, "content/steps.png");
    first.remove();
    unseen.remove();
    const again = card();
    pictures.show(again, "content/gate.png");
    // At once: no read, no waiting for the observer.
    expect(again.style.backgroundImage).toBe('url("blob:picture-1")');
    expect(load).toHaveBeenCalledTimes(1);
    pictures.sweep();
    expect(FakeObserver.last?.watched.has(first)).toBe(false);
    expect(FakeObserver.last?.watched.has(unseen)).toBe(false);
    expect(FakeObserver.last?.watched.has(again)).toBe(false);
  });

  it("leaves a picture that cannot be read as its placeholder", async () => {
    const pictures = createShellPictures({
      load: () => Promise.resolve(new Blob(["not a picture"])),
    });
    const el = card();
    pictures.show(el, "content/broken.png");
    FakeObserver.last?.see(el);
    await settle();
    expect(el.style.backgroundImage).toBe("");
    expect(made).toBe(0);
  });

  it("lets every picture go when cleared, and a read finishing after it too", async () => {
    let finish: (blob: Blob) => void = () => undefined;
    const late = new Promise<Blob>((resolve) => {
      finish = resolve;
    });
    const pictures = createShellPictures({
      load: (path) =>
        path === "late"
          ? late
          : Promise.resolve(new Blob([PNG], { type: "image/png" })),
    });
    const shown = card();
    pictures.show(shown, "content/gate.png");
    FakeObserver.last?.see(shown);
    const pending = card();
    pictures.show(pending, "late");
    FakeObserver.last?.see(pending);
    await settle();
    pictures.clear();
    await settle();
    expect(revoked).toEqual(["blob:picture-1"]);
    finish(new Blob([PNG], { type: "image/png" }));
    await settle();
    expect(revoked).toEqual(["blob:picture-1", "blob:picture-2"]);
    expect(pending.style.backgroundImage).toBe("");
  });

  // Why: a read that fails once (the tour's file still being opened, a
  // busy page) was remembered as "no picture" for as long as the shell
  // showed, so the card stayed blank until the tour was opened again.
  describe("a read that failed", () => {
    const blob = () => new Blob([PNG], { type: "image/png" });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("is tried again for the card still waiting, and then shows", async () => {
      const load = vi
        .fn<() => Promise<Blob>>()
        .mockRejectedValueOnce(new Error("busy"))
        .mockResolvedValue(blob());
      const pictures = createShellPictures({ load });
      const el = card();
      pictures.show(el, "content/gate.png");
      FakeObserver.last?.see(el);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(() => {
        expect(el.style.backgroundImage).toBe('url("blob:picture-1")');
      });
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("is given up after three tries, and no later card reads it again", async () => {
      const load = vi.fn(() => Promise.reject(new Error("gone")));
      const pictures = createShellPictures({ load });
      const el = card();
      pictures.show(el, "content/gone.png");
      FakeObserver.last?.see(el);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(load).toHaveBeenCalledTimes(3);
      expect(el.style.backgroundImage).toBe("");
      const later = card();
      pictures.show(later, "content/gone.png");
      expect(FakeObserver.last?.watched.has(later)).toBe(false);
      expect(load).toHaveBeenCalledTimes(3);
    });

    it("is read again on a new card, seen, while tries are left", async () => {
      const load = vi
        .fn<() => Promise<Blob>>()
        .mockRejectedValueOnce(new Error("busy"))
        .mockResolvedValue(blob());
      const pictures = createShellPictures({ load });
      const el = card();
      pictures.show(el, "content/gate.png");
      FakeObserver.last?.see(el);
      await vi.advanceTimersByTimeAsync(0);
      // A redraw replaced the card before the second try.
      el.remove();
      const redrawn = card();
      pictures.show(redrawn, "content/gate.png");
      FakeObserver.last?.see(redrawn);
      await vi.waitFor(() => {
        expect(redrawn.style.backgroundImage).toBe('url("blob:picture-1")');
      });
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("is not tried again for a card that left the page, nor after clear", async () => {
      const load = vi.fn(() => Promise.reject(new Error("busy")));
      const pictures = createShellPictures({ load });
      const left = card();
      pictures.show(left, "content/left.png");
      FakeObserver.last?.see(left);
      await vi.advanceTimersByTimeAsync(0);
      left.remove();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(load).toHaveBeenCalledTimes(1);

      const cleared = card();
      pictures.show(cleared, "content/cleared.png");
      FakeObserver.last?.see(cleared);
      await vi.advanceTimersByTimeAsync(0);
      pictures.clear();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(load).toHaveBeenCalledTimes(2);
    });

    // Why: a picture too large to decode stays too large: reading it again
    // would only cost its bytes.
    it("is not what a picture with a problem is: that one is read once", async () => {
      const load = vi.fn(() => Promise.resolve(new Blob(["not a picture"])));
      const pictures = createShellPictures({ load });
      const el = card();
      pictures.show(el, "content/broken.png");
      FakeObserver.last?.see(el);
      await vi.waitFor(() => {
        const later = card();
        pictures.show(later, "content/broken.png");
        expect(FakeObserver.last?.watched.has(later)).toBe(false);
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(load).toHaveBeenCalledTimes(1);
    });
  });
});
