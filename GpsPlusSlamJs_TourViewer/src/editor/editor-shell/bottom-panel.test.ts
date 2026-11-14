// @vitest-environment jsdom
/**
 * Why these tests matter: the bottom panel is where the creator learns
 * that an item is out of reach, that the map server asked to wait or that
 * frames are slow, so a toggle whose badge lies, a row that selects the
 * wrong item or a History row that takes one step too many would each
 * mislead silently. These run the real panel on its own markup, with the
 * page's commands as spies; its rules are `bottom-panel-model.test.ts`'s.
 */
import type {
  OsmMapTile,
  OsmRetryAsk,
  OsmRetryOutcome,
} from "gps-plus-slam-globe/editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Editor3dReadout } from "../../editor3d/editor3d-scene.js";
import { PANEL_STORAGE_KEY, createBottomPanel } from "./bottom-panel.js";
import type { ProblemFix, ProblemGroup } from "./tour-problems.js";

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

/** The street map as the panel reads it, set by each test. */
function fakeMap() {
  const map = {
    rows: [] as OsmMapTile[],
    asked: 0,
    off: false,
    /** The number of the retry the next ask waits for. */
    next: 1,
    outcome: null as OsmRetryOutcome | null,
    tiles: vi.fn((limit: number) => map.rows.slice(0, limit)),
    retry: vi.fn((): OsmRetryAsk => ({
      tiles: map.off ? 0 : map.asked,
      refused: map.off ? "map-off" : map.asked > 0 ? null : "none-failed",
      retry: map.next,
    })),
    lastRetry: vi.fn(() => map.outcome),
  };
  return map;
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
  const fix = vi.fn();
  const step = vi.fn();
  const map = fakeMap();
  const clock = { now: 1_000_000 };
  const stepTimes = new Map<object, number>();
  const panel = createBottomPanel({
    panel: document.getElementById("shell-panel") as HTMLElement,
    toggles: document.getElementById("shell-toggles") as HTMLElement,
    box,
    choose,
    fix,
    map,
    stepTime: (s) => stepTimes.get(s),
    now: () => clock.now,
    step,
    storage,
  });
  const el = document.getElementById("shell-panel") as HTMLElement;
  return { panel, el, choose, fix, step, map, clock, stepTimes };
}

