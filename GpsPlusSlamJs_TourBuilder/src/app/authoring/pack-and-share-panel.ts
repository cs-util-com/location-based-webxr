/**
 * Share step of composed Authoring mode (plan
 * `plans/2026-08-14-authoring-composition-plan.md`, AC5, revised by
 * plans/2026-09-02-authoring-composition-ui-refresh-design.md). Packing and
 * downloading now happen on the authoring view's own Export button (see
 * `authoring-view.ts`'s `packAndDownload` dependency); by the time this
 * panel mounts, `tour.zip` has already been packed and downloaded. This
 * panel's only job is turning the URL the author uploads it to into a
 * scannable link, using packaging's `core/` (`buildTourUrl`, `generateQr`)
 * and `view/renderQrSvg`. It no longer needs the `Tour`/asset files
 * themselves at all (only packaging ever used them, and that now happens
 * earlier, in `authoring-view.ts`), so it takes no deps beyond `root`.
 *
 * Once a code is showing, the author can also save it as an image (PNG or
 * JPEG) via `view/export-qr-image.ts`'s `rasterizeQrSvg` — useful for
 * printing a sign or dropping the code into a flyer, which the on-page SVG
 * alone doesn't support. Saving goes through the framework's
 * `shareOrDownloadBlob` (native share sheet on a phone, save picker on
 * desktop) rather than a plain `<a download>`, matching every other export
 * in this app and fitting this product's outdoor-phone-in-hand audience.
 */
import {
  type DownloadFileType,
  shareOrDownloadBlob,
} from "gps-plus-slam-app-framework/storage";

import { buildTourUrl } from "../../components/packaging/core/build-tour-url.js";
import { generateQr } from "../../components/packaging/core/generate-qr.js";
import {
  type QrImageFormat,
  rasterizeQrSvg,
} from "../../components/packaging/view/export-qr-image.js";
import { renderQrSvg } from "../../components/packaging/view/qr-view.js";
import { prepareHostedZipUrl } from "../../components/shared/hosted-zip-url.js";
import { ICONS } from "../../components/shared/icons.js";
import { buildLabeledField } from "../../components/shared/labeled-field.js";

const QR_IMAGE_TYPES: Record<QrImageFormat, DownloadFileType> = {
  png: { description: "PNG Image", mimeType: "image/png", extension: ".png" },
  jpeg: {
    description: "JPEG Image",
    mimeType: "image/jpeg",
    extension: ".jpg",
  },
};

