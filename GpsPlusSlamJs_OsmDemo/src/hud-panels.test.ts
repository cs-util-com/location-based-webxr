/**
 * @vitest-environment jsdom
 *
 * The command bar's panel controller. jsdom, like the module it replaces
 * (the header collapse), because the behaviour worth pinning IS the wiring:
 * which attributes move together, where focus goes, and which layer one
 * Escape closes.
 *
 * WHY THESE TESTS MATTER:
 * - One place on screen holds the drawer, the info and the sun popover; two
 *   open at once would overlap and the second would hide the first's controls.
 * - Focus return is what lets a keyboard user leave a panel without losing
 *   their place in the bar.
 * - The light dialog stacks over the drawer and answers its own Escape; if
 *   the drawer also closed on that key, one press would close two layers and
 *   focus would return to a button inside a hidden drawer.
 * - Opening moves focus into the panel: the panels come after the map and
 *   the scene in the page, so without it Tab would walk every map control
 *   before reaching the panel a keyboard user just opened.
 *
 * The controller is driven the way the page drives it, by its openers and
 * Escape, and observed through the DOM: `hide` (the drawer's own close
 * button) is the one method the page calls.
 */
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachBusyMark,
  attachHudPanels,
  type HudPanels,
} from "./hud-panels.js";

function build(names: readonly string[]) {
  document.body.innerHTML = "";
  const panels: Record<string, { element: HTMLElement; opener: HTMLElement }> =
    {};
  for (const name of names) {
    const opener = document.createElement("button");
    opener.id = `${name}-open`;
    const element = document.createElement("section");
    element.id = `${name}-panel`;
    const inner = document.createElement("input");
    element.append(inner);
    document.body.append(opener, element);
    panels[name] = { element, opener };
  }
  return panels;
}

/** The open panel's name, read from the DOM, or undefined. */
const openOf = (panels: Record<string, { element: HTMLElement }>) =>
  Object.keys(panels).find((name) => !panels[name]!.element.hidden);

const escape = () =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );

let hud: HudPanels | undefined;
afterEach(() => hud?.dispose());

