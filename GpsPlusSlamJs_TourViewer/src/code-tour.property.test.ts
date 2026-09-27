import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normalizeShareUrl } from "gps-plus-slam-app-framework/storage";

import { resolveCodeTour, tourRelation } from "./code-tour.js";

/**
 * Why these properties matter (TourViewer scan-to-open plan §9 #2): the
 * rule the whole scan-to-open flow rests on is that a tour's own printed
 * code is always recognised as that tour - never "another tour", which
 * locks Save - whatever link the tour was hosted at. The unit tests pin
 * the Drive spellings; this pins the rule for any http(s) link.
 */

const PROXY = "/api/drive-proxy";

describe("a tour's own code is always this tour", () => {
  it("for any http(s) link printed into a launch code", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.webUrl({ withQueryParameters: true }),
        async (link) => {
          const text = `https://gps.csutil.com/tour/?qr=${encodeURIComponent(link)}`;
          const code = await resolveCodeTour(text, PROXY);
          expect(code.kind).toBe("tour");
          const openUrl = normalizeShareUrl(link, { corsProxyBaseUrl: PROXY });
          expect(tourRelation(code, openUrl)).toBe("this-tour");
        },
      ),
    );
  });

  it("never throws, whatever the camera reads", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (text) => {
        const code = await resolveCodeTour(text, PROXY);
        expect(["tour", "not-a-tour-code", "unreadable"]).toContain(code.kind);
      }),
    );
  });
});
