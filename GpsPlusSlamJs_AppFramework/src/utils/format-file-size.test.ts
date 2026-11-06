/**
 * Unit tests for formatFileSize utility.
 *
 * Why this test matters:
 * User Feedback Issue #3 (2026-02-06): ZIP stats on summary screen need
 * human-readable file sizes. This utility formats byte counts into
 * KB/MB/GB strings for display.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { formatFileSize } from './format-file-size.js';

describe('formatFileSize', () => {
  it('should format 0 bytes', () => {
    // Why: Edge case — empty ZIP or missing data
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('should format bytes below 1 KB', () => {
    // Why: Very small files should show in bytes
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(999)).toBe('999 B');
  });

  it('should format kilobytes', () => {
    // Why: Small sessions produce KB-range ZIPs
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10240)).toBe('10.0 KB');
  });

  it('should format megabytes', () => {
    // Why: Most recording sessions produce MB-range ZIPs
    expect(formatFileSize(1048576)).toBe('1.0 MB');
    expect(formatFileSize(23_500_000)).toBe('22.4 MB');
    expect(formatFileSize(104857600)).toBe('100.0 MB');
  });

  it('should format gigabytes', () => {
    // Why: Long sessions with many images could reach GB
    expect(formatFileSize(1073741824)).toBe('1.0 GB');
    expect(formatFileSize(2_500_000_000)).toBe('2.3 GB');
  });

  it('should handle negative values gracefully', () => {
    // Why: Defensive — should not crash on invalid input
    expect(formatFileSize(-1)).toBe('0 B');
  });
});
