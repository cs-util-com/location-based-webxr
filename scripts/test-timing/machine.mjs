// Pure machine-identity builders for the timing recordings. The fingerprint
// and label end up in the versioned docs/test-timings.md, so the raw
// hostname must never appear in them — only a short sha256 prefix
// (pseudonymization: a common hostname is still dictionary-guessable from
// the hash, but it no longer reads as plain text in the repo). CPU model
// and core count stay readable because they carry the actual "are these
// seconds comparable?" signal.

import { createHash } from 'node:crypto';

/**
 * First 8 hex chars of the sha256 of the hostname. 8 chars keep the md
 * compact; collisions across the handful of dev machines that will ever
 * write the same file are not a realistic concern.
 * @param {string} hostname
 * @returns {string}
 */
export function anonymizeHostname(hostname) {
  return createHash('sha256').update(hostname).digest('hex').slice(0, 8);
}

/**
 * Pure fingerprint builder: `host-hash|cpu-slug|logical-cores` (plan §5;
 * hostname hashed since 2026-07-10, followups doc §4).
 * @param {string} hostname
 * @param {string} cpuModel
 * @param {number} cores
 * @returns {string}
 */
export function machineFingerprint(hostname, cpuModel, cores) {
  const slug = cpuModel
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${anonymizeHostname(hostname)}|${slug}|${cores}`;
}

/**
 * Human-readable label for the md header — same hash prefix as the
 * fingerprint so header and JSON entries stay correlatable.
 * @param {string} hostname
 * @param {string} cpuModel
 * @param {number} cores
 * @returns {string}
 */
export function machineLabel(hostname, cpuModel, cores) {
  return `${anonymizeHostname(hostname)} (${cpuModel}, ${cores} threads)`;
}
