/**
 * Getting the frame-hitch recorder's export off a phone (globe zoom
 * frame-hitch plan 2026-10-03-2017 §4.1, DEC-PERF-1): Copy (the clipboard,
 * from the button's tap), Download (a .json file), and a selectable box as
 * the last resort when either refuses. The browser parts are injected, so
 * it runs under `node --test`.
 *
 * @see globe-perf-share.js.md
 */

/**
 * Copies `text`: the clipboard when the browser allows it ("clipboard"),
 * else the text shown to select ("shown"). Never throws.
 *
 * @param {string} text
 * @param {{ clipboard?: { writeText(t: string): Promise<void> },
 *   showText(t: string): void }} env
 */
export async function copyExport(text, env) {
  try {
    if (!env.clipboard?.writeText) throw new Error("no clipboard");
    await env.clipboard.writeText(text);
    return "clipboard";
  } catch {
    env.showText(text);
    return "shown";
  }
}

/**
 * Saves `text` as `name` through a link to a blob URL ("download"), else
 * shows it to select ("shown"). Never throws.
 *
 * @param {string} text
 * @param {string} name
 * @param {{ makeUrl(text: string): string, revokeUrl(url: string): void,
 *   clickLink(href: string, name: string): void, showText(t: string): void }} env
 */
export function downloadExport(text, name, env) {
  let url = null;
  try {
    url = env.makeUrl(text);
    env.clickLink(url, name);
    return "download";
  } catch {
    env.showText(text);
    return "shown";
  } finally {
    // Late, so the browser has taken the download first.
    if (url !== null) {
      const timer = setTimeout(() => env.revokeUrl(url), 10_000);
      timer.unref?.();
    }
  }
}

/** `globe-perf-<sweep>-<UTC time>.json`, safe on every filesystem. */
export function exportFileName(sweep, epochMs) {
  const stamp = new Date(epochMs)
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replaceAll(":", "-");
  return `globe-perf-${sweep}-${stamp}.json`;
}

/** The browser's parts for `copyExport` and `downloadExport`. */
export function browserShareEnv(showText) {
  return {
    // Read when Copy is pressed, not when the overlay is built.
    get clipboard() {
      return globalThis.navigator?.clipboard;
    },
    showText,
    makeUrl: (text) =>
      URL.createObjectURL(new Blob([text], { type: "application/json" })),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    clickLink: (href, name) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.rel = "noopener";
      document.body.append(a);
      a.click();
      a.remove();
    },
  };
}
