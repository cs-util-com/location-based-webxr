import { describe, expect, it } from "vitest";

import { buildQrLaunchUrl } from "gps-plus-slam-app-framework/utils/qr-payload/qr-launch-url";
import { resolveQrPayload } from "./qr-launch-dispatch.js";

/**
 * Why these tests matter: the encoder (`buildQrLaunchUrl`) picks whichever
 * payload form yields the sparsest printable QR, so a viewer that decodes
 * only some forms silently breaks a SUBSET of printed codes — the worst kind
 * of breakage, discovered only in the field. The round-trip test below runs
 * the real encoder and requires every candidate it can emit for `?qr=` to
 * resolve back to the exact input URL.
 */

const PREFIX =
  "https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/";

describe("resolveQrPayload — the four documented forms", () => {
  it("passes a raw http(s) payload through", async () => {
    await expect(
      resolveQrPayload("https://example.com/recording.zip", PREFIX),
    ).resolves.toBe("https://example.com/recording.zip");
  });

  it("expands the GitHub template user/repo/path", async () => {
    await expect(
      resolveQrPayload("user/repo/maps/city.zip", PREFIX),
    ).resolves.toBe(
      "https://raw.githubusercontent.com/user/repo/refs/heads/main/maps/city.zip",
    );
  });

  it("resolves a bare name under the default asset prefix", async () => {
    await expect(resolveQrPayload("MyMap123.zip", PREFIX)).resolves.toBe(
      `${PREFIX}MyMap123.zip`,
    );
  });

  it("returns null for an empty or undecodable payload", async () => {
    await expect(resolveQrPayload("", PREFIX)).resolves.toBeNull();
    await expect(
      resolveQrPayload("~!!!not-base64url", PREFIX),
    ).resolves.toBeNull();
    await expect(
      resolveQrPayload("name with spaces", PREFIX),
    ).resolves.toBeNull();
  });
});

describe("resolveQrPayload — round-trips the real encoder", () => {
  /** The GitHub template collapses `/refs/heads/main/` and `/main/` into one
   *  payload, so equality is checked modulo that (both URL forms serve the
   *  same bytes on raw.githubusercontent). */
  function canonical(url: string): string {
    return url.replace("/refs/heads/main/", "/main/");
  }

  // Every ?qr= candidate the encoder can emit must decode to the input URL.
  it.each([
    "https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/MyMap123.zip",
    "https://raw.githubusercontent.com/user/repo/main/a/recording.zip",
    "https://example.com/tours/city.zip?sig=abc123",
  ])("decodes every emitted ?qr= form for %s", async (dataUrl) => {
    const plan = await buildQrLaunchUrl("https://gps.csutil.com", dataUrl, {
      defaultAssetPrefix: PREFIX,
    });
    for (const candidate of plan.candidates) {
      const payload = new URL(candidate.url).searchParams.get("qr");
      expect(payload).not.toBeNull();
      const resolved = await resolveQrPayload(payload!, PREFIX);
      expect(resolved).not.toBeNull();
      expect(canonical(resolved!)).toBe(canonical(dataUrl));
    }
  });
});
