import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  COLOUR_SCHEME_NAMES,
  colourSchemeBuildFailure,
  failedColourSchemeOf,
  isColourSchemeName,
  resolveColourScheme,
} from "./colour-schemes.js";

describe("colour schemes, properties", () => {
  it("resolves any link value to a name in the table", () => {
    // Why this test matters: whatever a link carries, the worker must be
    // asked for a scheme it has.
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), (raw) => {
        const name = resolveColourScheme(raw, () => {});
        expect(COLOUR_SCHEME_NAMES).toContain(name);
        expect(isColourSchemeName(name)).toBe(true);
      }),
    );
  });

  it("reads back the scheme of any build-failure message, whatever the cause", () => {
    // Why this test matters: the cause is an arbitrary error text and may
    // itself contain quotes or the phrase; the name must still come back.
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== "" && !s.includes('"')),
        fc.string(),
        (scheme, cause) => {
          expect(
            failedColourSchemeOf(colourSchemeBuildFailure(scheme, cause)),
          ).toBe(scheme);
        },
      ),
    );
  });
});
