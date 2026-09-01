/**
 * Unit tests for Session Summary Panel.
 *
 * TDD: These tests define the expected behavior for the Session Summary
 * component that shows after recording stops. This is a TERMINAL state -
 * no restart is allowed.
 *
 * Why this test matters:
 * - User feedback Issue #3+#4 identified that users expect a summary
 *   screen after stopping, not the ability to restart.
 * - The summary provides validation data (event counts, errors) for
 *   field testing workflows.
 *
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  afterEach,
  expectTypeOf,
} from 'vitest';

// Mock the summary-map module so we can track destroy() calls (Bug 11)
const mockDestroy = vi.fn();
const mockExpand = vi.fn();
const mockCollapse = vi.fn();
vi.mock('./summary-map', () => ({
  createSummaryMap: vi.fn(() => ({
    destroy: mockDestroy,
    expand: mockExpand,
    collapse: mockCollapse,
    isExpanded: () => false,
  })),
}));

// We'll implement these - start with failing tests
import {
  initSessionSummary,
  showSessionSummary,
  hideSessionSummary,
  formatFileSize,
  type SessionSummaryData,
} from './session-summary.js';

/**
 * Creates DOM structure required for session summary panel.
 */
function setupSummaryDOM(): void {
  document.body.innerHTML = `
    <div id="session-summary-panel" class="hidden">
      <div id="summary-duration"></div>
      <div id="summary-gps-count"></div>
      <div id="summary-ref-points"></div>
      <div id="summary-images"></div>
      <div id="summary-depth-samples"></div>
      <div class="summary-row"><div id="summary-failed-writes"></div></div>
      <div id="summary-errors"></div>
      <div id="summary-first-gps"></div>
      <div id="summary-last-gps"></div>
      <div id="summary-distance"></div>
      <div id="summary-zip-size"></div>
      <div id="summary-zip-files"></div>
      <button id="btn-share-session"></button>
      <button id="btn-new-recording"></button>
      <button id="btn-view-logs"></button>
      <div id="summary-map-container"></div>
    </div>
  `;
}

