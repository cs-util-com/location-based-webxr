/**
 * OSM bridge — wires `gps-plus-slam-osm` to browser storage.
 *
 * `gps-plus-slam-osm` is an **optional peer dependency**: only this subpath
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
