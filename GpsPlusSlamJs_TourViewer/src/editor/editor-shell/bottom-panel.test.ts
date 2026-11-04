// @vitest-environment jsdom
/**
 * Why these tests matter: the bottom panel is where the creator learns
 * that an item is out of reach, that the map server asked to wait or that
 * frames are slow, so a toggle whose badge lies, a row that selects the
 * wrong item or a History row that takes one step too many would each
 * mislead silently. These run the real panel on its own markup, with the
 * page's commands as spies; its rules are `bottom-panel-model.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Editor3dReadout } from "../../editor3d/editor3d-scene.js";
import { PANEL_STORAGE_KEY, createBottomPanel } from "./bottom-panel.js";
import type { ProblemGroup } from "./tour-problems.js";

const GROUPS: ProblemGroup[] = [
  {
    stationId: "a",
    number: 1,
    title: "Square",
    problems: [
      {
        severity: "warning",
        what: "Outside its station's circle (50 m from the centre, circle 25 m)",
        who: "Far pin",
        select: "far",
      },
    ],
  },
  {
    stationId: "b",
    number: 2,
    title: "Station 2",
    problems: [
      {
        severity: "note",
        what: "Has no content yet",
        who: "Station 2",
        select: "station:b",
      },
    ],
  },
];

function readoutOf(over: Partial<Editor3dReadout> = {}): Editor3dReadout {
  return {
    tiltDeg: 40,
    headingDeg: 10,
    top: false,
    drawCalls: 12,
    triangles: 34_567,
    frameMs: 16.7,
    worstFrameMs: 20,
    slowFrames: 0,
    frameCount: 3,
    recentFrameMs: [16, 17, 18],
    mapLoad: { waiting: 0, failed: 0, givenUp: 0, ceilingWaitS: 0 },
    ...over,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const kept = new Map(Object.entries(initial));
  return {
    kept,
    getItem: vi.fn((key: string) => kept.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      kept.set(key, value);
    }),
  };
}

function setUp(storage: ReturnType<typeof memoryStorage> | null = null) {
  document.body.innerHTML = `
    <div id="view3d">
      <section id="shell-panel" hidden></section>
    </div>
    <footer><div id="shell-toggles"></div></footer>`;
  const box = document.getElementById("view3d") as HTMLElement;
  Object.defineProperty(box, "clientHeight", { value: 800 });
  box.getBoundingClientRect = () =>
    ({ top: 0, bottom: 800, left: 0, right: 1000, height: 800 }) as DOMRect;
  const choose = vi.fn();
  const step = vi.fn();
  const panel = createBottomPanel({
    panel: document.getElementById("shell-panel") as HTMLElement,
    toggles: document.getElementById("shell-toggles") as HTMLElement,
    box,
    choose,
    step,
    storage,
  });
  const el = document.getElementById("shell-panel") as HTMLElement;
  return { panel, el, choose, step };
}

const toggle = (tab: string) =>
  document.querySelector<HTMLButtonElement>(`.tog[data-tab="${tab}"]`) ??
  (() => {
    throw new Error(`no toggle ${tab}`);
  })();
const badgeText = (tab: string) =>
  toggle(tab).querySelector(".badge")?.textContent ?? "";
const key = (init: KeyboardEventInit) =>
  new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

beforeEach(() => {
  document.body.style.removeProperty("--s-panel-h");
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("the toggles", () => {
  it("are named, with no badge while there is nothing to see", () => {
    setUp();
    const names = [...document.querySelectorAll(".tog")].map(
      (b) => b.textContent,
    );
    expect(names).toEqual([
      "Problems",
      "History",
      "Map loading",
      "Performance",
    ]);
    for (const tab of ["problems", "history", "tiles", "perf"]) {
      expect(badgeText(tab)).toBe("");
      expect(toggle(tab).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("open the panel on their tab, switch tabs, and close it on their own", () => {
    const { el, panel } = setUp();
    toggle("history").click();
    expect(el.hidden).toBe(false);
    expect(panel.state()).toMatchObject({ open: true, tab: "history" });
    expect(toggle("history").getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("shell-pane-history")?.hidden).toBe(false);
    expect(document.getElementById("shell-pane-problems")?.hidden).toBe(true);
    toggle("perf").click();
    expect(panel.state()).toMatchObject({ open: true, tab: "perf" });
    expect(toggle("history").getAttribute("aria-pressed")).toBe("false");
    toggle("perf").click();
    expect(el.hidden).toBe(true);
    expect(document.body.style.getPropertyValue("--s-panel-h")).toBe("0px");
  });

  it("tell the page the open panel's height", () => {
    const { el } = setUp();
    toggle("problems").click();
    expect(el.style.height).toBe("220px");
    expect(document.body.style.getPropertyValue("--s-panel-h")).toBe("220px");
  });
});

describe("the keys", () => {
  it("open and close with Ctrl+J, and open the problems with Ctrl+Shift+M", () => {
    const { panel } = setUp();
    const ctrlJ = key({ code: "KeyJ", key: "j", ctrlKey: true });
    expect(panel.key(ctrlJ)).toBe(true);
    expect(ctrlJ.defaultPrevented).toBe(true);
    expect(panel.state().open).toBe(true);
    toggle("perf").click();
    expect(panel.key(key({ code: "KeyJ", key: "j", ctrlKey: true }))).toBe(
      true,
    );
    expect(panel.state()).toMatchObject({ open: false, tab: "perf" });
    expect(
      panel.key(key({ code: "KeyM", key: "M", ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(panel.state()).toMatchObject({ open: true, tab: "problems" });
    expect(panel.key(key({ code: "KeyJ", key: "j" }))).toBe(false);
  });

  // Why: Escape deselects in the view; only inside the panel is it the
  // panel's, and the focus must not be lost with the panel.
  it("close on Escape only from inside, the focus back on the toggle", () => {
    const { panel, el } = setUp();
    toggle("history").click();
    expect(panel.key(key({ key: "Escape" }))).toBe(false);
    const tab = el.querySelector<HTMLButtonElement>(".tab[data-tab='history']");
    tab?.focus();
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    Object.defineProperty(esc, "target", { value: tab });
    expect(panel.key(esc)).toBe(true);
    expect(el.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle("history"));
  });
});

describe("the Problems tab", () => {
  it("counts the problems on the toggle, toned by the worst", () => {
    const { panel } = setUp();
    panel.problems(GROUPS, null);
    expect(badgeText("problems")).toBe("2");
    expect(toggle("problems").querySelector(".badge")?.className).toBe(
      "badge warning",
    );
    expect(toggle("problems").title).toMatch(/0 errors, 1 warning, 1 note/);
  });

  it("lists them by station; a row selects its object, the selected one marked", () => {
    const { panel, el, choose } = setUp();
    panel.problems(GROUPS, "far");
    toggle("problems").click();
    const rows = [...el.querySelectorAll<HTMLButtonElement>(".prow")];
    expect(rows.map((r) => r.textContent)).toEqual([
      "Outside its station's circle (50 m from the centre, circle 25 m) - Far pin",
      "Has no content yet - Station 2",
    ]);
    expect(rows[0]?.classList.contains("sel")).toBe(true);
    rows[1]?.click();
    expect(choose).toHaveBeenCalledWith("station:b");
    const heads = [...el.querySelectorAll(".ghead")].map((h) => h.textContent);
    expect(heads).toEqual(["1Square1", "2Station 21"]);
  });

  it("hides a severity by its chip, and says how many the filters hide", () => {
    const { panel, el } = setUp();
    panel.problems(GROUPS, null);
    toggle("problems").click();
    const chipOf = (s: string) =>
      el.querySelector<HTMLButtonElement>(`[data-filter="${s}"]`);
    chipOf("note")?.click();
    expect(el.querySelectorAll(".prow")).toHaveLength(1);
    expect(chipOf("note")?.getAttribute("aria-pressed")).toBe("false");
    chipOf("warning")?.click();
    expect(el.querySelector(".hidden-by-filter")?.textContent).toBe(
      "2 hidden by the filters above.",
    );
  });

  it("folds a station's group", () => {
    const { panel, el } = setUp();
    panel.problems(GROUPS, null);
    toggle("problems").click();
    el.querySelector<HTMLButtonElement>('[data-fold="a"]')?.click();
    const group = el.querySelector('[data-fold="a"]')?.parentElement;
    expect(group?.classList.contains("fold")).toBe(true);
    expect(
      el.querySelector('[data-fold="a"]')?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("says so when the tour has no problem", () => {
    const { panel, el } = setUp();
    panel.problems([], null);
    toggle("problems").click();
    expect(el.querySelector(".empty-state")?.textContent).toBe(
      "No problems found in this tour.",
    );
    expect(badgeText("problems")).toBe("");
  });
});

describe("the History tab", () => {
  const steps = (...what: string[]) => what.map((w) => ({ what: w }));

  it("lists the steps newest first; a row takes exactly its steps", () => {
    const { panel, el, step } = setUp();
    panel.history({
      past: steps("Moved A", "Named B"),
      future: steps("Added C"),
      position: 2,
      savedAt: 1,
    });
    expect(badgeText("history")).toBe("2/3");
    toggle("history").click();
    const rows = [...el.querySelectorAll<HTMLButtonElement>(".hrow")];
    expect(rows.map((r) => r.querySelector(".lbl")?.textContent)).toEqual([
      "Added C",
      "Named B",
      "Moved A",
      "Opened the tour",
    ]);
    expect(rows[1]?.querySelector(".tagm.now")).not.toBeNull();
    expect(rows[2]?.querySelector(".tagm.saved")).not.toBeNull();
    rows[3]?.click();
    expect(step.mock.calls).toEqual([["undo"], ["undo"]]);
    step.mockClear();
    rows[0]?.click();
    expect(step.mock.calls).toEqual([["redo"]]);
    step.mockClear();
    rows[1]?.click();
    expect(step).not.toHaveBeenCalled();
  });

  it("offers Undo and Redo only when there is a step to take", () => {
    const { panel, el, step } = setUp();
    toggle("history").click();
    panel.history({
      past: steps("Moved A"),
      future: [],
      position: 1,
      savedAt: null,
    });
    const undo = el.querySelector<HTMLButtonElement>('[data-step="undo"]');
    const redo = el.querySelector<HTMLButtonElement>('[data-step="redo"]');
    expect(undo?.disabled).toBe(false);
    expect(redo?.disabled).toBe(true);
    undo?.click();
    expect(step).toHaveBeenCalledWith("undo");
    expect(el.querySelector(".hnote")?.textContent).toBe(
      "Newest on top. Click a step to go back to it.",
    );
    expect(badgeText("history")).toBe("");
  });
});

describe("the Map loading tab", () => {
  it("shows the server's wait, then failures, then loading on the toggle", () => {
    const { panel, el } = setUp();
    const load = { waiting: 4, failed: 0, givenUp: 0, ceilingWaitS: 0 };
    panel.tick(readoutOf({ mapLoad: load }));
    expect(toggle("tiles").querySelector(".badge .spin")).not.toBeNull();
    expect(badgeText("tiles")).toBe("4");
    panel.tick(readoutOf({ mapLoad: { ...load, failed: 1 } }));
    expect(badgeText("tiles")).toBe("1");
    panel.tick(readoutOf({ mapLoad: { ...load, ceilingWaitS: 9.5 } }));
    expect(badgeText("tiles")).toBe("0:10");
    toggle("tiles").click();
    expect(el.querySelector(".rl")?.textContent).toMatch(
      /The map server asked us to slow down\. Waiting tiles load again when the pause ends\.0:10/,
    );
    panel.tick(readoutOf());
    expect(badgeText("tiles")).toBe("");
    expect(el.querySelector(".rl")).toBeNull();
    expect(
      el.querySelector("#shell-pane-tiles .empty-state")?.textContent,
    ).toBe("The street map near the camera has loaded.");
  });
});

describe("the Performance tab", () => {
  it("badges slow frames and shows the view's numbers", () => {
    const { panel, el } = setUp();
    panel.tick(readoutOf({ slowFrames: 3, worstFrameMs: 80 }));
    expect(badgeText("perf")).toBe("3");
    toggle("perf").click();
    const text = el.querySelector(".nums")?.textContent ?? "";
    expect(text).toContain("Worst80.0 ms");
    expect(text).toContain("Slow (over 50 ms)3 in 5 s");
    expect(text).toContain("Draw calls12");
    expect(text).toContain("Triangles34,567");
    expect(text).toContain("3D view");
    expect(el.querySelector(".cap")?.textContent).toBe(
      "Frame time, last 4 snow 18.0 ms",
    );
  });
});

describe("the height and what the browser keeps", () => {
  it("reopens on the tab and height kept, and keeps a dragged height", () => {
    const storage = memoryStorage({
      [PANEL_STORAGE_KEY]: JSON.stringify({ h: 300, tab: "perf" }),
    });
    const { el, panel } = setUp(storage);
    expect(panel.state().tab).toBe("perf");
    expect(panel.key(key({ code: "KeyJ", ctrlKey: true }))).toBe(true);
    expect(el.style.height).toBe("300px");
    const grip = el.querySelector(".bp-grip") as HTMLElement;
    grip.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientY: 500 }),
    );
    grip.dispatchEvent(new MouseEvent("pointerup", { clientY: 450 }));
    expect(el.style.height).toBe("350px");
    expect(JSON.parse(storage.kept.get(PANEL_STORAGE_KEY) ?? "")).toEqual({
      h: 350,
      tab: "perf",
    });
  });

  it("closes when dragged low, and works where the browser keeps nothing", () => {
    const storage = memoryStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    storage.setItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    const { el, panel } = setUp(storage);
    toggle("problems").click();
    const grip = el.querySelector(".bp-grip") as HTMLElement;
    grip.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientY: 600 }),
    );
    grip.dispatchEvent(new MouseEvent("pointerup", { clientY: 760 }));
    expect(panel.state().open).toBe(false);
  });

  it("maximises and restores", () => {
    const { el } = setUp();
    toggle("problems").click();
    el.querySelector<HTMLButtonElement>(".bp-max")?.click();
    expect(el.style.height).toBe("800px");
    el.querySelector<HTMLButtonElement>(".bp-max")?.click();
    expect(el.style.height).toBe("220px");
  });

  it("closes, and forgets the frames, when the view hides", () => {
    const { el, panel } = setUp();
    toggle("perf").click();
    panel.hide();
    expect(el.hidden).toBe(true);
    expect(panel.state().open).toBe(false);
  });
});