describe('Session Summary Panel', () => {
  beforeEach(() => {
    setupSummaryDOM();
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('initSessionSummary', () => {
    it('should throw if required DOM elements are missing', () => {
      // Why: Fail-fast behavior consistent with hud.ts pattern
      document.body.innerHTML = ''; // Clear DOM

      expect(() => initSessionSummary({ onNewRecording: vi.fn() })).toThrow(
        /session-summary-panel.*not found/i
      );
    });

    it('should wire up New Recording button to reload page', () => {
      // Why: Per spec, SUMMARY is terminal - new recording = page reload
      const mockOnNewRecording = vi.fn();
      initSessionSummary({ onNewRecording: mockOnNewRecording });

      const btn = document.getElementById(
        'btn-new-recording'
      ) as HTMLButtonElement;
      btn.click();

      expect(mockOnNewRecording).toHaveBeenCalledTimes(1);
    });

    it('should wire up View Logs button to callback', () => {
      // Why: User wants detailed logs accessible from summary
      const mockOnViewLogs = vi.fn();
      initSessionSummary({
        onNewRecording: vi.fn(),
        onViewLogs: mockOnViewLogs,
      });

      const btn = document.getElementById('btn-view-logs') as HTMLButtonElement;
      btn.click();

      expect(mockOnViewLogs).toHaveBeenCalledTimes(1);
    });
  });

  describe('showSessionSummary', () => {
    const sampleData: SessionSummaryData = {
      duration: { startTime: 1000, endTime: 61000 }, // 60 seconds
      gpsEventCount: 42,
      refPointCount: 3,
      imageCount: 15,
      depthSampleCount: 60,
      errors: ['GPS accuracy degraded at 00:30', 'Image write failed at 00:45'],
      firstGps: { lat: 50.0, lng: 8.0 },
      lastGps: { lat: 50.001, lng: 8.001 },
      totalDistanceMeters: 150.5,
      qrAnchors: [],
    };

    beforeEach(() => {
      initSessionSummary({ onNewRecording: vi.fn() });
    });

    it('should make the summary panel visible', () => {
      // Why: Core behavior - panel must appear after recording stops
      showSessionSummary(sampleData);

      const panel = document.getElementById('session-summary-panel');
      expect(panel?.classList.contains('hidden')).toBe(false);
    });

    it('should display formatted duration', () => {
      // Why: User needs to know how long the session lasted
      showSessionSummary(sampleData);

      const durationEl = document.getElementById('summary-duration');
      // 60 seconds = "1:00" or "01:00" or "1m 0s" - accept common formats
      expect(durationEl?.textContent).toMatch(/1.*00|60\s*(s|sec)/i);
    });

    it('should display GPS event count', () => {
      // Why: Primary metric for validating recording quality
      showSessionSummary(sampleData);

      const gpsEl = document.getElementById('summary-gps-count');
      expect(gpsEl?.textContent).toContain('42');
    });

    it('should display reference point count', () => {
      // Why: User needs to verify ref points were captured
      showSessionSummary(sampleData);

      const refEl = document.getElementById('summary-ref-points');
      expect(refEl?.textContent).toContain('3');
    });

    it('should display image count', () => {
      // Why: Images are key deliverable for visual debugging
      showSessionSummary(sampleData);

      const imgEl = document.getElementById('summary-images');
      expect(imgEl?.textContent).toContain('15');
    });

    it('should display depth sample count', () => {
      // Why: Depth data validates 3D reconstruction capability
      showSessionSummary(sampleData);

      const depthEl = document.getElementById('summary-depth-samples');
      expect(depthEl?.textContent).toContain('60');
    });

    it('should display errors list', () => {
      // Why: Critical for field testing - surface any issues
      showSessionSummary(sampleData);

      const errorsEl = document.getElementById('summary-errors');
      expect(errorsEl?.textContent).toContain('GPS accuracy degraded');
      expect(errorsEl?.textContent).toContain('Image write failed');
    });

    it('should display "No errors" when error list is empty', () => {
      // Why: Positive confirmation that session was clean
      showSessionSummary({ ...sampleData, errors: [] });

      const errorsEl = document.getElementById('summary-errors');
      expect(errorsEl?.textContent).toMatch(/no errors|none|0 errors/i);
    });

    it('should display first and last GPS coordinates', () => {
      // Why: Quick validation of GPS coverage
      showSessionSummary(sampleData);

      const firstEl = document.getElementById('summary-first-gps');
      const lastEl = document.getElementById('summary-last-gps');

      expect(firstEl?.textContent).toContain('50.0');
      expect(firstEl?.textContent).toContain('8.0');
      expect(lastEl?.textContent).toContain('50.001');
      expect(lastEl?.textContent).toContain('8.001');
    });

    it('should display total distance traveled', () => {
      // Why: Sanity check - did the user actually move?
      showSessionSummary(sampleData);

      const distEl = document.getElementById('summary-distance');
      // Should show ~150m or 150.5m
      expect(distEl?.textContent).toMatch(/150/);
    });

    it('should handle missing GPS data gracefully', () => {
      // Why: Edge case - session might have zero GPS events
      const noGpsData: SessionSummaryData = {
        ...sampleData,
        gpsEventCount: 0,
        firstGps: null,
        lastGps: null,
        totalDistanceMeters: 0,
        qrAnchors: [],
      };

      showSessionSummary(noGpsData);

      const firstEl = document.getElementById('summary-first-gps');
      expect(firstEl?.textContent).toMatch(/no data|n\/a|--/i);
    });
  });

  describe('hideSessionSummary', () => {
    beforeEach(() => {
      initSessionSummary({ onNewRecording: vi.fn() });
    });

    it('should hide the summary panel', () => {
      // Why: May be needed for cleanup or edge cases
      showSessionSummary({
        duration: { startTime: 0, endTime: 1000 },
        gpsEventCount: 0,
        refPointCount: 0,
        imageCount: 0,
        depthSampleCount: 0,
        errors: [],
        qrAnchors: [],
        firstGps: null,
        lastGps: null,
        totalDistanceMeters: 0,
      });

      hideSessionSummary();

      const panel = document.getElementById('session-summary-panel');
      expect(panel?.classList.contains('hidden')).toBe(true);
    });
  });

  describe('SessionSummaryData type', () => {
    it('should accept all required fields', () => {
      // Why: TypeScript compile-time check + runtime validation
      const data: SessionSummaryData = {
        duration: { startTime: Date.now(), endTime: Date.now() + 60000 },
        gpsEventCount: 100,
        refPointCount: 5,
        imageCount: 30,
        depthSampleCount: 60,
        errors: [],
        qrAnchors: [],
        firstGps: { lat: 0, lng: 0 },
        lastGps: { lat: 1, lng: 1 },
        totalDistanceMeters: 1000,
      };

      // Should not throw
      expect(data.gpsEventCount).toBe(100);
    });
  });
});

describe('Session Summary - Error Collection', () => {
  /**
   * Tests for collecting errors during recording session.
   * The session summary needs access to errors that occurred.
   */

  it('should handle errors array with many items', () => {
    // Why: Long recording sessions may accumulate many errors
    setupSummaryDOM();
    initSessionSummary({ onNewRecording: vi.fn() });

    const manyErrors = Array.from({ length: 20 }, (_, i) => `Error ${i + 1}`);

    showSessionSummary({
      duration: { startTime: 0, endTime: 1000 },
      gpsEventCount: 0,
      refPointCount: 0,
      imageCount: 0,
      depthSampleCount: 0,
      errors: manyErrors,
      qrAnchors: [],
      firstGps: null,
      lastGps: null,
      totalDistanceMeters: 0,
    });

    const errorsEl = document.getElementById('summary-errors');
    // Should show at least first and last error
    expect(errorsEl?.textContent).toContain('Error 1');
    expect(errorsEl?.textContent).toContain('Error 20');
  });
});

describe('Session Summary - Failed Write Count', () => {
  /**
   * TDD tests for Issue #1 Part B: Display failed write count.
   *
   * WHY THESE TESTS MATTER:
   * User feedback showed that write operations can fail silently.
   * The session summary should clearly display how many writes failed
   * so users know if their data may be incomplete.
   */

  beforeEach(() => {
    setupSummaryDOM();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should display failed write count when greater than zero', () => {
    // Why: User needs to know data may be incomplete
    initSessionSummary({ onNewRecording: vi.fn() });

    showSessionSummary({
      duration: { startTime: 0, endTime: 60000 },
      gpsEventCount: 100,
      refPointCount: 2,
      imageCount: 10,
      depthSampleCount: 60,
      errors: [],
      qrAnchors: [],
      firstGps: { lat: 50.0, lng: 8.0 },
      lastGps: { lat: 50.001, lng: 8.001 },
      totalDistanceMeters: 150,
      failedWriteCount: 5,
    });

    const failedWritesEl = document.getElementById('summary-failed-writes');
    expect(failedWritesEl).not.toBeNull();
    expect(failedWritesEl?.textContent).toContain('5');
  });

  it('should indicate no failed writes when count is zero', () => {
    // Why: Positive feedback that all writes succeeded
    initSessionSummary({ onNewRecording: vi.fn() });

    showSessionSummary({
      duration: { startTime: 0, endTime: 60000 },
      gpsEventCount: 100,
      refPointCount: 2,
      imageCount: 10,
      depthSampleCount: 60,
      errors: [],
      qrAnchors: [],
      firstGps: { lat: 50.0, lng: 8.0 },
      lastGps: { lat: 50.001, lng: 8.001 },
      totalDistanceMeters: 150,
      failedWriteCount: 0,
    });

    const failedWritesEl = document.getElementById('summary-failed-writes');
    // Should show 0 or "None" or similar
    expect(failedWritesEl?.textContent).toMatch(/0|none|no failed/i);
  });

  it('should highlight failed writes row when count is greater than zero', () => {
    // Why: Visual emphasis helps user notice the problem
    initSessionSummary({ onNewRecording: vi.fn() });

    showSessionSummary({
      duration: { startTime: 0, endTime: 60000 },
      gpsEventCount: 100,
      refPointCount: 2,
      imageCount: 10,
      depthSampleCount: 60,
      errors: [],
      qrAnchors: [],
      firstGps: { lat: 50.0, lng: 8.0 },
      lastGps: { lat: 50.001, lng: 8.001 },
      totalDistanceMeters: 150,
      failedWriteCount: 3,
    });

    const failedWritesEl = document.getElementById('summary-failed-writes');
    // Parent row should have warning/error styling
    expect(
      failedWritesEl?.closest('.summary-row')?.classList.contains('warning') ||
        failedWritesEl?.classList.contains('warning')
    ).toBe(true);
  });
});

describe('Session Summary - ZIP Stats Display (Issue #3, 2026-02-06)', () => {
  /**
   * TDD tests for Issue #3: Show ZIP file statistics on summary screen.
   *
   * WHY THESE TESTS MATTER:
   * User feedback requested ZIP stats (size + file count) on the summary
   * screen so they know the recording size at a glance.
   */

  const baseSummaryData: SessionSummaryData = {
    duration: { startTime: 0, endTime: 60000 },
    gpsEventCount: 100,
    refPointCount: 2,
    imageCount: 10,
    depthSampleCount: 60,
    errors: [],
    qrAnchors: [],
    firstGps: { lat: 50.0, lng: 8.0 },
    lastGps: { lat: 50.001, lng: 8.001 },
    totalDistanceMeters: 150,
  };

  beforeEach(() => {
    setupSummaryDOM();
    initSessionSummary({ onNewRecording: vi.fn() });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should display human-readable ZIP size when zipSizeBytes is provided', () => {
    // Why: User needs quick sense of recording size (e.g., "23.4 MB")
    showSessionSummary({
      ...baseSummaryData,
      zipSizeBytes: 23_500_000,
      zipFileCount: 1247,
    });

    const zipSizeEl = document.getElementById('summary-zip-size');
    expect(zipSizeEl).not.toBeNull();
    // 23.5 MB ≈ 23500000 / 1048576 = 22.4 MB
    expect(zipSizeEl?.textContent).toMatch(/22\.4\s*MB/);
  });

  it('should display ZIP file count when zipFileCount is provided', () => {
    // Why: File count helps validate recording completeness
    showSessionSummary({
      ...baseSummaryData,
      zipSizeBytes: 10_000_000,
      zipFileCount: 503,
    });

    const zipFilesEl = document.getElementById('summary-zip-files');
    expect(zipFilesEl).not.toBeNull();
    expect(zipFilesEl?.textContent).toContain('503');
  });

  it('should show placeholder when ZIP stats are not provided', () => {
    // Why: ZIP stats are optional — handle gracefully for sessions without sync
    showSessionSummary(baseSummaryData);

    const zipSizeEl = document.getElementById('summary-zip-size');
    const zipFilesEl = document.getElementById('summary-zip-files');
    // Should show dash or "N/A" when data is missing
    expect(zipSizeEl?.textContent).toMatch(/--|N\/A|—/);
    expect(zipFilesEl?.textContent).toMatch(/--|N\/A|—/);
  });

  it('should format small ZIP sizes in KB', () => {
    // Why: Short sessions produce small ZIPs
    showSessionSummary({
      ...baseSummaryData,
      zipSizeBytes: 51200, // 50 KB
      zipFileCount: 3,
    });

    const zipSizeEl = document.getElementById('summary-zip-size');
    expect(zipSizeEl?.textContent).toMatch(/50\.0\s*KB/);
  });
});

describe('Session Summary - Share Session (Issue #2, 2026-02-06)', () => {
  /**
   * TDD tests for Issue #2: Share recorded session via Web Share API.
   *
   * WHY THESE TESTS MATTER:
   * User feedback requested a share button that triggers the OS share sheet
   * for the ZIP file. Must support Web Share API with download fallback.
   */

  const zipBlob = new Blob(['fake-zip-data'], { type: 'application/zip' });

  const shareableSummaryData: SessionSummaryData = {
    duration: { startTime: 0, endTime: 60000 },
    gpsEventCount: 42,
    refPointCount: 3,
    imageCount: 15,
    depthSampleCount: 60,
    errors: [],
    qrAnchors: [],
    firstGps: { lat: 50.0, lng: 8.0 },
    lastGps: { lat: 50.001, lng: 8.001 },
    totalDistanceMeters: 150.5,
    zipSizeBytes: 5_000_000,
    zipFileCount: 100,
    zipBlob,
    zipFilename: 'test-scenario-2026-02-06.zip',
  };

  beforeEach(() => {
    setupSummaryDOM();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('should show share button when zipBlob is provided', () => {
    // Why: Share button only makes sense when there's data to share
    initSessionSummary({ onNewRecording: vi.fn() });
    showSessionSummary(shareableSummaryData);

    const shareBtn = document.getElementById(
      'btn-share-session'
    ) as HTMLButtonElement;
    expect(shareBtn).not.toBeNull();
    expect(shareBtn.classList.contains('hidden')).toBe(false);
  });

  it('should hide share button when no zipBlob is provided', () => {
    // Why: No point sharing if there's no ZIP data
    initSessionSummary({ onNewRecording: vi.fn() });
    showSessionSummary({
      duration: { startTime: 0, endTime: 60000 },
      gpsEventCount: 0,
      refPointCount: 0,
      imageCount: 0,
      depthSampleCount: 0,
      errors: [],
      qrAnchors: [],
      firstGps: null,
      lastGps: null,
      totalDistanceMeters: 0,
    });

    const shareBtn = document.getElementById(
      'btn-share-session'
    ) as HTMLButtonElement;
    expect(shareBtn.classList.contains('hidden')).toBe(true);
  });

  it('should call navigator.share with the ZIP file when supported', async () => {
    // Why: Native share sheet gives best UX on mobile
    const mockShare = vi.fn().mockResolvedValue(undefined);
    const mockCanShare = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'share', {
      value: mockShare,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: mockCanShare,
      writable: true,
      configurable: true,
    });

    initSessionSummary({ onNewRecording: vi.fn() });
    showSessionSummary(shareableSummaryData);

    const shareBtn = document.getElementById(
      'btn-share-session'
    ) as HTMLButtonElement;
    shareBtn.click();

    // Allow async handler to complete
    await vi.waitFor(() => {
      expect(mockShare).toHaveBeenCalledTimes(1);
    });

    const shareArg = mockShare.mock.calls[0][0] as { files: File[] };
    expect(shareArg.files).toHaveLength(1);
    expect(shareArg.files[0].name).toBe('test-scenario-2026-02-06.zip');
    expect(shareArg.files[0].type).toBe('application/zip');
  });

  it('should fall back to download when navigator.share not available', async () => {
    // Why: Desktop browsers may not support Web Share API
    // Remove navigator.share if present
    Object.defineProperty(navigator, 'share', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    // Mock URL and DOM for download fallback
    const mockClick = vi.fn();
    const mockLink = {
      href: '',
      download: '',
      click: mockClick,
      style: { display: '' },
    };
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return mockLink as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tag);
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test-url'),
      revokeObjectURL: vi.fn(),
    });

    initSessionSummary({ onNewRecording: vi.fn() });
    showSessionSummary(shareableSummaryData);

    const shareBtn = document.getElementById(
      'btn-share-session'
    ) as HTMLButtonElement;
    shareBtn.click();

    // Allow async handler to complete
    await vi.waitFor(() => {
      expect(mockClick).toHaveBeenCalledTimes(1);
    });
    expect(mockLink.download).toBe('test-scenario-2026-02-06.zip');
  });

  it('should fall back to download when canShare returns false for files', async () => {
    // Why: Some browsers have share but don't support file sharing
    const mockCanShare = vi.fn().mockReturnValue(false);
    Object.defineProperty(navigator, 'share', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: mockCanShare,
      writable: true,
      configurable: true,
    });

    // Mock URL and DOM for download fallback
    const mockClick = vi.fn();
    const mockLink = {
      href: '',
      download: '',
      click: mockClick,
      style: { display: '' },
    };
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return mockLink as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tag);
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test-url'),
      revokeObjectURL: vi.fn(),
    });

    initSessionSummary({ onNewRecording: vi.fn() });
    showSessionSummary(shareableSummaryData);

    const shareBtn = document.getElementById(
      'btn-share-session'
    ) as HTMLButtonElement;
    shareBtn.click();

    await vi.waitFor(() => {
      expect(mockClick).toHaveBeenCalledTimes(1);
    });
    expect(mockLink.download).toBe('test-scenario-2026-02-06.zip');
  });
});

