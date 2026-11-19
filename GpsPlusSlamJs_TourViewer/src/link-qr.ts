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

import type { EnableGpsArState } from "gps-plus-slam-app-framework/ar";
import QRCode from "qrcode";

/** A screen a person sits at: wide, with a mouse or a trackpad. */
export const COMPUTER_SCREEN_QUERY =
  "(min-width: 768px) and (hover: hover) and (pointer: fine)";

/** Quiet zone around the code, in modules (the standard asks for 4; the
 *  code sits on its own white tile, so 2 scans as well and stays larger). */
const QUIET_ZONE = 2;

/** CSS pixels per module: a whole number, so every module lands on whole
 *  pixels and the code stays sharp; the box is sized from the module
 *  count (135 to 195 px for the shortest to the longest storage provider
 *  link the tests use). */
export const LINK_QR_MODULE_PX = 3;

/** CSS pixels per module for a code too large at `LINK_QR_MODULE_PX`
 *  (a presigned storage link of several hundred bytes): still whole
 *  pixels, so still sharp, up to 242 px. */
export const LINK_QR_SMALL_MODULE_PX = 2;

/** The largest code, in CSS pixels, that stands beside the Copy link dial:
 *  the visitor's column is at most 440 px with its 24 px side padding, the
 *  dial up to 156 px and the gap 40 px, so a code up to 440 - 156 - 40 =
 *  244 px keeps the row inside the column's box (taking at most all of its
 *  padding; measured on the page at 1280x720 and 1000x620). A code larger
 *  at 3 px per module is drawn at 2; one larger even then is refused like
 *  a link too long for any code: Copy link alone. */
export const LINK_QR_MAX_PX = 244;

interface MediaWindow {
  matchMedia?: (query: string) => {
    matches: boolean;
    addEventListener?: (type: "change", listener: () => void) => void;
  };
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

/** Calls `listener` whenever the window starts or stops answering the
 *  computer-screen query (a window widened past 768 px, a mouse plugged
 *  in), so the code follows without a reload. Does nothing where the
 *  browser cannot say (no `matchMedia`, no `addEventListener` on its
 *  answer, or either throws). */
export function onComputerScreenChange(
  win: MediaWindow,
  listener: () => void,
): void {
  try {
    if (typeof win.matchMedia !== "function") return;
    const query = win.matchMedia(COMPUTER_SCREEN_QUERY);
    if (typeof query.addEventListener !== "function") return;
    query.addEventListener("change", listener);
  } catch {
    // An old or unusual browser: the code keeps its first answer.
  }
}

/** Whether the visitor's screen shows the code: a visitor whose device
 *  cannot show AR (the button copies the link), with a Start not withheld
 *  (a tour not finished yet offers nothing to open elsewhere), on a
 *  computer-sized screen. */
export function linkQrShown(input: {
  visitor: boolean;
  arStatus: EnableGpsArState["status"];
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
 * The link the code holds and Copy link copies: the page and its `qr`
 * parameter, nothing else of the address (a debug switch, a cache
 * switch, a fragment). The parameter keeps its own encoding, so a link
 * that had nothing else is given back unchanged. An address without a
 * `qr` parameter, or one that does not parse, is given back as it is.
 */
export function shareLinkOf(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  const qr = url.search
    .slice(1)
    .split("&")
    .find((part) => part === "qr" || part.startsWith("qr="));
  if (qr === undefined) return href;
  // The page's own address without its query and fragment, not origin
  // plus path: a `file:` page's origin reads "null", and a `blob:` page's
  // origin is the page that made it, its path a whole address.
  url.search = "";
  url.hash = "";
  // A user name and password would travel with every scan and paste.
  url.username = "";
  url.password = "";
  return `${url.href}?${qr}`;
}

/**
 * The QR code of `url` as an SVG string: one path of dark modules on a
 * white square, `viewBox` in modules, `width` and `height` at
 * `LINK_QR_MODULE_PX` CSS pixels per module, or at
 * `LINK_QR_SMALL_MODULE_PX` where 3 would exceed `LINK_QR_MAX_PX` (a
 * link over about 410 bytes). Throws on an empty or non-string url, with
 * a `RangeError` on a code larger than `LINK_QR_MAX_PX` even at 2 px
 * per module (a link over about 1000 bytes), and (the library's error) on
 * a link too long for any QR code: past version 40, about 2300 bytes at
 * error correction M.
 */
export function linkQrSvg(url: string): string {
  if (typeof url !== "string" || url.length === 0) {
    throw new TypeError("linkQrSvg needs a non-empty url");
  }
  const { size, data } = QRCode.create(url, {
    errorCorrectionLevel: "M",
  }).modules;
  const side = size + 2 * QUIET_ZONE;
  const modulePx =
    side * LINK_QR_MODULE_PX <= LINK_QR_MAX_PX
      ? LINK_QR_MODULE_PX
      : LINK_QR_SMALL_MODULE_PX;
  const px = side * modulePx;
  if (px > LINK_QR_MAX_PX) {
    throw new RangeError(
      `linkQrSvg: a ${String(px)} px code is larger than ${String(LINK_QR_MAX_PX)} px`,
    );
  }
  let path = "";
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y * size + x] === 1) {
        path += `M${String(x + QUIET_ZONE)} ${String(y + QUIET_ZONE)}h1v1h-1z`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(side)} ${String(side)}" width="${String(px)}" height="${String(px)}" shape-rendering="crispEdges" aria-hidden="true">` +
    `<rect width="${String(side)}" height="${String(side)}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`
  );
}
