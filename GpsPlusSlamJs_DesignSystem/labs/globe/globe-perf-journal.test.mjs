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

import { createSweepJournal } from "./globe-perf-journal.js";

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
  it("offers only a sweep that did not finish", () => {
    const storage = fakeStorage();
    const journal = createSweepJournal({ storage: () => storage });
    journal.save({ text: "{}", runs: 3, total: 60, state: "running" });
    assert.equal(journal.unfinished().runs, 3);
    journal.save({ text: "{}", runs: 3, total: 60, state: "stopped" });
    assert.equal(journal.unfinished().state, "stopped");
    journal.save({ text: "{}", runs: 60, total: 60, state: "done" });
    assert.equal(journal.unfinished(), null);
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
