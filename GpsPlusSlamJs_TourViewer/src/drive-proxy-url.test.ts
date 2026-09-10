/**
 * Why these tests matter (second testing session, F3). The bug they pin was
 * invisible to every gate: local dev worked, production worked, and only a
 * BRANCH PREVIEW - the thing the owner actually tests on - failed, with a
 * message ("The host refused the browser access") that points at the file
 * host rather than at us. The regression would return the moment someone
 * "simplifies" this back to one constant, so the preview case is asserted
 * by name.
 */
import { describe, expect, it } from "vitest";
import {
  driveProxyBaseUrl,
  PRODUCTION_DRIVE_PROXY_URL,
  RELATIVE_DRIVE_PROXY_PATH,
} from "./drive-proxy-url.js";

describe("driveProxyBaseUrl", () => {
  it("uses the page's own worker on a branch preview - the case that was broken", () => {
    // The exact shape of the deploy the owner tested on: a per-branch
    // Worker serving the whole site, its own /api included. Calling
    // production from here is cross-origin and is refused.
    expect(driveProxyBaseUrl("r663-gps-plus-slam.csutil.workers.dev")).toBe(
      RELATIVE_DRIVE_PROXY_PATH,
    );
    expect(driveProxyBaseUrl("a1b2c3d4-gps-plus-slam.csutil.workers.dev")).toBe(
      RELATIVE_DRIVE_PROXY_PATH,
    );
  });

  it("uses the page's own worker in production too", () => {
    // Same-origin either way; a relative path is simply the honest spelling
    // of what production was already doing.
    expect(driveProxyBaseUrl("gps.csutil.com")).toBe(RELATIVE_DRIVE_PROXY_PATH);
  });

  it("falls back to production on a dev host, which has no /api of its own", () => {
    // vite serves the app; there is no worker behind it, so a relative path
    // would 404. These hostnames are exactly the ones the worker's CORS
    // allowlist admits.
    for (const host of [
      "localhost",
      "127.0.0.1",
      "192.168.1.42",
      "10.0.0.7",
      "abc-123.ngrok-free.app",
    ]) {
      expect(driveProxyBaseUrl(host), host).toBe(PRODUCTION_DRIVE_PROXY_URL);
    }
  });

  it("does not treat a lookalike host as a dev host", () => {
    // Why this matters: a too-eager dev match would send a real deployment
    // cross-origin to production and reproduce the original bug. The
    // sub-domain and suffix tricks are the same ones the worker's own
    // allowlist test guards against.
    for (const host of [
      "localhost.evil.example",
      "192.168.1.42.evil.example",
      "abc.ngrok-free.app.evil.example",
      "notlocalhost",
      "ngrok-free.app",
    ]) {
      expect(driveProxyBaseUrl(host), host).toBe(RELATIVE_DRIVE_PROXY_PATH);
    }
  });
});
