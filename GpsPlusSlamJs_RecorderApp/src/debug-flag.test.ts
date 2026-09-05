/**
 * Why this test matters: the debug flag is the ONLY thing standing between an
 * ordinary user and a developer surface drawn over the camera feed. An
 * accidental default of "on", or a parser that read `?debug=0` as on, would
 * put the settings wheel on every phone; a parser that missed `?debug=True`
 * would make a tester think the build was broken.
 */

import { describe, expect, it } from 'vitest';
import { debugUiEnabledFromSearch } from './debug-flag';

describe('debugUiEnabledFromSearch', () => {
  it('is OFF without the parameter, and off is the default for everyone', () => {
    expect(debugUiEnabledFromSearch('')).toBe(false);
    expect(debugUiEnabledFromSearch('?scenario=x')).toBe(false);
  });

  it('turns ON for 1 and true, case-insensitively and with stray whitespace', () => {
    for (const s of [
      '?debug=1',
      '?debug=true',
      '?debug=True',
      '?debug=%20TRUE%20',
      '?x=1&debug=1',
    ]) {
      expect(debugUiEnabledFromSearch(s), s).toBe(true);
    }
  });

  it('stays OFF for every other value - 0, false, yes, empty', () => {
    for (const s of [
      '?debug=0',
      '?debug=false',
      '?debug=yes',
      '?debug=',
      '?debug',
    ]) {
      expect(debugUiEnabledFromSearch(s), s).toBe(false);
    }
  });
});
