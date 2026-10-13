/**
 * A HUD chip's label folds to its icon after its first use (polish round
 * M3, the owner's D-P4 on the H1 strip), remembered per device; a long
 * press shows it again.
 *
 * Why these tests matter: a folded chip is an icon only, so its accessible
 * name must stay the full label; the long press that unfolds it must not
 * ALSO run the chip's action (a pin would be placed); and storage that
 * throws (a private window) must leave the chip working, unfolded.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { LONG_PRESS_MS, wireFoldingLabel } from "./folding-label.js";

type Handler = (event: FakeEvent) => void;
interface FakeEvent {
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

/** A button with capture-first click dispatch, as a browser at the target. */
function fakeButton() {
  const capture: Handler[] = [];
  const bubble: Handler[] = [];
  const other = new Map<string, Handler[]>();
  const attributes = new Map<string, string>();
  return {
    dataset: {} as Record<string, string>,
    attributes,
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    addEventListener(
      type: string,
      handler: Handler,
      options?: { capture?: boolean },
    ) {
      if (type === "click") (options?.capture ? capture : bubble).push(handler);
      else other.set(type, [...(other.get(type) ?? []), handler]);
    },
    prevented: [] as string[],
    fire(type: string) {
      const prevented = this.prevented;
      const event: FakeEvent = {
        defaultPrevented: false,
        stopped: false,
        preventDefault() {
          this.defaultPrevented = true;
          prevented.push(type);
        },
        stopImmediatePropagation() {
          this.stopped = true;
        },
      };
      const handlers =
        type === "click" ? [...capture, ...bubble] : (other.get(type) ?? []);
      for (const handler of handlers) {
        if (event.stopped) break;
        handler(event);
      }
    },
  };
}

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

/** A one-shot clock the test advances by hand. */
function fakeClock() {
  let now = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    schedule(fn: () => void, ms: number) {
      const timer = { at: now + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (timer.live && timer.at <= now) {
          timer.live = false;
          timer.fn();
        }
      }
    },
  };
}

function setup(store: ReturnType<typeof memory> | null = memory()) {
  const clock = fakeClock();
  const button = fakeButton();
  let actions = 0;
  wireFoldingLabel({
    button,
    key: "pin",
    label: "Place a pin",
    store,
    schedule: (fn, ms) => clock.schedule(fn, ms),
  });
  // The chip's own action, bound after the fold (as the page does).
  button.addEventListener("click", () => (actions += 1));
  return {
    button,
    store,
    actions: () => actions,
    tap(heldMs = 50) {
      button.fire("pointerdown");
      clock.advance(heldMs);
      button.fire("pointerup");
      button.fire("click");
    },
    /** A touch browser's long press: the context menu instead of a click. */
    touchLongPress(heldMs: number) {
      button.fire("pointerdown");
      clock.advance(heldMs);
      button.fire("contextmenu");
      button.fire("pointercancel");
    },
  };
}

describe("wireFoldingLabel", () => {
  it("shows the label until the chip is first used, then folds it, remembered", () => {
    const s = setup();
    expect(s.button.dataset["folded"]).toBeUndefined();
    s.tap();
    expect(s.actions()).toBe(1);
    expect(s.button.dataset["folded"]).toBe("true");
    // The next page load (a new wiring over the same store) starts folded.
    const again = fakeButton();
    wireFoldingLabel({
      button: again,
      key: "pin",
      label: "Place a pin",
      store: s.store,
      schedule: () => () => undefined,
    });
    expect(again.dataset["folded"]).toBe("true");
  });

  it("keeps the full label as the accessible name, folded or not", () => {
    const s = setup();
    expect(s.button.attributes.get("aria-label")).toBe("Place a pin");
    s.tap();
    expect(s.button.attributes.get("aria-label")).toBe("Place a pin");
  });

  it("unfolds on a long press, which does not also run the chip's action", () => {
    const s = setup();
    s.tap();
    expect(s.actions()).toBe(1);
    s.tap(LONG_PRESS_MS);
    expect(s.button.dataset["folded"]).toBeUndefined();
    expect(s.actions()).toBe(1);
    // A tap after that runs the action again (and folds it again).
    s.tap();
    expect(s.actions()).toBe(2);
    expect(s.button.dataset["folded"]).toBe("true");
  });

  // Why (M3 review #6): on a phone a press longer than the system's long
  // press fires the context menu and NO click, so an unfold that waited
  // for the click could never happen; the timer unfolds while the finger
  // is still down, and the menu is suppressed.
  it("unfolds on a touch long press that ends in a context menu, not a click", () => {
    const s = setup();
    s.tap();
    expect(s.button.dataset["folded"]).toBe("true");
    s.touchLongPress(LONG_PRESS_MS);
    expect(s.button.dataset["folded"]).toBeUndefined();
    expect(s.button.prevented).toContain("contextmenu");
    expect(s.actions()).toBe(1);
  });

  it("a press that is cancelled before the threshold neither acts nor unfolds", () => {
    const s = setup();
    s.tap();
    s.button.fire("pointerdown");
    s.button.fire("pointercancel");
    s.tap(LONG_PRESS_MS - 1);
    expect(s.button.dataset["folded"]).toBe("true");
    expect(s.actions()).toBe(2);
  });

  it("works without storage, and with storage that throws", () => {
    const none = setup(null);
    none.tap();
    expect(none.actions()).toBe(1);
    expect(none.button.dataset["folded"]).toBe("true");
    const throwing = {
      data: new Map<string, string>(),
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const s = setup(throwing);
    expect(s.button.dataset["folded"]).toBeUndefined();
    s.tap();
    expect(s.actions()).toBe(1);
  });

  // A press shorter than the threshold is a tap, whatever its length.
  it("treats every press shorter than the long press as a tap (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: LONG_PRESS_MS - 1 }), (held) => {
        const s = setup();
        s.tap(held);
        expect(s.actions()).toBe(1);
      }),
    );
  });
});
