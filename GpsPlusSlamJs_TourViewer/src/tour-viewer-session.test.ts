/**
 * The TourViewer session helpers.
 *
 * Why these tests matter (QR near-frontal pose plan §61, b4b-1): when an AR
 * session ends while a QR decode or level fetch is in flight, the late lock
 * used to land in the NEXT session - a dead-frame detection in its window,
 * the creator's tracked code set again, status lines the teardown had
 * cleared. Nulling the controller does not stop it; disposing it does.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createTourViewerSession,
  endQrPipeline,
} from "./tour-viewer-session.js";

describe("endQrPipeline", () => {
  it("disposes the QR controller and forgets it", () => {
    const ctx = createTourViewerSession();
    const dispose = vi.fn();
    ctx.qrController = { dispose } as unknown as NonNullable<
      typeof ctx.qrController
    >;
    endQrPipeline(ctx);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(ctx.qrController).toBeNull();
  });

  it("is harmless without a controller", () => {
    const ctx = createTourViewerSession();
    expect(() => endQrPipeline(ctx)).not.toThrow();
    expect(ctx.qrController).toBeNull();
  });
});
