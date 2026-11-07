/**
 * The editor's panels on a phone: the tree and the details are sheets over
 * the map, each with a grip to drag it, and the map's canvas ends at a
 * sheet's top. Both follow one number on the page, `--s-sheet-share`: the
 * part of the height over the bottom panel that the sheet takes. A drag
 * sets the sheet's own height and writes the number on release, so the
 * canvas, and the buffers behind it, resize once.
 *
 * @see phone-sheet.ts.md
 */
import type { DockLayout } from "gps-plus-slam-editor-kit/chrome";

/** At this width and under, the panels are sheets. */
export const PHONE_SHEET_PX = 700;

export type SheetKind = "tree" | "details";

/** The part a sheet takes when it first shows. */
export const SHEET_SHARE: Readonly<Record<SheetKind, number>> = {
  tree: 0.62,
  details: 0.66,
};

/** What a drag may leave; under `dismiss` the sheet goes. */
export const SHEET_LIMITS = { min: 0.3, max: 0.8, dismiss: 0.2 } as const;

/** Above the sheets both panels stay, the map between them, at any width;
 *  on a phone the list opens first. */
export const SHELL_DOCK_LAYOUT: DockLayout = {
  treePx: 226,
  inspectorPx: 268,
  sceneFloorPx: PHONE_SHEET_PX + 1 - 226 - 268,
  treeStartsFoldedPx: 0,
};

export function phoneSheets(widthPx: number): boolean {
  return widthPx <= PHONE_SHEET_PX;
}

/** Where a sheet released at `share` rests; null: it goes. */
export function sheetRelease(share: number): number | null {
  if (!(share >= SHEET_LIMITS.dismiss)) return null;
  return Math.min(SHEET_LIMITS.max, Math.max(SHEET_LIMITS.min, share));
}

export interface PhoneSheets {
  /** The sheet that shows now; null: none, or no phone. */
  sync(which: SheetKind | null): void;
}

const SHARE_VAR = "--s-sheet-share";

/** Both sheets' grips added and answered. */
export function wirePhoneSheets(deps: {
  readonly tree: HTMLElement;
  readonly details: HTMLElement;
  /** The height a share is of: the view's, over the bottom panel. */
  readonly spacePx: () => number;
  /** A sheet dragged down past the limit. */
  readonly dismiss: (which: SheetKind) => void;
}): PhoneSheets {
  const shares = { ...SHEET_SHARE };
  let showing: SheetKind | null = null;

  const write = () => {
    const { style } = document.body;
    if (showing === null) style.removeProperty(SHARE_VAR);
    else style.setProperty(SHARE_VAR, String(shares[showing]));
  };

  const wire = (which: SheetKind, root: HTMLElement) => {
    const grip = document.createElement("div");
    grip.className = "sheet-grip";
    grip.setAttribute("aria-hidden", "true");
    root.prepend(grip);
    let drag: { startY: number; startPx: number; px: number } | null = null;

    const end = () => {
      drag = null;
      root.style.removeProperty("height");
    };
    grip.addEventListener("pointerdown", (event) => {
      const startPx = root.getBoundingClientRect().height;
      drag = { startY: event.clientY, startPx, px: startPx };
      grip.setPointerCapture?.(event.pointerId);
    });
    grip.addEventListener("pointermove", (event) => {
      if (drag === null) return;
      const space = deps.spacePx();
      if (space <= 0) {
        end();
        return;
      }
      const most = space * SHEET_LIMITS.max;
      const wanted = drag.startPx + drag.startY - event.clientY;
      drag.px = Math.min(most, Math.max(0, wanted));
      root.style.height = `${String(drag.px)}px`;
    });
    grip.addEventListener("pointerup", () => {
      if (drag === null) return;
      const space = deps.spacePx();
      if (space <= 0) {
        end();
        return;
      }
      const rest = sheetRelease(drag.px / space);
      end();
      if (rest === null) {
        deps.dismiss(which);
        return;
      }
      shares[which] = rest;
      write();
    });
    grip.addEventListener("pointercancel", end);
  };
  wire("tree", deps.tree);
  wire("details", deps.details);

  return {
    sync(which) {
      if (which === showing) return;
      showing = which;
      write();
    },
  };
}
