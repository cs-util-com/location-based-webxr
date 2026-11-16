/**
 * Why these tests matter: the detail slider is the author's one control
 * over how coarse a model may get, and it re-makes the model, which takes
 * seconds. Its readout must say what the stop under the thumb would give
 * (triangles and deviation) before anything runs, the slider must be
 * locked with an "Applying..." state while a request runs and say the
 * outcome when it settles, a dragging thumb must never be redrawn away,
 * and a level the author can no longer change must say why.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShelfRow } from "./asset-shelf-slice.js";
import {
  detailReadout,
  detailStops,
  detailView,
  formatLength,
} from "./shelf-panel-model.js";
import { createShelfPanel, type ShelfPanelDeps } from "./shelf-panel.js";

const CHOICES = [
  { share: 1, triangles: 10_000, deviation: 0 },
  { share: 0.5, triangles: 5_000, deviation: 0.004 },
  { share: 0.25, triangles: 2_500, deviation: 0.009 },
];

type Detail = NonNullable<ShelfRow["detail"]>;

function model(
  detail: Partial<Detail> = {},
  over: Partial<ShelfRow> = {},
): ShelfRow {
  return {
    id: "m",
    kind: "model",
    name: "rock.glb",
    origin: "added",
    status: "optimized",
    progress: 1,
    retryable: false,
    originalBytes: 1_000_000,
    optimizedBytes: 600_000,
    estimatedBytes: 600_000,
    queuePosition: null,
    placesInUse: 0,
    swaps: 1,
    canUseOriginal: true,
    detail: {
      share: null,
      triangles: 8_000,
      trianglesBefore: 10_000,
      deviation: 0.0016,
      size: 0.2,
      choices: CHOICES,
      adjustable: true,
      busy: false,
      ...detail,
    },
    ...over,
  };
}

describe("formatLength", () => {
  it.each([
    [0.0000007, "1 µm"],
    [0, "0 µm"],
    [0.00028, "280 µm"],
    [0.0028, "2.8 mm"],
    [0.5, "500.0 mm"],
    [1.234, "1.23 m"],
    [Number.NaN, "0 µm"],
  ])("says %s as %s", (metres, words) => {
    expect(formatLength(metres)).toBe(words);
  });
});

describe("detailView", () => {
  it("puts the fewest triangles on the left, the default level a stop of its own under the thumb", () => {
    const view = detailView(model())!;
    expect(view.stops.map((s) => s.triangles)).toEqual([
      2_500, 5_000, 8_000, 10_000,
    ]);
    expect(view.stops[2]!.share).toBeNull();
    expect(view.at).toBe(2);
    expect(view.isDefault).toBe(true);
    expect(view.note).toBeNull();
  });

  it("stands at the author's share, with no stop of the default's", () => {
    const view = detailView(model({ share: 0.5, triangles: 5_000 }))!;
    expect(view.stops.map((s) => s.share)).toEqual([0.25, 0.5, 1]);
    expect(view.at).toBe(1);
    expect(view.isDefault).toBe(false);
  });

  it("says why a level can no longer be changed", () => {
    const view = detailView(model({ adjustable: false }))!;
    expect(view.adjustable).toBe(false);
    expect(view.note).toMatch(/last save/);
  });

  it("is null for a row with no detail", () => {
    expect(detailView(model({}, { detail: undefined } as never))).toBeNull();
    const { detail: _none, ...plain } = model();
    expect(detailView(plain)).toBeNull();
  });
});

describe("detailStops", () => {
  // Why this test matters: the optimizer check page builds its geometry
  // slider from this alone, from a level-of-detail report rather than a
  // shelf row, so it must give the shelf's stops for the same levels.
  it("gives the same stops and held stop as detailView, from the levels alone", () => {
    for (const patch of [{}, { share: 0.5, triangles: 5_000 }]) {
      const row = model(patch);
      const view = detailView(row)!;
      expect(detailStops(row.detail!)).toEqual({
        stops: view.stops,
        at: view.at,
      });
    }
    expect(
      detailStops({ choices: [], share: null, triangles: 300, deviation: 0 }),
    ).toEqual({
      stops: [{ share: null, triangles: 300, deviation: 0 }],
      at: 0,
    });
  });
});

describe("detailReadout", () => {
  it("says the share, the triangles and the deviation in length and share of the size", () => {
    expect(detailReadout(2_500, 10_000, 0.009, 0.2)).toEqual({
      share: "25 %",
      triangles: "2,500 of 10,000 triangles",
      deviation: "Largest deviation: 1.8 mm (0.90 % of the model's size)",
    });
  });
});

let rows: ShelfRow[];
let listeners: Set<() => void>;

function setRows(next: ShelfRow[]): void {
  rows = next;
  for (const l of listeners) l();
}

beforeEach(() => {
  rows = [];
  listeners = new Set();
  document.body.innerHTML =
    '<aside id="shelf" class="dock"></aside><button id="tog"></button><button id="pill" hidden></button>';
});

afterEach(() => {
  document.body.replaceChildren();
});

function panel(over: Partial<ShelfPanelDeps> = {}) {
  const deps: ShelfPanelDeps = {
    root: document.getElementById("shelf") as HTMLElement,
    toggle: document.getElementById("tog") as HTMLButtonElement,
    pill: document.getElementById("pill") as HTMLButtonElement,
    host: document.body,
    rows: () => rows,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    retry: vi.fn(() => true),
    useOriginal: vi.fn(() => Promise.resolve(true)),
    setDetail: vi.fn(() => Promise.resolve({ kind: "applied" as const })),
    remove: vi.fn(() => vi.fn()),
    optimizeTour: vi.fn(() => 0),
    addFiles: vi.fn(),
    placesOf: vi.fn(() => []),
    show: vi.fn(),
    toast: vi.fn(),
    storage: null,
    phone: () => false,
    ...over,
  };
  createShelfPanel(deps);
  return deps;
}

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s);

function openCard(): void {
  $<HTMLElement>('[data-aid="m"] [data-act="toggle"]')!.click();
}

const slider = () =>
  $<HTMLInputElement>('[data-aid="m"] input.as-detail-range')!;

describe("the detail slider", () => {
  it("shows the model's level in its open card, labelled as the prototype's", () => {
    rows = [model()];
    panel();
    expect(slider()).toBeNull();
    openCard();
    const range = slider();
    expect(range.min).toBe("0");
    expect(range.max).toBe("3");
    expect(range.value).toBe("2");
    expect($(`label[for="${range.id}"]`)?.textContent).toContain(
      "Quality, share of triangles kept",
    );
    expect($(".as-detail-out")?.textContent).toBe("80 % (default)");
    expect($(".as-detail-stats")?.textContent).toContain(
      "8,000 of 10,000 triangles",
    );
    expect($(".as-detail-stats")?.textContent).toContain(
      "Largest deviation: 320 µm (0.16 % of the model's size)",
    );
  });

  it("says what a stop would give while dragging, without asking for it", () => {
    rows = [model()];
    const deps = panel();
    openCard();
    const range = slider();
    range.value = "0";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect($(".as-detail-out")?.textContent).toBe("25 %");
    expect($(".as-detail-stats")?.textContent).toContain(
      "2,500 of 10,000 triangles",
    );
    expect(deps.setDetail).not.toHaveBeenCalled();
    // a redraw for something else keeps the thumb where it is
    for (const l of listeners) l();
    expect(slider()).toBe(range);
  });

  it("asks for the stop when let go, locked until it settles, then says the outcome", async () => {
    let settle!: (o: { kind: "applied" }) => void;
    rows = [model()];
    const deps = panel({
      setDetail: vi.fn(
        () => new Promise<{ kind: "applied" }>((r) => (settle = r)),
      ),
    });
    openCard();
    const range = slider();
    range.value = "1";
    range.dispatchEvent(new Event("change", { bubbles: true }));
    expect(deps.setDetail).toHaveBeenCalledWith("m", 0.5);
    expect(slider().disabled).toBe(true);
    expect(slider().getAttribute("aria-busy")).toBe("true");
    expect($(".as-detail-out")?.textContent).toBe("Applying...");
    // the store holds the new level before the request settles
    setRows([model({ share: 0.5, triangles: 5_000, deviation: 0.004 })]);
    expect(slider().disabled).toBe(true);
    expect(deps.toast).not.toHaveBeenCalled();
    settle({ kind: "applied" });
    await Promise.resolve();
    await Promise.resolve();
    expect(slider().disabled).toBe(false);
    expect(slider().getAttribute("aria-busy")).toBeNull();
    expect($(".as-detail-out")?.textContent).toBe("50 %");
    expect(deps.toast).toHaveBeenCalledWith(
      "rock.glb now has 5,000 triangles.",
    );
  });

  it("says a refusal, and the slider goes back to the level the tour holds", async () => {
    rows = [model()];
    const deps = panel({
      setDetail: vi.fn(() =>
        Promise.resolve({ kind: "refused" as const, reason: "No smaller." }),
      ),
    });
    openCard();
    slider().value = "2";
    slider().value = "0";
    slider().dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.toast).toHaveBeenCalledWith(
      "rock.glb was not changed. No smaller.",
    );
    expect(slider().disabled).toBe(false);
    expect(slider().value).toBe("2");
  });

  // Why: a re-make the author's own later act stopped ("use the original",
  // a delete) is no news; a toast saying it was not changed, or that it
  // now has some triangles, would contradict what they just did.
  it("says nothing of a request the author's own later act stopped", async () => {
    rows = [model()];
    const deps = panel({
      setDetail: vi.fn(() => Promise.resolve({ kind: "stopped" as const })),
    });
    openCard();
    slider().value = "0";
    slider().dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(slider().disabled).toBe(false);
  });

  // Why: the slider is locked (disabled) while its request runs, which
  // drops the keyboard focus; an author stepping with the arrow keys must
  // find the focus back on the slider once it settles.
  it("gives the focus back to the slider when its request settles", async () => {
    rows = [model()];
    panel();
    openCard();
    slider().focus();
    slider().value = "1";
    slider().dispatchEvent(new Event("change", { bubbles: true }));
    expect(slider().disabled).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(slider().disabled).toBe(false);
    expect(document.activeElement).toBe(slider());
  });

  // Why: the request can take seconds; an author who moved on to another
  // control meanwhile must not have the focus pulled back to the slider.
  it("leaves the focus where the author put it while the request ran", async () => {
    rows = [model()];
    panel();
    openCard();
    slider().focus();
    slider().value = "1";
    slider().dispatchEvent(new Event("change", { bubbles: true }));
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    await Promise.resolve();
    await Promise.resolve();
    expect(slider().disabled).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("goes back to the default level", () => {
    rows = [model({ share: 0.25, triangles: 2_500, deviation: 0.009 })];
    const deps = panel();
    openCard();
    expect($(".as-detail-out")?.textContent).toBe("25 %");
    $<HTMLButtonElement>('[data-aid="m"] [data-act="detaildefault"]')!.click();
    expect(deps.setDetail).toHaveBeenCalledWith("m", null);
  });

  it("asks for nothing when let go at the stop it stands on", () => {
    rows = [model()];
    const deps = panel();
    openCard();
    slider().dispatchEvent(new Event("change", { bubbles: true }));
    expect(deps.setDetail).not.toHaveBeenCalled();
  });

  it("says a request that threw as a refusal", async () => {
    rows = [model()];
    const deps = panel({
      setDetail: vi.fn(() => Promise.reject(new Error("x"))),
    });
    openCard();
    slider().value = "0";
    slider().dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.toast).toHaveBeenCalledWith(
      "rock.glb was not changed. It could not be made.",
    );
    expect(slider().disabled).toBe(false);
  });

  it("offers no default button at the default level", () => {
    rows = [model()];
    panel();
    openCard();
    expect($('[data-aid="m"] [data-act="detaildefault"]')).toBeNull();
  });

  it("shows a level the author can no longer change, and why", () => {
    rows = [model({ adjustable: false }, { canUseOriginal: false })];
    panel();
    openCard();
    expect(slider()).toBeNull();
    expect($(".as-detail-stats")?.textContent).toContain(
      "8,000 of 10,000 triangles",
    );
    expect($(".as-detail-note")?.textContent).toMatch(/last save/);
  });
});
