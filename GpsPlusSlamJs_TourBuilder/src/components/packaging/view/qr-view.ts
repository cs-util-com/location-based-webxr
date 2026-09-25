/**
 * `renderQrSvg` — put a generated QR SVG on the page.
 *
 * The DOM seam for `core/generate-qr.ts`, which returns markup as a string and
 * knows nothing about the document.
 */

/**
 * Render `svg` inside `host`, replacing whatever was there.
 *
 * `innerHTML` is safe here specifically because the markup is produced locally
 * by the `qrcode` encoder from a URL string — it is never author- or
 * network-supplied HTML.
 */
export function renderQrSvg(host: HTMLElement, svg: string): void {
  host.innerHTML = svg;
}
