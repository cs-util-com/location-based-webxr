/**
 * Escapes text destined for an HTML sink.
 *
 * WHY THE DEMO NEEDS THIS AT ALL. Leaflet's `bindTooltip`/`bindPopup` render
 * their argument as HTML, and the strings this demo interpolates into them are
 * not ours: category names come from `discoverCategories`, which reads the
 * column headers of a **publicly editable Google Sheet** and accepts any name
 * up to 20 characters with no character-set restriction. `<svg onload=x>` fits
 * in 20 characters.
 *
 * `rule-table-loader.ts` already describes that sheet as "the only thing
 * standing between a bad edit to a publicly-editable Google Sheet and every
 * downstream app's behaviour", so handing its column names straight to an HTML
 * sink is inconsistent with how the rest of the pipeline treats them.
 *
 * WHY HERE AND NOT AT THE SOURCE. Restricting category names to `[A-Za-z0-9_]`
 * in `discoverCategories` was the alternative. It is rejected for now because it
 * silently drops legitimate owner-authored names (spaces, umlauts) from every
 * consumer, which is a behaviour change to owner-published data made to fix a
 * problem that belongs to the sink. Escaping is complete, costs nothing, and
 * breaks nobody.
 *
 * Deliberately a plain string transform rather than `textContent` on a detached
 * node: this module is unit-tested in Node, where there is no DOM.
 *
 * @see escape-html.ts.md
 */

const REPLACEMENTS: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Returns `value` with the five HTML-significant characters replaced.
 *
 * `&` is handled by the same pass rather than first, so an already-escaped
 * entity is double-escaped (`&amp;` → `&amp;amp;`) instead of a `&lt;` in the
 * input surviving as a literal `<`. Displaying a stray `&amp;` is a cosmetic
 * bug; unescaping one is a hole.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => REPLACEMENTS[char] ?? char);
}
