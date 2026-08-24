/**
 * A *permanent* per-read failure marker: an unknown id, an entry missing from
 * a central directory, a decode error, or a 4xx on a range read (expired
 * signed link, file gone). Consumers (e.g. a ref-counted asset provider) fail
 * these immediately — retrying cannot fix them. Any other rejection from a
 * byte-source backing is treated as transient and eligible for retry.
 */
export class StructuralReadError extends Error {
  override readonly name = 'StructuralReadError';
}
