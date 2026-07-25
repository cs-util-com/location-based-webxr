// Why this test matters: docs/test-timings.md is versioned, so whatever the
// fingerprint/label builders emit ends up in git forever. The raw hostname
// must never appear there (privacy leak, followups doc §4) — only its short
// sha256 prefix — while cpu model and core count stay readable. These tests
// pin the exact hash-prefix format so the one-time history migration
// (MSI → f936c64e) keeps matching future recordings on the same machine.
import { describe, it, expect } from 'vitest';
import {
  anonymizeHostname,
  machineFingerprint,
  machineLabel,
} from './machine.mjs';

describe('anonymizeHostname', () => {
  it('returns the first 8 hex chars of the sha256 of the hostname', () => {
    // sha256('MSI') = f936c64e... — pinned so the migrated history in
    // docs/test-timings.md stays same-machine-comparable with new runs.
    expect(anonymizeHostname('MSI')).toBe('f936c64e');
  });

  it('is deterministic and never echoes the input', () => {
    expect(anonymizeHostname('DESKTOP-ABC123')).toBe(
      anonymizeHostname('DESKTOP-ABC123')
    );
    expect(anonymizeHostname('DESKTOP-ABC123')).not.toContain('DESKTOP');
    expect(anonymizeHostname('DESKTOP-ABC123')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('machineFingerprint', () => {
  it('builds hash8|cpu-slug|cores without the raw hostname', () => {
    expect(
      machineFingerprint(
        'MSI',
        '11th Gen Intel(R) Core(TM) i7-1185G7 @ 3.00GHz',
        8
      )
    ).toBe('f936c64e|11th-Gen-Intel-R-Core-TM-i7-1185G7-3-00G|8');
  });

  it('slugs the cpu model to at most 40 chars without leading/trailing dashes', () => {
    expect(machineFingerprint('host', '  weird++cpu  ', 4)).toBe(
      `${anonymizeHostname('host')}|weird-cpu|4`
    );
  });
});

describe('machineLabel', () => {
  it('uses the hostname hash, keeping cpu model and thread count readable', () => {
    expect(machineLabel('MSI', 'SomeCpu', 8)).toBe(
      'f936c64e (SomeCpu, 8 threads)'
    );
  });
});
