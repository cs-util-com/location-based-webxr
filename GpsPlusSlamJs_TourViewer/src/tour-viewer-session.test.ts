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
import { createQrVoteBudget } from "gps-plus-slam-app-framework/ar/qr/qr-vote-budget";
import {
  createTourViewerSession,
  endQrPipeline,
  endTourCodeVotes,
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

  // Plan §61 #9: the fused source is per session - a kept one would carry
  // the motion detector's confirmed flags into the next session.
  it("forgets the session's fused pose source", () => {
    const ctx = createTourViewerSession();
    ctx.fusedPose = {} as NonNullable<typeof ctx.fusedPose>;
    endQrPipeline(ctx);
    expect(ctx.fusedPose).toBeNull();
  });

  it("is harmless without a controller", () => {
    const ctx = createTourViewerSession();
    expect(() => endQrPipeline(ctx)).not.toThrow();
    expect(ctx.qrController).toBeNull();
  });

  // Authoring plan M2b: the keep-alive and the vote budget are per AR
  // entry; the next entry's pipeline makes its own.
  it("stops the keep-alive and forgets it and the vote budget", () => {
    const ctx = createTourViewerSession();
    const stop = vi.fn();
    ctx.viewerKeepAlive = { stop } as never;
    ctx.viewerVoteBudget = createQrVoteBudget();
    endQrPipeline(ctx);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(ctx.viewerKeepAlive).toBeNull();
    expect(ctx.viewerVoteBudget).toBeNull();
  });
});

// Why (M2b review #6): the pipeline outlives a tour switch, so the switch
// must end the closing tour's votes itself - a reopened tour found its code
// already "voted" and passed its gate without a vote.
describe("endTourCodeVotes", () => {
  it("stops the hold and starts every code's budget again, keeping both objects", () => {
    const ctx = createTourViewerSession();
    const stop = vi.fn();
    const keepAlive = { stop } as never;
    ctx.viewerKeepAlive = keepAlive;
    const budget = createQrVoteBudget(1);
    budget.tryConsume("code");
    ctx.viewerVoteBudget = budget;
    endTourCodeVotes(ctx);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(budget.isSpent("code")).toBe(false);
    expect(ctx.viewerKeepAlive).toBe(keepAlive);
    expect(ctx.viewerVoteBudget).toBe(budget);
  });

  it("is harmless outside an AR entry", () => {
    expect(() => endTourCodeVotes(createTourViewerSession())).not.toThrow();
  });
});
