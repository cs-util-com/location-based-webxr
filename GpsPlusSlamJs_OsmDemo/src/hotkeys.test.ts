/**
 * @vitest-environment jsdom
 *
 * The keyboard shortcut registry (§1.4 step 5 / §3.4).
 *
 * OPTS INTO jsdom, like `header-collapse.test.ts` and for the same reason: the
 * behaviour worth pinning IS the DOM wiring. "Does a keypress reach the handler
 * while the user is typing in a field" cannot be asked of a pure function,
 * because the answer lives entirely in how the listener is attached.
 *
 * WHY THESE TESTS MATTER. The demo had NO hotkey infrastructure before round 6 —
 * the only `keydown` listener in `src/` was on the header-collapse button. Three
 * separate stages now want one (§1's time of day, §3's look presets, §6's event
 * clock), so the thing worth getting right is not any individual binding but the
 * two properties that make a shared registry safe:
 *
 * - **No two features may claim the same key.** A duplicate is silent: both
 *   handlers run, or one shadows the other depending on registration order, and
 *   the symptom is "the preset key sometimes changes the time as well". A
 *   property test over the registered set makes it a build failure instead.
 * - **Typing in a field must never trigger a shortcut.** The demo has a location
 *   picker and will gain more inputs; a user typing "t" into a text box must not
 *   move the sun. This is the single most common defect in hand-rolled shortcut
 *   handlers.
 *
 * The third property is disposal, for the same reason every other listener in
 * this codebase is held rather than passed inline: one that outlives its view
 * fires against a disposed renderer.
 */

import { describe, expect, it, vi } from "vitest";

import { HotkeyRegistry } from "./hotkeys.js";

/** Dispatches a keydown as if the user pressed it on `target`. */
function press(key: string, target: EventTarget = document.body): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

describe("HotkeyRegistry", () => {
  it("runs the handler for its key", () => {
    const registry = new HotkeyRegistry(document);
    const handler = vi.fn();
    registry.add({ key: "t", description: "step time", handler });
    press("t");
    expect(handler).toHaveBeenCalledTimes(1);
    registry.dispose();
  });

  it("REFUSES a duplicate key rather than shadowing one silently", () => {
    // The property that makes a shared registry safe. Two features claiming "t"
    // is a defect whose symptom is "the preset key sometimes also moves the
    // sun" — impossible to attribute from the outside, trivial to prevent here.
    const registry = new HotkeyRegistry(document);
    registry.add({ key: "t", description: "step time", handler: vi.fn() });
    expect(() =>
      registry.add({ key: "t", description: "cycle preset", handler: vi.fn() }),
    ).toThrow(/already/i);
    registry.dispose();
  });

  it("treats keys case-sensitively, so shift is a separate binding", () => {
    // `t` and `T` are different bindings — stepping the sun forwards and
    // backwards is the obvious pair and it must not collide.
    const registry = new HotkeyRegistry(document);
    const lower = vi.fn();
    const upper = vi.fn();
    registry.add({ key: "t", description: "forward", handler: lower });
    registry.add({ key: "T", description: "back", handler: upper });
    press("t");
    press("T");
    expect(lower).toHaveBeenCalledTimes(1);
    expect(upper).toHaveBeenCalledTimes(1);
    registry.dispose();
  });

  it("does NOTHING while focus is in a text input", () => {
    // The most common defect in hand-rolled shortcut handlers. The demo already
    // has a location picker and will gain more fields.
    const registry = new HotkeyRegistry(document);
    const handler = vi.fn();
    registry.add({ key: "t", description: "step time", handler });
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("t", input);
    expect(handler).not.toHaveBeenCalled();
    input.remove();
    registry.dispose();
  });

  it("does nothing in a textarea or a select either", () => {
    const registry = new HotkeyRegistry(document);
    const handler = vi.fn();
    registry.add({ key: "t", description: "step time", handler });
    for (const tag of ["textarea", "select"] as const) {
      const node = document.createElement(tag);
      document.body.appendChild(node);
      press("t", node);
      node.remove();
    }
    expect(handler).not.toHaveBeenCalled();
    registry.dispose();
  });

  it("ignores a modified press, so browser shortcuts keep working", () => {
    // Ctrl+T opens a tab. A registry that swallowed it would be actively
    // hostile, and the user would have no way to know why.
    const registry = new HotkeyRegistry(document);
    const handler = vi.fn();
    registry.add({ key: "t", description: "step time", handler });
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "t", ctrlKey: true, bubbles: true }),
    );
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "t", metaKey: true, bubbles: true }),
    );
    expect(handler).not.toHaveBeenCalled();
    registry.dispose();
  });

  it("stops listening after dispose", () => {
    // Held and removed, like every other listener here: one that outlives its
    // view fires against a disposed renderer, which is a crash rather than a
    // leak.
    const registry = new HotkeyRegistry(document);
    const handler = vi.fn();
    registry.add({ key: "t", description: "step time", handler });
    registry.dispose();
    press("t");
    expect(handler).not.toHaveBeenCalled();
  });

  it("lists its bindings, so they are discoverable", () => {
    // An undocumented hotkey is a feature only its author has. `bindings()` is
    // what the "?" overlay renders.
    const registry = new HotkeyRegistry(document);
    registry.add({
      key: "t",
      description: "step time forward",
      handler: vi.fn(),
    });
    registry.add({ key: "g", description: "cycle ground", handler: vi.fn() });
    expect(registry.bindings().map((b) => b.key)).toEqual(["t", "g"]);
    expect(registry.bindings()[0]?.description).toBe("step time forward");
    registry.dispose();
  });

  it("survives a handler that throws, so one bad key cannot kill the rest", () => {
    // A shortcut handler runs inside a DOM event; an exception there is
    // reported and then everything keeps working — except that a registry which
    // let it escape would leave the NEXT press unhandled if it ever batched.
    // Cheap to make explicit.
    const registry = new HotkeyRegistry(document);
    const good = vi.fn();
    registry.add({
      key: "b",
      description: "bad",
      handler: () => {
        throw new Error("boom");
      },
    });
    registry.add({ key: "g", description: "good", handler: good });
    expect(() => press("b")).not.toThrow();
    press("g");
    expect(good).toHaveBeenCalledTimes(1);
    registry.dispose();
  });
});
