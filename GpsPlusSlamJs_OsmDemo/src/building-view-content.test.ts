/**
 * Guardrail: map-derived content is routed through `this.content`, not to the
 * scene directly.
 *
 * WHY A SOURCE-TEXT TEST, which is unusual and is the point. `scene-content.ts`
 * names one failure mode twice — *"an edit that attaches AR-relevant content
 * straight to `BuildingView`'s scene leaves it behind, and the symptom is
 * content missing in AR while every desktop test stays green"* — and the first
 * version of this milestone guarded it nowhere. It cannot be guarded at
 * runtime: `BuildingView` constructs a `THREE.WebGLRenderer`, so the unit suite
 * cannot instantiate it, and the desktop e2e passes either way BY DEFINITION —
 * on desktop both parents render identically. The defect is invisible until AR
 * runs, which is the definition of a thing that needs a static check.
 *
 * Precedent in this workspace for reading source as text rather than importing
 * it: `agent-loop-config.test.ts`, `retracted-osm-figures-in-docs.test.ts`,
 * `internal-subpath-guardrail.test.ts` and `ip-guardrail.test.ts`.
 *
 * What it does NOT do: decide whether a given object *should* be AR content.
 * That is a judgement recorded in `scene-content.ts` against plan §2.8. This
 * only makes the split explicit, so adding a fifth object to the scene is a
 * deliberate act with a red gate attached rather than an oversight.
 *
 * @see scene-content.ts.md
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(HERE, "building-view.ts"), "utf-8");

/**
 * Everything `BuildingView` may attach directly to its own scene, with the
 * reason each one is NOT AR content.
 *
 * Keyed on the field name as written at the call site. Kept as a table rather
 * than a count so a failure names the object, and so the reason travels with
 * the exemption instead of living in a commit message.
 */
const SCENE_ONLY: readonly {
  readonly expression: string;
  readonly why: string;
}[] = [
  {
    expression: "new THREE.AmbientLight(0xffffff, 0.25)",
    why: "AR uses the framework scene's own lighting (ambient 0.5 / directional 0.8)",
  },
  { expression: "this.sun", why: "same — AR does not carry the sun rig" },
  {
    expression: "this.ground",
    why: "AR hides the ground plane by design (plan §2.8, ground mode `none`)",
  },
  {
    expression: "this.undergroundLines",
    why: "not in §2.8's content list, and its material disables depth testing — with no ground plane in AR it would paint across the passthrough",
  },
  {
    expression: "this.routeLine",
    why: "the NPC is not listed as AR content in §2.8",
  },
  { expression: "this.agent", why: "same as routeLine" },
];

/**
 * `this.scene.add(x)` / `this.scene.remove(x)`, capturing `x`.
 *
 * Allows ONE level of nested parentheses, because the argument is sometimes a
 * constructor call (`new THREE.AmbientLight(0xffffff, 0.25)`). A plain
 * `[^)]+?` truncates that at the inner paren and the exemption then never
 * matches — which is how the first run of this guard failed, and is worth
 * keeping as a comment because the truncation is silent in the other
 * direction: a table entry written to match the TRUNCATED text would pass
 * while describing something that is not what the code says.
 */
const SCENE_ATTACH =
  /this\.scene\.(?:add|remove)\(\s*((?:[^()]|\([^()]*\))*?)\s*\)/g;