describe("attachHudPanels", () => {
  it("starts with every panel closed and its opener collapsed", () => {
    const panels = build(["drawer", "info"]);
    hud = attachHudPanels({ panels });
    expect(openOf(panels)).toBeUndefined();
    for (const { element, opener } of Object.values(panels)) {
      expect(element.hidden).toBe(true);
      expect(opener.getAttribute("aria-expanded")).toBe("false");
      expect(opener.getAttribute("aria-controls")).toBe(element.id);
    }
  });

  it("opens from its opener and keeps only one panel open", () => {
    const panels = build(["drawer", "info"]);
    const onChange = vi.fn();
    hud = attachHudPanels({ panels, onChange });
    panels["drawer"]!.opener.click();
    expect(openOf(panels)).toBe("drawer");
    panels["info"]!.opener.click();
    expect(openOf(panels)).toBe("info");
    expect(panels["drawer"]!.element.hidden).toBe(true);
    expect(panels["drawer"]!.opener.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(panels["info"]!.opener.getAttribute("aria-expanded")).toBe("true");
    expect(onChange.mock.calls).toEqual([["drawer"], ["info"]]);
  });

  it("closes on a second press of its opener", () => {
    const panels = build(["drawer"]);
    hud = attachHudPanels({ panels });
    panels["drawer"]!.opener.click();
    panels["drawer"]!.opener.click();
    expect(openOf(panels)).toBeUndefined();
    expect(panels["drawer"]!.element.hidden).toBe(true);
  });

  it("moves focus into the panel it opens, and the panel can hold it", () => {
    const panels = build(["drawer", "info"]);
    hud = attachHudPanels({ panels });
    panels["info"]!.opener.click();
    expect(document.activeElement).toBe(panels["info"]!.element);
    expect(panels["info"]!.element.tabIndex).toBe(-1);
    panels["drawer"]!.opener.click();
    expect(document.activeElement).toBe(panels["drawer"]!.element);
  });

  it("closes from hide with an onChange, and ignores a panel already closed", () => {
    const panels = build(["drawer", "info"]);
    const onChange = vi.fn();
    hud = attachHudPanels({ panels, onChange });
    hud.hide("drawer");
    expect(onChange).not.toHaveBeenCalled();
    panels["drawer"]!.opener.click();
    hud.hide("info");
    expect(openOf(panels)).toBe("drawer");
    hud.hide("drawer");
    expect(openOf(panels)).toBeUndefined();
    expect(onChange.mock.calls).toEqual([["drawer"], [undefined]]);
  });

  it("closes on Escape and returns focus to the opener", () => {
    const panels = build(["drawer"]);
    hud = attachHudPanels({ panels });
    panels["drawer"]!.opener.click();
    panels["drawer"]!.element.querySelector("input")!.focus();
    escape();
    expect(openOf(panels)).toBeUndefined();
    expect(document.activeElement).toBe(panels["drawer"]!.opener);
  });

  it("leaves focus where it is when it was elsewhere on the page", () => {
    const panels = build(["drawer"]);
    const other = document.createElement("input");
    document.body.append(other);
    hud = attachHudPanels({ panels });
    panels["drawer"]!.opener.click();
    other.focus();
    hud.hide("drawer");
    expect(document.activeElement).toBe(other);
  });

  it("leaves an Escape that a stacked layer already answered alone", () => {
    // The light dialog's own listener is on `document`, which runs before
    // `window`, and it marks the key as handled.
    const panels = build(["drawer"]);
    hud = attachHudPanels({ panels });
    panels["drawer"]!.opener.click();
    const stacked = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener("keydown", stacked);
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
        bubbles: true,
      }),
    );
    document.removeEventListener("keydown", stacked);
    expect(openOf(panels)).toBe("drawer");
  });

  it("ignores keys other than Escape and Escape with nothing open", () => {
    const panels = build(["drawer"]);
    hud = attachHudPanels({ panels });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    escape();
    panels["drawer"]!.opener.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(openOf(panels)).toBe("drawer");
  });

  it("rejects an unknown panel name and an empty panel set", () => {
    const panels = build(["drawer"]);
    hud = attachHudPanels({ panels });
    expect(() => hud!.hide("nope")).toThrow(/unknown panel/);
    expect(() => attachHudPanels({ panels: {} })).toThrow(/no panels/);
  });

  it("stops listening after dispose", () => {
    const panels = build(["drawer"]);
    const local = attachHudPanels({ panels });
    local.dispose();
    panels["drawer"]!.opener.click();
    expect(panels["drawer"]!.element.hidden).toBe(true);
  });

  it("keeps the DOM and its own state in step for any sequence of actions", () => {
    // Property: whatever is pressed, at most one panel is visible, every
    // opener's aria-expanded says whether its own panel is, and the last
    // onChange names the visible one.
    const names = ["drawer", "info", "sun"] as const;
    const action = fc.oneof(
      fc.record({
        kind: fc.constantFrom("hide", "click"),
        name: fc.constantFrom(...names),
      }),
      fc.record({ kind: fc.constant("escape") }),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 30 }), (actions) => {
        const panels = build(names);
        let reported: string | undefined;
        const local = attachHudPanels({
          panels,
          onChange: (open) => (reported = open),
        });
        try {
          for (const a of actions) {
            if (!("name" in a)) escape();
            else if (a.kind === "click") panels[a.name]!.opener.click();
            else local.hide(a.name);
          }
          const visible = names.filter((n) => !panels[n]!.element.hidden);
          expect(visible.length).toBeLessThanOrEqual(1);
          expect(visible[0]).toBe(reported);
          for (const n of names) {
            expect(panels[n]!.opener.getAttribute("aria-expanded")).toBe(
              String(visible[0] === n),
            );
          }
        } finally {
          local.dispose();
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("attachBusyMark", () => {
  /**
   * WHY THIS MATTERS. The drawer starts closed and a switch inside it can
   * take seconds to apply (a refetch, a city rebuild). With the drawer
   * closed the switch's own cue is invisible, so the bar's settings button
   * has to say it; and it must clear, or the bar claims work that ended.
   */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("marks busy while a switch label is busy or a status line has text", async () => {
    document.body.innerHTML = `
      <div id="drawer">
        <label id="sw"><input type="checkbox" /> underground</label>
        <span id="line" role="status"></span>
      </div>
      <button id="mark"></button>`;
    const root = document.getElementById("drawer")!;
    const mark = document.getElementById("mark")!;
    const dispose = attachBusyMark({ root, mark });
    expect(mark.dataset["busy"]).toBe("false");

    document.getElementById("sw")!.classList.add("layer-busy");
    await settle();
    expect(mark.dataset["busy"]).toBe("true");
    document.getElementById("sw")!.classList.remove("layer-busy");
    await settle();
    expect(mark.dataset["busy"]).toBe("false");

    document.getElementById("line")!.textContent = "Applying...";
    await settle();
    expect(mark.dataset["busy"]).toBe("true");
    document.getElementById("line")!.textContent = "";
    await settle();
    expect(mark.dataset["busy"]).toBe("false");

    dispose();
    document.getElementById("line")!.textContent = "Applying...";
    await settle();
    expect(mark.dataset["busy"]).toBe("false");
  });
});
