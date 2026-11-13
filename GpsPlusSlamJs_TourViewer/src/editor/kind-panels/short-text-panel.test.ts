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

describe("a ground arrow's panel", () => {
  const ground = (
    own: Partial<
      NonNullable<NonNullable<PanelItem["shortText"]>["ground"]>
    > = {},
  ) => ({
    view: "ground",
    role: null,
    orientation: null,
    ground: {
      id: "t",
      style: null,
      floorPlacement: null,
      captionOnArrow: false,
      color: null,
      darkColor: null,
      ...own,
    },
  });

  it("offers the styles, and the floor arrow's placement and caption switch only for a floor arrow", () => {
    // Why: placement and the caption on the arrow mean nothing for the
    // other four styles; offering them there would be a switch that
    // does nothing.
    const plain = drawn(ground());
    expect(plain.pressed).toEqual([
      "short-view:ground",
      "short-role:label",
      "short-style:ribbon",
      "short-turn:world",
    ]);
    expect(plain.box.querySelector("input[type=checkbox]")).toBeNull();
    const floor = drawn(ground({ style: "floor" }));
    expect(floor.pressed).toContain("short-floor:lying");
    expect(floor.box.querySelector("input[type=checkbox]")).not.toBeNull();
  });

  it("writes the style, the placement, the caption switch and the colours through its edits", () => {
    const view = vi.fn();
    const block = vi.fn();
    const changed = vi.fn();
    const panel = createShortTextPanel({ view, block, changed });
    const at = item(ground({ style: "floor" }));
    expect(panel.act("short-style:vanes", at, "t")).toBe(true);
    expect(panel.act("short-floor:upright", at, "t")).toBe(true);
    const box = document.createElement("div");
    box.append(...(panel.sync(at)?.parts() ?? []));
    const check = box.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    check.checked = true;
    check.dispatchEvent(new Event("change"));
    const [main, dark] = [
      ...box.querySelectorAll<HTMLInputElement>("input[type=color]"),
    ];
    main!.value = "#ff2200";
    main!.dispatchEvent(new Event("change"));
    dark!.value = "#002244";
    dark!.dispatchEvent(new Event("change"));
    expect(panel.act("short-colours:reset", at, "t")).toBe(true);
    expect(block.mock.calls).toEqual([
      ["t", "style", "vanes"],
      ["t", "floorPlacement", "upright"],
      ["t", "captionOnArrow", "true"],
      ["t", "color", "#ff2200"],
      ["t", "darkColor", "#002244"],
      ["t", "color", ""],
      ["t", "darkColor", ""],
    ]);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("shows the role's and the style's colours, and warns when the dark part would fade in the sun", () => {
    // Why: in direct sun on pale paving it is the dark part that carries
    // the arrow's shape; below 3 : 1 it is lost there.
    const plain = drawn(ground({ style: "lights" }));
    const wells = [
      ...plain.box.querySelectorAll<HTMLInputElement>("input[type=color]"),
    ];
    expect(wells.map((w) => w.value)).toEqual(["#f1d79c", "#2a3038"]);
    expect(plain.box.querySelector(".sunwarn")).toBeNull();
    expect(plain.box.textContent).toContain("Sun check");
    const pale = drawn(ground({ darkColor: "#d0d0d0" }));
    expect(pale.box.querySelector(".sunwarn")?.textContent).toContain("3 : 1");
  });
});
