/**
 * Why these tests matter: the tour's details form is checked by one rule
 * set that both pages and the shared tour document use (D30, the parity
 * contract): the name by the framework's `checkTourTitle` (80 characters
 * counted as a reader counts them), the description and the contact by
 * the format's own checks, the cover only while it names one of the
 * tour's images. A refusal is plain words, never the format's field names;
 * a name kept as the tour carries it passes whatever its length (a tour
 * named elsewhere must not become unsaveable).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TOUR_TITLE_MAX_CHARS } from "gps-plus-slam-app-framework/ar/tour-details";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  checkDetailsForm,
  DETAIL_FIELDS,
  detailsOf,
  withDetails,
  type DetailsForm,
  type TourDetailFields,
} from "./tour-details-form.js";
import { tourOf } from "./test-support/v3-tour.js";

const form = (over: Partial<DetailsForm> = {}): DetailsForm => ({
  name: "",
  description: "",
  cover: null,
  contact: "",
  ...over,
});

const COVERS = new Set(["f"]);

describe("detailsOf / withDetails", () => {
  it("reads the four fields a manifest carries, and writes them back, an absent one removed", () => {
    const manifest = tourOf([], {
      title: "Old town",
      description: "A walk.",
      contact: "guide@example.org",
    });
    expect(detailsOf(manifest)).toEqual({
      title: "Old town",
      description: "A walk.",
      contact: "guide@example.org",
    });
    const next = withDetails(manifest, { title: "New" });
    expect(next.title).toBe("New");
    expect(next).not.toHaveProperty("description");
    expect(next).not.toHaveProperty("contact");
    // The input is left as it was.
    expect(manifest.description).toBe("A walk.");
  });

  it("names the four fields in the order the offer names them", () => {
    expect(DETAIL_FIELDS).toEqual(["title", "description", "cover", "contact"]);
  });
});

describe("checkDetailsForm", () => {
  it("keeps each field trimmed; an empty one is none", () => {
    expect(
      checkDetailsForm(
        form({
          name: "  The castle ",
          description: " Up and back. ",
          cover: "f",
          contact: " guide@example.org ",
        }),
        COVERS,
        {},
      ),
    ).toEqual({
      ok: true,
      details: {
        title: "The castle",
        description: "Up and back.",
        cover: "f",
        contact: "guide@example.org",
      },
    });
    expect(checkDetailsForm(form(), COVERS, { title: "Old" })).toEqual({
      ok: true,
      details: {},
    });
  });

  it("counts the name as a reader counts it: 80 emoji are 80 characters", () => {
    const name = "🙂".repeat(TOUR_TITLE_MAX_CHARS);
    expect(checkDetailsForm(form({ name }), COVERS, {})).toEqual({
      ok: true,
      details: { title: name },
    });
    expect(checkDetailsForm(form({ name: `${name}🙂` }), COVERS, {})).toEqual({
      ok: false,
      reason: "The name is longer than 80 characters.",
    });
  });

  it("keeps a long name the tour already carries, as it is", () => {
    const long = "x".repeat(TOUR_TITLE_MAX_CHARS + 10);
    expect(
      checkDetailsForm(form({ name: long }), COVERS, { title: long }),
    ).toEqual({ ok: true, details: { title: long } });
  });

  it("refuses what the format would drop, in plain words", () => {
    const refusals: [Partial<DetailsForm>, string][] = [
      [
        { contact: "call me" },
        "The contact must be an e-mail address or a web link starting with http:// or https://.",
      ],
      [
        { contact: `${"x".repeat(320)}@example.org` },
        "The contact is longer than 320 characters.",
      ],
      [
        { description: "x".repeat(2001) },
        "The description is longer than 2000 characters.",
      ],
      [
        { cover: "gone" },
        "That cover is not one of this tour's photos any more.",
      ],
    ];
    for (const [over, reason] of refusals) {
      expect(checkDetailsForm(form(over), COVERS, {})).toEqual({
        ok: false,
        reason,
      });
    }
  });

  it("drops a cover naming no image when asked to (a draft's record), keeping the rest", () => {
    expect(
      checkDetailsForm(form({ name: "N", cover: "gone" }), COVERS, {}, "drop"),
    ).toEqual({ ok: true, details: { title: "N" } });
  });
});

describe("tour details form (properties)", () => {
  const text = fc.option(fc.string({ maxLength: 30 }), { nil: undefined });
  const details = fc.record(
    { title: text, description: text, contact: text, cover: text },
    { requiredKeys: [] },
  );

  it("withDetails then detailsOf gives back the details written", () => {
    fc.assert(
      fc.property(details, (raw) => {
        const wanted: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (v !== undefined) wanted[k] = v;
        }
        const manifest: TourManifest = tourOf([], { title: "Was" });
        expect(detailsOf(withDetails(manifest, wanted))).toEqual(wanted);
      }),
      { numRuns: 200 },
    );
  });

  it("a form built from accepted details is accepted again unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 100 }),
        fc.string({ maxLength: 50 }),
        (name, description) => {
          const first = checkDetailsForm(
            form({ name, description }),
            COVERS,
            {},
          );
          if (!first.ok) return;
          const kept: TourDetailFields = first.details;
          const again = checkDetailsForm(
            form({
              name: kept.title ?? "",
              description: kept.description ?? "",
            }),
            COVERS,
            kept,
          );
          expect(again).toEqual(first);
        },
      ),
      { numRuns: 300 },
    );
  });
});
