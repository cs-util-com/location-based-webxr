/**
 * The 2D summary map's shell, unit tests.
 *
 * Why these tests matter: the shell moved out of the RecorderApp (DEC-H3,
 * Tour Viewer authoring plan 2026-09-28-0953 §3.3) so a second app - the
 * Tour Viewer's summary after Finish - draws its map through the SAME
 * code. What each app adds (the Recorder's ref points, the Tour Viewer's
 * codes and pins) goes through `drawExtra`, and how it frames the view is
 * its choice (`fitPoints`). These pin both seams and the lifecycle a
 * second consumer depends on: null instead of a throw, the extra layers
 * removed on destroy, no timer firing on a removed map. The Recorder's
 * own `summary-map.test.ts` keeps covering the composed Recorder map.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockMap {
  remove: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  setView: ReturnType<typeof vi.fn>;
  getZoom: ReturnType<typeof vi.fn>;
  invalidateSize: ReturnType<typeof vi.fn>;
}

const calls = vi.hoisted(() => ({
  maps: [] as unknown[],
  tileLayers: [] as { url: unknown; options: unknown }[],
  polylines: [] as { latLngs: unknown; options: unknown }[],
  bounds: [] as unknown[][],
}));

vi.mock('leaflet', () => {
  const layer = () => ({
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  });
  return {
    default: {
      map: vi.fn(() => {
        const map: MockMap = {
          remove: vi.fn(),
          fitBounds: vi.fn(),
          setView: vi.fn().mockReturnThis(),
          getZoom: vi.fn().mockReturnValue(17),
          invalidateSize: vi.fn(),
        };
        calls.maps.push(map);
        return map;
      }),
      tileLayer: vi.fn((url: unknown, options: unknown) => {
        calls.tileLayers.push({ url, options });
        return layer();
      }),
      polyline: vi.fn((latLngs: unknown, options: unknown) => {
        calls.polylines.push({ latLngs, options });
        return layer();
      }),
      circle: vi.fn(() => layer()),
      marker: vi.fn(() => layer()),
      divIcon: vi.fn(() => ({})),
      latLngBounds: vi.fn((points: unknown[]) => {
        const list = [...points];
        calls.bounds.push(list);
        return {
          isValid: () => list.length > 0,
          extend: vi.fn((p: unknown) => {
            list.push(p);
          }),
        };
      }),
    },
  };
});

import { OSM_TILE_URL } from '../utils/osm-tiles.js';
import {
  createSummaryMapShell,
  SUMMARY_MAP_FIT_PADDING,
  SUMMARY_MAP_INITIAL_ZOOM,
  type SummaryMapShellOptions,
} from './summary-map-shell.js';

function lastMap(): MockMap {
  return calls.maps.at(-1) as MockMap;
}

const PATHS = {
  rawGpsPath: [
    { lat: 50, lng: 8 },
    { lat: 50.001, lng: 8.001 },
  ],
  fusedPath: [{ lat: 50.0005, lng: 8.0005 }],
};

const FULLSCREEN: NonNullable<SummaryMapShellOptions['fullscreen']> = {
  expandedClasses: ['map--expanded'],
  inlineClasses: ['map--inline'],
  buttonClassName: 'map-toggle',
  hiddenClass: 'is-hidden',
};

let container: HTMLElement;

beforeEach(() => {
  calls.maps.length = 0;
  calls.tileLayers.length = 0;
  calls.polylines.length = 0;
  calls.bounds.length = 0;
  container = document.createElement('div');
  container.classList.add('map--inline');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  vi.useRealTimers();
});

describe('createSummaryMapShell', () => {
  it('refuses a missing container or nothing to show with null, not a throw', () => {
    expect(createSummaryMapShell(null, PATHS)).toBeNull();
    expect(
      createSummaryMapShell(container, { rawGpsPath: [], fusedPath: [] })
    ).toBeNull();
  });

  it('draws the OSM tiles and the trajectory through the shared overlay', () => {
    const shell = createSummaryMapShell(container, PATHS);
    expect(shell).not.toBeNull();
    expect(calls.tileLayers.map((t) => t.url)).toEqual([OSM_TILE_URL]);
    // Raw and fused: the shared `drawMapData` polylines.
    expect(calls.polylines).toHaveLength(2);
  });

  it('centres on the final position by default, as the Recorder always did', () => {
    createSummaryMapShell(container, PATHS);
    expect(lastMap().setView).toHaveBeenCalledWith(
      [50.001, 8.001],
      SUMMARY_MAP_INITIAL_ZOOM
    );
    expect(lastMap().fitBounds).not.toHaveBeenCalled();
  });

  it('frames the given points instead when asked, even with no path at all', () => {
    // A tour edited on the page has codes and pins but no walk: the map
    // must still show them.
    const fitPoints = [
      { lat: 47.5, lng: 8.7 },
      { lat: 47.501, lng: 8.701 },
    ];
    const shell = createSummaryMapShell(
      container,
      { rawGpsPath: [], fusedPath: [] },
      { fitPoints }
    );
    expect(shell).not.toBeNull();
    expect(lastMap().fitBounds).toHaveBeenCalledTimes(1);
    const [bounds, options] = lastMap().fitBounds.mock.calls[0] as [
      unknown,
      { padding: unknown; maxZoom: unknown },
    ];
    expect(bounds).toBeDefined();
    expect(options.padding).toEqual(SUMMARY_MAP_FIT_PADDING);
    expect(options.maxZoom).toBeGreaterThan(SUMMARY_MAP_INITIAL_ZOOM);
  });

  it('hands the map to drawExtra and removes its layers on destroy', () => {
    const extra = { remove: vi.fn() };
    const drawExtra = vi.fn(() => [extra as never]);
    const shell = createSummaryMapShell(container, PATHS, { drawExtra });
    expect(drawExtra).toHaveBeenCalledWith(lastMap());
    shell!.destroy();
    expect(extra.remove).toHaveBeenCalledTimes(1);
    expect(lastMap().remove).toHaveBeenCalledTimes(1);
    // Idempotent.
    shell!.destroy();
    expect(lastMap().remove).toHaveBeenCalledTimes(1);
  });

  it('returns null when an app layer throws, rather than a half-drawn map', () => {
    const shell = createSummaryMapShell(container, PATHS, {
      drawExtra: () => {
        throw new Error('bad marker');
      },
    });
    expect(shell).toBeNull();
  });

  it('never resizes a map that was destroyed before its first resize', () => {
    vi.useFakeTimers();
    const shell = createSummaryMapShell(container, PATHS);
    shell!.destroy();
    vi.advanceTimersByTime(1000);
    expect(lastMap().invalidateSize).not.toHaveBeenCalled();
  });

  // Why this test matters (Tour Viewer M3a/M3b review #1): an INLINE
  // position beats every stylesheet rule, so the shell writing
  // `position: relative` onto a container the app had already positioned
  // made the app's fullscreen rule (`position: fixed`) lose - the Tour
  // Viewer's enlarged map collapsed to 0 px. Only a container that is
  // still static (nothing positions it) gets the inline fallback.
  it('leaves a container the app positions alone, so its fullscreen rule can win', () => {
    const style = document.createElement('style');
    style.textContent = '.positioned { position: relative; }';
    document.head.appendChild(style);
    try {
      container.classList.add('positioned');
      createSummaryMapShell(container, PATHS, { fullscreen: FULLSCREEN });
      expect(container.style.position).toBe('');
    } finally {
      style.remove();
    }
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    try {
      createSummaryMapShell(plain, PATHS, { fullscreen: FULLSCREEN });
      expect(plain.style.position).toBe('relative');
    } finally {
      plain.remove();
    }
  });

  it('adds no fullscreen buttons unless the app styles them', () => {
    createSummaryMapShell(container, PATHS);
    expect(container.querySelector('button')).toBeNull();
  });

  it('toggles the app-given classes and button visibility on expand and collapse', () => {
    const shell = createSummaryMapShell(container, PATHS, {
      fullscreen: FULLSCREEN,
    })!;
    const expand = container.querySelector<HTMLElement>(
      '[data-testid="btn-map-expand"]'
    )!;
    const collapse = container.querySelector<HTMLElement>(
      '[data-testid="btn-map-collapse"]'
    )!;
    expect(expand.className).toContain('map-toggle');
    expect(collapse.classList.contains('is-hidden')).toBe(true);

    expand.click();
    expect(shell.isExpanded()).toBe(true);
    expect(container.classList.contains('map--expanded')).toBe(true);
    expect(container.classList.contains('map--inline')).toBe(false);
    expect(expand.classList.contains('is-hidden')).toBe(true);
    expect(collapse.classList.contains('is-hidden')).toBe(false);

    collapse.click();
    expect(shell.isExpanded()).toBe(false);
    expect(container.classList.contains('map--inline')).toBe(true);

    shell.destroy();
    expect(container.querySelector('button')).toBeNull();
    // Safe after destroy.
    shell.expand();
    expect(shell.isExpanded()).toBe(false);
  });
});
