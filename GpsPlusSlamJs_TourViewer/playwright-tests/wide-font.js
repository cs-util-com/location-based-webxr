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
 */
export async function useWideFont(page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent =
      '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; }';
    const add = () => document.head.append(style);
    if (document.head === null) {
      document.addEventListener("DOMContentLoaded", add, { once: true });
    } else {
      add();
    }
  });
}
