/**
 * The summary panel's states (authoring plan 2026-09-28-0953 §3.3, M3b;
 * CLAUDE.md "UI feedback for async actions").
 *
 * Why these tests matter: the map is a dynamic import - a network fetch
 * on a phone that may be offline at the end of a walk. The author must
 * see that it is loading, then the map or a plain failure, and never a
 * blank box; the verdicts must be there either way; and a load that
 * lands after the summary was replaced or closed must not draw into it.
 * This package's unit tests run without a DOM, so the elements are small
 * fakes; the real DOM is covered by the Playwright suite
 * (`object-editing.spec.js`, the summary test).
 */
import { describe, expect, it } from "vitest";

import {
  createSummaryPanel,
  SUMMARY_MAP_TEXT,
  type SummaryMapModule,
} from "./summary-panel.js";
import type { SummaryCode, SummaryModel } from "./summary-model.js";

interface FakeEl {
  tag: string;
  hidden: boolean;
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  children: FakeEl[];
  listeners: Map<string, () => void>;
  append: (...c: FakeEl[]) => void;
  replaceChildren: (...c: FakeEl[]) => void;
  addEventListener: (type: string, fn: () => void) => void;
  click: () => void;
}

function fakeEl(tag = "div"): FakeEl {
  const el: FakeEl = {
    tag,
    hidden: false,
    textContent: "",
    className: "",
    dataset: {},
    children: [],
    listeners: new Map(),
    append: (...c) => {
      el.children.push(...c);
    },
    replaceChildren: (...c) => {
      el.children = [...c];
    },
    addEventListener: (type, fn) => {
      el.listeners.set(type, fn);
    },
    click: () => el.listeners.get("click")?.(),
  };
  return el;
}

const doc = { createElement: (tag: string) => fakeEl(tag) };

type Kind = SummaryCode["verdict"]["kind"];

function code(kind: Kind, estimateKind: Kind | null = null): SummaryCode {
  return {
    levelId: "lvl",
    label: "The code",
    reference: null,
    combined: null,
    verdict: { kind, text: `text ${kind}`, numbers: null, walkM: null },
    estimateVerdict:
      estimateKind === null
        ? null
        : {
            kind: estimateKind,
            text: `text ${estimateKind}`,
            numbers: null,
            walkM: null,
          },
    details: ["line one", "line two"],
  };
}

const MODEL: SummaryModel = {
  tracks: [],
  codes: [code("good")],
  objects: [],
  fitPoints: [{ lat: 47.5, lng: 8.7 }],
};

