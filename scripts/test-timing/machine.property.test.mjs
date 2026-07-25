// Why this test matters: the anonymization contract is "no raw hostname in
// the versioned md, ever" — not just for the hostnames we thought of. The
// properties pin that for ARBITRARY hostnames the hash prefix is always
// 8 lowercase hex chars, and that the HOST SLOT of fingerprint and label
// carries exactly that hash and nothing else. (A naive "output never
// contains the hostname" check is wrong: short hostnames like "re" occur in
// static text such as "threads", and the cpu model may coincidentally
// contain the hostname — neither is a leak from the host slot.)
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  anonymizeHostname,
  machineFingerprint,
  machineLabel,
} from './machine.mjs';

describe('machine anonymization properties', () => {
  it('hash prefix is always 8 lowercase hex chars, for any string', () => {
    fc.assert(
      fc.property(fc.string(), (hostname) => {
        expect(anonymizeHostname(hostname)).toMatch(/^[0-9a-f]{8}$/);
      })
    );
  });

  it('the host slot of fingerprint and label is exactly the hash', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9-]{1,63}$/),
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.integer({ min: 1, max: 256 }),
        (hostname, cpuModel, cores) => {
          const hash = anonymizeHostname(hostname);
          const fingerprint = machineFingerprint(hostname, cpuModel, cores);
          const label = machineLabel(hostname, cpuModel, cores);
          expect(fingerprint.split('|')[0]).toBe(hash);
          expect(label.slice(0, label.indexOf(' ('))).toBe(hash);
        }
      )
    );
  });
});
