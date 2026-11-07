// @vitest-environment jsdom
/**
 * Why these tests matter: AR has no window.confirm, so the list's question
 * is the only way a Move into another station's circle is answered. Hidden
 * or unwired, the Move would wait for ever, its row stuck on "Asking…".
 */
import { describe, expect, it, vi } from "vitest";

import {
  createObjectListView,
  type ObjectListHandlers,
  type ObjectListModel,
} from "./object-list.js";

const MODEL: ObjectListModel = {
  hidden: false,
  hint: "",
  heading: "",
  rows: [],
  note: "",
  undo: false,
  question: null,
};

function viewed() {
  const container = document.createElement("div");
  const view = createObjectListView(container, document);
  const answer = vi.fn();
  view.bind({ answer } as unknown as ObjectListHandlers);
  return { container, view, answer };
}

const inside = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

describe("the object list's question", () => {
  it("shows the question with both answers, and hides without one", () => {
    const { container, view, answer } = viewed();
    view.render(MODEL);
    expect(inside(container, "object-question").parentElement?.hidden).toBe(
      true,
    );
    view.render({
      ...MODEL,
      question: { text: "Change?", declined: "Or it stays." },
    });
    const asked = inside(container, "object-question");
    expect(asked.parentElement?.hidden).toBe(false);
    expect(asked.textContent).toBe("Change? Or it stays.");
    inside(container, "object-question-no").click();
    expect(answer).toHaveBeenLastCalledWith(false);
    inside(container, "object-question-yes").click();
    expect(answer).toHaveBeenLastCalledWith(true);
  });
});