/** A map module whose load the test settles by hand. */
function deferredLoad() {
  const loads: {
    resolve: (m: SummaryMapModule) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const drawn: { destroyed: boolean }[] = [];
  const module: SummaryMapModule = {
    drawSummaryMap: () => {
      const map = { destroyed: false };
      drawn.push(map);
      return {
        destroy: () => {
          map.destroyed = true;
        },
      };
    },
  };
  const loadMap = () =>
    new Promise<SummaryMapModule>((resolve, reject) => {
      loads.push({ resolve, reject });
    });
  return { loads, drawn, module, loadMap };
}

function panel(loadMap: () => Promise<SummaryMapModule>) {
  const dom = {
    root: fakeEl(),
    codes: fakeEl("ul"),
    map: fakeEl(),
    mapStatus: fakeEl("p"),
    startAr: fakeEl("button"),
  };
  dom.root.hidden = true;
  let startAr = 0;
  const p = createSummaryPanel({
    dom: dom as never,
    doc: doc as never,
    loadMap,
    startAr: () => {
      startAr += 1;
    },
  });
  return { p, dom, starts: () => startAr };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("createSummaryPanel", () => {
  // The two verdicts are labelled plainly (M3a/M3b review #2): visitors
  // get the stored pose, so its grade leads; the visits' estimate follows
  // as what they now suggest.
  it("lists every code with what visitors get, what the visits now suggest, and the numbers, before the map has loaded", () => {
    const load = deferredLoad();
    const { p, dom } = panel(load.loadMap);
    p.show({
      ...MODEL,
      codes: [code("good"), code("unknown", "walk-further")],
    });
    expect(dom.root.hidden).toBe(false);
    const rows = dom.codes.children;
    expect(rows.map((r) => r.dataset["verdict"])).toEqual(["good", "unknown"]);
    expect(rows.map((r) => r.dataset["estimateVerdict"])).toEqual([
      "none",
      "walk-further",
    ]);
    const [title, verdict, estimate, numbers] = rows[1]!.children;
    expect(title?.textContent).toBe("The code");
    expect(verdict?.textContent).toBe("What visitors get: text unknown");
    expect(estimate?.textContent).toBe(
      "What your visits now suggest: text walk-further",
    );
    expect(rows[0]!.children[2]?.textContent).toBe(
      "What your visits now suggest: nothing yet",
    );
    expect(numbers?.tag).toBe("details");
    expect(numbers?.children.map((c) => c.textContent)).toEqual([
      "The numbers",
      "line one",
      "line two",
    ]);
  });

  it("says the map is loading, then shows it", async () => {
    const load = deferredLoad();
    const { p, dom } = panel(load.loadMap);
    p.show(MODEL);
    expect(dom.mapStatus.dataset["state"]).toBe("loading");
    expect(dom.mapStatus.textContent).toBe(SUMMARY_MAP_TEXT.loading);
    expect(dom.mapStatus.hidden).toBe(false);
    load.loads[0]!.resolve(load.module);
    await flush();
    expect(dom.mapStatus.dataset["state"]).toBe("ready");
    expect(dom.mapStatus.hidden).toBe(true);
    expect(load.drawn).toHaveLength(1);
  });

  it("says plainly when the map cannot load, and keeps the verdicts", async () => {
    const load = deferredLoad();
    const { p, dom } = panel(load.loadMap);
    p.show(MODEL);
    load.loads[0]!.reject(new Error("offline"));
    await flush();
    expect(dom.mapStatus.dataset["state"]).toBe("failed");
    expect(dom.mapStatus.textContent).toBe(SUMMARY_MAP_TEXT.failed);
    expect(dom.codes.children).toHaveLength(1);
  });

  // M3a/M3b review #8: a module that loaded but could not draw is not
  // "offline?" - the line says what actually happened.
  it("says the map could not be drawn, not that it is offline, when the loaded map refuses to draw", async () => {
    const { p, dom } = panel(() =>
      Promise.resolve({ drawSummaryMap: () => null }),
    );
    p.show(MODEL);
    await flush();
    expect(dom.mapStatus.dataset["state"]).toBe("error");
    expect(dom.mapStatus.textContent).toBe(SUMMARY_MAP_TEXT.error);
    expect(SUMMARY_MAP_TEXT.error).not.toMatch(/offline/);
  });

  it("does not load a map with nothing to frame", () => {
    const load = deferredLoad();
    const { p, dom } = panel(load.loadMap);
    p.show({ ...MODEL, fitPoints: [] });
    expect(load.loads).toHaveLength(0);
    expect(dom.map.hidden).toBe(true);
    expect(dom.mapStatus.textContent).toBe(SUMMARY_MAP_TEXT.empty);
  });

  it("never draws a late map into a summary that was replaced or closed, and drops the old map", async () => {
    const load = deferredLoad();
    const { p } = panel(load.loadMap);
    p.show(MODEL);
    p.show(MODEL);
    load.loads[0]!.resolve(load.module);
    await flush();
    expect(load.drawn).toHaveLength(0);
    load.loads[1]!.resolve(load.module);
    await flush();
    expect(load.drawn).toHaveLength(1);
    p.hide();
    expect(load.drawn[0]?.destroyed).toBe(true);
    p.show(MODEL);
    p.hide();
    load.loads[2]!.resolve(load.module);
    await flush();
    expect(load.drawn).toHaveLength(1);
  });

  it("goes back into AR through the page's own Start AR setup", () => {
    const { dom, starts } = panel(deferredLoad().loadMap);
    dom.startAr.click();
    expect(starts()).toBe(1);
  });
});
