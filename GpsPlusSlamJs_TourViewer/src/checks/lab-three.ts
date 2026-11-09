/**
 * The app's own three.js, as a module a kind's folder can import by name:
 * the item lab maps the bare specifier `three` to this module's URL
 * (`labThreeMap`), so a kind's `import { Mesh } from "three"` gets the very
 * instance the lab renders with, never a second copy. Loaded by a dynamic
 * import, so a build gives it its own chunk and `import.meta.url` is that
 * chunk's.
 *
 * @see lab-three.ts.md
 */
export * from "three";

/** This module's URL: what `three` resolves to in a kind's folder. */
export const LAB_THREE_URL: string = import.meta.url;
