import { describe, expect, it } from "vitest";
import { routeRequest, type SiteWorkerEnv } from "./site-worker";

/**
 * Why these tests matter (drive-proxy plan Rev 2, review finding 1): adding
 * a `main` script makes the worker the fallback for EVERY request that
 * matches no static asset — not just the /api/ route. The asset-delegation
 * tests are the proof that the site's serving behaviour (including its 404
 * surface) stays byte-identical to the assets-only deployment; without
 * them, a dispatcher bug turns every dead link on the site into a proxy
 * error.
 */

function envSpy(assetResponse: Response): {
  env: SiteWorkerEnv;
  assetCalls: Request[];
} {
  const assetCalls: Request[] = [];
  return {
    assetCalls,
    env: {
      ASSETS: {
        fetch: (request: Request) => {
          assetCalls.push(request);
          return Promise.resolve(assetResponse);
        },
      },
    },
  };
}

describe("routeRequest", () => {
  it("delegates every non-/api path to the assets, request untouched", async () => {
    for (const path of [
      "/",
      "/tour/",
      "/tour/deep/typo",
      "/recorder/does-not-exist",
      "/favicon.ico",
    ]) {
      const marker = new Response(`asset:${path}`);
      const { env, assetCalls } = envSpy(marker);
      const request = new Request(`https://gps.csutil.com${path}`);
      const response = await routeRequest(request, env);
      expect(assetCalls.length, path).toBe(1);
      expect(assetCalls[0], path).toBe(request); // the SAME request object
      expect(response, path).toBe(marker); // the SAME response, unwrapped
    }
  });

  it("routes /api/drive-proxy to the proxy handler, not the assets", async () => {
    const { env, assetCalls } = envSpy(new Response("asset"));
    // A missing id → the proxy's own 400, proving the proxy answered.
    const response = await routeRequest(
      new Request("https://gps.csutil.com/api/drive-proxy"),
      env,
    );
    expect(response.status).toBe(400);
    expect(assetCalls.length).toBe(0);
  });

  it("answers unknown /api/* routes with a JSON 404, never the asset 404 page", async () => {
    // An unknown API route reaching the assets would return the site's
    // HTML 404 with a 200-ish asset pipeline — a JSON 404 keeps API
    // consumers debuggable and reserves the /api/ prefix for real routes
    // (the /S/ QR rewrite will join this dispatcher later).
    const { env, assetCalls } = envSpy(new Response("asset"));
    const response = await routeRequest(
      new Request("https://gps.csutil.com/api/nope"),
      env,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/json/);
    expect(assetCalls.length).toBe(0);
  });

  it("the API 404 carries CORS for an allowlisted dev origin (PR #369 review)", async () => {
    // Without it, a typo'd route fetched from a dev server shows up as an
    // opaque CORS failure — the readable JSON error was unreachable for
    // exactly the caller class that cannot just curl the route.
    const { env } = envSpy(new Response("asset"));
    const response = await routeRequest(
      new Request("https://gps.csutil.com/api/nope", {
        headers: { Origin: "http://localhost:5187" },
      }),
      env,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5187",
    );
    expect(response.headers.get("vary")).toBe("Origin");
  });
});
