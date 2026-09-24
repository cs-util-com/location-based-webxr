import { describe, expect, it } from "vitest";
import {
  parseAbsoluteTime,
  sliderToInstant,
  splitUtcInstant,
} from "./time-controls";

describe("absolute ISO input", () => {
  it.each([
    "2026-06-21T12:34:56.789Z",
    "2026-06-21T14:34:56.789+02:00",
    "2026-06-21T08:34:56.789-04:00",
  ])("preserves the instant and milliseconds from %s", (value) => {
    expect(parseAbsoluteTime(value)?.toISOString()).toBe(
      "2026-06-21T12:34:56.789Z",
    );
  });
  it.each([
    "",
    "2026-06-21T12:00",
    "2026-06-21",
    "not a date",
    "2026-02-30T12:00:00Z",
    "2025-02-29T12:00Z",
    "2026-13-01T12:00Z",
    "2026-06-21T24:00:00Z",
    "2026-06-21T12:60:00Z",
    "2026-06-21T12:00:60Z",
    "2026-06-21T12:00+25:00",
    "2026-06-21T12:00+01:60",
  ])("rejects invalid or ambiguous input %s", (value) => {
    expect(parseAbsoluteTime(value)).toBeNull();
  });
  it("accepts leap days and optional seconds without normalizing invalid days", () => {
    expect(parseAbsoluteTime(" 2028-02-29T12:00Z ")?.toISOString()).toBe(
      "2028-02-29T12:00:00.000Z",
    );
  });
  it("distinguishes repeated local times with explicit daylight-saving offsets", () => {
    const earlier = parseAbsoluteTime("2026-10-25T02:30+02:00")!;
    const later = parseAbsoluteTime("2026-10-25T02:30+01:00")!;
    expect(later.getTime() - earlier.getTime()).toBe(3_600_000);
  });
});

describe("UTC day slider", () => {
  it.each([
    { minute: 0, clock: "00:00" },
    { minute: 720, clock: "12:00" },
    { minute: 1439, clock: "23:59" },
  ])("maps minute $minute on the selected UTC day", ({ minute, clock }) => {
    expect(sliderToInstant("2026-10-25", minute)?.toISOString()).toBe(
      `2026-10-25T${clock}:00.000Z`,
    );
  });
  it.each([-1, 1440, 1.5, NaN, Infinity])(
    "rejects invalid minute %s",
    (minute) => {
      expect(sliderToInstant("2026-06-21", minute)).toBeNull();
    },
  );
  it.each(["", "2026-02-30", "2026-6-1"])("rejects invalid day %s", (day) => {
    expect(sliderToInstant(day, 720)).toBeNull();
  });
  it("selects the UTC day after an offset crosses midnight", () => {
    expect(
      splitUtcInstant(parseAbsoluteTime("2026-06-22T00:30+02:00")!),
    ).toEqual({ day: "2026-06-21", minute: 1350 });
  });
});
