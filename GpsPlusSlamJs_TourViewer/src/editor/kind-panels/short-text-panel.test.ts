/**
 * Why these tests matter: a short text's view, role and turn are chosen
 * on the inspector's chips, and each chip must write exactly its own
 * field through the shell's edits; a turn chip on a pin, which never
 * turns, would offer a choice that does nothing. These hold the chips
 * drawn per view, the pressed defaults, and what each act writes.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

import type { PanelItem } from "./kind-panel.js";
import { createShortTextPanel } from "./short-text-panel.js";

function item(shortText: NonNullable<PanelItem["shortText"]>): PanelItem {
  return {
    kind: "item",
    itemKind: "shortText",
    title: "Gate",
    sub: "Pin in Gate",
    stationId: "s",
    text: "Gate",
    extent: null,
    fields: [],
    model: null,
    longText: null,
    shortText,
    offset: { northM: 0, upM: 0, eastM: 0 },
    headingDeg: 0,
    turns: false,
    groundOffM: null,
  };
}

function drawn(shortText: NonNullable<PanelItem["shortText"]>) {
  const panel = createShortTextPanel({ view: vi.fn(), block: vi.fn() });
  const draw = panel.sync(item(shortText));
  const box = document.createElement("div");
  box.append(...(draw?.parts() ?? []));
  const pressed = [...box.querySelectorAll("[aria-pressed=true]")].map((b) =>
    b.getAttribute("data-act"),
  );
  return { draw, box, pressed };
}

describe("a short text's panel", () => {
  it("draws nothing for another kind", () => {
    const panel = createShortTextPanel({ view: vi.fn(), block: vi.fn() });
    expect(panel.sync(null)).toBeNull();
    const { shortText: _parts, ...other } = item({
      view: "pin",
      role: null,
      orientation: null,
    });
    expect(panel.sync({ ...other, itemKind: "model" })).toBeNull();
  });

  it("offers a turn only on a sign, and presses the reader's defaults", () => {
    const pin = drawn({ view: "pin", role: null, orientation: null });
    expect(pin.pressed).toEqual(["short-view:pin", "short-role:label"]);
    const sign = drawn({ view: "sign", role: "warning", orientation: null });
    expect(sign.pressed).toEqual([
      "short-view:sign",
      "short-role:warning",
      "short-turn:world",
    ]);
  });

  it("writes the view, the role and the turn through its own edits", () => {
    const view = vi.fn();
    const block = vi.fn();
    const panel = createShortTextPanel({ view, block });
    const at = item({ view: "sign", role: null, orientation: null });
    expect(panel.act("short-view:edgeHint", at, "t")).toBe(true);
    expect(panel.act("short-role:instruction", at, "t")).toBe(true);
    expect(panel.act("short-turn:face", at, "t")).toBe(true);
    expect(view).toHaveBeenCalledWith("t", "edgeHint");
    expect(block.mock.calls).toEqual([
      ["t", "role", "instruction"],
      ["t", "orientation", "face"],
    ]);
    expect(panel.act("view:pin", at, "t")).toBe(false);
    expect(panel.act("nothing", at, "t")).toBe(false);
  });
});
