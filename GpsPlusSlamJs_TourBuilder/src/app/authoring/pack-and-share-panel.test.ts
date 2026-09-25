// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import type * as StorageModule from "gps-plus-slam-app-framework/storage";
import type { rasterizeQrSvg as RasterizeQrSvgFn } from "../../components/packaging/view/export-qr-image.js";

const shareOrDownloadBlob = vi.fn<typeof StorageModule.shareOrDownloadBlob>(
  () => Promise.resolve({ route: "download" as const, delivered: true }),
);
vi.mock("gps-plus-slam-app-framework/storage", async () => {
  const actual = await vi.importActual<typeof StorageModule>(
    "gps-plus-slam-app-framework/storage",
  );
  return {
    ...actual,
    normalizeShareUrl: (raw: string) => raw,
    shareOrDownloadBlob,
  };
});

vi.mock("../../components/packaging/core/generate-qr.js", () => ({
  generateQr: vi.fn((url: string) => Promise.resolve(`QR-DATA(${url})`)),
}));

vi.mock("../../components/packaging/view/qr-view.js", () => ({
  renderQrSvg: vi.fn((host: HTMLElement, data: string) => {
    host.textContent = String(data);
  }),
}));

const rasterizeQrSvg = vi.fn<typeof RasterizeQrSvgFn>(
  () => Promise.resolve(new Blob(["fake-image"], { type: "image/png" })),
);
vi.mock("../../components/packaging/view/export-qr-image.js", () => ({
  rasterizeQrSvg,
}));

import { mountPackAndSharePanel } from "./pack-and-share-panel.js";

function setup() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const panel = mountPackAndSharePanel(root);
  const urlInputs =
    root.querySelectorAll<HTMLInputElement>('input[type="url"]');
  const zipUrlInput = urlInputs[1]!;
  const zipField = zipUrlInput.closest(".field")!;
  const qrStatus = root.querySelector<HTMLParagraphElement>(
    '[data-testid="qr-status"]',
  )!;
  const generateButton = root.querySelector<HTMLButtonElement>(
    '[data-testid="generate-qr"]',
  )!;
  const savePngButton = root.querySelector<HTMLButtonElement>(
    '[data-testid="save-qr-png"]',
  )!;
  const saveJpgButton = root.querySelector<HTMLButtonElement>(
    '[data-testid="save-qr-jpg"]',
  )!;
  const exportStatus = root.querySelector<HTMLParagraphElement>(
    '[data-testid="qr-export-status"]',
  )!;
  return {
    root,
    panel,
    zipUrlInput,
    zipField,
    qrStatus,
    generateButton,
    savePngButton,
    saveJpgButton,
    exportStatus,
  };
}

async function generateQrCode(
  helpers: ReturnType<typeof setup>,
  zipUrl = "https://example.com/tour.zip",
): Promise<void> {
  helpers.zipUrlInput.value = zipUrl;
  helpers.generateButton.click();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = "";
  rasterizeQrSvg.mockClear();
  rasterizeQrSvg.mockResolvedValue(
    new Blob(["fake-image"], { type: "image/png" }),
  );
  shareOrDownloadBlob.mockClear();
  shareOrDownloadBlob.mockResolvedValue({
    route: "download",
    delivered: true,
  });
});

