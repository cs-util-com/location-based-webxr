/**
 * Why these tests matter: a short text's view, role and turn are chosen
 * on the inspector's chips, and each chip must write exactly its own
 * field through the shell's edits; a turn chip on a pin, which never
 * turns, would offer a choice that does nothing. These hold the chips
 * drawn per view, the pressed defaults, and what each act writes.
 *
 * @vitest-environment jsdom
 */
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import type { PanelItem } from "./kind-panel.js";
import { composedPoint, createShortTextPanel } from "./short-text-panel.js";

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
    folder: null,
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

describe("a short text's point", () => {
  const signAt = (
    at: readonly [number, number, number] | null,
    picking = false,
  ): NonNullable<PanelItem["shortText"]> => ({
    view: "sign",
    role: null,
    orientation: null,
    point: { id: "t", at, picking },
  });
  const boxes = (box: HTMLElement) =>
    ["x", "y", "z"].map((k) =>
      box.querySelector<HTMLInputElement>(
        `input[aria-label="Points to ${k}"]`,
      )!,
    );

  it("draws three labelled boxes, Pick in 3D and Clear, as the prototype does", () => {
    // Why: the chosen prototype types a point as three boxes named x, y
    // and z under "Points to", with "Pick in 3D" and "Clear" beside
    // them; one line of three numbers was a shortcut of that.
    const set = drawn(signAt([2, 1.2, -19.6]));
    expect(boxes(set.box).map((b) => b.value)).toEqual(["2", "1.2", "-19.6"]);
    expect(set.box.textContent).toContain("local point, m");
    const labels = [...set.box.querySelectorAll(".xyz label")].map((l) =>
      l.textContent?.trim(),
    );
    expect(labels).toEqual(["x", "y", "z"]);
    const pick = set.box.querySelector<HTMLButtonElement>(
      '[data-act="short-point:pick"]',
    )!;
    expect(pick.textContent).toBe("Pick in 3D");
    expect(pick.getAttribute("aria-pressed")).toBe("false");
    expect(
      set.box.querySelector<HTMLButtonElement>('[data-act="short-point:clear"]')
        ?.disabled,
    ).toBe(false);
    const none = drawn(signAt(null));
    expect(boxes(none.box).map((b) => b.value)).toEqual(["", "", ""]);
    expect(none.box.textContent).toContain("none");
    expect(
      none.box.querySelector<HTMLButtonElement>(
        '[data-act="short-point:clear"]',
      )?.disabled,
    ).toBe(true);
    // A pin and an edge hint point nowhere: no boxes there.
    const pin = drawn({ view: "pin", role: null, orientation: null });
    expect(pin.box.querySelector(".xyz")).toBeNull();
  });

  it("shows the pick armed, with how to cancel it", () => {
    // Why: while armed the next click in the 3D view writes the point;
    // the creator must see that, and that Escape gets out of it.
    const armed = drawn(signAt(null, true));
    const pick = armed.box.querySelector<HTMLButtonElement>(
      '[data-act="short-point:pick"]',
    )!;
    expect(pick.getAttribute("aria-pressed")).toBe("true");
    expect(pick.textContent).toContain("Click the ground or an item");
    expect(armed.box.textContent).toContain("Esc cancels");
  });

  it("arms, disarms and clears through its deps", () => {
    const block = vi.fn();
    const pointPick = vi.fn();
    const panel = createShortTextPanel({ view: vi.fn(), block, pointPick });
    expect(panel.act("short-point:pick", item(signAt(null)), "t")).toBe(true);
    expect(panel.act("short-point:pick", item(signAt(null, true)), "t")).toBe(
      true,
    );
    expect(pointPick.mock.calls).toEqual([[true], [false]]);
    expect(panel.act("short-point:clear", item(signAt([1, 0, 1])), "t")).toBe(
      true,
    );
    expect(block.mock.calls).toEqual([["t", "pointsTo", ""]]);
  });

  it("writes the three boxes as the field's text once all three are filled, and a refusal once", () => {
    // Why: the format's strict reader judges the point (`block-fields.ts`),
    // so the boxes send their text as typed; a box still empty while the
    // creator fills the others is not yet a point, and sending it would
    // toast a refusal at every Tab. Enter and then leaving the box must
    // not send the same refused text twice.
    const block = vi.fn().mockReturnValue("refused");
    const changed = vi.fn();
    const panel = createShortTextPanel({ view: vi.fn(), block, changed });
    const box = document.createElement("div");
    box.append(...(panel.sync(item(signAt(null)))?.parts() ?? []));
    const [x, y, z] = boxes(box);
    const type = (input: HTMLInputElement, text: string) => {
      input.value = text;
      input.dispatchEvent(new Event("input"));
      input.dispatchEvent(new Event("change"));
    };
    type(x!, "2");
    type(y!, "1,5");
    expect(block).not.toHaveBeenCalled();
    type(z!, "abc");
    z!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    z!.dispatchEvent(new Event("change"));
    expect(block.mock.calls).toEqual([["t", "pointsTo", "2 1,5 abc"]]);
    expect(changed).not.toHaveBeenCalled();
    block.mockReturnValue("written");
    type(z!, "-3");
    expect(block.mock.calls.at(-1)).toEqual(["t", "pointsTo", "2 1,5 -3"]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("clears the point when all three boxes are emptied, and sends nothing for an unchanged point", () => {
    const block = vi.fn().mockReturnValue("written");
    const panel = createShortTextPanel({ view: vi.fn(), block });
    const box = document.createElement("div");
    box.append(...(panel.sync(item(signAt([2, 0, -10])))?.parts() ?? []));
    const [x, y, z] = boxes(box);
    x!.dispatchEvent(new Event("change"));
    expect(block).not.toHaveBeenCalled();
    for (const b of [x!, y!, z!]) {
      b.value = " ";
      b.dispatchEvent(new Event("change"));
    }
    expect(block.mock.calls).toEqual([["t", "pointsTo", ""]]);
  });

  it("composes a shown point so that the reader reads back the same numbers", () => {
    // Why: the boxes are drawn from the block after every write; a shown
    // value that composed into other numbers would edit the point on
    // the next change of any box.
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), {
          minLength: 3,
          maxLength: 3,
        }),
        (xyz) => {
          const text = composedPoint(xyz.map((n) => String(n)));
          expect(text?.split(" ").map(Number)).toEqual(
            xyz.map((n) => (Object.is(n, -0) ? 0 : n)),
          );
        },
      ),
      { numRuns: 300 },
    );
    expect(composedPoint(["", " ", ""])).toBe("");
    expect(composedPoint(["1", "", "2"])).toBeNull();
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
