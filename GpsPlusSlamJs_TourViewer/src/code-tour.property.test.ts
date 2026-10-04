import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normalizeShareUrl } from "gps-plus-slam-app-framework/storage";
import { planPrintCode } from "gps-plus-slam-app-framework/utils/qr-payload/qr-print-plan";

import { resolveCodeTour, tourRelation } from "./code-tour.js";

/**
 * Why these properties matter (TourViewer scan-to-open plan §9 #2): the
 * rule the whole scan-to-open flow rests on is that a tour's own printed
 * code is always recognised as that tour - never "another tour", which
 * locks Save - whatever link the tour was hosted at. The unit tests pin the
 * Drive, GitHub and Dropbox spellings; this pins the rule for any http(s)
 * link, through the print step's own encoder (`planPrintCode`), which
 * shortens links. The first version encoded the link by hand and so could
 * not see a mismatch the encoder introduces (milestone review #7).
 */

const PROXY = "/api/drive-proxy";

describe("a tour's own code is always this tour", () => {
  it("for any http(s) link, as the print step encodes it", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.webUrl({ withQueryParameters: true }),
        async (link) => {
          let text: string;
          try {
            text = (await planPrintCode(link)).url;
          } catch {
            return; // no printable code fits this link at all
          }
          const code = await resolveCodeTour(text, PROXY);
          expect(code.kind).toBe("tour");
          const openUrl = normalizeShareUrl(link, {
            corsProxyBaseUrl: PROXY,
          });
          expect(tourRelation(code, openUrl)).toBe("this-tour");
        },
      ),
      // Each run encodes a QR size estimate; 60 runs keep the property
      // inside the unit budget on a loaded machine.
      { numRuns: 60 },
    );
  }, 30_000);

  it("never throws, whatever the camera reads", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (text) => {
        const code = await resolveCodeTour(text, PROXY);
        expect(["tour", "not-a-tour-code", "unreadable"]).toContain(code.kind);
      }),
    );
  });
});
