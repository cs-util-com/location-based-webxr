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
    blocks: [
      {
        id: `p${id}`,
        kind: "shortText",
        view: "pin",
        caption: pinText,
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
    block: vi.fn(),
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

/** The inspector's field `name`: a line (an input) or prose (a text
 *  area). */
function field(name: string): HTMLInputElement | HTMLTextAreaElement {
  const found = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `#shell-inspector [data-field="${name}"]`,
  );
  if (found === null) throw new Error(`no field ${name}`);
  return found;
}

/** Text typed into `name`, its focus kept, nothing committed. */
function typeInto(
  name: string,
  text: string,
): HTMLInputElement | HTMLTextAreaElement {
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

  // Why (B2c): a block's other text fields reach the page as block field
  // edits for the block they were typed for, never as a station's or a
  // pin text's.
  it("write a short text's description as a block field of that block", () => {
    const { select, edits, shell } = setUp();
    select("pa");
    typeInto("description", "Under the arch");
    select("station:b");
    expect(edits.block).toHaveBeenCalledWith(
      "pa",
      "description",
      "Under the arch",
    );
    expect(edits.station).not.toHaveBeenCalled();
    expect(edits.text).not.toHaveBeenCalled();
    shell.hide();
  });

  // Why: the page refuses a text over the format's cap (its toast says
  // so). The field was reset to the tour's value before the edit was
  // sent, so the creator's typing was wiped by the refusal; it must stay
  // in the field to be shortened. A written edit still shows the tour's
  // value, as the draw gives it.
  it("keep the typed text in the field when the page refuses the edit", () => {
    const cases = [
      { selection: "pa", name: "description", text: "x".repeat(161) },
      { selection: "pb", name: "title", text: "A pin text the page refuses" },
      { selection: "station:a", name: "title", text: "A name it refuses" },
    ] as const;
    for (const { selection, name, text } of cases) {
      const { select, edits, shell } = setUp();
      edits.block.mockReturnValue("refused");
      edits.text.mockReturnValue("refused");
      edits.station.mockReturnValue("refused");
      select(selection);
      const input = typeInto(name, text);
      input.blur();
      const sent =
        edits.block.mock.calls.length +
        edits.text.mock.calls.length +
        edits.station.mock.calls.length;
      expect(sent, `${selection} ${name}`).toBe(1);
      expect(input.value, `${selection} ${name}`).toBe(text);
      shell.hide();
    }
  });

  it("show the tour's value again when the page writes the edit", () => {
    const { select, edits, shell } = setUp();
    edits.block.mockReturnValue("written");
    select("pa");
    const description = typeInto("description", "Under the arch");
    description.blur();
    expect(edits.block).toHaveBeenCalledTimes(1);
    // The fake page wrote nothing to the store, so the tour's value is
    // still the empty one.
    expect(description.value).toBe("");
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

  // Why: Chromium fires focusout before the focus moves on, and the
  // commit draws the inspector again at once: that takes the control the
  // focus was moving to out of the page, and Chromium then drops the
  // focus to the page (Tab lost the creator's place, and the next plain
  // key was the page's: T toggled the top view). The shell hands the
  // focus on to that control as drawn again, found by its name.
  it("hand the focus on to the control it was moving to when the commit draws the inspector again", () => {
    const { store, select, edits, shell } = setUp();
    edits.station.mockImplementation((...args: unknown[]) => {
      store.dispatch(
        tourDocumentActions.stationEdited({
          stationId: args[0] as string,
          edit: args[1] as { description: string },
          what: "description",
        }),
      );
    });
    select("station:a");
    const typed = typeInto("description", "By the fountain");
    const radius = field("radius");
    typed.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: radius }),
    );
    expect(edits.station).toHaveBeenCalledTimes(1);
    // Drawn again: a new field under the same name, and it has the focus.
    expect(field("radius")).not.toBe(radius);
    expect(document.activeElement).toBe(field("radius"));
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

  // Why: a description is prose, so Enter starts a new line there and
  // must not write the field (it did while the description was a one-line
  // input); leaving it writes the lines.
  it("takes Enter in a description as a new line, and writes the lines when it is left", () => {
    const { select, edits, shell } = setUp();
    select("station:a");
    const area = typeInto("description", "line one");
    expect(area).toBeInstanceOf(HTMLTextAreaElement);
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    area.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(edits.station).not.toHaveBeenCalled();
    area.value = "line one\nline two";
    area.blur();
    expect(edits.station).toHaveBeenCalledWith("a", {
      description: "line one\nline two",
    });
    shell.hide();
  });

  // Why: a description of several lines from a tour written elsewhere
  // stays editable here, and an untouched one is not written back (its
  // line ends read as typed text would make every focus an edit).
  it("writes nothing for a description of several lines that is focused and left", () => {
    const { store, select, edits, shell } = setUp();
    store.dispatch(
      tourDocumentActions.stationEdited({
        stationId: "a",
        edit: { description: "one\r\ntwo" },
        what: "description",
      }),
    );
    select("station:a");
    const area = field("description");
    expect(area.readOnly).toBe(false);
    area.focus();
    area.blur();
    select("station:b");
    shell.hide();
    expect(edits.station).not.toHaveBeenCalled();
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
