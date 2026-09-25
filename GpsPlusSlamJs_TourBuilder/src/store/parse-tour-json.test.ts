import { describe, expect, it } from "vitest";

import { sampleTour } from "./fixtures/sample-tour.js";
import { TourValidationError } from "./validate-tour.js";
import { parseTourJson } from "./parse-tour-json.js";

/**
 * Why these tests matter: this is the gate between text an author typed,
 * pasted, or uploaded and the `Tour` the rest of the app trusts. It has to
 * turn every way that text can be wrong — broken JSON syntax, or JSON that
 * parses but breaks a tour invariant — into the one error type consumers know
 * how to display, without ever handing back a partial `Tour`.
 */

describe("parseTourJson", () => {
  it("parses valid tour JSON text into a Tour", () => {
    expect(parseTourJson(JSON.stringify(sampleTour))).toEqual(sampleTour);
  });

  it("throws TourValidationError on malformed JSON syntax", () => {
    expect(() => parseTourJson("{ not valid json,,, ")).toThrow(
      TourValidationError,
    );
  });

  it("forwards validateTour's own message when an invariant is violated", () => {
    const broken = { ...sampleTour, assets: "not-an-array" };
    expect(() => parseTourJson(JSON.stringify(broken))).toThrow(
      "assets must be an array",
    );
  });
});
