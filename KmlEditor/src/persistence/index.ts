export { PersistenceServiceImpl, sanitizeFilename } from './service';
export * from './errors';
export type { } from '../contracts/persistence'; // re-export for consumers

import { PersistenceServiceImpl } from './service';
import { IPersistenceService } from '../contracts/persistence';

/**
 * Factory function. Returns a new PersistenceServiceImpl.
 * Callers should hold exactly one instance per editor session.
 */
export function createPersistenceService(): IPersistenceService {
  return new PersistenceServiceImpl();
}
