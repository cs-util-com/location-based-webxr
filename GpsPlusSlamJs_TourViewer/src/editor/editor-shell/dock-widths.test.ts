/**
 * Why this test matters: the stylesheet draws the 3D view's docks, and
 * the editor kit's dock rule reads their widths from its constants; the
 * two must not drift apart, or the rule folds a dock for a scene strip
 * that is not the one on screen. The kit draws no CSS, so the check is
 * the app's, next to its stylesheet (it was in the rule's own test before
 * the rule moved into the kit).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  INSPECTOR_DOCK_PX,
  TREE_DOCK_PX,
} from "gps-plus-slam-editor-kit/chrome";

describe("the docks' widths", () => {
  it("are the widths the stylesheet draws", () => {
    const css = readFileSync(
      new URL("./editor-shell.css", import.meta.url),
      "utf8",
    );
    const width = (id: string) =>
      new RegExp(String.raw`#${id} [{][^}]*?\bwidth: (\d+)px;`).exec(css)?.[1];
    expect(width("shell-tree")).toBe(String(TREE_DOCK_PX));
    expect(width("shell-inspector")).toBe(String(INSPECTOR_DOCK_PX));
  });
});
