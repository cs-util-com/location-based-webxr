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
  SAVE_DEBUG_LABELS,
  doneWords,
  wireDoneDialog,
  type DoneDialogDom,
  type DebugSaveOutcome,
  type DoneFacts,
  type WalkMoveOutcome,
} from "./done-dialog.js";
import { TOUR_HOSTS } from "../tour-host.js";

const IN_PLACE: DoneFacts = {
  saved: { kind: "in-place", name: "castle.zip" },
  host: "drive",
  carriesWalk: true,
  debugLeftOut: false,
  driveMountTip: false,
};

/** A download that left the opened file's walk out (M2 of the
 *  debug-captures plan). */
const LEAN: DoneFacts = {
  ...IN_PLACE,
  saved: { kind: "downloaded", name: "castle (1).zip" },
  carriesWalk: false,
  debugLeftOut: true,
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

  it("says the file carries the walk - the GPS track, the depth and the camera captures - only while it does", () => {
    // (Changed, debug-captures M1: the line named the GPS track and the depth
    // only, but the walk also carries every picture the camera took by
    // itself, which visitors of the file at the link can download too.)
    const walk = doneWords(IN_PLACE).walk;
    expect(walk).toMatch(/castle\.zip/);
    expect(walk).toMatch(/GPS track/);
    expect(walk).toMatch(/depth/);
    expect(walk).toMatch(/camera captures/);
    expect(walk?.toLowerCase()).not.toContain("photo");
    expect(walk).toMatch(/file at your tour's link/);
    // Named as the debug data it is, and moved out as such (M2 of the
    // debug-captures plan: the moved-out file is the debug bundle).
    expect(walk).toMatch(/debug data/);
    expect(walk).toMatch(/Move the debug data out/);
    expect(doneWords({ ...IN_PLACE, carriesWalk: false }).walk).toBeNull();
  });

  it("says a file whose walk could not be checked may carry it, and offers the move", () => {
    // Why (the M4b milestone review #9): a failed check said nothing, as
    // if the file carried no walk; it fails toward the walk.
    const walk = doneWords({ ...IN_PLACE, carriesWalk: "unknown" }).walk;
    expect(walk).toMatch(/could not be checked/);
    expect(walk).toMatch(/GPS track/);
    // (Changed, M2 of the debug-captures plan: "Move the walk out".)
    expect(walk).toMatch(/Move the debug data out/);
  });

  it("names the move's steps as the debug data's", () => {
    // Why (M2 of the debug-captures plan): the moved-out file is the debug
    // bundle, so every label says what the creator gets - the words were
    // the walk's.
    expect(MOVE_LABELS).toEqual({
      idle: "Move the debug data out",
      moving: "Moving the debug data out…",
      confirm: "Take the debug data out of the tour",
      download: "Download the tour without the debug data",
    });
  });

  it("offers to save the debug data apart only when a save left it out of a file that carried it", () => {
    // Why (M2 of the debug-captures plan): a save as a new file
    // leaves the walk out by default, so the copy the creator keeps may be
    // the only one - the opened file still carries the walk, and Done is
    // where the creator is told to keep it apart.
    const words = doneWords(LEAN);
    expect(words.walk).toBeNull();
    expect(words.debugSave).toMatch(
      /castle \(1\)\.zip leaves out your debug data/,
    );
    expect(words.debugSave).toMatch(/GPS track/);
    expect(words.debugSave).toMatch(/camera captures/);
    expect(words.debugSave).toMatch(/file you opened still carries it/);
    expect(words.debugSave).toMatch(/Save the debug data/);
    expect(doneWords({ ...LEAN, debugLeftOut: false }).debugSave).toBeNull();
    // A file that still carries the walk is offered the move, not this.
    expect(doneWords({ ...LEAN, carriesWalk: true }).debugSave).toBeNull();
    expect(doneWords({ ...LEAN, carriesWalk: "unknown" }).debugSave).toBeNull();
    expect(doneWords(IN_PLACE).debugSave).toBeNull();
  });

  it("says to save the debug data BEFORE the copy is put in place", () => {
    // Why (r901 review #1): "Save the debug data" reads the opened file,
    // so a creator who first puts the lean copy in its place (over that
    // file) has nothing left to save it from: the order is the point.
    const line = doneWords(LEAN).debugSave ?? "";
    expect(line).toMatch(
      /Save the debug data before you put this copy in place/,
    );
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

function wire(
  move: () => Promise<WalkMoveOutcome>,
  saveDebug: () => Promise<DebugSaveOutcome> = () =>
    Promise.resolve({ kind: "cancelled" }),
) {
  const dom = {
    backdrop: el(),
    where: el(),
    host: el(),
    update: el(),
    publicLine: el(),
    walk: el(),
    walkText: el(),
    moveButton: el(),
    saveDebugButton: el(),
    moveStatus: el(),
    driveTip: el(),
    close: el(),
  };
  const deps = {
    moveWalk: vi.fn(move),
    saveDebugData: vi.fn(saveDebug),
    onClose: vi.fn(),
  };
  const dialog = wireDoneDialog({
    dom: dom as unknown as DoneDialogDom,
    ...deps,
  });
  return { dom, deps, dialog };
}

describe("wireDoneDialog", () => {
  it("shows the save of the debug data, not the move, after a save that left it out", () => {
    const { dom, dialog } = wire(() => Promise.resolve({ kind: "cancelled" }));
    dialog.open(LEAN);
    expect(dom.walk.hidden).toBe(false);
    expect(dom.walkText.textContent).toBe(doneWords(LEAN).debugSave);
    expect(dom.moveButton.hidden).toBe(true);
    expect(dom.saveDebugButton.hidden).toBe(false);
    expect(dom.saveDebugButton.textContent).toBe(SAVE_DEBUG_LABELS.idle);
    dialog.close();
    // A file that carries the walk: the move, and no save.
    dialog.open(IN_PLACE);
    expect(dom.moveButton.hidden).toBe(false);
    expect(dom.saveDebugButton.hidden).toBe(true);
  });

  it("saves the debug data: in progress while it runs, then says where it went, and offers it again", async () => {
    // Why (the async-UI rule): the save reads the opened file and writes a
    // second zip, which takes a while; the dialog may not close under it.
    let finish!: (outcome: DebugSaveOutcome) => void;
    const { dom, deps, dialog } = wire(
      () => Promise.resolve({ kind: "cancelled" }),
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    dialog.open(LEAN);
    dom.saveDebugButton.fire("click");
    expect(deps.saveDebugData).toHaveBeenCalledTimes(1);
    expect(dom.saveDebugButton.disabled).toBe(true);
    expect(dom.saveDebugButton.textContent).toBe(SAVE_DEBUG_LABELS.saving);
    expect(dom.close.disabled).toBe(true);
    dialog.close();
    expect(dom.backdrop.hidden).toBe(false);
    // A second click while it runs starts nothing.
    dom.saveDebugButton.fire("click");
    expect(deps.saveDebugData).toHaveBeenCalledTimes(1);
    finish({ kind: "saved", name: "castle-debug.zip" });
    await vi.waitFor(() => {
      expect(dom.moveStatus.textContent).toBe(
        "The debug data is in castle-debug.zip - keep that file.",
      );
    });
    expect(dom.saveDebugButton.disabled).toBe(false);
    expect(dom.saveDebugButton.textContent).toBe(SAVE_DEBUG_LABELS.again);
    expect(dom.close.disabled).toBe(false);
    expect(deps.moveWalk).not.toHaveBeenCalled();
  });

  it("says a refusal, a dismissed save and a thrown save, and gives the button back", async () => {
    // Factories: a rejection made before its turn would go unhandled.
    for (const [outcome, said] of [
      [
        () =>
          Promise.resolve<DebugSaveOutcome>({
            kind: "refused",
            reason: "The file you opened can no longer be read.",
          }),
        "The file you opened can no longer be read.",
      ],
      [
        () => Promise.resolve<DebugSaveOutcome>({ kind: "cancelled" }),
        "Nothing was saved: the debug data's file was not saved.",
      ],
      [
        () => Promise.reject<DebugSaveOutcome>(new Error("disk full")),
        "The debug data was not saved: disk full",
      ],
    ] as const) {
      const { dom, dialog } = wire(
        () => Promise.resolve({ kind: "cancelled" }),
        outcome,
      );
      dialog.open(LEAN);
      dom.saveDebugButton.fire("click");
      await vi.waitFor(() => {
        expect(dom.moveStatus.textContent).toBe(said);
      });
      expect(dom.saveDebugButton.disabled).toBe(false);
      expect(dom.saveDebugButton.textContent).toBe(SAVE_DEBUG_LABELS.idle);
      expect(dom.close.disabled).toBe(false);
    }
  });

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
      walkName: "castle-debug.zip",
      tourName: "castle.zip",
      saved: { kind: "in-place", name: "castle.zip" },
    });
    await vi.waitFor(() => {
      expect(dom.moveStatus.textContent).toMatch(/castle-debug\.zip/);
    });
    expect(dom.moveStatus.textContent).toMatch(
      /The debug data is in castle-debug\.zip/,
    );
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

  it("stays open while a move runs: Close is disabled and neither it nor close() shuts it, until the move ends; a forced close does", async () => {
    // Why (the M4b milestone review #1): a dialog closed mid-move let Done
    // start while the move still held the page's save, and the page froze
    // waiting on it. The move's files are being written: nothing of the
    // page may change under it.
    let finish!: (outcome: WalkMoveOutcome) => void;
    const { dom, deps, dialog } = wire(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    dialog.open(IN_PLACE);
    dom.moveButton.fire("click");
    expect(dom.close.disabled).toBe(true);
    dom.close.fire("click");
    dialog.close();
    expect(dialog.isOpen()).toBe(true);
    expect(deps.onClose).not.toHaveBeenCalled();
    finish({ kind: "cancelled" });
    await vi.waitFor(() => {
      expect(dom.close.disabled).toBe(false);
    });
    dialog.close();
    expect(dialog.isOpen()).toBe(false);
    // A tour that is gone closes it, move or not.
    const held = wire(() => new Promise<WalkMoveOutcome>(() => undefined));
    held.dialog.open(IN_PLACE);
    held.dom.moveButton.fire("click");
    held.dialog.close(true);
    expect(held.dialog.isOpen()).toBe(false);
    expect(held.deps.onClose).toHaveBeenCalledTimes(1);
  });

  it("asks for a second click after the walk was downloaded, and that click takes it out - never a second download", async () => {
    // Why (the M4b milestone review #2): without a save dialog the walk's
    // download is only started, never known to have landed; the tour is
    // rewritten without the walk only once the creator says so.
    const confirm = vi.fn(() =>
      Promise.resolve<WalkMoveOutcome>({
        kind: "moved",
        walkName: "castle-debug.zip",
        tourName: "castle.zip",
        saved: { kind: "in-place", name: "castle.zip" },
      }),
    );
    const { dom, deps, dialog } = wire(() =>
      Promise.resolve({
        kind: "downloaded",
        walkName: "castle-debug.zip",
        confirm,
      }),
    );
    dialog.open(IN_PLACE);
    dom.moveButton.fire("click");
    await vi.waitFor(() => {
      expect(dom.moveButton.textContent).toBe(MOVE_LABELS.confirm);
    });
    expect(dom.moveStatus.textContent).toMatch(
      /downloaded as castle-debug\.zip/,
    );
    expect(dom.moveStatus.textContent).toMatch(/the tour file keeps it/);
    expect(dom.moveButton.disabled).toBe(false);
    expect(dom.walkText.hidden).toBe(false);
    dom.moveButton.fire("click");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deps.moveWalk).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(dom.moveStatus.textContent).toMatch(/no longer carries it/);
    });
    // Closed before the second click, the next open starts over.
    const again = wire(() =>
      Promise.resolve({ kind: "downloaded", walkName: "w.zip", confirm }),
    );
    again.dialog.open(IN_PLACE);
    again.dom.moveButton.fire("click");
    await vi.waitFor(() => {
      expect(again.dom.moveButton.textContent).toBe(MOVE_LABELS.confirm);
    });
    again.dialog.close();
    again.dialog.open(IN_PLACE);
    expect(again.dom.moveButton.textContent).toBe(MOVE_LABELS.idle);
    again.dom.moveButton.fire("click");
    expect(again.deps.moveWalk).toHaveBeenCalledTimes(2);
  });

  it("asks for a second click when the walk is saved but the tour must be downloaded, and says the walk is safe", async () => {
    // Why (the M4b fix re-review #2): a tour with no file to write into
    // (a sample, a link, a file input) is downloaded; done after the walk's
    // write, the click's window had passed and the download fell back
    // unseen. The tour's download now waits for a fresh click.
    const confirm = vi.fn(() =>
      Promise.resolve<WalkMoveOutcome>({
        kind: "moved",
        walkName: "castle-debug.zip",
        tourName: "castle.zip",
        saved: { kind: "downloaded", name: "castle.zip" },
      }),
    );
    const { dom, deps, dialog } = wire(() =>
      Promise.resolve({
        kind: "walk-saved",
        walkName: "castle-debug.zip",
        confirm,
      }),
    );
    dialog.open(IN_PLACE);
    dom.moveButton.fire("click");
    await vi.waitFor(() => {
      expect(dom.moveButton.textContent).toBe(MOVE_LABELS.download);
    });
    expect(dom.moveStatus.textContent).toMatch(/castle-debug\.zip/);
    expect(dom.moveStatus.textContent).toMatch(/keep that file/);
    expect(dom.moveStatus.textContent).toMatch(/still carries it/);
    expect(dom.walkText.hidden).toBe(false);
    dom.moveButton.fire("click");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deps.moveWalk).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(dom.moveStatus.textContent).toMatch(/no longer carries it/);
    });
  });

  it("after a move, its first line and steps follow where the changes are now", async () => {
    // Why (the M4b milestone review #10): a tour unchanged before the move
    // is written by it; the dialog said "Nothing was changed" over a file
    // it had just rewritten.
    const { dom, dialog } = wire(() =>
      Promise.resolve({
        kind: "moved",
        walkName: "castle-debug.zip",
        tourName: "castle.zip",
        saved: { kind: "downloaded", name: "castle (1).zip" },
      }),
    );
    dialog.open({
      ...IN_PLACE,
      saved: { kind: "unchanged", name: "castle.zip" },
    });
    expect(dom.where.textContent).toMatch(/Nothing was changed/);
    dom.moveButton.fire("click");
    await vi.waitFor(() => {
      expect(dom.where.textContent).toMatch(/downloaded as castle \(1\)\.zip/);
    });
    expect(dom.update.textContent).toContain("castle (1).zip");
    // The walk's words go; its section stays to say where the walk went.
    expect(dom.walkText.hidden).toBe(true);
    expect(dom.walk.hidden).toBe(false);
    expect(dom.moveStatus.textContent).toMatch(/castle-debug\.zip/);
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
