/**
 * Tests for the recorder's sweep journal.
 *
 * Why this file matters: iOS kills a background or memory-hungry tab and
 * reloads it when the tester comes back. With `perfAuto=1` the reloaded
 * page started the whole sweep again and the runs measured so far were
 * gone. The journal keeps the export after every run, so a reload can
 * offer what was measured instead of starting over; storage that is
 * missing, full or refusing must never break the sweep.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { createSweepJournal, previousSweepText } from "./globe-perf-journal.js";

/** A Storage-like map; `full` makes every write throw. */
function fakeStorage() {
  const data = new Map();
  return {
    full: false,
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) {
      if (this.full) throw new DOMException("quota", "QuotaExceededError");
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
  };
}

describe("createSweepJournal", () => {
  it("keeps the latest export with its progress, and reads it back", () => {
    const storage = fakeStorage();
    const journal = createSweepJournal({ storage: () => storage });
    assert.equal(journal.load(), null);
    assert.equal(
      journal.save({ text: "{1}", runs: 1, total: 60, state: "running" }),
      true,
    );
    journal.save({ text: "{2}", runs: 2, total: 60, state: "running" });
    const entry = journal.load();
    assert.equal(entry.text, "{2}");
    assert.equal(entry.runs, 2);
    assert.equal(entry.total, 60);
    assert.equal(entry.state, "running");
    assert.equal(typeof entry.savedAt, "number");
  });
  // WHY: a reload after Done restarted an auto-starting sweep and wiped
  // the finished result before it was copied: a finished sweep must block
  // the auto-start as a cut-off one does. The journal is tied to the link,
  // so a sweep kept from other settings is offered but never stops a new
  // link from starting.
  it("offers any kept sweep, and says whether it came from this link", () => {
    const storage = fakeStorage();
    const journal = createSweepJournal({ storage: () => storage });
    assert.equal(journal.previous("#perf=1"), null);
    journal.save({
      text: "{}",
      runs: 3,
      total: 60,
      state: "running",
      link: "#perf=1&perfItems=0,5",
    });
    assert.deepEqual(
      { ...journal.previous("#perf=1&perfItems=0,5"), savedAt: 0 },
      {
        text: "{}",
        runs: 3,
        total: 60,
        state: "running",
        link: "#perf=1&perfItems=0,5",
        savedAt: 0,
        sameLink: true,
      },
    );
    journal.save({
      text: "{}",
      runs: 60,
      total: 60,
      state: "done",
      link: "#perf=1&perfItems=0,5",
    });
    assert.equal(journal.previous("#perf=1&perfItems=0,5").state, "done");
    assert.equal(journal.previous("#perf=1&perfItems=0,5").sameLink, true);
    assert.equal(journal.previous("#perf=1&perfItems=0,20").sameLink, false);
    // An entry kept before the link was stored matches no link.
    storage.setItem(
      "globe-perf-sweep",
      JSON.stringify({ text: "{}", runs: 1, total: 2, state: "running" }),
    );
    assert.equal(journal.previous("").sameLink, false);
    journal.clear();
    assert.equal(journal.load(), null);
  });
  it("never throws: a full, missing or refusing storage, or a broken entry", () => {
    const storage = fakeStorage();
    storage.full = true;
    const journal = createSweepJournal({ storage: () => storage });
    assert.equal(
      journal.save({ text: "{}", runs: 1, total: 2, state: "running" }),
      false,
    );
    assert.equal(journal.report().failedSaves, 1);
    assert.match(journal.report().lastError, /QuotaExceededError/);
    const refusing = createSweepJournal({
      storage: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    assert.equal(
      refusing.save({ text: "{}", runs: 1, total: 2, state: "running" }),
      false,
    );
    assert.equal(refusing.load(), null);
    refusing.clear();
    const missing = createSweepJournal({ storage: () => undefined });
    assert.equal(missing.load(), null);
    storage.full = false;
    storage.setItem("globe-perf-sweep", "{not json");
    assert.equal(journal.load(), null);
    storage.setItem("globe-perf-sweep", JSON.stringify({ text: 5 }));
    assert.equal(journal.load(), null);
  });
});

describe("previousSweepText", () => {
  const entry = (state, sameLink) => ({
    text: "{}",
    runs: 7,
    total: 80,
    state,
    sameLink,
  });
  // WHY: the tester reads this line once, on a phone, and decides whether
  // the result is safe; a finished sweep must not read as cut off, and one
  // from other settings must not read as this link's.
  it("names how the kept sweep ended, and whether it is this link's", () => {
    assert.equal(
      previousSweepText(entry("running", true)),
      "Previous sweep cut off after 7 of 80 runs (page reloaded). Copy or Download it, or start fresh.",
    );
    assert.equal(
      previousSweepText(entry("done", true)),
      "Previous sweep finished: 7 of 80 runs. Copy or Download it, or start fresh.",
    );
    assert.equal(
      previousSweepText(entry("stopped", true)),
      "Previous sweep stopped after 7 of 80 runs. Copy or Download it, or start fresh.",
    );
    assert.equal(
      previousSweepText(entry("failed", true)),
      "Previous sweep failed after 7 of 80 runs. Copy or Download it, or start fresh.",
    );
    assert.equal(
      previousSweepText(entry("done", false)),
      "An earlier sweep with other settings is kept (finished, 7 of 80 runs). Copy or Download it; a new sweep replaces it.",
    );
    assert.equal(
      previousSweepText(entry("running", false)),
      "An earlier sweep with other settings is kept (cut off, 7 of 80 runs). Copy or Download it; a new sweep replaces it.",
    );
  });
});
