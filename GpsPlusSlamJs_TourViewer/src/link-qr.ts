/**
 * The visitor's "Scan with your phone" code: on a computer whose browser
 * cannot show the tour in AR, the tour's link as a QR code beside "Copy
 * link", so the visitor moves it to a phone with one scan. A phone without
 * AR gets no code: scanning it with the same kind of phone gains nothing.
 *
 * The code comes from the same `qrcode` library the print panel uses
 * (`print-panel.ts`), drawn as an inline SVG: synchronous, so there is no
 * in-progress state to show.
 */

import QRCode from "qrcode";

/** A screen a person sits at: wide, with a mouse or a trackpad. */
export const COMPUTER_SCREEN_QUERY =
  "(min-width: 768px) and (hover: hover) and (pointer: fine)";

/** Quiet zone around the code, in modules (the standard asks for 4; the
 *  code sits on its own white tile, so 2 scans as well and stays larger). */
const QUIET_ZONE = 2;

interface MediaWindow {
  matchMedia?: (query: string) => { matches: boolean };
}

/** Whether this window is a computer-sized screen; false where the
 *  browser cannot say (no `matchMedia`, or it throws). */
export function isComputerScreen(win: MediaWindow): boolean {
  try {
    return (
      typeof win.matchMedia === "function" &&
      win.matchMedia(COMPUTER_SCREEN_QUERY).matches
    );
  } catch {
    return false;
  }
}

/** Whether the visitor's screen shows the code: a visitor whose device
 *  cannot show AR (the button copies the link), with a Start not withheld
 *  (a tour not finished yet offers nothing to open elsewhere), on a
 *  computer-sized screen. */
export function linkQrShown(input: {
  visitor: boolean;
  arStatus: string;
  withheld: boolean;
  computerScreen: boolean;
}): boolean {
  return (
    input.visitor &&
    input.arStatus === "unsupported" &&
    !input.withheld &&
    input.computerScreen
  );
}

/**
 * The QR code of `url` as an SVG string: one path of dark modules on a
 * white square, `viewBox` in modules. Throws on an empty or non-string
 * url (the caller passes the page's own `location.href`).
 */
export function linkQrSvg(url: string): string {
  if (typeof url !== "string" || url.length === 0) {
    throw new TypeError("linkQrSvg needs a non-empty url");
  }
  const { size, data } = QRCode.create(url, {
    errorCorrectionLevel: "M",
  }).modules;
  const side = size + 2 * QUIET_ZONE;
  let path = "";
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y * size + x] === 1) {
        path += `M${String(x + QUIET_ZONE)} ${String(y + QUIET_ZONE)}h1v1h-1z`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(side)} ${String(side)}" shape-rendering="crispEdges" aria-hidden="true">` +
    `<rect width="${String(side)}" height="${String(side)}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`
  );
}
