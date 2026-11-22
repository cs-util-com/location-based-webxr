/**
 * The draft question in the store (`tour-draft-slice.ts`).
 *
 * Why this suite matters: both pages render the offer from these
 * selectors, so a wrong transition shows an offer nobody can answer, or
 * hides one whose edits still wait. These rows pin each answer's path and
 * the guards that keep a late read or answer of an earlier question from
 * changing the present one.
 */
import { describe, expect, it } from "vitest";

import { tourDocumentActions } from "./tour-document.js";
import {
  initialTourDraftState,
  selectDraftOffer,
  selectDraftUndecided,
  selectEditWaitsForRead,
  tourDraftActions as a,
  tourDraftReducer,
  type TourDraftState,
} from "./tour-draft-slice.js";

function run(...actions: Parameters<typeof tourDraftReducer>[1][]) {
  return actions.reduce<TourDraftState>(
    (s, action) => tourDraftReducer(s, action),
    initialTourDraftState,
  );
}

const view = (state: TourDraftState) => selectDraftOffer({ tourDraft: state });

describe("the draft question in the store", () => {
  it("offers what the read found, in its words", () => {
    const s = run(a.readStarted(), a.found({ generation: 1, text: "Back?" }));
    expect(s.status).toBe("offered");
    expect(view(s)).toEqual({ text: "Back?", waits: false, deleting: false });
    expect(selectDraftUndecided({ tourDraft: s })).toBe(true);
  });

  it("ends the read with nothing to offer", () => {
    const s = run(a.readStarted(), a.noneFound({ generation: 1 }));
    expect(s.status).toBe("none");
    expect(view(s)).toBeNull();
  });

  it("ignores a read that finishes after the tour was read again", () => {
    const s = run(
      a.readStarted(),
      a.readStarted(),
      a.found({ generation: 1, text: "Old tour's" }),
    );
    expect(s.status).toBe("reading");
    expect(s.text).toBeNull();
  });

  it("ignores a Restore of a question the tour's close ended", () => {
    const s = run(
      a.readStarted(),
      a.found({ generation: 1, text: "Back?" }),
      tourDocumentActions.closed(),
      a.restored({ generation: 1 }),
    );
    expect(s.status).toBe("none");
    expect(s.generation).toBe(2);
  });

  it("lets no answer of an earlier offer decide the reopened tour's offer", () => {
    const reopened = run(
      a.readStarted(),
      a.found({ generation: 1, text: "First open" }),
      a.deleteStarted({ generation: 1 }),
      a.readStarted(),
      a.found({ generation: 2, text: "Second open" }),
    );
    const late = [
      a.restored({ generation: 1 }),
      a.declined({ generation: 1 }),
      a.deleteStarted({ generation: 1 }),
    ];
    for (const action of late) {
      expect(tourDraftReducer(reopened, action)).toEqual(reopened);
    }
    const deleting = tourDraftReducer(
      reopened,
      a.deleteStarted({ generation: 2 }),
    );
    expect(
      tourDraftReducer(
        deleting,
        a.deleteEnded({ generation: 1, landed: true }),
      ),
    ).toEqual(deleting);
  });

  it("hides a put-off offer and shows it again at the first waiting edit", () => {
    const off = run(
      a.readStarted(),
      a.found({ generation: 1, text: "Back?" }),
      a.declined({ generation: 1 }),
    );
    expect(off.status).toBe("declined");
    expect(view(off)).toBeNull();
    expect(selectDraftUndecided({ tourDraft: off })).toBe(true);
    const asked = tourDraftReducer(off, a.editsWaitingChanged({ count: 1 }));
    expect(view(asked)).toEqual({
      text: "Back?",
      waits: true,
      deleting: false,
    });
  });

  it("keeps every answer off while Delete it runs, and the offer on a failure", () => {
    const running = run(
      a.readStarted(),
      a.found({ generation: 1, text: "Back?" }),
      a.deleteStarted({ generation: 1 }),
      a.restored({ generation: 1 }),
      a.declined({ generation: 1 }),
    );
    expect(running.status).toBe("offered");
    expect(view(running)?.deleting).toBe(true);
    const failed = tourDraftReducer(
      running,
      a.deleteEnded({ generation: 1, landed: false }),
    );
    expect(view(failed)).toEqual({
      text: "Back?",
      waits: false,
      deleting: false,
    });
    const landed = tourDraftReducer(
      running,
      a.deleteEnded({ generation: 1, landed: true }),
    );
    expect(landed.status).toBe("none");
    expect(landed.text).toBeNull();
  });

  it("says no draft can be kept, but never over an offer still to answer", () => {
    const none = run(
      a.readStarted(),
      a.unavailable({ generation: 1, reason: "storage" }),
    );
    expect(none).toMatchObject({ status: "unavailable", reason: "storage" });
    const offered = run(
      a.readStarted(),
      a.found({ generation: 1, text: "Back?" }),
      a.unavailable({ generation: 1, reason: "other-tab" }),
    );
    expect(offered).toMatchObject({ status: "offered", reason: null });
  });

  it("refuses a malformed count or reason", () => {
    const s = run(
      a.readStarted(),
      a.editsWaitingChanged({ count: -1 }),
      a.editsWaitingChanged({ count: 1.5 }),
      a.unavailable({ generation: 1, reason: "nope" as never }),
    );
    expect(s).toMatchObject({ status: "reading", editsWaiting: 0 });
  });

  it("names an edit waiting for a draft still being read", () => {
    const s = run(a.readStarted(), a.editsWaitingChanged({ count: 2 }));
    expect(selectEditWaitsForRead({ tourDraft: s })).toBe(true);
    const found = tourDraftReducer(s, a.found({ generation: 1, text: "B" }));
    expect(selectEditWaitsForRead({ tourDraft: found })).toBe(false);
  });
});
