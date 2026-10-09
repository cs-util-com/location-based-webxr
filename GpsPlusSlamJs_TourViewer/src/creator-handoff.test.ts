/**
 * The hand-off's save in isolation (the 2026-10-08 field test, F4): what
 * the status line keeps across saves. The composed behaviour - the Finish
 * saving by itself, the leave guard, the replace steps - is in
 * `creator-finish.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { wireCreatorHandoff } from "./creator-handoff.js";
import { FINISH_LABELS } from "./qr-author-mode.js";
import { createTourViewerSession } from "./tour-viewer-session.js";

function el() {
  const handlers = new Map<string, () => void>();
  return {
    hidden: false,
    disabled: false,
    textContent: "",
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function wired(outcome: { delivered: boolean }) {
  const ctx = createTourViewerSession();
  ctx.session = {
    archive: { url: "https://example.test/tour.zip", size: 1 },
    hostedFileName: () => null,
  } as never;
  ctx.rebuiltZip = { blob: new Blob(["zip"]), filename: "tour.zip" };
  const dom = {
    downloadButton: el(),
    finishStatus: el(),
    replaceHelp: el(),
    replaceHelpGeneric: el(),
    replaceHelpDrive: el(),
  };
  const handoff = wireCreatorHandoff({
    ctx,
    seams: { downloadZip: () => Promise.resolve(outcome.delivered) },
    dom: dom as never,
    render: () => undefined,
  });
  return { ctx, dom, handoff };
}

describe("the hand-off's status line", () => {
  // Why (F4 milestone review #4b): the Finish's result sentences - the
  // code's position (with a large-turn warning), a walk left out - stay
  // under the status of EVERY save, the button's later ones too; the old
  // tapped save replaced them with its own line.
  it("keeps the Finish's notes under every save's status", async () => {
    const outcome = { delivered: false };
    const { dom, handoff } = wired(outcome);
    handoff.save("The code's saved position was kept.");
    await flush();
    expect(dom.finishStatus.textContent).toBe(
      `${FINISH_LABELS.notSaved} The code's saved position was kept.`,
    );
    outcome.delivered = true;
    dom.downloadButton.click();
    await flush();
    expect(dom.finishStatus.textContent).toBe(
      `${FINISH_LABELS.saved("tour.zip")} The code's saved position was kept.`,
    );
  });

  // Why: a closed tour's notes must not reach the next tour's line.
  it("forgets the notes when the tour closes", async () => {
    const outcome = { delivered: true };
    const { dom, handoff } = wired(outcome);
    handoff.save("A note of the closed tour.");
    await flush();
    handoff.reset();
    handoff.save();
    await flush();
    expect(dom.finishStatus.textContent).toBe(FINISH_LABELS.saved("tour.zip"));
  });
});
