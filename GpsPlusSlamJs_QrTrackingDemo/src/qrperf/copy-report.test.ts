/**
 * Why these tests matter: "Copy JSON" is how the owner gets the full numbers
 * off the phone. Clipboard writes are async and can be refused (no permission,
 * no secure context), so the button must show an in-progress state and then
 * a truthful outcome for BOTH success and failure (root CLAUDE.md, UI feedback
 * for async actions) - a silent failure would look like a copied report.
 */

import { describe, expect, it } from "vitest";
import { copyReport, COPY_LABELS } from "./copy-report.js";

function fakeButton() {
  return { textContent: COPY_LABELS.idle, disabled: false };
}

describe("copyReport", () => {
  it("shows the in-progress label while writing, then confirms success", async () => {
    const button = fakeButton();
    let seenDuring: string | null = null;
    await copyReport(button, "{}", () => {
      seenDuring = button.textContent;
      return Promise.resolve();
    });
    expect(seenDuring).toBe(COPY_LABELS.busy);
    expect(button.textContent).toBe(COPY_LABELS.done);
    expect(button.disabled).toBe(false);
  });

  it("reports a refused clipboard write instead of pretending it worked", async () => {
    const button = fakeButton();
    await copyReport(button, "{}", () =>
      Promise.reject(new Error("NotAllowedError")),
    );
    expect(button.textContent).toBe(COPY_LABELS.failed);
    expect(button.disabled).toBe(false);
  });

  it("fails honestly when there is no clipboard API at all", async () => {
    const button = fakeButton();
    await copyReport(button, "{}", undefined);
    expect(button.textContent).toBe(COPY_LABELS.failed);
  });
});