describe("mountPackAndSharePanel", () => {
  it("has no pack/download controls left — it opens directly on the share step", () => {
    const { root } = setup();
    expect(root.querySelector('[data-testid="pack-tour"]')).toBeNull();
    expect(root.querySelector('[data-testid="pack-status"]')).toBeNull();
    expect(root.querySelector('[data-testid="url-notes"]')).toBeNull();
  });

  it("labels the zip-url field for a non-technical author", () => {
    const { zipField } = setup();
    expect(zipField.textContent).toContain("OneDrive / Dropbox link");
  });

  it("shows no error and builds the link unchanged for an ordinary host", async () => {
    const { zipUrlInput, qrStatus, generateButton } = setup();
    zipUrlInput.value = "https://example.com/tour.zip";
    generateButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(qrStatus.dataset["state"]).toBe("ok");
    expect(qrStatus.textContent).toContain(
      encodeURIComponent("https://example.com/tour.zip"),
    );
  });

  it("routes a Dropbox URL through the dev proxy without showing an explanatory note", async () => {
    const original = import.meta.env.DEV;
    (import.meta.env as { DEV: boolean }).DEV = true;
    try {
      const { root, zipUrlInput, qrStatus, generateButton } = setup();
      const raw = "https://dl.dropboxusercontent.com/scl/fi/abc/tour.zip";
      zipUrlInput.value = raw;
      generateButton.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(qrStatus.textContent).toContain(
        encodeURIComponent(`/tour-proxy?u=${encodeURIComponent(raw)}`),
      );
      // The routing itself is fine to see baked into the generated link
      // (that's just the URL); what must never appear is a *note explaining*
      // it, which is why there's no url-notes element at all any more.
      expect(root.querySelector('[data-testid="url-notes"]')).toBeNull();
    } finally {
      (import.meta.env as { DEV: boolean }).DEV = original;
    }
  });

  it("rejects an invalid link before building a URL", async () => {
    const { zipUrlInput, qrStatus, generateButton } = setup();
    zipUrlInput.value = "not-a-url";
    generateButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(qrStatus.dataset["state"]).toBe("error");
    expect(qrStatus.textContent).toBe("Enter a shared link first.");
  });

  it("exposes its top-level element as .root, for the caller's entrance transition", () => {
    const { panel, root } = setup();
    expect(panel.root.parentElement).toBe(root);
  });

  describe("saving the QR as an image", () => {
    it("keeps the save buttons out of the accessibility tree until a code exists", () => {
      const { root } = setup();
      expect(root.querySelector('[data-testid="save-qr-png"]')).toBeTruthy();
      // Present but visually/interactively collapsed pre-generate: covered by
      // the CSS contract (`.qr-actions-show`), not asserted on layout here.
    });

    it("rasterizes the generated SVG and hands it to shareOrDownloadBlob as a PNG", async () => {
      const helpers = setup();
      await generateQrCode(helpers);

      helpers.savePngButton.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(rasterizeQrSvg).toHaveBeenCalledWith(
        expect.stringMatching(/^QR-DATA\(/),
        "png",
      );
      expect(shareOrDownloadBlob).toHaveBeenCalledTimes(1);
      const [blob, filename, fileType] = shareOrDownloadBlob.mock.calls[0]!;
      expect(filename).toBe("tour-qr.png");
      expect((fileType as { mimeType: string }).mimeType).toBe("image/png");
      expect(blob).toBeInstanceOf(Blob);
    });

    it("saves as JPEG with a .jpg filename from the JPG button", async () => {
      const helpers = setup();
      await generateQrCode(helpers);

      helpers.saveJpgButton.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(rasterizeQrSvg).toHaveBeenLastCalledWith(
        expect.any(String),
        "jpeg",
      );
      const [, filename, fileType] = shareOrDownloadBlob.mock.calls[0]!;
      expect(filename).toBe("tour-qr.jpg");
      expect((fileType as { mimeType: string }).mimeType).toBe("image/jpeg");
    });

    it("reports an error without touching qr-status when rasterizing fails", async () => {
      const helpers = setup();
      await generateQrCode(helpers);
      rasterizeQrSvg.mockRejectedValueOnce(new Error("Could not decode"));

      helpers.savePngButton.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(helpers.exportStatus.dataset["state"]).toBe("error");
      expect(helpers.exportStatus.textContent).toBe("Could not decode");
      expect(helpers.qrStatus.dataset["state"]).toBe("ok");
    });

    it("stays quiet when the author dismisses the save picker", async () => {
      const helpers = setup();
      await generateQrCode(helpers);
      shareOrDownloadBlob.mockResolvedValueOnce({
        route: "download",
        delivered: false,
      });

      helpers.savePngButton.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(helpers.exportStatus.dataset["state"]).not.toBe("error");
      expect(helpers.exportStatus.textContent).toBe("");
    });

    it("re-enables the button after saving completes", async () => {
      const helpers = setup();
      await generateQrCode(helpers);

      helpers.savePngButton.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(helpers.savePngButton.disabled).toBe(false);
    });

    it("clears any previous export error and the stale code when regenerating", async () => {
      const helpers = setup();
      await generateQrCode(helpers);
      rasterizeQrSvg.mockRejectedValueOnce(new Error("boom"));
      helpers.savePngButton.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(helpers.exportStatus.dataset["state"]).toBe("error");

      await generateQrCode(helpers, "https://example.com/other.zip");

      expect(helpers.exportStatus.textContent).toBe("");
      expect(helpers.exportStatus.dataset["state"]).toBe("");
    });
  });
});
