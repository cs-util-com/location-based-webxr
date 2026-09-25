import { describe, expect, it } from "vitest";

import { createListenerSet } from "./listener-set.js";

describe("createListenerSet", () => {
  it("delivers to every subscriber, in subscription order", () => {
    const set = createListenerSet<[string]>();
    const seen: string[] = [];
    set.add((value) => seen.push(`a:${value}`));
    set.add((value) => seen.push(`b:${value}`));
    set.emit("tap");
    expect(seen).toEqual(["a:tap", "b:tap"]);
  });

  it("stops delivering after unsubscribe", () => {
    const set = createListenerSet<[]>();
    let calls = 0;
    const off = set.add(() => {
      calls += 1;
    });
    off();
    set.emit();
    expect(calls).toBe(0);
  });

  it("tolerates unsubscribing twice", () => {
    const set = createListenerSet<[]>();
    const off = set.add(() => undefined);
    off();
    expect(off).not.toThrow();
    expect(set.size).toBe(0);
  });

  it("survives a listener that unsubscribes during emit", () => {
    // The scene does exactly this on teardown, and mutating the live set mid
    // iteration would otherwise skip the next listener.
    const set = createListenerSet<[]>();
    const seen: string[] = [];
    const off = set.add(() => {
      seen.push("first");
      off();
    });
    set.add(() => seen.push("second"));
    set.emit();
    expect(seen).toEqual(["first", "second"]);
  });

  it("clears every subscriber", () => {
    const set = createListenerSet<[]>();
    set.add(() => undefined);
    set.clear();
    expect(set.size).toBe(0);
  });
});
