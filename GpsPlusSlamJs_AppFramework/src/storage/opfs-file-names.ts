/**
 * Escaping a caller-supplied key into a flat OPFS filename, and back.
 *
 * WHY FLAT RATHER THAN NESTED. Keys here come from callers that are free to
 * change their shape - an OSM tile key like `osm/v2/871fa199affffff`, a tour
 * URL a creator pasted. Creating nested directories from such a string is
 * how a `..` segment becomes a traversal, and it turns listing into a
 * recursive walk for no benefit. `encodeURIComponent` escapes `/`, so `.`
 * runs are harmless once slashes are gone, and the result is reversible -
 * which listing depends on.
 *
 * WHY IT LIVES HERE rather than beside its first caller: it is a contract
 * (traversal-proof AND reversible), and two stores now depend on exactly
 * that pair of properties. Two copies of an escaping rule is how one of them
 * quietly stops being reversible.
 */

/** Escapes a store key into a flat filename. */
export function fileNameFor(key: string): string {
  return `${encodeURIComponent(key)}.blob`;
}

/** Inverse of {@link fileNameFor}; `undefined` for anything we did not write. */
export function keyForFileName(name: string): string | undefined {
  if (!name.endsWith('.blob')) return undefined;
  try {
    return decodeURIComponent(name.slice(0, -'.blob'.length));
  } catch {
    // A malformed percent-escape means the file was not written by us.
    // Ignoring it is safer than surfacing a key that no `get` could resolve.
    return undefined;
  }
}
