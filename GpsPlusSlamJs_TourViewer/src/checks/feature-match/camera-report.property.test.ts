import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  cameraReport,
  cameraReportText,
  knownCameraReport,
} from "./camera-report";

const field = fc.oneof(
  fc.double(),
  fc.string({ maxLength: 6 }),
  fc.constant(null),
  fc.array(fc.oneof(fc.string({ maxLength: 4 }), fc.integer()), {
    maxLength: 3,
  }),
  fc.record({ min: fc.double(), max: fc.double(), step: fc.anything() }),
);
const keys = fc.constantFrom(
  "focusDistance",
  "zoom",
  "focusMode",
  "width",
  "height",
  "frameRate",
  "deviceId",
);
const reported = fc.dictionary(keys, field);
const method = fc.oneof(
  reported.map((r) => () => r),
  fc.constant(() => {
    throw new Error("no");
  }),
  fc.anything(),
);

// Why this test matters: whatever a browser's track reports (or throws),
// the photo must still be taken, and what is stored must read back as a
// report: so reading never throws and always passes the stored check.
describe("cameraReport, properties", () => {
  it("never throws and always gives a report the plan accepts", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({ getSettings: method, getCapabilities: method }),
          fc.anything(),
        ),
        (track) => {
          const r = cameraReport(track);
          expect(knownCameraReport(r) ?? {}).toEqual(r);
          expect(r).not.toHaveProperty("deviceId");
          expect(typeof cameraReportText(r)).toBe("string");
        },
      ),
    );
  });
});
