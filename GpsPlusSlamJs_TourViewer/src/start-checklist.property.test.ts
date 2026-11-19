/**
 * Why this test matters: the list must never promise what the page does
 * not know, whatever the inputs. For every combination: the tour line is
 * checked exactly when a tour is open, its link shows exactly when none
 * is, its words say a tour is open exactly when one is, "backed up" is never said while the draft store keeps nothing, and
 * the hung code is never checked.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { startChecklistView } from "./start-checklist.js";

describe("the Before you start list, for any state", () => {
  it("claims only what the page knows", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (tourOpen, backupKept) => {
        const view = startChecklistView({ tourOpen, backupKept });
        const byId = new Map(view.rows.map((r) => [r.id, r]));
        const tour = byId.get("tour");
        const code = byId.get("code");
        const noBackup = byId.get("no-backup");
        expect(tour?.state).toBe(tourOpen ? "done" : "todo");
        expect(tour?.linkShown).toBe(!tourOpen);
        expect(/is open/.test(tour?.text ?? "")).toBe(tourOpen);
        expect(code?.state).toBe("reminder");
        expect(noBackup?.shown).toBe(!backupKept);
        const backupClaims = view.rows.filter(
          (r) => r.shown && /backed up/.test(r.text),
        );
        expect(backupClaims.length).toBe(backupKept ? 1 : 0);
        // Exactly one row may ever carry a check mark.
        expect(view.rows.filter((r) => r.state === "done").length).toBe(
          tourOpen ? 1 : 0,
        );
      }),
    );
  });
});
