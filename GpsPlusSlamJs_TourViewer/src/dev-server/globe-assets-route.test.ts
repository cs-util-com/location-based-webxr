/**
 * Why these tests matter: the editor on the globe view loads the globe's
 * whole-Earth imagery from `/globe-assets/...` (the globe package's own
 * absolute paths), which this app's dev server - the e2e's too - did not
 * serve. The route maps that prefix onto the globe package's `assets/`
 * folder, and must never hand out a file outside it.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GLOBE_ASSETS_PREFIX,
  globeAssetFile,
  serveGlobeAsset,
} from "./globe-assets-route.js";

const DIR = join("C:", "globe", "assets");

describe("globeAssetFile", () => {
  it("maps a file under the prefix into the assets folder", () => {
    expect(globeAssetFile("/globe-assets/equirect/clouds.webp?v=2", DIR)).toBe(
      join(DIR, "equirect", "clouds.webp"),
    );
    expect(GLOBE_ASSETS_PREFIX).toBe("/globe-assets/");
  });

  it("answers nothing outside the prefix", () => {
    expect(globeAssetFile("/edit.html", DIR)).toBeNull();
    expect(globeAssetFile("/globe-assetsx/a.webp", DIR)).toBeNull();
    expect(globeAssetFile("/globe-assets/", DIR)).toBeNull();
  });

  // Why: a path that climbs out of the folder, plain or percent-encoded,
  // or that cannot be decoded, is refused rather than read.
  it("refuses a path that leaves the folder", () => {
    for (const url of [
      "/globe-assets/../package.json",
      "/globe-assets/%2e%2e/package.json",
      "/globe-assets/a/..%2f..%2fpackage.json",
      "/globe-assets/%E0%A4%A",
      "/globe-assets/a%00.webp",
    ]) {
      expect(globeAssetFile(url, DIR), url).toBeNull();
    }
  });
});

describe("serveGlobeAsset", () => {
  const dir = mkdtempSync(join(tmpdir(), "globe-assets-"));
  mkdirSync(join(dir, "equirect"));
  writeFileSync(join(dir, "equirect", "sky.webp"), "pixels");

  const answer = (url: string) => {
    const headers: Record<string, string> = {};
    let status = 0;
    let body = "";
    let passed = false;
    return new Promise<{
      status: number;
      body: string;
      headers: Record<string, string>;
      passed: boolean;
    }>((resolve) => {
      const res = {
        setHeader(name: string, value: string) {
          headers[name.toLowerCase()] = value;
        },
        set statusCode(code: number) {
          status = code;
        },
        end(chunk?: string | Buffer) {
          if (chunk !== undefined) body += chunk.toString();
          resolve({ status, body, headers, passed });
        },
      };
      serveGlobeAsset({ url }, res, dir, () => {
        passed = true;
        resolve({ status, body, headers, passed });
      });
    });
  };

  it("sends a file with its type and passes on what is not one", async () => {
    const sent = await answer("/globe-assets/equirect/sky.webp");
    expect(sent.status).toBe(200);
    expect(sent.body).toBe("pixels");
    expect(sent.headers["content-type"]).toBe("image/webp");
    expect((await answer("/edit.html")).passed).toBe(true);
  });

  it("answers 404 for a missing file and 403 for a refused path", async () => {
    expect((await answer("/globe-assets/equirect/none.webp")).status).toBe(404);
    expect((await answer("/globe-assets/%2e%2e/x.webp")).status).toBe(403);
  });
});
