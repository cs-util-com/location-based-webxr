/**
 * Unit tests for the sync + AbsCompass HUD status rows.
 *
 * Moved from `hud.test.ts` when the panel was extracted (simplify-loop
 * Area 5 stage B, 2026-07-24), with one deliberate change: the
 * `initUI(...)` calls and the full minimal HUD DOM were dropped — the rows
 * own their elements and read none of `initUI`'s state, so the tests now
 * pin that independence too. Assertions are unchanged. The sync tests keep
 * the `vi.resetModules()` + dynamic-import pattern because the module holds
 * the refresh-timer interval as module state.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { loadFullIndexHtml } from '../test-utils/html-fixtures.js';

describe('updateSyncStatus', () => {
  /**
   * Helper to set up DOM with sync status elements.
   */
  function setupDOMWithSyncStatus(): void {
    document.body.innerHTML = `
      <div id="sync-info" class="hidden">
        <span id="sync-status">--</span>
      </div>
    `;
  }

  /**
   * Why this test matters:
   * When sync is active and working, the user should see last sync time.
   */
  it('displays last sync time when sync is successful', async () => {
    vi.resetModules();
    setupDOMWithSyncStatus();

    const { updateSyncStatus } = await import('./hud-status-rows.js');

    updateSyncStatus({
      state: 'active',
      lastSyncTime: Date.now() - 30_000, // 30 seconds ago
      lastError: null,
    });

    const syncInfo = document.getElementById('sync-info')!;
    const syncStatus = document.getElementById('sync-status')!;

    expect(syncInfo.classList.contains('hidden')).toBe(false);
    expect(syncStatus.textContent).toContain('30s ago');
    expect(syncStatus.classList.contains('text-green-400')).toBe(true);
  });

  /**
   * Why this test matters:
   * When sync fails, the user should see an error indicator.
   */
  it('displays error message when sync fails', async () => {
    vi.resetModules();
    setupDOMWithSyncStatus();

    const { updateSyncStatus } = await import('./hud-status-rows.js');

    updateSyncStatus({
      state: 'active',
      lastSyncTime: Date.now() - 60_000,
      lastError: 'Write failed',
    });

    const syncStatus = document.getElementById('sync-status')!;

    expect(syncStatus.textContent).toContain('⚠️');
    expect(syncStatus.classList.contains('text-yellow-400')).toBe(true);
  });

  /**
   * Why this test matters:
   * When sync is idle, the UI should be hidden.
   */
  it('hides sync info when state is idle', async () => {
    vi.resetModules();
    setupDOMWithSyncStatus();

    const { updateSyncStatus } = await import('./hud-status-rows.js');

    // First show it
    updateSyncStatus({
      state: 'active',
      lastSyncTime: Date.now(),
      lastError: null,
    });

    // Then set to idle
    updateSyncStatus({
      state: 'idle',
      lastSyncTime: null,
      lastError: null,
    });

    const syncInfo = document.getElementById('sync-info')!;
    expect(syncInfo.classList.contains('hidden')).toBe(true);
  });

  /**
   * Why this test matters:
   * When never synced, should show pending indicator.
   */
  it('shows pending when active but never synced', async () => {
    vi.resetModules();
    setupDOMWithSyncStatus();

    const { updateSyncStatus } = await import('./hud-status-rows.js');

    updateSyncStatus({
      state: 'active',
      lastSyncTime: null,
      lastError: null,
    });

    const syncInfo = document.getElementById('sync-info')!;
    const syncStatus = document.getElementById('sync-status')!;

    expect(syncInfo.classList.contains('hidden')).toBe(false);
    expect(syncStatus.textContent).toContain('pending');
  });

  // Bug 3 (SPA audit): The relative time display ("30s ago") must tick forward
  // even without new sync events. Currently it freezes at the value computed
  // when updateSyncStatus was last called.
  it('should refresh relative time periodically without new sync calls', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    setupDOMWithSyncStatus();

    const { updateSyncStatus } = await import('./hud-status-rows.js');

    const syncTime = Date.now();
    updateSyncStatus({
      state: 'active',
      lastSyncTime: syncTime,
      lastError: null,
    });

    const syncStatus = document.getElementById('sync-status')!;
    expect(syncStatus.textContent).toBe('0s ago');

    // Advance 30 seconds (3 refresh intervals) — no new sync event fires
    vi.advanceTimersByTime(30_000);

    expect(syncStatus.textContent).toBe('30s ago');

    vi.useRealTimers();
  });

  // Bug 3: Timer must be cleaned up when sync becomes idle
  it('should stop relative time refresh when state is idle', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    setupDOMWithSyncStatus();

    const { updateSyncStatus } = await import('./hud-status-rows.js');

    updateSyncStatus({
      state: 'active',
      lastSyncTime: Date.now(),
      lastError: null,
    });

    // Go idle — should stop the timer
    updateSyncStatus({
      state: 'idle',
      lastSyncTime: null,
      lastError: null,
    });

    // Advance time — should not throw or cause issues
    vi.advanceTimersByTime(30_000);

    const syncInfo = document.getElementById('sync-info')!;
    expect(syncInfo.classList.contains('hidden')).toBe(true);

    vi.useRealTimers();
  });
});

/**
 * Why these tests matter: this row is the field tester's only on-device signal
 * that a recording is actually capturing the independent-north sensor before
 * collecting many sessions. It must show a green "ok" when active, a gray
 * "unavailable" with the reason off Chrome Android, and a yellow error — and the
 * element must actually ship in index.html.
 */