describe("BuildingView routes AR content through the content root", () => {
  it("attaches nothing to the scene directly except the recorded exemptions", () => {
    // THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. Before this
    // milestone the cell mesh, its outlines and the layer group all went
    // straight to the scene; in AR that is a city that does not appear.
    const attached = [...SOURCE.matchAll(SCENE_ATTACH)].map((m) =>
      (m[1] ?? "").replace(/\s+/g, " ").trim(),
    );
    const allowed = new Set(SCENE_ONLY.map((entry) => entry.expression));

    const unexpected = attached.filter(
      (expression) => !allowed.has(expression),
    );

    expect(
      unexpected,
      "attached straight to the scene — is this AR content? If yes it belongs " +
        "on `this.content`; if no, add it to SCENE_ONLY with the reason.",
    ).toEqual([]);
  });

  it("actually finds the attachments, so the check cannot pass vacuously", () => {
    // A renamed field, a reformatted call or a regex that stopped matching
    // would each make the assertion above succeed over an empty list — the
    // failure mode every guard in this workspace has hit at least once.
    const attached = [...SOURCE.matchAll(SCENE_ATTACH)];
    expect(attached.length).toBeGreaterThanOrEqual(SCENE_ONLY.length);
  });

  it("keeps the AR content on the content root", () => {
    // The positive half. Without it, "move everything back to the scene and
    // add it all to SCENE_ONLY" would pass the first test.
    for (const expression of [
      "this.group",
      "this.cellMesh",
      "this.cellOutlines",
      // N6/DEC-K4. THE ASSERTION WITH TEETH FOR THE BEACONS: the negative
      // half above matches only `this.scene.add(...)`, so a beacon routed
      // through `this.content` trips nothing there — and could later be moved
      // to the scene with no gate noticing. A quest marker left behind on
      // entering AR is the wrong half of the feature: the map already shows
      // the quest, and AR is where you walk to it.
      "this.questBeacons.root",
    ]) {
      expect(
        SOURCE.includes(`this.content.add(${expression})`),
        `${expression} must be attached to the content root, not the scene`,
      ).toBe(true);
    }
  });
});

describe("the demo store keeps its devtools summariser wired", () => {
  it("passes summariseSnapshot to the factory", () => {
    // The migration DROPPED this once already, and nothing noticed: devtools
    // then deep-walked the whole ~931-cell snapshot on every dispatch, which is
    // the 71 ms cost the serialisable exemption two lines away exists to avoid.
    // Source text for the same reason the framework side is: the only consumer
    // of a state sanitizer is the browser extension.
    const source = readFileSync(path.join(HERE, "osm-store.ts"), "utf-8");
    expect(source).toMatch(/devToolsStateSanitizer:\s*summariseSnapshot/);
  });
});

describe("suspend/resume — the desktop renderer's AR lifecycle (M5)", () => {
  it("gates EVERY frame request behind one flag, not each call site", () => {
    // `requestFrame` has a dozen callers in this file — a terrain load landing,
    // a snapshot publishing, a resize, a camera change — and a suspended view
    // can still be driven down any of them. Refusing inside `requestFrame` is
    // the only place that covers them all; guarding the call sites instead is a
    // list that the next one added will not be on.
    expect(SOURCE).toMatch(
      /private requestFrame\(\): void \{[\s\S]{0,600}?if \(this\.suspended\) return;/,
    );
  });

  it("cancels a frame already in flight rather than only refusing new ones", () => {
    // `requestFrame` coalesces, so one callback can already be scheduled when
    // AR starts. Left alone it renders the desktop scene once, on the frame
    // after the session began, for nothing.
    expect(SOURCE).toMatch(
      /suspend\(\): void \{[\s\S]{0,400}?cancelAnimationFrame\(this\.frame\)/,
    );
  });

  it("hides with `visibility`, never with `display`", () => {
    // A `display: none` canvas has a zero-sized box, and this class observes
    // its container with a `ResizeObserver` — so hiding that way would resize
    // the drawing buffer to 0×0, and returning from AR would find a renderer
    // sized for an element that had no size. Blank pane, no error.
    const suspend = /suspend\(\): void \{[\s\S]*?\n {2}\}/.exec(SOURCE)?.[0];
    expect(suspend).toContain('style.visibility = "hidden"');
    // On the ASSIGNMENT, not the word: the method's own comment explains why
    // `display` is wrong, and a naive substring check flags that explanation.
    expect(suspend).not.toContain("style.display");
  });

  it("schedules a frame on resume, because nothing else will", () => {
    // The scene is static and frames are on demand, so without this the pane
    // stays exactly as it was when the session started — which, having been
    // hidden, means blank.
    const resume = /resume\(\): void \{[\s\S]*?\n {2}\}/.exec(SOURCE)?.[0];
    expect(resume).toContain("this.requestFrame()");
  });
});
