import { describe, expect, it, vi } from "vitest";

vi.mock("gps-plus-slam-app-framework/storage", () => ({
  normalizeShareUrl: (raw: string) => raw,
}));

import { prepareHostedZipUrl, PROXY_REQUIRED_HOSTS } from "./hosted-zip-url.js";

describe("prepareHostedZipUrl", () => {
  it("passes an ordinary host through unchanged with no notes", () => {
    const result = prepareHostedZipUrl("https://example.com/tour.zip", true);
    expect(result).toEqual({ url: "https://example.com/tour.zip", notes: [] });
  });

  it("routes a no-CORS host through the dev proxy when isDev is true", () => {
    const raw = "https://dl.dropboxusercontent.com/scl/fi/abc/tour.zip";
    const result = prepareHostedZipUrl(raw, true);
    expect(result.url).toBe(`/tour-proxy?u=${encodeURIComponent(raw)}`);
    expect(result.notes).toEqual([
      "no-CORS host dl.dropboxusercontent.com → routed via dev proxy",
    ]);
  });

  it("routes drive.usercontent.google.com through the dev proxy when isDev is true", () => {
    const raw = "https://drive.usercontent.google.com/download?id=abc";
    const result = prepareHostedZipUrl(raw, true);
    expect(result.url).toBe(`/tour-proxy?u=${encodeURIComponent(raw)}`);
  });

  it("leaves a no-CORS host unrewritten with a warning note when isDev is false", () => {
    const raw = "https://dl.dropboxusercontent.com/scl/fi/abc/tour.zip";
    const result = prepareHostedZipUrl(raw, false);
    expect(result.url).toBe(raw);
    expect(result.notes).toEqual([
      "⚠ dl.dropboxusercontent.com serves no CORS headers — route it through the Worker proxy (RECIPE.md)",
    ]);
  });

  it("passes through a relative/unparseable URL without throwing", () => {
    const result = prepareHostedZipUrl("/tour-proxy?u=already-proxied", true);
    expect(result).toEqual({ url: "/tour-proxy?u=already-proxied", notes: [] });
  });

  it("notes when normalizeShareUrl changes the input", async () => {
    vi.resetModules();
    vi.doMock("gps-plus-slam-app-framework/storage", () => ({
      normalizeShareUrl: () => "https://example.com/normalized.zip",
    }));
    const { prepareHostedZipUrl: prepare } =
      await import("./hosted-zip-url.js");
    const result = prepare("https://example.com/share/xyz", true);
    expect(result.url).toBe("https://example.com/normalized.zip");
    expect(result.notes).toEqual([
      "share link normalized → https://example.com/normalized.zip",
    ]);
  });

  it("exposes the exact proxy-required host set", () => {
    expect(PROXY_REQUIRED_HOSTS).toEqual(
      new Set(["dl.dropboxusercontent.com", "drive.usercontent.google.com"]),
    );
  });
});
