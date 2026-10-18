/**
 * Why these tests matter (tour editor plan 2026-10-17-1816, W2, D18, D19):
 * "Done" is where a creator leaves the editor, and the only place that
 * tells them what is left to do: where the changes are, how the tour at
 * its link is updated (per host), that a file at a link is public at once,
 * and - when the file still carries the walk - that the walk goes public
 * with it unless it is moved out. These pin the words for each case, that
 * the Drive-mount tip stays off until the owner's check (review #10) while
 * its switch still works, and the move's states for the async-UI rule:
 * in progress, then moved, refused or cancelled, the button back to idle
 * on every path but success.
 */
import { describe, expect, it, vi } from "vitest";

import {
  DRIVE_MOUNT_TIP_SHOWN,
  MOVE_LABELS,
  doneWords,
  wireDoneDialog,
  type DoneDialogDom,
  type DoneFacts,
  type WalkMoveOutcome,
} from "./done-dialog.js";
import { TOUR_HOSTS } from "../tour-host.js";

const IN_PLACE: DoneFacts = {
  saved: { kind: "in-place", name: "castle.zip" },
  host: "drive",
  carriesWalk: true,
  driveMountTip: false,
};

describe("doneWords", () => {
  it("says the changes are in the opened file when it was written in place", () => {
    expect(doneWords(IN_PLACE).where).toBe(
      "Your changes are saved in castle.zip, the file you opened on this computer.",
    );
  });

  it("says a download is the tour now, and the opened file does not have the changes", () => {
    const words = doneWords({
      ...IN_PLACE,
      saved: { kind: "downloaded", name: "castle.zip" },
    });
    expect(words.where).toMatch(/downloaded as castle\.zip/);
    expect(words.where).toMatch(/file you opened does not have them/);
  });

  it("says nothing changed when nothing was saved", () => {
    expect(
      doneWords({
        ...IN_PLACE,
        saved: { kind: "unchanged", name: "castle.zip" },
      }).where,
    ).toBe("Nothing was changed since you opened castle.zip.");
  });

  it("gives every host its own way to update the tour at its link, naming the file", () => {
    for (const { id, label } of TOUR_HOSTS) {
      const update = doneWords({ ...IN_PLACE, host: id }).update;
      expect(update).toContain("castle.zip");
      expect(update).toMatch(/same/);
      // An own server has no name to say.
      expect(id === "own" || update.includes(label)).toBe(true);
    }
    expect(doneWords(IN_PLACE).update).toMatch(/Replace existing file/);
  });

  it("always says a file at a link is public at once", () => {
    expect(doneWords(IN_PLACE).publicLine).toMatch(/public/);
    expect(doneWords(IN_PLACE).publicLine).toMatch(/as soon as/);
  });

  it("says the file carries the walk - the GPS track and the depth - only while it does", () => {
    const walk = doneWords(IN_PLACE).walk;
    expect(walk).toMatch(/castle\.zip/);
    expect(walk).toMatch(/GPS track/);
    expect(walk).toMatch(/depth/);
    expect(walk).toMatch(/file at your tour's link/);
    expect(doneWords({ ...IN_PLACE, carriesWalk: false }).walk).toBeNull();
  });

  it("keeps the Drive-mount tip hidden by default, and the switch shows it for a Drive tour saved in place only", () => {
    // Review #10: the tip waits for the owner's check that a write through
    // the mount keeps the Drive file id. The switch is off in the module.
    expect(DRIVE_MOUNT_TIP_SHOWN).toBe(false);
    expect(doneWords(IN_PLACE).driveTip).toBeNull();
    const on = { ...IN_PLACE, driveMountTip: true };
    expect(doneWords(on).driveTip).toMatch(/Google Drive for desktop/);
    expect(doneWords({ ...on, host: "dropbox" }).driveTip).toBeNull();
    expect(
      doneWords({ ...on, saved: { kind: "downloaded", name: "castle.zip" } })
        .driveTip,
    ).toBeNull();
  });
});

function el() {
  const handlers = new Map<string, () => void>();
  return {
    value: "",
    hidden: true,
    disabled: false,
    textContent: "" as string | null,
    focused: 0,
    focus() {
      this.focused += 1;
    },
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    fire: (type: string) => handlers.get(type)?.(),
  };
}

function wire(move: () => Promise<WalkMoveOutcome>) {
  const dom = {
    backdrop: el(),
    where: el(),
    host: el(),
    update: el(),
    publicLine: el(),
    walk: el(),
    walkText: el(),
    moveButton: el(),
    moveStatus: el(),
    driveTip: el(),
    close: el(),
  };
  const deps = { moveWalk: vi.fn(move), onClose: vi.fn() };
  const dialog = wireDoneDialog({
    dom: dom as unknown as DoneDialogDom,
    ...deps,
  });
  return { dom, deps, dialog };
}

describe("wireDoneDialog", () => {
  it("opens with the facts' words, the host chosen, and the walk section only while the file carries it", () => {
    const { dom, dialog } = wire(() => Promise.resolve({ kind: "cancelled" }));
    dialog.open(IN_PLACE);
    expect(dom.backdrop.hidden).toBe(false);
    expect(dom.where.textContent).toBe(doneWords(IN_PLACE).where);
    expect(dom.host.value).toBe("drive");
    expect(dom.update.textContent).toBe(doneWords(IN_PLACE).update);
    expect(dom.walk.hidden).toBe(false);
    expect(dom.moveButton.textContent).toBe(MOVE_LABELS.idle);
    expect(dom.driveTip.hidden).toBe(true);
    expect(dom.close.focused).toBe(1);
    dialog.close();
    dialog.open({ ...IN_PLACE, carriesWalk: false });
    expect(dom.walk.hidden).toBe(true);
  });

  it("follows the host picked in the dialog", () => {
    const { dom, dialog } = wire(() => Promise.resolve({ kind: "cancelled" }));
    dialog.open(IN_PLACE);
    dom.host.value = "github";
    dom.host.fire("change");
    expect(dom.update.textContent).toBe(
      doneWords({ ...IN_PLACE, host: "github" }).update,
    );
  });

  it("moves the walk: in progress while it runs, then says where it went and offers no second move", async () => {
    let finish!: (outcome: WalkMoveOutcome) => void;
    const { dom, deps, dialog } = wire(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    dialog.open(IN_PLACE);
    dom.moveButton.fire("click");
    expect(deps.moveWalk).toHaveBeenCalledTimes(1);
    expect(dom.moveButton.disabled).toBe(true);
    expect(dom.moveButton.textContent).toBe(MOVE_LABELS.moving);
    // A second click while it runs starts nothing.
    dom.moveButton.fire("click");
    expect(deps.moveWalk).toHaveBeenCalledTimes(1);
    finish({
      kind: "moved",
      walkName: "castle-walk.zip",
      tourName: "castle.zip",
    });
    await vi.waitFor(() => {
      expect(dom.moveStatus.textContent).toMatch(/castle-walk\.zip/);
    });
    expect(dom.moveStatus.textContent).toMatch(
      /castle\.zip no longer carries it/,
    );
    expect(dom.moveButton.hidden).toBe(true);
    expect(dom.walkText.hidden).toBe(true);
  });

  it("says a refusal's reason and gives the button back", async () => {
    const { dom, dialog } = wire(() =>
      Promise.resolve({ kind: "refused", reason: "The photos need it." }),
    );
    dialog.open(IN_PLACE);
    dom.moveButton.fire("click");
    await vi.waitFor(() => {
      expect(dom.moveStatus.textContent).toBe("The photos need it.");
    });
    expect(dom.moveButton.disabled).toBe(false);
    expect(dom.moveButton.textContent).toBe(MOVE_LABELS.idle);
    expect(dom.moveButton.hidden).toBe(false);
  });

  it("says nothing moved when the walk's file was not saved, and a thrown move is said too", async () => {
    const cancelled = wire(() => Promise.resolve({ kind: "cancelled" }));
    cancelled.dialog.open(IN_PLACE);
    cancelled.dom.moveButton.fire("click");
    await vi.waitFor(() => {
      expect(cancelled.dom.moveStatus.textContent).toMatch(/Nothing was moved/);
    });
    expect(cancelled.dom.moveButton.disabled).toBe(false);
    const thrown = wire(() => Promise.reject(new Error("disk full")));
    thrown.dialog.open(IN_PLACE);
    thrown.dom.moveButton.fire("click");
    await vi.waitFor(() => {
      expect(thrown.dom.moveStatus.textContent).toMatch(/disk full/);
    });
    expect(thrown.dom.moveButton.disabled).toBe(false);
    expect(thrown.dom.moveButton.textContent).toBe(MOVE_LABELS.idle);
  });

  it("closes from its button and tells the page; an open clears the last move's line", () => {
    const { dom, deps, dialog } = wire(() =>
      Promise.resolve({ kind: "cancelled" }),
    );
    dialog.open(IN_PLACE);
    dom.moveStatus.textContent = "old";
    dom.close.fire("click");
    expect(dom.backdrop.hidden).toBe(true);
    expect(deps.onClose).toHaveBeenCalledTimes(1);
    expect(dialog.isOpen()).toBe(false);
    dialog.open(IN_PLACE);
    expect(dom.moveStatus.textContent).toBe("");
  });
});
