/**
 * The bottom bar's power actions for the selection, as data (pure): what
 * the inspector does not offer - Duplicate (Ctrl+D), Align to station (an
 * item turned to face the way its station faces) and Copy position (the
 * selection's place and heading as text, in the inspector's numbers). A
 * code is read-only in the 3D view: its position is all it offers. The
 * buttons are `editor-shell.ts`'s.
 *
 * @see bar-actions.ts.md
 */
import type { InspectorModel } from "./inspector-model.js";

export type BarAction = "duplicate" | "align" | "copy";

interface BarButton {
  readonly action: BarAction;
  readonly label: string;
  readonly title: string;
}

/** An item this near its station's way (degrees, either side) is aligned:
 *  a turn would only add an undo step. */
export const ALIGNED_DEG = 0.5;

const BUTTONS: Readonly<Record<BarAction, BarButton>> = {
  duplicate: {
    action: "duplicate",
    label: "Duplicate",
    title: "Duplicate the selection (Ctrl+D)",
  },
  align: {
    action: "align",
    label: "Align to station",
    title: "Turn it to face the way its station faces",
  },
  copy: {
    action: "copy",
    label: "Copy position",
    title: "Copy the position and heading as text",
  },
};

/** The bar's actions for the selection's inspector (none without one). */
export function barActions(model: InspectorModel | null): readonly BarButton[] {
  if (model === null) return [];
  const copy = positionText(model) === null ? [] : [BUTTONS.copy];
  if (model.kind === "code") return copy;
  if (model.kind === "station") return [BUTTONS.duplicate, ...copy];
  return [BUTTONS.duplicate, BUTTONS.align, ...copy];
}

/** `value` with two decimals, "-0.00" said as "0.00". */
function metres(value: number): string {
  const text = value.toFixed(2);
  return Number(text) === 0 ? "0.00" : text;
}

function heading(deg: number | null): string {
  if (deg === null || !Number.isFinite(deg)) return "no heading";
  return `heading ${String(Math.round(((deg % 360) + 360) % 360) % 360)} deg`;
}

/**
 * The selection's place and heading as text: a station's or a code's in
 * metres east and north of the tour's centre and its height over the
 * ellipsoid (the inspector's Position), an item's in its station's frame.
 * Null without a selection or a position.
 */
export function positionText(model: InspectorModel | null): string | null {
  if (model === null) return null;
  if (model.kind === "item") {
    const { northM, eastM, upM } = model.offset;
    return `${metres(northM)} m north, ${metres(eastM)} m east, ${metres(upM)} m up of its station, ${heading(model.headingDeg)}`;
  }
  const at = model.position;
  if (at === null) return null;
  return `E ${metres(at.eastM)} m, N ${metres(at.northM)} m, height ${metres(at.altM)} m, ${heading(at.headingDeg)}`;
}
