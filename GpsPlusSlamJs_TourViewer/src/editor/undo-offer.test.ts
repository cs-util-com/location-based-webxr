/**
 * Why these tests matter: a toast's Undo names one step. Tapped after a
 * newer change, running the edit stack's undo would take back that newer
 * change instead - an edit the creator did not ask to lose - so the tap
 * must end the offer and say why, never undo and never stay silent.
 */
import { describe, expect, it, vi } from "vitest";

import { UNDO_NOT_NEWEST, undoTap } from "./undo-offer.js";

function page(current: unknown) {
  return {
    current: () => current,
    end: vi.fn(),
    undo: vi.fn(),
    say: vi.fn(),
  };
}

describe("undoTap", () => {
  it("undoes the step while it is the newest edit", () => {
    const mine = { revision: () => 4 };
    const p = page(mine);
    undoTap(mine, 4, p)();
    expect(p.undo).toHaveBeenCalledOnce();
    expect(p.say).not.toHaveBeenCalled();
  });

  it("ends the offer and says why after a newer change", () => {
    let revision = 4;
    const mine = { revision: () => revision };
    const p = page(mine);
    const tap = undoTap(mine, 4, p);
    revision = 5;
    tap();
    expect(p.undo).not.toHaveBeenCalled();
    expect(p.end).toHaveBeenCalledOnce();
    expect(p.say).toHaveBeenCalledWith(UNDO_NOT_NEWEST);
  });

  it("ends the offer in silence once another tour is open", () => {
    const mine = { revision: () => 4 };
    const p = page({ revision: () => 4 });
    undoTap(mine, 4, p)();
    expect(p.undo).not.toHaveBeenCalled();
    expect(p.end).toHaveBeenCalledOnce();
    expect(p.say).not.toHaveBeenCalled();
  });
});
