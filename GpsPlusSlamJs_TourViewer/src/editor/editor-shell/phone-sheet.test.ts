// @vitest-environment jsdom
/**
 * Why these tests matter: on a phone the tree and the details are sheets
 * over the map, and the map's canvas ends at a sheet's top through one
 * number, `--s-sheet-share`. A wrong number there leaves the selected place
 * behind the sheet, and a drag must never resize the canvas per step (a
 * resize reallocates its buffers), so these pin when the number is written
 * and how a drag ends.
 */
import { docksAfter } from "gps-plus-slam-editor-kit/chrome";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PHONE_SHEET_PX,
  SHEET_LIMITS,
  SHEET_SHARE,
  SHELL_DOCK_LAYOUT,
  phoneSheets,
  sheetRelease,
  wirePhoneSheets,
  type PhoneSheets,
  type SheetKind,
} from "./phone-sheet.js";

let tree: HTMLElement;
let details: HTMLElement;
let sheets: PhoneSheets;
const dismiss = vi.fn<(which: SheetKind) => void>();

const share = () => document.body.style.getPropertyValue("--s-sheet-share");

function pointer(type: string, clientY: number): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, clientY });
  return Object.assign(event, { pointerId: 1 }) as unknown as PointerEvent;
}

function drag(grip: Element, from: number, to: number): void {
  grip.dispatchEvent(pointer("pointerdown", from));
  grip.dispatchEvent(pointer("pointermove", to));
  grip.dispatchEvent(pointer("pointerup", to));
}

const gripOf = (root: HTMLElement) =>
  root.querySelector(".sheet-grip") as HTMLElement;

beforeEach(() => {
  document.body.removeAttribute("style");
  document.body.innerHTML = "<div id=t></div><div id=d></div>";
  tree = document.getElementById("t") as HTMLElement;
  details = document.getElementById("d") as HTMLElement;
  tree.getBoundingClientRect = () => ({ height: 620 }) as DOMRect;
  details.getBoundingClientRect = () => ({ height: 660 }) as DOMRect;
  dismiss.mockClear();
  sheets = wirePhoneSheets({
    tree,
    details,
    spacePx: () => 1000,
    dismiss,
  });
});

describe("the layout", () => {
  // Why: the prototype keeps both side panels down to where the sheets
  // take over, and opens with the list on a phone.
  it("keeps the docks side by side down to the sheets' width", () => {
    const selectedAt = (widthPx: number) =>
      docksAfter(
        "selected",
        {
          widthPx,
          folded: { tree: false, inspector: false },
          inspectorShows: true,
        },
        SHELL_DOCK_LAYOUT,
      ).tree;
    expect(selectedAt(PHONE_SHEET_PX + 1)).toBe(false);
    expect(selectedAt(PHONE_SHEET_PX)).toBe(true);
    expect(SHELL_DOCK_LAYOUT.treeStartsFoldedPx).toBe(0);
  });

  it("tells a phone by the width", () => {
    expect(phoneSheets(PHONE_SHEET_PX)).toBe(true);
    expect(phoneSheets(PHONE_SHEET_PX + 1)).toBe(false);
  });
});

describe("sheetRelease", () => {
  it("keeps a height between the limits", () => {
    expect(sheetRelease(0.5)).toBe(0.5);
  });

  it("snaps up to the least height and down to the most", () => {
    expect(sheetRelease(SHEET_LIMITS.dismiss + 0.01)).toBe(SHEET_LIMITS.min);
    expect(sheetRelease(0.99)).toBe(SHEET_LIMITS.max);
  });

  it("dismisses a sheet dragged down past the limit", () => {
    expect(sheetRelease(SHEET_LIMITS.dismiss - 0.01)).toBeNull();
    expect(sheetRelease(Number.NaN)).toBeNull();
  });
});

describe("wirePhoneSheets", () => {
  it("gives each sheet a grip, first in the sheet, hidden from readers", () => {
    expect(tree.firstElementChild).toBe(gripOf(tree));
    expect(details.firstElementChild).toBe(gripOf(details));
    expect(gripOf(tree).getAttribute("aria-hidden")).toBe("true");
  });

  it("writes the share of the sheet that shows, none for none", () => {
    sheets.sync("tree");
    expect(share()).toBe(String(SHEET_SHARE.tree));
    sheets.sync("details");
    expect(share()).toBe(String(SHEET_SHARE.details));
    sheets.sync(null);
    expect(share()).toBe("");
  });

  // Why: the canvas follows this number, and a canvas resize is not free.
  it("leaves the canvas alone during a drag and writes on release", () => {
    sheets.sync("tree");
    const grip = gripOf(tree);
    grip.dispatchEvent(pointer("pointerdown", 400));
    grip.dispatchEvent(pointer("pointermove", 200));
    expect(tree.style.height).toBe("800px");
    expect(share()).toBe(String(SHEET_SHARE.tree));
    grip.dispatchEvent(pointer("pointermove", 300));
    expect(tree.style.height).toBe("720px");
    grip.dispatchEvent(pointer("pointerup", 300));
    expect(tree.style.height).toBe("");
    expect(share()).toBe("0.72");
  });

  it("stops a drag at the most the sheet may take", () => {
    sheets.sync("tree");
    const grip = gripOf(tree);
    grip.dispatchEvent(pointer("pointerdown", 400));
    grip.dispatchEvent(pointer("pointermove", -500));
    expect(tree.style.height).toBe("800px");
  });

  it("dismisses a sheet dragged down, keeping the height it had", () => {
    sheets.sync("details");
    drag(gripOf(details), 100, 600);
    expect(dismiss).toHaveBeenCalledWith("details");
    expect(details.style.height).toBe("");
    expect(share()).toBe(String(SHEET_SHARE.details));
  });

  it("keeps a sheet's height for its next showing, each its own", () => {
    sheets.sync("tree");
    drag(gripOf(tree), 400, 500);
    sheets.sync("details");
    expect(share()).toBe(String(SHEET_SHARE.details));
    sheets.sync("tree");
    expect(share()).toBe("0.52");
  });

  // Why: the system takes a touch for a scroll or a gesture at any time.
  it("drops a drag the system cancelled", () => {
    sheets.sync("tree");
    const grip = gripOf(tree);
    grip.dispatchEvent(pointer("pointerdown", 400));
    grip.dispatchEvent(pointer("pointermove", 200));
    grip.dispatchEvent(pointer("pointercancel", 200));
    expect(tree.style.height).toBe("");
    expect(share()).toBe(String(SHEET_SHARE.tree));
    expect(dismiss).not.toHaveBeenCalled();
  });

  // Why: with no height to take a share of, a release would divide by
  // nothing and throw the sheet away.
  it("leaves a sheet alone when there is no height to share", () => {
    const root = document.createElement("div");
    const other = document.createElement("div");
    const lost = vi.fn();
    wirePhoneSheets({
      tree: root,
      details: other,
      spacePx: () => 0,
      dismiss: lost,
    }).sync("tree");
    const grip = gripOf(root);
    grip.dispatchEvent(pointer("pointerdown", 400));
    grip.dispatchEvent(pointer("pointermove", 400));
    grip.dispatchEvent(pointer("pointerup", 400));
    expect(lost).not.toHaveBeenCalled();
    expect(root.style.height).toBe("");
  });

  it("ignores a move with no press before it", () => {
    sheets.sync("tree");
    gripOf(tree).dispatchEvent(pointer("pointermove", 200));
    expect(tree.style.height).toBe("");
  });
});
