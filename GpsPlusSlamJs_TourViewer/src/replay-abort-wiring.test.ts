/**
 * Replay abort seam — wiring guard.
 *
 * Why this test matters (PR #379 review): `replayActions`' `shouldContinue`
 * option was added WITH a docstring naming this exact call site as its
 * motivation, and then not wired here. Nothing caught that — the option is
 * optional, so types are satisfied; it is used by the framework's own unit
 * tests, so knip sees no dead export; and `main.ts` is the DOM-heavy app
 * entry with no unit tests of its own. The defect the seam was written to
 * remove therefore stayed live while its documentation said otherwise.
 *
 * A source-level assertion is the honest guard for this: the invariant is
 * "the production call site passes the option", which no type check and no
 * behavioural test of either module can see. If the call is ever refactored
 * out of `main.ts`, this fails loudly rather than silently losing the abort.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(
  fileURLToPath(new URL("./main.ts", import.meta.url)),
  "utf8",
);

describe("the tour replay honours the abort seam", () => {
  it("passes shouldContinue to replayActions", () => {
    const call = mainSource.slice(
      mainSource.indexOf("await replayActions(actions, {"),
    );
    expect(call).not.toBe("");
    // Scoped to the option object of that one call, so an unrelated
    // `shouldContinue` elsewhere in the file cannot make this pass.
    const options = call.slice(0, call.indexOf("}))"));
    expect(options).toContain("shouldContinue:");
    expect(options).toContain("planesRunGeneration");
  });

  it("bails without writing a status when the run was superseded", () => {
    // An aborted replay returns a PARTIAL state, which `assessReplayedJoin`
    // declines for a reason that names missing GPS data — a wrong label
    // written into a UI a newer run already owns.
    const afterReplay = mainSource.slice(
      mainSource.indexOf("})) as unknown as ReplayedJoinState;"),
    );
    const beforeVerdict = afterReplay.slice(
      0,
      afterReplay.indexOf("const verdict = assessReplayedJoin(state);"),
    );
    expect(beforeVerdict).toContain(
      "if (generation !== planesRunGeneration) return false;",
    );
  });
});
