/**
 * Why these tests matter: the shelf panel is the only place a creator sees
 * what happens to the files they add, and acts on them. A redraw on every
 * progress tick would drop the keyboard focus many times a second; a
 * delete of a file still in use would empty fields the creator never saw;
 * "Use the original" without an in-progress state invites a second press
 * and without an outcome leaves the creator guessing; a fold that is not
 * kept, or a phone that folds a sheet, breaks the layout the panel was
 * chosen for.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShelfRow } from "./asset-shelf-slice.js";
import {
  createShelfPanel,
  SHELF_FOLD_KEY,
  type ShelfPanelDeps,
} from "./shelf-panel.js";

const MB = 1024 * 1024;

function row(over: Partial<ShelfRow> = {}): ShelfRow {
  return {
    id: "a",
    kind: "audio",
    name: "bells.wav",
    origin: "added",
    status: "optimized",
    progress: 1,
    retryable: false,
    originalBytes: 9 * MB,
    optimizedBytes: 1.5 * MB,
    estimatedBytes: 1.5 * MB,
    queuePosition: null,
    placesInUse: 0,
    swaps: 0,
    canUseOriginal: true,
    ...over,
  };
}

let rows: ShelfRow[];
let listeners: Set<() => void>;
let phone: boolean;
let stored: Map<string, string>;

function setRows(next: ShelfRow[]): void {
  rows = next;
  for (const l of listeners) l();
}

beforeEach(() => {
  rows = [];
  listeners = new Set();
  phone = false;
  stored = new Map();
  document.body.className = "";
  document.body.innerHTML =
    '<aside id="shelf" class="dock"></aside><button id="tog" class="tog"></button><button id="pill" hidden></button>';
});

afterEach(() => {
  document.body.replaceChildren();
});

function panel(over: Partial<ShelfPanelDeps> = {}) {
  const deps = {
    root: document.getElementById("shelf") as HTMLElement,
    toggle: document.getElementById("tog") as HTMLButtonElement,
    pill: document.getElementById("pill") as HTMLButtonElement,
    host: document.body,
    rows: () => rows,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    retry: vi.fn(() => true),
    useOriginal: vi.fn(() => Promise.resolve(true)),
    remove: vi.fn<(id: string) => (() => void) | null>(() => vi.fn()),
    optimizeTour: vi.fn(() => 2),
    addFiles: vi.fn(),
    placesOf: vi.fn(() => [
      { selection: "s1", label: "2 The old gate › The legend › Bells" },
    ]),
    show: vi.fn(),
    toast: vi.fn(),
    storage: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => {
        stored.set(k, v);
      },
    },
    phone: () => phone,
    ...over,
  };
  const made = createShelfPanel(deps);
  return { deps, panel: made };
}

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s);
const card = (id: string) => $(`[data-aid="${id}"]`);
const actIn = (id: string, act: string) =>
  $(`[data-aid="${id}"] [data-act="${act}"]`);

describe("the list", () => {
  it("shows an empty shelf with a way to add files", () => {
    const { deps } = panel();
    expect($(".as-sum")?.textContent).toBe("Nothing on the shelf yet.");
    expect($(".as-empty")?.textContent).toContain(
      "Drop sounds, pictures, videos or 3D models anywhere on the page.",
    );
    $<HTMLButtonElement>('.as-empty [data-act="add"]')?.click();
    expect(deps.addFiles).toHaveBeenCalledTimes(1);
  });

  it("draws a card per file with its kind, state and places, the names as text", () => {
    rows = [
      row(),
      row({
        id: "b",
        name: "<b>x</b>.glb",
        kind: "model",
        status: "queued",
        queuePosition: 1,
        placesInUse: 2,
      }),
    ];
    panel();
    expect(card("a")?.querySelector(".as-ckind")?.textContent).toBe(
      "Sound · WAV · 9.0 MB",
    );
    expect(card("a")?.querySelector(".as-cstate")?.textContent).toContain(
      "9.0 MB → 1.5 MB",
    );
    expect(card("a")?.querySelector(".as-uses")?.textContent).toBe("Not used");
    expect(card("b")?.querySelector(".as-cstate")?.textContent).toBe(
      "Queued, 1 before it",
    );
    expect(card("b")?.querySelector(".as-uses")?.textContent).toBe("Used in 2");
    expect(card("b")?.querySelector("b")).toBeNull();
    expect($(".as-count")?.textContent).toBe("2");
  });

  // Why: a redraw per tick would take the focus off the card a keyboard
  // user is on, many times a second.
  it("moves a running file's bar without redrawing its card, the focus kept", () => {
    rows = [row({ status: "running", progress: 0.2 })];
    panel();
    const before = card("a");
    const crow = actIn("a", "toggle");
    crow?.focus();
    setRows([row({ status: "running", progress: 0.7 })]);
    expect(card("a")).toBe(before);
    expect(card("a")?.querySelector(".as-pc")?.textContent).toBe("70 %");
    expect(
      card("a")?.querySelector(".as-bar")?.getAttribute("aria-valuenow"),
    ).toBe("70");
    expect(document.activeElement).toBe(crow);
  });

  it("keeps the focus on the card through a redraw of the list", () => {
    rows = [row({ status: "running", progress: 0.2 })];
    panel();
    actIn("a", "toggle")?.focus();
    setRows([row()]);
    expect(document.activeElement).toBe(actIn("a", "toggle"));
  });

  it("opens a card by click, Enter or Space and says what happens to the file", () => {
    rows = [row()];
    panel();
    const crow = actIn("a", "toggle") as HTMLElement;
    crow.click();
    expect(card("a")?.classList.contains("open")).toBe(true);
    expect(actIn("a", "toggle")?.getAttribute("aria-expanded")).toBe("true");
    expect(card("a")?.querySelector(".as-more")?.textContent).toContain(
      "Made smaller for a phone",
    );
    actIn("a", "toggle")?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(card("a")?.classList.contains("open")).toBe(false);
    actIn("a", "toggle")?.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(card("a")?.classList.contains("open")).toBe(true);
  });

  it("filters by kind with the chips", () => {
    rows = [row(), row({ id: "b", kind: "image", name: "p.jpg" })];
    panel();
    $<HTMLButtonElement>('[data-filter="image"]')?.click();
    expect(card("a")).toBeNull();
    expect(card("b")).not.toBeNull();
    expect($('[data-filter="image"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});

describe("acting on a file", () => {
  it("deletes an unused file with an Undo", () => {
    rows = [row()];
    const undo = vi.fn();
    const { deps } = panel({ remove: vi.fn(() => undo) });
    (actIn("a", "del") as HTMLButtonElement).click();
    expect(deps.remove).toHaveBeenCalledWith("a");
    expect(deps.toast).toHaveBeenCalledWith("bells.wav deleted.", {
      label: "Undo",
      run: undo,
    });
  });

  // Why: deleting a file in use would empty the fields that use it; the
  // creator is told where first, and nothing is deleted.
  it("deletes nothing in use, and says where it is used", () => {
    rows = [row({ placesInUse: 1 })];
    const { deps } = panel();
    (actIn("a", "del") as HTMLButtonElement).click();
    expect(deps.remove).not.toHaveBeenCalled();
    const confirm = card("a")?.querySelector('[role="alertdialog"]');
    expect(confirm?.textContent).toContain("bells.wav is used in 1 place.");
    expect(confirm?.textContent).toContain(
      "2 The old gate › The legend › Bells",
    );
    expect(document.activeElement).toBe(actIn("a", "delno"));
    confirm?.querySelector<HTMLButtonElement>(".as-link")?.click();
    expect(deps.show).toHaveBeenCalledWith("s1");
    (actIn("a", "delno") as HTMLButtonElement).click();
    expect(card("a")?.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(actIn("a", "del"));
  });

  it("retries a failed file and optimizes the opened tour", () => {
    rows = [
      row({ status: "failed", retryable: true, reason: "Busy." }),
      row({ id: "b", status: "idle", origin: "opened" }),
    ];
    const { deps } = panel();
    (actIn("a", "retry") as HTMLButtonElement).click();
    expect(deps.retry).toHaveBeenCalledWith("a");
    $<HTMLButtonElement>('[data-act="optour"]')?.click();
    expect(deps.optimizeTour).toHaveBeenCalledTimes(1);
    expect(deps.toast).toHaveBeenCalledWith("2 files are being made smaller.");
  });

  // Why: the swap back reads and writes the file; the button must say it
  // works while it does, and the outcome must be said either way.
  it("shows the way back to the original in progress, then its outcome", async () => {
    rows = [row()];
    let settle: (done: boolean) => void = () => undefined;
    const { deps } = panel({
      useOriginal: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            settle = resolve;
          }),
      ),
    });
    (actIn("a", "toggle") as HTMLElement).click();
    (actIn("a", "useorig") as HTMLButtonElement).click();
    const busy = actIn("a", "useorig") as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toBe("Going back...");
    settle(true);
    await vi.waitFor(() => {
      expect(deps.toast).toHaveBeenCalledWith(
        "The original of bells.wav is used again.",
      );
    });
    expect((actIn("a", "useorig") as HTMLButtonElement).disabled).toBe(false);
  });

  it("says when the original could not be used, the button back", async () => {
    rows = [row()];
    const { deps } = panel({
      useOriginal: vi.fn(() => Promise.reject(new Error("x"))),
    });
    (actIn("a", "toggle") as HTMLElement).click();
    (actIn("a", "useorig") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(deps.toast).toHaveBeenCalledWith(
        "The original of bells.wav could not be used.",
      );
    });
    expect(actIn("a", "useorig")?.textContent).toBe("Use the original");
  });

  it("lists where a file is used, shows a place and closes on Escape", () => {
    rows = [row({ placesInUse: 1 })];
    const { deps } = panel();
    const uses = card("a")?.querySelector<HTMLButtonElement>(".as-uses");
    uses?.click();
    const items = [...document.querySelectorAll<HTMLElement>("#shelf-pop .mi")];
    expect(items.map((i) => i.textContent)).toEqual([
      "2 The old gate › The legend › Bells",
    ]);
    expect(document.activeElement).toBe(items[0]);
    items[0]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect($("#shelf-pop")).toBeNull();
    expect(document.activeElement).toBe(uses);
    uses?.click();
    $<HTMLElement>("#shelf-pop .mi")?.click();
    expect(deps.show).toHaveBeenCalledWith("s1");
    expect($("#shelf-pop")).toBeNull();
  });
});

describe("folding and the phone", () => {
  it("folds to the rail and keeps the fold for the next visit", () => {
    rows = [row({ status: "running", progress: 0.5 })];
    panel();
    $<HTMLButtonElement>('.as-head [data-act="fold"]')?.click();
    expect($("#shelf")?.classList.contains("folded")).toBe(true);
    expect(document.body.classList.contains("shelf-folded")).toBe(true);
    expect(stored.get(SHELF_FOLD_KEY)).toBe("1");
    expect($("#tog")?.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelectorAll(".as-rail .as-ring")).toHaveLength(1);
    expect($("#tog .as-badge")?.textContent).toBe("1");
    document.body.replaceChildren();
    document.body.innerHTML =
      '<aside id="shelf"></aside><button id="tog"></button><button id="pill"></button>';
    panel();
    expect($("#shelf")?.classList.contains("folded")).toBe(true);
  });

  it("opens from a ring on the rail with the file's card", () => {
    stored.set(SHELF_FOLD_KEY, "1");
    rows = [row({ status: "failed", retryable: true })];
    panel();
    $<HTMLButtonElement>('.as-rail [data-rid="a"]')?.click();
    expect($("#shelf")?.classList.contains("folded")).toBe(false);
    expect(card("a")?.classList.contains("open")).toBe(true);
    expect($("#tog .as-badge.error")?.textContent).toBe("1");
  });

  it("toggles from the bottom bar", () => {
    panel();
    $<HTMLButtonElement>("#tog")?.click();
    expect(document.body.classList.contains("shelf-folded")).toBe(true);
    $<HTMLButtonElement>("#tog")?.click();
    expect(document.body.classList.contains("shelf-folded")).toBe(false);
  });

  // Why: a phone's shelf is a sheet; a fold there would leave a rail over
  // the map. The pill keeps the progress in sight while the sheet is shut.
  it("is a sheet on a phone, never folded, the pill showing the work", () => {
    phone = true;
    stored.set(SHELF_FOLD_KEY, "1");
    rows = [row({ status: "running", progress: 0.4 })];
    panel();
    expect(document.body.classList.contains("shelf-folded")).toBe(false);
    const pill = $<HTMLButtonElement>("#pill") as HTMLButtonElement;
    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toBe("Optimizing 1 file");
    pill.click();
    expect(document.body.classList.contains("shelf-sheet")).toBe(true);
    expect(pill.hidden).toBe(true);
    $<HTMLButtonElement>('.as-head [data-act="close"]')?.click();
    expect(document.body.classList.contains("shelf-sheet")).toBe(false);
    setRows([row()]);
    expect(pill.hidden).toBe(true);
  });

  it("stops drawing once destroyed", () => {
    rows = [row()];
    const { panel: p } = panel();
    p.destroy();
    setRows([]);
    expect(card("a")).not.toBeNull();
  });
});
