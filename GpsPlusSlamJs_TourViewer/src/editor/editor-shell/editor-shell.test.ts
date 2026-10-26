// @vitest-environment jsdom
/**
 * Why these tests matter: the shell decides WHEN a typed field is written
 * and to WHICH selection, and when a "Put on the ground" that waits for
 * the ground is called off. None of that is visible in the pure modules
 * (`inspector-edits.ts`, `ground-wait.ts`): a field committed to the
 * station selected after it, a wait that writes to the station the
 * creator left, or a half-typed value written because the inspector was
 * drawn again under the cursor would each be a silent edit of the wrong
 * thing. So the real shell runs here on the page's own markup
 * (`edit.html`) and a real store, with the page's commands as spies.
 *
 * The browser part this needs: Chromium fires `focusout` synchronously on
 * a focused field that a draw takes out of the page (`replaceChildren`),
 * while jsdom fires nothing. `chromiumFocusOut` reproduces that one
 * behaviour, so a draw while typing is tested as the browser runs it; the
 * e2e (`editor3d-inspector.spec.js`) checks the same in Chromium itself.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createEmptyTourManifest,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tourDocumentActions } from "../../tour-document.js";
import type * as TourDocument from "../../tour-document.js";
import { createTourViewerStore } from "../../tour-viewer-session.js";
import { editorViewActions, editorViewReducer } from "../editor-view.js";
import { createEditorShell, type EditorShellDeps } from "./editor-shell.js";

/** How often the tour to write is rebuilt (`manifestToWrite`): the
 *  readout's tick must not pay for it with nothing to show. */
const manifests = vi.hoisted(() => ({ built: 0 }));
vi.mock("../../tour-document.js", async (importOriginal) => {
  const actual = await importOriginal<typeof TourDocument>();
  return {
    ...actual,
    manifestToWrite: (...args: Parameters<typeof actual.manifestToWrite>) => {
      manifests.built += 1;
      return actual.manifestToWrite(...args);
    },
  };
});

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const PAGE = new DOMParser().parseFromString(
  readFileSync(resolve(packageRoot, "edit.html"), "utf8"),
  "text/html",
);

const AT = "2026-10-26T10:00:00Z";

function station(id: string, dLat: number, pinText = `Pin ${id}`): TourStation {
  return {
    id,
    title: `Station ${id}`,
    geo: { lat: 48.1371 + dLat, lon: 11.5754, alt: 560, headingDeg: 0 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    items: [
      {
        id: `p${id}`,
        kind: "pin",
        label: pinText,
        createdAtIso: AT,
        pose: { position: [5, 1.5, 0], rotation: [0, 0, 0, 1] },
      },
    ],
  } as unknown as TourStation;
}

/** The ground the fake view has loaded: null until `ground.m` is set. */
const ground: { m: number | null } = { m: null };

function fakeView() {
  return {
    flyTo: vi.fn(() => true),
    frame: vi.fn(),
    setTop: vi.fn(),
    zoom: vi.fn(),
    northUp: vi.fn(),
    readout: () => ({
      tiltDeg: 40,
      headingDeg: 0,
      top: false,
      drawCalls: 0,
      frameMs: 16,
    }),
    setLayers: vi.fn(),
    centre: () => ({ lat: 48.1371, lon: 11.5754, alt: 560 }),
    turn: vi.fn(() => true),
    groundAt: () => ground.m,
    origin: () => ({ lat: 48.1371, lng: 11.5754 }),
  };
}

function setUp() {
  document.body.replaceChildren(
    ...[...PAGE.body.childNodes].map((n) => document.importNode(n, true)),
  );
  const store = createTourViewerStore(undefined, {
    editorView: editorViewReducer,
  });
  store.dispatch(
    tourDocumentActions.opened({
      manifest: {
        ...createEmptyTourManifest(),
        stations: [station("a", 0, "line one\nline two"), station("b", 0.0004)],
      },
    }),
  );
  const select = (id: string | null) =>
    store.dispatch(editorViewActions.selected({ id }));
  const edits = {
    station: vi.fn(),
    text: vi.fn(),
    scene: vi.fn(),
    groundItems: vi.fn(),
    addPin: vi.fn(),
  };
  const deps: EditorShellDeps = {
    store,
    select,
    step: vi.fn(),
    openDetails: vi.fn(),
    codes: () => [],
    loadPicture: () => Promise.reject(new Error("no pictures here")),
    dialogOpen: () => false,
    stations: {
      add: vi.fn(),
      reorder: vi.fn(),
      split: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
    },
    edits,
    say: vi.fn(),
  };
  const shell = createEditorShell(deps);
  shell.show(fakeView());
  return { store, select, edits, deps, shell };
}

/** The inspector's field `name`. */
function field(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    `#shell-inspector [data-field="${name}"]`,
  );
  if (found === null) throw new Error(`no field ${name}`);
  return found;
}