export function mountPackAndSharePanel(root: HTMLElement): {
  destroy(): void;
  root: HTMLElement;
} {
  const section = document.createElement("section");
  section.className = "panel";

  const heading = document.createElement("h2");
  heading.textContent = "Share link";
  section.appendChild(heading);

  const appBaseInput = document.createElement("input");
  appBaseInput.type = "url";
  appBaseInput.value = `${location.origin}${location.pathname}`;
  section.append(
    buildLabeledField("App base URL", appBaseInput, "app-base-url"),
  );

  const zipUrlInput = document.createElement("input");
  zipUrlInput.type = "url";
  zipUrlInput.placeholder = "Paste the shared link after uploading tour.zip";
  const zipUrlField = buildLabeledField(
    "OneDrive / Dropbox link",
    zipUrlInput,
    "zip-url",
  );
  section.append(zipUrlField);

  const generateButton = document.createElement("button");
  generateButton.className = "primary";
  generateButton.dataset["testid"] = "generate-qr";
  generateButton.textContent = "Generate QR";
  section.appendChild(generateButton);

  const qrStatus = document.createElement("p");
  qrStatus.dataset["testid"] = "qr-status";
  section.appendChild(qrStatus);

  const qrHost = document.createElement("div");
  qrHost.className = "qr-host";
  section.appendChild(qrHost);

  const qrActions = document.createElement("div");
  qrActions.className = "qr-actions";
  const savePngButton = buildSaveImageButton("png", "PNG");
  const saveJpgButton = buildSaveImageButton("jpeg", "JPG");
  qrActions.append(savePngButton, saveJpgButton);
  section.appendChild(qrActions);

  const exportStatus = document.createElement("p");
  exportStatus.dataset["testid"] = "qr-export-status";
  section.appendChild(exportStatus);

  /** The SVG last rendered into `qrHost` — `null` before the first
   * successful generate, or after a regenerate clears it below. Saving
   * rasterizes this rather than re-reading `qrHost.innerHTML`, so a saved
   * image can never race a regenerate that's already cleared the host. */
  let currentQrSvg: string | null = null;

  function buildSaveImageButton(
    format: QrImageFormat,
    label: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "qr-action";
    button.dataset["testid"] = `save-qr-${format === "jpeg" ? "jpg" : "png"}`;
    button.setAttribute("aria-label", `Save QR code as ${label} image`);
    const icon = document.createElement("span");
    icon.className = "qr-action-icon";
    icon.innerHTML = ICONS.download;
    const text = document.createElement("span");
    text.textContent = label;
    button.append(icon, text);
    button.addEventListener("click", () => {
      void saveQrImage(format, button);
    });
    return button;
  }

  async function saveQrImage(
    format: QrImageFormat,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (!currentQrSvg) return;
    exportStatus.textContent = "";
    exportStatus.dataset["state"] = "";
    button.disabled = true;
    try {
      const blob = await rasterizeQrSvg(currentQrSvg, format);
      const fileType = QR_IMAGE_TYPES[format];
      const result = await shareOrDownloadBlob(
        blob,
        `tour-qr${fileType.extension}`,
        fileType,
      );
      if (result.route === "download" && !result.delivered) {
        // A dismissed save picker, not a failure — nothing to report as an
        // error (mirrors how `downloadZip`'s own callers treat `false`).
        return;
      }
    } catch (error) {
      exportStatus.textContent =
        error instanceof Error ? error.message : String(error);
      exportStatus.dataset["state"] = "error";
    } finally {
      button.disabled = false;
    }
  }

  generateButton.addEventListener("click", () => {
    void (async () => {
      qrStatus.textContent = "";
      qrStatus.dataset["state"] = "";
      zipUrlField.classList.remove("field-error");
      qrHost.classList.remove("qr-host-show");
      qrHost.textContent = "";
      qrActions.classList.remove("qr-actions-show");
      exportStatus.textContent = "";
      exportStatus.dataset["state"] = "";
      currentQrSvg = null;

      // AC13: buildTourUrl only validates appBaseUrl — a garbage zipUrl would
      // otherwise silently produce a QR pointing at a broken "?tour=" link.
      try {
        new URL(zipUrlInput.value);
      } catch {
        qrStatus.textContent = "Enter a shared link first.";
        qrStatus.dataset["state"] = "error";
        zipUrlField.classList.add("field-error");
        return;
      }

      // The proxy-routing decision is entirely an implementation detail —
      // the author can't act on it, so its notes never reach the UI.
      const prepared = prepareHostedZipUrl(
        zipUrlInput.value,
        import.meta.env.DEV,
      );
      if (prepared.notes.length > 0) {
        console.info("[pack-and-share]", prepared.notes.join(" | "));
      }

      try {
        const url = buildTourUrl(appBaseInput.value, prepared.url);
        const svg = await generateQr(url);
        renderQrSvg(qrHost, svg);
        qrHost.classList.add("qr-host-show");
        currentQrSvg = svg;
        qrActions.classList.add("qr-actions-show");
        // A real link, not just displayed text: the author (or whoever they
        // forward this to) can tap it directly instead of only scanning.
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = url;
        qrStatus.textContent = "";
        qrStatus.appendChild(link);
        qrStatus.dataset["state"] = "ok";
      } catch (error) {
        qrStatus.textContent =
          error instanceof Error ? error.message : String(error);
        qrStatus.dataset["state"] = "error";
        zipUrlField.classList.add("field-error");
      }
    })();
  });

  root.appendChild(section);

  return {
    root: section,
    destroy() {
      section.remove();
    },
  };
}
