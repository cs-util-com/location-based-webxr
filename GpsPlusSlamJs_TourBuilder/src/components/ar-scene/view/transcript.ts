/**
 * The transcript panel: component 2's `InWorldText`, positioned at the
 * waypoint's fixed transcript offset and stamped for tap-picking. Operates
 * directly on a looked-up `WaypointNode` — the adapter does the handle→node
 * lookup, same as it does for every other per-waypoint view module.
 */

import { Vector3 } from "three";

import {
  TRANSCRIPT_PANEL_WIDTH_M,
  TRANSCRIPT_VISUAL_HEIGHT_M,
  transcriptOffset,
} from "../config.js";
import { createInWorldText } from "../../in-world-text/view/in-world-text.js";
import { stamp } from "./pick-classify.js";
import type { WaypointNode } from "./waypoint-registry.js";

export function showTranscript(
  node: WaypointNode,
  text: string,
  centered = false,
): void {
  if (node.text === null) {
    const offset = transcriptOffset(TRANSCRIPT_PANEL_WIDTH_M, centered);
    node.text = createInWorldText({
      text,
      id: `transcript-${node.waypointId}`,
      position: new Vector3(offset.x, offset.y, 0),
      maxWidthMeters: TRANSCRIPT_PANEL_WIDTH_M,
      maxHeightMeters: TRANSCRIPT_VISUAL_HEIGHT_M,
      minHeightMeters: TRANSCRIPT_VISUAL_HEIGHT_M,
    });
    stamp(node.text.pickMesh, node.waypointId, "transcript");
    node.group.add(node.text.group);
  } else {
    node.text.setText(text);
  }
  node.text.group.visible = true;
}

export function hideTranscript(node: WaypointNode): void {
  if (node.text != null) node.text.group.visible = false;
}

export function disposeTranscript(node: WaypointNode): void {
  if (node.text == null) return;
  node.text.group.removeFromParent();
  node.text.dispose();
  node.text = null;
}

/**
 * Resolves the tapped `uv` against the panel's own prev/next/chrome layout
 * (component 2's `hitTest`) so only the footer buttons page the panel — a
 * tap on the text body is a no-op. Without this, every tap anywhere on the
 * panel (text included) always paged forward and there was no way back.
 * `uv` is only absent for a caller with no ray-cast surface (e.g. tests
 * driving taps directly); that case falls back to the prior next-only
 * behavior.
 */
export function pageTranscript(
  node: WaypointNode,
  uv?: { readonly u: number; readonly v: number },
): void {
  const text = node.text;
  if (text === null) return;
  if (uv === undefined) {
    text.next();
    return;
  }
  const intent = text.hitTest(uv);
  if (intent?.type === "next") text.next();
  else if (intent?.type === "prev") text.prev();
}