describe('AbsCompass status row', () => {
  function setupDOMWithAbsCompass(): void {
    document.body.innerHTML = `
      <div id="abs-compass-info" class="hidden">
        <span id="abs-compass-status">--</span>
      </div>
    `;
  }

  it('shows the live magnetic heading in degrees when active (matches v3 demo)', async () => {
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus } = await import('./hud-status-rows.js');
    setAbsCompassStatus({ state: 'active', headingDeg: 123.4 });

    const info = document.getElementById('abs-compass-info')!;
    const status = document.getElementById('abs-compass-status')!;
    expect(info.classList.contains('hidden')).toBe(false);
    expect(status.textContent).toBe('123°');
    expect(status.classList.contains('text-green-400')).toBe(true);
  });

  it('falls back to "ok" when active but the phone is level (heading undefined)', async () => {
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus } = await import('./hud-status-rows.js');
    setAbsCompassStatus({ state: 'active', headingDeg: null });

    const status = document.getElementById('abs-compass-status')!;
    expect(status.textContent).toBe('ok');
    expect(status.classList.contains('text-green-400')).toBe(true);
  });

  it('falls back to "ok" (not "NaN°") when active but the heading is NaN', async () => {
    // `typeof NaN === 'number'` is true, so a guard on `typeof` alone would
    // render `Math.round(NaN)` → "NaN°". A degenerate quaternion can yield a
    // NaN heading; the row must degrade to "ok" rather than show "NaN°".
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus } = await import('./hud-status-rows.js');
    setAbsCompassStatus({ state: 'active', headingDeg: Number.NaN });

    const status = document.getElementById('abs-compass-status')!;
    expect(status.textContent).toBe('ok');
    expect(status.classList.contains('text-green-400')).toBe(true);
  });

  it('shows gray "unavailable" with the reason (iOS/Safari/desktop path)', async () => {
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus } = await import('./hud-status-rows.js');
    setAbsCompassStatus({ state: 'unavailable', reason: 'no sensor' });

    const status = document.getElementById('abs-compass-status')!;
    expect(status.textContent).toBe('unavailable (no sensor)');
    expect(status.classList.contains('text-gray-400')).toBe(true);
  });

  it('shows a yellow error with the reason', async () => {
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus } = await import('./hud-status-rows.js');
    setAbsCompassStatus({ state: 'error', reason: 'NotReadableError' });

    const status = document.getElementById('abs-compass-status')!;
    expect(status.textContent).toContain('NotReadableError');
    expect(status.classList.contains('text-yellow-400')).toBe(true);
  });

  it('hideAbsCompass hides the row', async () => {
    setupDOMWithAbsCompass();
    const { setAbsCompassStatus, hideAbsCompass } =
      await import('./hud-status-rows.js');
    setAbsCompassStatus({ state: 'active' });
    hideAbsCompass();
    expect(
      document.getElementById('abs-compass-info')!.classList.contains('hidden')
    ).toBe(true);
  });

  it('index.html ships the AbsCompass status element', () => {
    const full = loadFullIndexHtml();
    expect(full).toContain('id="abs-compass-status"');
  });
});

describe('QR status row', () => {
  function setupDOMWithQrStatus(): void {
    document.body.innerHTML = `
      <div id="qr-info" class="hidden">
        <span id="qr-status">--</span>
      </div>
    `;
  }

  /**
   * Why this test matters: the recorder used to show NOTHING for QR, so a
   * field session where the detector never fired looked exactly like one
   * where it did. The row existing is the whole point of it; a test that
   * only checked the text would pass on a row that stays hidden.
   */
  it('reveals the row and writes the line', async () => {
    setupDOMWithQrStatus();
    const { setQrStatus } = await import('./hud-status-rows.js');

    setQrStatus('2 codes · 0.21 m');

    expect(
      document.getElementById('qr-info')!.classList.contains('hidden')
    ).toBe(false);
    expect(document.getElementById('qr-status')!.textContent).toBe(
      '2 codes · 0.21 m'
    );
  });

  /**
   * Why this test matters: null means "QR detection is off", which must hide
   * the row rather than render an empty one — an empty row reads as "detection
   * is on and finding nothing", the exact confusion this row exists to remove.
   */
  it('hides the row for a null line without clearing the last text', async () => {
    setupDOMWithQrStatus();
    const { setQrStatus } = await import('./hud-status-rows.js');

    setQrStatus('1 code');
    setQrStatus(null);

    expect(
      document.getElementById('qr-info')!.classList.contains('hidden')
    ).toBe(true);
  });

  /**
   * Why this test matters: these helpers run from HUD wiring that also runs on
   * pages without the QR row (the replay view). Throwing there would take down
   * the whole HUD update for an element that is legitimately absent.
   */
  it('is inert when the elements are absent', async () => {
    document.body.innerHTML = '';
    const { setQrStatus, hideQrStatus } = await import('./hud-status-rows.js');

    expect(() => {
      setQrStatus('anything');
    }).not.toThrow();
    expect(() => {
      hideQrStatus();
    }).not.toThrow();
  });

  it('hideQrStatus hides the row', async () => {
    setupDOMWithQrStatus();
    const { setQrStatus, hideQrStatus } = await import('./hud-status-rows.js');
    setQrStatus('1 code');
    hideQrStatus();
    expect(
      document.getElementById('qr-info')!.classList.contains('hidden')
    ).toBe(true);
  });

  it('index.html ships the QR status element', () => {
    const full = loadFullIndexHtml();
    expect(full).toContain('id="qr-status"');
  });
});
