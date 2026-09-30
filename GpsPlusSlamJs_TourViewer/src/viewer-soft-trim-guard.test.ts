/**
 * The keep-alive's solver seam is not wired yet - and must be the moment it
 * can be (Tour Viewer authoring plan 2026-09-28-0953 §3.2, D12; M2b
 * milestone review #3).
 *
 * Why this test matters: M0c measured the keep-alive's hand-off to GPS as
 * smooth only under M2a's soft outlier trimming; under the core's shipped
 * hard trim it fails at a 5 m bias, jumps at 8 m, and never hands off at
 * 15 m. The soft keys (`outlierFalloff*`) exist only in an unreleased core,
 * so the viewer cannot dispatch them yet, and the seam's contract lives in
 * `viewer-placement.ts.md` ("The seam for the per-entry solver
 * overrides"). This guard is the tripwire between the two: it holds while
 * the installed core REFUSES the soft keys, and it breaks - at
 * `typecheck:tests` (the `@ts-expect-error` below turns unused) and here at
 * run time - on the first core that accepts them. Whoever bumps the core is
 * then stopped until the seam is wired; replace this file with tests of the
 * wiring, never by deleting the directive alone.
 *
 * What it cannot do: stop a build that ships the keep-alive under the hard
 * trim BEFORE that core exists. Only a release rule, or gating the
 * keep-alive itself off until the seam is wired, can - an owner decision.
 */
import { describe, expect, it } from "vitest";
import { setAlignmentOverrides } from "gps-plus-slam-app-framework/state";

import { createTourViewerStore } from "./tour-viewer-session.js";

type AlignmentOverrides = NonNullable<
  Parameters<typeof setAlignmentOverrides>[0]
>;

describe("the viewer's per-entry soft-trimming seam (M2b review #3)", () => {
  it("the installed core cannot take the soft-trimming keys yet - when it can, wire the seam first", () => {
    // The published core has no `outlierFalloff*` keys. When the directive
    // below is reported unused, the core release landed: wire
    // viewer-placement.ts's seam (its sidecar states the contract) and
    // replace this guard with tests of that wiring.
    // @ts-expect-error - no such key in today's AlignmentOverrides
    const soft: AlignmentOverrides = { outlierFalloffEnabled: true };
    // The action creators are licence-gated; the store activates them.
    createTourViewerStore();
    // Today's core refuses the key outright, so no build can carry it by
    // accident; a core that stops refusing it is the release that makes
    // the seam wireable.
    expect(
      () => setAlignmentOverrides(soft),
      "the core accepts outlierFalloffEnabled: wire the viewer's per-entry overrides seam (viewer-placement.ts.md) before shipping the keep-alive, then replace this guard",
    ).toThrow(/unknown key "outlierFalloffEnabled"/);
  });
});
