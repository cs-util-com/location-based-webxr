/**
 * OSM bridge — wires `osm-h3` to browser storage.
 *
 * `osm-h3` is an **optional peer dependency**: only this subpath
 * needs it, so a framework consumer that does not want OSM never installs it.
 */

export type {
  OsmBlobStore,
  OsmBlobStoreWarn,
  OpfsOsmBlobStoreOptions,
} from './opfs-osm-blob-store.js';
export {
  OSM_STORE_DIR,
  OpfsOsmBlobStore,
  fileNameFor,
  keyForFileName,
  openOsmStoreDirectory,
} from './opfs-osm-blob-store.js';
export type { OpenOsmStoreOptions } from './open-osm-store.js';
export { openPersistentOsmStore } from './open-osm-store.js';
