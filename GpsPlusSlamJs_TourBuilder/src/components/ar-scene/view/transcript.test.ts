import { describe, expect, it, vi } from "vitest";
import { Group, Texture, Vector3 } from "three";

import { PAGE_PANEL_LAYOUT } from "../../in-world-text/core/page-layout.js";
import type { Measure } from "../../in-world-text/core/text-wrap.js";
import type { TextSurface } from "../../in-world-text/view/text-surface.js";
import { pageTranscript } from "./transcript.js";
import { createInWorldText } from "../../in-world-text/view/in-world-text.js";
import type { WaypointNode } from "./waypoint-registry.js";

/**
 * Regression coverage for the bug where any tap on the transcript panel
 * (including its text body) always advanced a page and there was no way to
 * go back. `pageTranscript` must resolve the tap's `uv` against the panel's
 * prev/next/text layout instead of unconditionally calling `next()`.
 */

const measure: Measure = (text) => text.length * 10;

function workingSurface(): TextSurface {
  return {
    texture: new Texture(),
    render: vi.fn(),
    settled: () => Promise.resolve(),
    dispose: vi.fn(),
  };
}

const centre = (r: { x: number; y: number; w: number; h: number }) => ({
  u: r.x + r.w / 2,
  v: r.y + r.h / 2,
});

// Two single-line paragraphs per page, long enough to span two pages at the
// tiny line height fixed below.
const TWO_PAGE_TEXT = Array.from({ length: 10 }, (_, i) => `line ${i}`).join(
  "\n",
);

function makeNode(): WaypointNode {
  return {
    waypointId: "wp-a",
    group: new Group(),
    anchor: {} as WaypointNode["anchor"],
    visual: null,
    text: null,
    audio: null,
    audioElement: null,
    transportPanel: null,
    transportPlaying: false,
    transportPositionSec: 0,
    transportDurationSec: 0,
  };
}

describe("pageTranscript", () => {
  it("does not advance on a tap in the text body", async () => {
    const node = makeNode();
    node.text = createInWorldText({
      text: TWO_PAGE_TEXT,
      position: new Vector3(),
      measure,
      createSurface: () => workingSurface(),
      style: { lineHeightPx: 56 },
    });
    await node.text.ready;
    expect(node.text.pageLabel).toBe("1 / 2");

    pageTranscript(node, centre(PAGE_PANEL_LAYOUT.text));

    expect(node.text.pageLabel).toBe("1 / 2");
  });

  it("advances on a tap on the next button", async () => {
    const node = makeNode();
    node.text = createInWorldText({
      text: TWO_PAGE_TEXT,
      position: new Vector3(),
      measure,
      createSurface: () => workingSurface(),
      style: { lineHeightPx: 56 },
    });
    await node.text.ready;

    pageTranscript(node, centre(PAGE_PANEL_LAYOUT.next));
    expect(node.text.pageLabel).toBe("2 / 2");

    // And the tap this bug prevented: going back via the prev button.
    pageTranscript(node, centre(PAGE_PANEL_LAYOUT.prev));
    expect(node.text.pageLabel).toBe("1 / 2");
  });
});
