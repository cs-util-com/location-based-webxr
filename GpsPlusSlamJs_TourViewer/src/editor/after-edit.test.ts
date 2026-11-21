/**
 * Why these tests matter: every typed edit of the inspector runs the same
 * steps around its write - the Undo offer ended first, the page refreshed
 * after the write, then a refusal said or a change counted - and about
 * thirty other places of the editor page repeat those steps by hand. A
 * later change makes them one listener on the document; these tests pin
 * what the steps do today (their order, and which outcome takes which
 * branch), so that move can be checked against them. They also pin which
 * session method each inspector command writes through, since the
 * commands are wired three times over (the session, the shell's command
 * list, the page's wrappers) and a later change wires them once.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  inspectorWriteCommands,
  writeTypedEdit,
  type InspectorWriteCommands,
  type SessionWrite,
  type TypedEditSteps,
} from "./after-edit.js";
import type { EditorSession } from "./editor-session.js";

/** A session that only stands for "a tour is open". */
const SESSION = {} as unknown as EditorSession;

/** Steps that log what ran, in order. */
function loggedSteps(open = true): { steps: TypedEditSteps; log: string[] } {
  const log: string[] = [];
  return {
    log,
    steps: {
      session: () => (open ? SESSION : null),
      endUndo: () => log.push("endUndo"),
      refresh: () => log.push("refresh"),
      say: (text) => log.push(`say ${text}`),
      changed: () => log.push("changed"),
    },
  };
}

/** A write that logs itself and answers `outcome`. */
function loggedWrite(
  log: string[],
  outcome: ReturnType<SessionWrite>,
): SessionWrite {
  return (session) => {
    expect(session).toBe(SESSION);
    log.push("write");
    return outcome;
  };
}

describe("writeTypedEdit: the steps around one typed edit", () => {
  // With no tour open nothing runs at all: not even the Undo offer ends,
  // and the inspector keeps the typed text ("refused").
  it("refuses with nothing run when no tour is open", () => {
    const { steps, log } = loggedSteps(false);
    const outcome = writeTypedEdit(steps, loggedWrite(log, { kind: "edited" }));
    expect(outcome).toBe("refused");
    expect(log).toEqual([]);
  });

  it("ends the Undo offer, writes, refreshes, then counts a change", () => {
    const { steps, log } = loggedSteps();
    expect(writeTypedEdit(steps, loggedWrite(log, { kind: "edited" }))).toBe(
      "written",
    );
    expect(log).toEqual(["endUndo", "write", "refresh", "changed"]);
  });

  // An unchanged outcome counts nothing here. The narration's and the
  // poster's paths of the page ask the autosave's cap again for it
  // instead (`judgeAutosave`): an asymmetry a single listener must keep
  // or decide on.
  it("counts no change for an unchanged outcome, and still refreshes", () => {
    const { steps, log } = loggedSteps();
    expect(writeTypedEdit(steps, loggedWrite(log, { kind: "unchanged" }))).toBe(
      "written",
    );
    expect(log).toEqual(["endUndo", "write", "refresh"]);
  });

  // The page refreshes before it says the refusal: the toast reads over a
  // page that already shows the tour as it stands.
  it("says a refusal after the refresh and counts nothing", () => {
    const { steps, log } = loggedSteps();
    expect(
      writeTypedEdit(
        steps,
        loggedWrite(log, { kind: "refused", reason: "Too long." }),
      ),
    ).toBe("refused");
    expect(log).toEqual(["endUndo", "write", "refresh", "say Too long."]);
  });

  // Over any kind the session answers, with or without a reason: the
  // Undo offer always ends first and the refresh always follows the
  // write; exactly one of "say" (a reason) or "changed" (any kind but
  // "unchanged") or nothing comes last. What decides a refusal is the
  // reason, not the kind's name.
  it("keeps its order over any outcome (property)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom("edited", "unchanged", "refused", "deleted"),
          fc.string(),
        ),
        fc.option(fc.string(), { nil: undefined }),
        (kind, reason) => {
          const { steps, log } = loggedSteps();
          const outcome =
            reason === undefined
              ? { kind }
              : ({ kind, reason } as { kind: "refused"; reason: string });
          const result = writeTypedEdit(steps, loggedWrite(log, outcome));
          const head = ["endUndo", "write", "refresh"];
          const tail =
            reason !== undefined
              ? [`say ${reason}`]
              : kind === "unchanged"
                ? []
                : ["changed"];
          expect({ result, log }).toEqual({
            result: reason === undefined ? "written" : "refused",
            log: [...head, ...tail],
          });
        },
      ),
    );
  });
});