/** Text typed into `name`, its focus kept, nothing committed. */
function typeInto(name: string, text: string): HTMLInputElement {
  const input = field(name);
  input.focus();
  input.value = text;
  return input;
}

const replaceChildren = Element.prototype.replaceChildren;

/** Chromium's behaviour jsdom lacks: a focused element a
 *  `replaceChildren` takes out of the page gets `focusout` at once,
 *  while it is still in the page. */
function chromiumFocusOut(): void {
  Element.prototype.replaceChildren = function (
    this: Element,
    ...nodes: (Node | string)[]
  ) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.contains(active)) {
      active.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    }
    replaceChildren.apply(this, nodes);
  };
}

/** No picture is in view here: the cards' pictures are not the subject. */
class NoObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoObserver);
  vi.useFakeTimers();
  ground.m = null;
});

afterEach(() => {
  Element.prototype.replaceChildren = replaceChildren;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the inspector's typed fields", () => {
  it("are written to the selection they were typed for when the selection changes", () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    typeInto("description", "By the fountain");
    select("station:b");
    expect(edits.station).toHaveBeenCalledTimes(1);
    expect(edits.station).toHaveBeenCalledWith("a", {
      description: "By the fountain",
    });
    shell.hide();
  });

  it("are written when the view hides", () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    typeInto("description", "By the fountain");
    shell.hide();
    expect(edits.station).toHaveBeenCalledTimes(1);
    expect(edits.station).toHaveBeenCalledWith("a", {
      description: "By the fountain",
    });
  });

  it("are not written by a draw of the inspector while typing, and keep the text and the focus", () => {
    chromiumFocusOut();
    const { store, select, edits, shell } = setUp();
    select("station:a");
    typeInto("description", "By the foun");
    // Another change of the station (here its radius from elsewhere)
    // draws the inspector again under the cursor.
    store.dispatch(
      tourDocumentActions.stationEdited({
        stationId: "a",
        edit: { foundRadiusM: 30 },
        what: "radius",
      }),
    );
    expect(field("radius").value).toBe("30.0");
    expect(edits.station).not.toHaveBeenCalled();
    expect(field("description").value).toBe("By the foun");
    expect(document.activeElement).toBe(field("description"));
    shell.hide();
  });

  it("are not written by the readout's draw when the ground arrives while typing", () => {
    chromiumFocusOut();
    const { select, edits, shell } = setUp();
    select("station:a");
    typeInto("description", "By the foun");
    ground.m = 500;
    vi.advanceTimersByTime(250);
    expect(
      document.querySelector('[data-act="ground-items"]')?.textContent,
    ).toContain("1 off");
    expect(edits.station).not.toHaveBeenCalled();
    expect(field("description").value).toBe("By the foun");
    shell.hide();
  });
});

describe("the inspector's Escape and its text of several lines", () => {
  it("puts the tour's value back on Escape, and leaving the field then writes nothing", () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    const input = typeInto("description", "Not this");
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(input.value).toBe("");
    input.blur();
    expect(edits.station).not.toHaveBeenCalled();
    shell.hide();
  });

  it("writes nothing for a pin text of several lines that is focused and left", () => {
    const { select, edits, shell } = setUp();
    select("pa");
    const input = field("title");
    input.focus();
    input.blur();
    select("station:b");
    shell.hide();
    expect(edits.text).not.toHaveBeenCalled();
  });
});

describe("Put items on the ground, waiting for the ground", () => {
  it("is called off by a selection change: ground that arrives later writes nothing", async () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    document
      .querySelector<HTMLButtonElement>('[data-act="ground-items"]')
      ?.click();
    expect(
      document.querySelector('[data-act="ground-items"]')?.textContent,
    ).toContain("Waiting for the ground");
    select("station:b");
    ground.m = 500;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edits.groundItems).not.toHaveBeenCalled();
    expect(edits.scene).not.toHaveBeenCalled();
    shell.hide();
  });

  it("writes once the ground arrives when the selection stays", async () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    document
      .querySelector<HTMLButtonElement>('[data-act="ground-items"]')
      ?.click();
    ground.m = 500;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edits.groundItems).toHaveBeenCalledTimes(1);
    expect(edits.groundItems.mock.calls[0]?.[0]).toEqual([
      { id: "pa", alt: 500 },
    ]);
    shell.hide();
  });
});

describe("the readout's tick", () => {
  // Why: the tick runs five times a second while the 3D view shows; with
  // nothing selected the inspector has nothing to show, and rebuilding
  // the whole tour to find that out cost a manifest build each time.
  it("builds no tour while nothing is selected, and does while something is", () => {
    const { select, shell } = setUp();
    manifests.built = 0;
    vi.advanceTimersByTime(1_000);
    expect(manifests.built).toBe(0);
    select("station:a");
    manifests.built = 0;
    vi.advanceTimersByTime(1_000);
    expect(manifests.built).toBeGreaterThanOrEqual(5);
    shell.hide();
  });
});