const tile = (
  key: string,
  status: OsmMapTile["status"],
  ms: number | null = null,
): OsmMapTile => ({ key, status, note: `${status} note`, ms });

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

  // Why: the grip is a separator a keyboard moves; a screen reader says
  // where it is only from its values, which must follow every height.
  it("give the grip its height as a separator's values", () => {
    const { el } = setUp();
    toggle("problems").click();
    const grip = el.querySelector(".bp-grip") as HTMLElement;
    expect(grip.getAttribute("role")).toBe("separator");
    expect(grip.getAttribute("aria-valuenow")).toBe("220");
    expect(grip.getAttribute("aria-valuemin")).toBe("90");
    expect(grip.getAttribute("aria-valuemax")).toBe("800");
    el.querySelector<HTMLButtonElement>(".bp-max")?.click();
    expect(grip.getAttribute("aria-valuenow")).toBe("800");
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

  // Why: inside the tablist the page stands back from the arrows, Home
  // and End (key-target.ts), so the tablist must answer them itself or
  // they do nothing at all there.
  it("move between the panel's tabs by the arrows, Home and End", () => {
    const { panel, el } = setUp();
    toggle("history").click();
    const tab = (id: string) =>
      el.querySelector<HTMLButtonElement>(`.tab[data-tab='${id}']`);
    const press = (k: string) => {
      const event = key({ key: k });
      (document.activeElement ?? el).dispatchEvent(event);
      return event.defaultPrevented;
    };
    tab("history")?.focus();
    expect(press("End")).toBe(true);
    expect(panel.state().tab).toBe("perf");
    expect(document.activeElement).toBe(tab("perf"));
    expect(press("Home")).toBe(true);
    expect(panel.state().tab).toBe("problems");
    expect(document.activeElement).toBe(tab("problems"));
    expect(press("ArrowLeft")).toBe(true);
    expect(panel.state().tab).toBe("perf");
    expect(press("ArrowRight")).toBe(true);
    expect(panel.state().tab).toBe("problems");
    expect(press("ArrowDown")).toBe(false);
    expect(panel.state().tab).toBe("problems");
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

  // Why: the chosen layout mends an outside item in one click from its
  // row; the link must hand the page that problem's own fix, and must not
  // also select through the row it sits in.
  it("offers a problem's fix as a link in its row", () => {
    const { panel, el, choose, fix } = setUp();
    const mend: ProblemFix = {
      label: "Move inside",
      edit: () => ({
        kind: "pose",
        ref: { kind: "block", id: "far" },
        geo: { lat: 1, lon: 2, alt: 3, heading: 0 } as never,
      }),
      done: "Moved",
    };
    const split: ProblemFix = { label: "Move to a new station", split: true };
    const [first, second] = GROUPS;
    panel.problems(
      [
        {
          ...first!,
          problems: [{ ...first!.problems[0]!, fixes: [mend, split] }],
        },
        second!,
      ],
      null,
    );
    toggle("problems").click();
    const links = [...el.querySelectorAll<HTMLButtonElement>(".prow .fix")];
    expect(links.map((l) => l.textContent)).toEqual([
      "Move inside",
      "Move to a new station",
    ]);
    links[0]?.click();
    expect(fix).toHaveBeenCalledWith("far", mend);
    links[1]?.click();
    expect(fix).toHaveBeenCalledWith("far", split);
    expect(choose).not.toHaveBeenCalled();
  });

  // Why: a problem's row is no longer a button (it holds its fix link), so
  // the keyboard reaches it by its tab stop and selects with Enter.
  it("selects a problem's row with Enter", () => {
    const { panel, el, choose } = setUp();
    panel.problems(GROUPS, null);
    toggle("problems").click();
    const row = el.querySelector<HTMLElement>('.prow[data-select="far"]');
    expect(row?.tabIndex).toBe(0);
    row?.dispatchEvent(key({ key: "Enter" }));
    expect(choose).toHaveBeenCalledWith("far");
  });

  // Why: choosing a row selects its object, the page redraws the problems
  // at once (from inside the choice) and the rows are rebuilt; the focus
  // was lost to the page's body, where the keyboard user could go no
  // further and Escape no longer closed the panel.
  it("keeps the focus on the chosen row when the problems redraw inside the choice", () => {
    const { panel, el, choose } = setUp();
    panel.problems(GROUPS, null);
    toggle("problems").click();
    choose.mockImplementation((select: string) => {
      panel.problems(GROUPS, select);
    });
    const row = el.querySelector<HTMLElement>('.prow[data-select="far"]');
    row?.focus();
    row?.dispatchEvent(key({ key: "Enter" }));
    const now = el.querySelector<HTMLElement>('.prow[data-select="far"]');
    expect(now).not.toBe(row);
    expect(now?.classList.contains("sel")).toBe(true);
    expect(document.activeElement).toBe(now);
  });

  // Why: docked, each pane is moved out of the panel into its docked
  // panel; a row's click and Enter were heard by the panel's body only, so
  // a docked row selected nothing.
  it("selects a docked problem's row by click and by Enter", () => {
    const { panel, choose } = setUp();
    panel.dock({ show: () => undefined, hide: () => undefined });
    const docked = document.createElement("div");
    document.body.append(docked);
    const pane = document.getElementById("shell-pane-problems");
    if (pane === null) throw new Error("no Problems pane");
    docked.append(pane);
    toggle("problems").click();
    // The docking shows it and says so.
    panel.docked({ shown: ["problems"] });
    panel.problems(GROUPS, null);
    const row = pane.querySelector<HTMLElement>('.prow[data-select="far"]');
    row?.dispatchEvent(key({ key: "Enter" }));
    expect(choose).toHaveBeenCalledWith("far");
    choose.mockClear();
    pane.querySelector<HTMLElement>('.prow[data-select="far"] .what')?.click();
    expect(choose).toHaveBeenCalledWith("far");
  });

  it("keeps the focus inside when its control is gone after a redraw", () => {
    const { panel, el } = setUp();
    panel.problems(GROUPS, null);
    toggle("problems").click();
    el.querySelector<HTMLElement>('.prow[data-select="station:b"]')?.focus();
    panel.problems([GROUPS[0]!], null);
    expect(document.activeElement).toBe(
      el.querySelector(".tab[data-tab='problems']"),
    );
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

  // Why: the chosen layout tells how long ago each step was made, and the
  // label must keep up while the panel stays open (no new step to redraw
  // it); the view it starts from has no known time.
  it("says how long ago each step was made, kept current", () => {
    const { panel, el, clock, stepTimes } = setUp();
    const past = steps("Moved A", "Named B");
    stepTimes.set(past[0]!, clock.now - 5 * 60_000);
    stepTimes.set(past[1]!, clock.now - 10_000);
    panel.history({ past, future: [], position: 2, savedAt: null });
    toggle("history").click();
    const times = () =>
      [...el.querySelectorAll(".hrow")].map(
        (r) => r.querySelector(".tm")?.textContent ?? null,
      );
    expect(times()).toEqual(["just now", "5 min ago", null]);
    clock.now += 2 * 60_000;
    panel.tick(readoutOf({ frameCount: 9 }));
    expect(times()).toEqual(["2 min ago", "7 min ago", null]);
  });

  it("keeps the focus on the step taken when the history redraws", () => {
    const { panel, el, step } = setUp();
    const doc = {
      past: steps("Moved A", "Named B"),
      future: [],
      position: 2,
      savedAt: null,
    };
    panel.history(doc);
    toggle("history").click();
    step.mockImplementation(() => {
      panel.history({ ...doc, position: 1 });
    });
    const row = el.querySelectorAll<HTMLElement>(".hrow")[1];
    row?.focus();
    row?.click();
    const now = el.querySelectorAll<HTMLElement>(".hrow")[1];
    expect(now).not.toBe(row);
    expect(document.activeElement).toBe(now);
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
    expect(el.querySelector<HTMLElement>(".rl")?.hidden).toBe(true);
    expect(
      el.querySelector("#shell-pane-tiles .empty-state")?.textContent,
    ).toBe("The street map near the camera has loaded.");
  });

  // Why: the wait banner is a live status; rebuilt on every readout (five
  // a second) a screen reader would say it again and again. One element
  // stays, its countdown changed in place.
  it("keeps one live wait banner, its countdown updated in place", () => {
    const { panel, el } = setUp();
    const load = { waiting: 4, failed: 0, givenUp: 0, ceilingWaitS: 9.5 };
    panel.tick(readoutOf({ mapLoad: load }));
    toggle("tiles").click();
    const banner = el.querySelector(".rl");
    expect(banner?.getAttribute("role")).toBe("status");
    panel.tick(readoutOf({ mapLoad: { ...load, ceilingWaitS: 3.2 } }));
    expect(el.querySelectorAll(".rl")).toHaveLength(1);
    expect(el.querySelector(".rl")).toBe(banner);
    expect(banner?.querySelector(".cd")?.textContent).toBe("0:04");
    expect(banner?.querySelector<HTMLElement>(".bar i")?.style.width).toBe(
      "66.3%",
    );
  });

  // Why: the chosen layout lists each near tile with its status, failed
  // first, as the overlay reports them, and counts them by status.
  it("lists the near tiles with their status, counted by status", () => {
    const { panel, el, map } = setUp();
    map.rows = [
      tile("15/17000/11000", "failed"),
      tile("15/17001/11000", "loading"),
      tile("14/8500/5500", "loaded", 120),
    ];
    panel.tick(
      readoutOf({
        mapLoad: { waiting: 2, failed: 1, givenUp: 0, ceilingWaitS: 0 },
      }),
    );
    toggle("tiles").click();
    const rows = [...el.querySelectorAll("table.tiles tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((c) => c.textContent),
    );
    expect(rows).toEqual([
      ["Failed", "15/17000/11000", "Street map", "failed note", ""],
      ["Loading", "15/17001/11000", "Street map", "loading note", ""],
      ["Loaded", "14/8500/5500", "Street map", "loaded note", "120 ms"],
    ]);
    expect(el.querySelector(".stt.failed")).not.toBeNull();
    const sum = el.querySelector(".sumrow")?.textContent ?? "";
    expect(sum).toContain("1loaded");
    expect(sum).toContain("1loading");
    expect(sum).toContain("1failed");
    expect(sum).toContain("Source: street map tiles, zoom 15");
  });

  // Why: Retry asks the overlay at once; the chip must show it is under
  // way and then the durable end, loaded or failed again, never stay busy.
  it("retries the failed tiles, busy until they all loaded", () => {
    const { panel, el, map } = setUp();
    map.asked = 2;
    toggle("tiles").click();
    const chipNow = () =>
      el.querySelector<HTMLButtonElement>('[data-retry="map"]');
    const note = () => el.querySelector(".retry-note");
    chipNow()?.focus();
    chipNow()?.click();
    expect(map.retry).toHaveBeenCalledTimes(1);
    expect(chipNow()?.disabled).toBe(true);
    expect(chipNow()?.getAttribute("aria-busy")).toBe("true");
    expect(note()?.textContent).toBe("Retrying 2 tiles...");
    expect(note()?.getAttribute("role")).toBe("status");
    // Focus stays inside though the busy chip is disabled.
    expect(el.contains(document.activeElement)).toBe(true);
    map.outcome = { retry: 1, tiles: 2, loaded: 1, failed: 0 };
    panel.tick(readoutOf({ frameCount: 9 }));
    expect(chipNow()?.disabled).toBe(true);
    map.outcome = { retry: 1, tiles: 2, loaded: 2, failed: 0 };
    panel.tick(readoutOf({ frameCount: 10 }));
    expect(chipNow()?.disabled).toBe(false);
    expect(chipNow()?.getAttribute("aria-busy")).toBe("false");
    expect(note()?.textContent).toBe("2 tiles loaded");
  });

  it("says when the retried tiles failed again", () => {
    const { panel, el, map } = setUp();
    map.asked = 1;
    toggle("tiles").click();
    el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.click();
    map.outcome = { retry: 1, tiles: 1, loaded: 0, failed: 1 };
    panel.tick(readoutOf({ frameCount: 9 }));
    expect(el.querySelector(".retry-note")?.textContent).toBe(
      "1 tile failed again",
    );
    expect(
      el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.disabled,
    ).toBe(false);
  });

  // Why: the overlay keeps the last retry's outcome until the next retry
  // runs, which is a frame or more after the click (and never while the
  // request ceiling is full). Read at once, the old outcome said "3 tiles
  // failed again" before anything had been asked; only an outcome of the
  // ask's own retry, or a later one, ends the wait.
  it("ignores an outcome from before its own ask", () => {
    const { panel, el, map } = setUp();
    map.outcome = { retry: 1, tiles: 3, loaded: 0, failed: 3 };
    map.next = 2;
    map.asked = 3;
    toggle("tiles").click();
    el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.click();
    panel.tick(readoutOf({ frameCount: 9 }));
    const note = () => el.querySelector(".retry-note")?.textContent;
    expect(note()).toBe("Retrying 3 tiles...");
    expect(
      el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.disabled,
    ).toBe(true);
    map.outcome = { retry: 2, tiles: 3, loaded: 3, failed: 0 };
    panel.tick(readoutOf({ frameCount: 10 }));
    expect(note()).toBe("3 tiles loaded");
  });

  // Why: with the map off nothing is asked; saying "Retrying..." and then
  // "Still loading" described a retry that never ran.
  it("says the map is off instead of retrying", () => {
    const { el, map } = setUp();
    map.asked = 2;
    map.off = true;
    toggle("tiles").click();
    el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.click();
    expect(el.querySelector(".retry-note")?.textContent).toBe(
      "Not retried: the street map is off right now",
    );
    expect(
      el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.disabled,
    ).toBe(false);
  });

  it("says when there is nothing to retry, and when it cannot", () => {
    const { el, map } = setUp();
    toggle("tiles").click();
    el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.click();
    expect(el.querySelector(".retry-note")?.textContent).toBe(
      "Nothing to retry",
    );
    map.retry.mockImplementation(() => {
      throw new Error("no map");
    });
    el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.click();
    expect(el.querySelector(".retry-note")?.textContent).toBe(
      "Could not retry: no map",
    );
    expect(
      el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.disabled,
    ).toBe(false);
  });

  it("stops watching a retry that is still loading after half a minute", () => {
    const { panel, el, map, clock } = setUp();
    map.asked = 3;
    toggle("tiles").click();
    el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.click();
    map.outcome = { retry: 1, tiles: 3, loaded: 1, failed: 0 };
    clock.now += 31_000;
    panel.tick(readoutOf({ frameCount: 9 }));
    expect(el.querySelector(".retry-note")?.textContent).toBe(
      "Still loading - the map keeps asking for them",
    );
    expect(
      el.querySelector<HTMLButtonElement>('[data-retry="map"]')?.disabled,
    ).toBe(false);
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

  // Why: the view's canvas follows `--s-panel-h` through a resize
  // observer, and each resize reallocates its buffers (at a phone's pixel
  // ratio of 2, megabytes). Written on every pointer move, a drag resized
  // the canvas many times a frame; it is written once per animation frame
  // while dragging, and the release writes the final height at once.
  it("resizes the view at most once a frame while the grip is dragged", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frames.push(run);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames[id - 1] = () => undefined;
    });
    try {
      const { el } = setUp();
      toggle("problems").click();
      const viewH = () => document.body.style.getPropertyValue("--s-panel-h");
      const before = viewH();
      const grip = el.querySelector(".bp-grip") as HTMLElement;
      grip.dispatchEvent(
        new MouseEvent("pointerdown", { button: 0, clientY: 500 }),
      );
      for (const y of [480, 470, 460]) {
        grip.dispatchEvent(new MouseEvent("pointermove", { clientY: y }));
      }
      expect(viewH()).toBe(before);
      expect(frames).toHaveLength(1);
      frames[0]!(0);
      expect(viewH()).toBe("340px");
      expect(el.style.height).toBe("340px");
      grip.dispatchEvent(new MouseEvent("pointermove", { clientY: 455 }));
      grip.dispatchEvent(new MouseEvent("pointerup", { clientY: 450 }));
      expect(viewH()).toBe("350px");
      // The frame asked for before the release writes nothing after it.
      for (const run of frames.slice(1)) run(0);
      expect(viewH()).toBe("350px");
    } finally {
      vi.unstubAllGlobals();
    }
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

describe("docked, panes dragged apart", () => {
  /** Docked, with each pane in a docked panel of its own. */
  function docked() {
    const made = setUp();
    const dock = { show: vi.fn(), hide: vi.fn() };
    made.panel.dock(dock);
    for (const id of ["problems", "history", "tiles", "perf"]) {
      const host = document.createElement("div");
      host.className = `docked-${id}`;
      document.body.append(host);
      const pane = document.getElementById(`shell-pane-${id}`);
      if (pane === null) throw new Error(`no ${id} pane`);
      host.append(pane);
    }
    return { ...made, dock };
  }
  const paneOf = (id: string) =>
    document.getElementById(`shell-pane-${id}`) as HTMLElement;

  // Why: a creator who drags Problems into the details' group sees it
  // there and Performance in the bottom group, both at once; a panel that
  // drew only one "current" tab left the other blank.
  it("draws every pane in sight, each with its own tools", () => {
    const { panel } = docked();
    panel.docked({ shown: ["problems", "perf"] });
    panel.problems(GROUPS, null);
    panel.tick(readoutOf());
    expect(paneOf("problems").querySelector(".prow")).not.toBeNull();
    expect(paneOf("perf").querySelector(".nums")).not.toBeNull();
    // The problems' filters stand above their own pane.
    const tools = paneOf("problems").previousElementSibling;
    expect(tools?.classList.contains("tools")).toBe(true);
    expect(tools?.querySelector('[data-filter="error"]')).not.toBeNull();
    expect(paneOf("history").querySelector(".hrow")).toBeNull();
  });

  // Why: docked, each toggle answers for its own pane: pressed while it
  // shows, wherever it was dragged, and pressing it again takes that pane
  // (not another group) out of sight.
  it("presses a toggle while its pane shows, and hides that pane", () => {
    const { panel, dock } = docked();
    panel.docked({ shown: ["problems", "perf"] });
    expect(toggle("problems").getAttribute("aria-pressed")).toBe("true");
    expect(toggle("perf").getAttribute("aria-pressed")).toBe("true");
    expect(toggle("history").getAttribute("aria-pressed")).toBe("false");
    toggle("perf").click();
    expect(dock.hide).toHaveBeenCalledWith("perf");
    toggle("history").click();
    expect(dock.show).toHaveBeenCalledWith("history");
  });

  // Why: the tab a creator just brought into sight is the one Escape and
  // Ctrl+J then act on; keeping an older one would close the wrong pane.
  it("takes the pane just come into sight as the current one", () => {
    const { panel } = docked();
    panel.docked({ shown: ["problems"] });
    panel.docked({ shown: ["problems", "perf"] });
    expect(panel.state()).toMatchObject({ open: true, tab: "perf" });
    panel.docked({ shown: ["problems"] });
    expect(panel.state()).toMatchObject({ open: true, tab: "problems" });
    panel.docked({ shown: [] });
    expect(panel.state()).toMatchObject({ open: false });
  });
});