describe("inspectorWriteCommands: each command's session method", () => {
  /** A session that records the method each write calls and its
   *  arguments. */
  function recordingSession(): {
    session: EditorSession;
    calls: [string, unknown[]][];
  } {
    const calls: [string, unknown[]][] = [];
    const session = new Proxy(
      {},
      {
        get:
          (_target, name) =>
          (...args: unknown[]) => {
            calls.push([String(name), args]);
            return { kind: "edited" };
          },
      },
    ) as EditorSession;
    return { session, calls };
  }

  type Case = [
    keyof InspectorWriteCommands,
    (commands: InspectorWriteCommands) => unknown,
    string,
    unknown[],
  ];
  const step = { storyId: "story-1" } as never;
  const edit = { name: "New" } as never;
  const cases: Case[] = [
    ["station", (c) => c.station("s1", edit), "editStation", ["s1", edit]],
    ["text", (c) => c.text("p1", "Hi"), "editText", ["p1", "Hi"]],
    [
      "block",
      (c) => c.block("p1", "caption", "Hi"),
      "editBlockField",
      ["p1", "caption", "Hi"],
    ],
    ["view", (c) => c.view("t1", "sign"), "editBlockView", ["t1", "sign"]],
    [
      "pictureTag",
      (c) => c.pictureTag("ph1", false),
      "editPictureTag",
      ["ph1", false],
    ],
    [
      "pictureViewpoint",
      (c) => c.pictureViewpoint("ph1", null),
      "editPictureViewpoint",
      ["ph1", null],
    ],
    ["model", (c) => c.model("m1", edit), "editModel", ["m1", edit]],
    [
      "groundItems",
      (c) => c.groundItems([{ id: "p1", alt: 3 }]),
      "groundItems",
      [[{ id: "p1", alt: 3 }]],
    ],
    [
      "storyTitle",
      (c) => c.storyTitle("story-1", "Walk"),
      "renameStory",
      ["story-1", "Walk"],
    ],
    [
      "storyAdvance",
      (c) => c.storyAdvance("b1", "tap" as never),
      "setStoryAdvance",
      ["b1", "tap"],
    ],
    ["storyStep", (c) => c.storyStep(step), "setStoryStep", [step]],
  ];

  it.each(cases)(
    "%s writes through the session's %s, once, through the typed-edit path",
    (_name, run, method, args) => {
      const { session, calls } = recordingSession();
      let writes = 0;
      const commands = inspectorWriteCommands((write) => {
        writes += 1;
        write(session);
        return "written";
      });
      run(commands);
      expect(writes).toBe(1);
      expect(calls).toEqual([[method, args]]);
    },
  );

  // The list is the whole set: a command added to the shell's list but
  // not here would reach the page by another path, and one dropped here
  // would leave the inspector without it.
  it("covers exactly these eleven commands", () => {
    const commands = inspectorWriteCommands(() => "written");
    expect(Object.keys(commands).sort()).toEqual(
      cases.map(([name]) => name).sort(),
    );
  });

  // groundItems answers nothing (the shell's command returns void), the
  // others hand the path's outcome back to the inspector.
  it("hands the typed-edit path's outcome back, but for groundItems", () => {
    const commands = inspectorWriteCommands(() => "refused");
    expect(commands.text("p1", "x")).toBe("refused");
    expect(commands.groundItems([])).toBeUndefined();
  });
});