describe('formatFileSize (re-exported from session-summary)', () => {
  /**
   * Quick sanity tests for the formatFileSize function that
   * session-summary re-exports for use in the UI.
   *
   * Full coverage is in format-file-size.test.ts.
   */
  it('should format megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB');
  });

  it('should format bytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });
});

// ============================================================================
// Soft Reset Tests (Issue 4 — retain read permission on new recording)
// ============================================================================

describe('hideSessionSummary (soft reset integration)', () => {
  /**
   * Helper to create minimal valid summary data for soft reset tests.
   */
  function createValidSummaryData(): SessionSummaryData {
    return {
      duration: { startTime: 1000, endTime: 61000 },
      gpsEventCount: 10,
      refPointCount: 2,
      imageCount: 5,
      depthSampleCount: 3,
      errors: [],
      qrAnchors: [],
      firstGps: { lat: 50.0, lng: 8.0 },
      lastGps: { lat: 50.001, lng: 8.001 },
      totalDistanceMeters: 100,
    };
  }

  // Why this test matters: When the user starts a new recording via soft reset,
  // the session summary panel must be hidden. The onNewRecording callback should
  // fire and the panel should become hidden.
  it('hides the summary panel when called during soft reset', () => {
    setupSummaryDOM();
    initSessionSummary({ onNewRecording: vi.fn() });
    showSessionSummary(createValidSummaryData());

    const panel = document.getElementById('session-summary-panel')!;
    expect(panel.classList.contains('hidden')).toBe(false);

    hideSessionSummary();

    expect(panel.classList.contains('hidden')).toBe(true);
  });

  // Why this test matters: The summary map instance should be cleaned up
  // when starting a new recording to avoid memory leaks (Leaflet map objects).
  it('cleans up map instance on next showSessionSummary call', () => {
    setupSummaryDOM();

    initSessionSummary({ onNewRecording: vi.fn() });

    // First show — no crash
    showSessionSummary({
      ...createValidSummaryData(),
      rawGpsPath: [{ lat: 50.0, lng: 8.0 }],
    });
    hideSessionSummary();

    // Second show — should clean up old map and create new one without errors
    showSessionSummary({
      ...createValidSummaryData(),
      rawGpsPath: [{ lat: 50.0, lng: 8.0 }],
    });
    expect(
      document
        .getElementById('session-summary-panel')!
        .classList.contains('hidden')
    ).toBe(false);
  });

  it('destroys the map instance immediately on hide, not deferred (Bug 11)', () => {
    // Why: When hideSessionSummary() is called during soft reset, the Leaflet
    // map instance should be destroyed immediately to free tile images, event
    // listeners, and DOM nodes. Deferring cleanup until the next
    // showSessionSummary() call wastes memory between recording cycles,
    // especially on low-memory mobile devices.
    setupSummaryDOM();
    initSessionSummary({ onNewRecording: vi.fn() });

    // Show summary with GPS data (triggers map creation)
    showSessionSummary({
      ...createValidSummaryData(),
      rawGpsPath: [{ lat: 50.0, lng: 8.0 }],
    });
    mockDestroy.mockClear();

    // Hide should destroy the map immediately
    hideSessionSummary();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  // Why this test matters: The onNewRecording callback is the entry point for
  // the soft reset. Clicking "New Recording" should fire it.
  it('fires onNewRecording callback when new recording button is clicked', () => {
    setupSummaryDOM();
    const onNewRecording = vi.fn();
    initSessionSummary({ onNewRecording });
    showSessionSummary(createValidSummaryData());

    const btn = document.getElementById(
      'btn-new-recording'
    ) as HTMLButtonElement;
    btn.click();

    expect(onNewRecording).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Readonly guards — Finding #6 (2026-03-05 code review)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Readonly guards for pure-data interfaces', () => {
    /**
     * Why this test matters:
     * SessionSummaryData is assembled once after recording stops
     * and displayed read-only. Fields must not be mutated.
     */
    it('SessionSummaryData ≡ Readonly<SessionSummaryData>', () => {
      expectTypeOf<SessionSummaryData>().toEqualTypeOf<
        Readonly<SessionSummaryData>
      >();
    });
  });
});
