/**
 * Why this test matters: step 5's "Before you start" list is what a
 * creator reads right before AR, and each line must say only what the page
 * really knows. An open tour is the one thing that keeps placed work on
 * this phone (its draft), so that line is checked only for an open tour;
 * the hung code is out of the page's sight, so it is never checked; and
 * "cannot keep a backup copy" shows only when the draft store said so.
 * The refusal sentence is the same reason, said when Start is tapped
 * with no tour open.
 */
import { describe, expect, it } from "vitest";

import {
  NO_TOUR_START_MESSAGE,
  renderStartChecklist,
  startChecklistView,
  type StartChecklistDom,
} from "./start-checklist.js";

function row(view: ReturnType<typeof startChecklistView>, id: string) {
  const found = view.rows.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
}

describe("the Before you start list", () => {
  it("checks the tour line for an open tour whose draft is kept, with no link", () => {
    const view = startChecklistView({ tourOpen: true, backupKept: true });
    const tour = row(view, "tour");
    expect(tour.state).toBe("done");
    expect(tour.text).toBe(
      "Your tour is open on this phone, so everything you place is backed up here.",
    );
    expect(tour.linkShown).toBe(false);
    expect(row(view, "no-backup").shown).toBe(false);
  });

  it("leaves the tour line unchecked with a link to step 2 when no tour is open", () => {
    const view = startChecklistView({ tourOpen: false, backupKept: true });
    const tour = row(view, "tour");
    expect(tour.state).toBe("todo");
    expect(tour.linkShown).toBe(true);
    expect(row(view, "no-backup").shown).toBe(false);
  });

  it("words an unchecked tour line as what to do, never as if a tour were open", () => {
    // Why this test matters: the first build showed "Your tour is open on
    // this phone" beside an empty box while no tour was open - a false
    // statement a sighted reader takes at its word.
    for (const backupKept of [true, false]) {
      const tour = row(
        startChecklistView({ tourOpen: false, backupKept }),
        "tour",
      );
      expect(tour.text).toMatch(/^Open your tour on this phone/);
      expect(tour.text).not.toMatch(/is open/);
    }
  });

  it("never checks the hung code: the page cannot see it", () => {
    for (const tourOpen of [true, false]) {
      for (const backupKept of [true, false]) {
        const code = row(startChecklistView({ tourOpen, backupKept }), "code");
        expect(code.state).toBe("reminder");
        expect(code.shown).toBe(true);
        expect(code.text).toMatch(/your code hangs where the tour starts/i);
      }
    }
  });

  it("says the phone keeps no backup only when the draft store said so, and drops the backup claim", () => {
    const view = startChecklistView({ tourOpen: true, backupKept: false });
    expect(row(view, "no-backup").shown).toBe(true);
    expect(row(view, "no-backup").text).toMatch(
      /this phone cannot keep a backup copy/i,
    );
    expect(row(view, "tour").state).toBe("done");
    expect(row(view, "tour").text).not.toMatch(/backed up/);
  });
});

describe("rendering the list", () => {
  function fakeRow() {
    return {
      root: { dataset: {} as DOMStringMap, hidden: false },
      state: { textContent: "" as string | null },
      text: { textContent: "" as string | null },
    };
  }
  function fakeDom() {
    return {
      tour: fakeRow(),
      code: fakeRow(),
      noBackup: fakeRow(),
      tourLink: { hidden: false },
    };
  }

  it("writes each row's state, its spoken state word and its text", () => {
    const dom = fakeDom();
    renderStartChecklist(
      dom as unknown as StartChecklistDom,
      startChecklistView({ tourOpen: false, backupKept: false }),
    );
    expect(dom.tour.root.dataset["state"]).toBe("todo");
    expect(dom.tour.state.textContent).toBe("Not yet:");
    expect(dom.tourLink.hidden).toBe(false);
    expect(dom.code.root.dataset["state"]).toBe("reminder");
    expect(dom.code.state.textContent).toBe("Reminder:");
    expect(dom.noBackup.root.hidden).toBe(false);
    expect(dom.noBackup.root.dataset["state"]).toBe("warning");
  });

  it("checks the tour row and hides the link and the warning for an open, backed-up tour", () => {
    const dom = fakeDom();
    renderStartChecklist(
      dom as unknown as StartChecklistDom,
      startChecklistView({ tourOpen: true, backupKept: true }),
    );
    expect(dom.tour.root.dataset["state"]).toBe("done");
    expect(dom.tour.state.textContent).toBe("Done:");
    expect(dom.tourLink.hidden).toBe(true);
    expect(dom.noBackup.root.hidden).toBe(true);
  });
});

describe("the refusal with no tour open", () => {
  it("names the step that opens a tour and why it comes first", () => {
    expect(NO_TOUR_START_MESSAGE).toMatch(/open your tour/i);
    expect(NO_TOUR_START_MESSAGE).toMatch(/step 2/);
    expect(NO_TOUR_START_MESSAGE).toMatch(/backed up/);
  });
});
