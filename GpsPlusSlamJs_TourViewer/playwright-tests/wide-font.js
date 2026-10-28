/**
 * The page's text set in a wide face, for the layout tests that check
 * every control fits a bar. Why: a bar that fits this machine's system
 * face by a few pixels overflows on another platform's - the map page's
 * top bar fit at 390 px here, and the CI's Linux face (DejaVu Sans) put
 * its last button 7 px past the window. Verdana has DejaVu's widths (both
 * descend from Bitstream Vera's metrics) and ships with Windows and
 * macOS; where it is missing, DejaVu Sans is the face, so every platform
 * checks the layout with about the widest common sans-serif.
 *
 * Call it before the page loads: it holds for every page the test opens.
 *
 * The widths are close, not equal: DejaVu Sans Bold sets a headline wider
 * than Verdana Bold (the landing's 40 px headline took four lines in
 * DejaVu where Verdana took three, and the CI saw a button 19 px below a
 * 600 px window that this machine kept 25 px clear). A layout check that
 * must hold in the CI's face passes `letterSpacing`: Verdana with
 * 0.02em set every line of the landing's hero at least as long as real
 * DejaVu Sans did, at seven desktop sizes.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ letterSpacing?: string }} [options]
 */
export async function useWideFont(page, options = {}) {
  const spacing = options.letterSpacing ?? null;
  await page.addInitScript((spacing) => {
    const style = document.createElement("style");
    style.textContent = `*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important;${spacing === null ? "" : ` letter-spacing: ${spacing} !important;`} }`;
    const add = () => document.head.append(style);
    if (document.head === null) {
      document.addEventListener("DOMContentLoaded", add, { once: true });
    } else {
      add();
    }
  }, spacing);
}
