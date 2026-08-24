/**
 * Escapes text destined for an HTML sink.
 *
 * WHY THE FRAMEWORK OWNS THIS. It was written in `GpsPlusSlamJs_OsmDemo`, and a
 * second, WEAKER copy grew independently in `GpsPlusSlamJs_Landing` — four
 * characters instead of five. That is the failure mode a shared escaper exists
 * to prevent: two implementations mean two chances to miss a character class,
 * and the weaker one is only safe by accident of its current call site.
 *
 * THE ORIGINAL REASON IT WAS NEEDED, kept because it is the clearest statement
 * of when to reach for this. Leaflet's `bindTooltip`/`bindPopup` render their
 * argument as HTML, and the OSM demo interpolates strings it does not own:
 * category names come from a **publicly editable Google Sheet**, accepted at any
 * name up to 20 characters with no character-set restriction. `<svg onload=x>`
 * fits in 20 characters, so the length cap is not a mitigation.
 *
 * WHY HERE AND NOT AT THE SOURCE. Restricting those names to `[A-Za-z0-9_]` was
 * the alternative. It is rejected because it silently drops legitimate
 * owner-authored names (spaces, umlauts) from every consumer, to fix a problem
 * that belongs to the sink. Escaping is complete, costs nothing, and breaks
 * nobody.
 *
 * Deliberately a plain string transform rather than `textContent` on a detached
 * node: this module is unit-tested in Node, where there is no DOM, and callers
 * that DO have a DOM should prefer `textContent` over building markup at all.
 *
 * @see escape-html.ts.md
 */

const REPLACEMENTS: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
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
