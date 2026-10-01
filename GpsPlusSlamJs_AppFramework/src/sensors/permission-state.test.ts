/**
 * Why this test matters: `permission-state.ts` is the ONE prompt-free
 * Permissions-API query (DEC-H3). The permission checker builds its
 * geolocation and camera rows on it, and the globe lab reads it to decide
 * whether a position may be asked for at load at all (round-5 plan
 * 2026-10-01-0945 §3.1). A wrong mapping would either prompt nobody who
 * granted (no fly-in to the user) or treat iOS's 'prompt' as granted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  geolocationPermissionState,
  queryPermissionState,
} from './permission-state';

const withQuery = (query: (d: { name: string }) => unknown) =>
  vi.stubGlobal('navigator', {
    geolocation: {},
    permissions: { query: vi.fn(query) },
  });

describe('permission-state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['granted', 'denied', 'prompt'] as const)(
    "passes the browser's %s through",
    async (state) => {
      withQuery(() => Promise.resolve({ state }));
      expect(await queryPermissionState('camera')).toBe(state);
      expect(await geolocationPermissionState()).toBe(state);
    }
  );

  // iOS Safari answers 'prompt' for geolocation even where the page may
  // ask; it must stay 'prompt' (never read as granted), so a caller that
  // must not prompt at load does not locate.
  it("keeps iOS's 'prompt' a prompt, and asks for the geolocation name", async () => {
    withQuery(() => Promise.resolve({ state: 'prompt' }));
    expect(await geolocationPermissionState()).toBe('prompt');
    expect(navigator.permissions.query).toHaveBeenCalledWith({
      name: 'geolocation',
    });
  });

  it("is 'unknown' without navigator.permissions, without a navigator, or without geolocation", async () => {
    vi.stubGlobal('navigator', { geolocation: {}, permissions: undefined });
    expect(await geolocationPermissionState()).toBe('unknown');
    vi.stubGlobal('navigator', undefined);
    expect(await geolocationPermissionState()).toBe('unknown');
    vi.stubGlobal('navigator', {
      geolocation: undefined,
      permissions: { query: () => Promise.resolve({ state: 'granted' }) },
    });
    expect(await geolocationPermissionState()).toBe('unknown');
  });

  it("is 'unknown' when the query rejects, throws, or answers something else", async () => {
    withQuery(() => Promise.reject(new TypeError('unsupported name')));
    expect(await geolocationPermissionState()).toBe('unknown');
    withQuery(() => {
      throw new TypeError('sync throw');
    });
    expect(await geolocationPermissionState()).toBe('unknown');
    withQuery(() => Promise.resolve({ state: 'maybe' }));
    expect(await geolocationPermissionState()).toBe('unknown');
    withQuery(() => Promise.resolve(null));
    expect(await geolocationPermissionState()).toBe('unknown');
  });
});
