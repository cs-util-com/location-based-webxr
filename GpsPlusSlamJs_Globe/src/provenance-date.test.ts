/**
 * Why this test matters: the imagery's provenance file says when its files
 * were fetched, and a hand-run script rewrites it. Its date logic went wrong
 * twice without a test (review of stream F, 2026-09-27): a capture that took
 * the sentence's full stop along ("2026-09-26.."), and under `--force` an
 * old "files added" date surviving next to a new first-fetch date, as if
 * files had been added before the fetch. Each path (a first run, a re-run
 * that adds nothing, one that adds files, `--force`) is pinned here.
 */

import { describe, expect, it } from "vitest";

import { provenanceFetchedOn } from "./provenance-date.js";

const sentence = (dates: string) =>
  `Written by the script. Fetched: ${dates}. All sources are NASA.`;

describe("provenanceFetchedOn", () => {
  it("is today on a first run", () => {
    expect(
      provenanceFetchedOn({
        previous: "",
        today: "2026-09-27",
        force: false,
        fetched: 685,
      }),
    ).toBe("2026-09-27");
  });

  it("keeps the recorded dates when a run adds nothing, without the full stop", () => {
    expect(
      provenanceFetchedOn({
        previous: sentence("2026-09-26"),
        today: "2026-09-28",
        force: false,
        fetched: 0,
      }),
    ).toBe("2026-09-26");
    expect(
      provenanceFetchedOn({
        previous: sentence("2026-09-26; files added: 2026-09-27"),
        today: "2026-09-28",
        force: false,
        fetched: 0,
      }),
    ).toBe("2026-09-26; files added: 2026-09-27");
  });

  it("records a later run that adds files beside the first fetch", () => {
    expect(
      provenanceFetchedOn({
        previous: sentence("2026-09-26"),
        today: "2026-09-27",
        force: false,
        fetched: 512,
      }),
    ).toBe("2026-09-26; files added: 2026-09-27");
    // Added again later: the newest addition is the one recorded.
    expect(
      provenanceFetchedOn({
        previous: sentence("2026-09-26; files added: 2026-09-27"),
        today: "2026-10-01",
        force: false,
        fetched: 3,
      }),
    ).toBe("2026-09-26; files added: 2026-10-01");
    // Added on the day of the first fetch: that day alone.
    expect(
      provenanceFetchedOn({
        previous: sentence("2026-09-27"),
        today: "2026-09-27",
        force: false,
        fetched: 12,
      }),
    ).toBe("2026-09-27");
  });

  it("is today alone under --force: every file was fetched again", () => {
    expect(
      provenanceFetchedOn({
        previous: sentence("2026-09-26; files added: 2026-09-27"),
        today: "2026-10-01",
        force: true,
        fetched: 685,
      }),
    ).toBe("2026-10-01");
  });

  it("falls back to today when the previous file carries no date", () => {
    expect(
      provenanceFetchedOn({
        previous: "an old file with no date",
        today: "2026-09-27",
        force: false,
        fetched: 0,
      }),
    ).toBe("2026-09-27");
  });
});
