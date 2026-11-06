/**
 * HTML Fixture Loader for Tests
 *
 * Loads HTML fragments from index.html to ensure tests use the same markup
 * as production. This eliminates duplication and prevents tests from passing
 * when the production HTML has diverged.
 *
 * Uses jsdom for robust HTML parsing instead of regex-based extraction.
 *
 * @see html-fixtures.md for usage examples
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Cache the loaded HTML to avoid repeated file reads
let cachedIndexHtml: string | null = null;
// Cache the parsed JSDOM to avoid re-parsing the same HTML
let cachedDom: InstanceType<typeof JSDOM> | null = null;
// Cache the loaded app CSS to avoid repeated file reads
let cachedAppCss: string | null = null;

/**
 * Get the path to index.html relative to this file.
 * Works in both ESM and test environments.
 */
function getIndexHtmlPath(): string {
  // In vitest with ESM, import.meta.url gives the file URL
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // Navigate from src/test-utils to project root
  return resolve(currentDir, '../../index.html');
}

/**
 * Get the path to the app CSS file (styles/app.css).
 */
function getAppCssPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, '../../styles/app.css');
}

/**
 * Load the full index.html content.
 * Cached after first load for performance.
 */
function loadIndexHtml(): string {
  if (cachedIndexHtml === null) {
    cachedIndexHtml = readFileSync(getIndexHtmlPath(), 'utf-8');
  }
  return cachedIndexHtml;
}

/**
 * Get or create the parsed JSDOM instance.
 * Cached after first parse for performance.
 */
function getParsedDom(): InstanceType<typeof JSDOM> {
  if (cachedDom === null) {
    cachedDom = new JSDOM(loadIndexHtml());
  }
  return cachedDom;
}

/**
 * Load the full contents of index.html as a raw string.
 * Useful for validating CSS rules, meta tags, and other structural invariants
 * that live outside of individual elements.
 *
 * @returns Full HTML source of index.html
 */
export function loadFullIndexHtml(): string {
  return loadIndexHtml();
}

/**
 * Load the app CSS file (styles/app.css) as a raw string.
 * Extracted from the inline <style> block in index.html (Phase 0 refactoring).
 * Useful for validating CSS rules like z-index, safe-area insets, and tap targets.
 *
 * @returns Full CSS source of styles/app.css
 */
export function loadAppCss(): string {
  if (cachedAppCss === null) {
    cachedAppCss = readFileSync(getAppCssPath(), 'utf-8');
  }
  return cachedAppCss;
}

/**
 * Extract an element and its contents from index.html by ID.
 * Uses jsdom for robust HTML parsing.
 *
 * @param elementId - The ID of the element to extract (without #)
 * @returns The outer HTML of the element
 * @throws Error if element is not found
 *
 * @example
 * const modalHtml = extractElementById('settings-modal');
 * document.body.innerHTML = modalHtml;
 */
export function extractElementById(elementId: string): string {
  const dom = getParsedDom();
  const element = dom.window.document.getElementById(elementId);

  if (!element) {
    throw new Error(
      `Element with id="${elementId}" not found in index.html. ` +
        `Make sure the element exists in the production HTML.`
    );
  }

  return element.outerHTML;
}

/**
 * Extract multiple elements by ID and concatenate their HTML.
 *
 * @param elementIds - Array of element IDs to extract
 * @returns Combined outer HTML of all elements
 *
 * @example
 * const html = extractElementsById(['settings-modal', 'setup-modal']);
 * document.body.innerHTML = html;
 */
function extractElementsById(elementIds: string[]): string {
  return elementIds.map((id) => extractElementById(id)).join('\n');
}

/**
 * Load settings modal HTML from index.html.
 * Convenience wrapper for the common test case.
 *
 * @returns The outer HTML of the settings-modal element
 */
export function loadSettingsModalHtml(): string {
  return extractElementById('settings-modal');
}

/**
 * Load settings button HTML from index.html.
 * Convenience wrapper for the common test case.
 *
 * @returns The outer HTML of the btn-settings element
 */
export function loadSettingsButtonHtml(): string {
  return extractElementById('btn-settings');
}

/**
 * Load both settings modal and the setup modal header (which contains the settings button).
 * This provides the full context needed for settings modal tests.
 *
 * @returns Combined HTML for settings modal testing
 */
export function loadSettingsTestFixture(): string {
  return extractElementsById(['settings-modal', 'setup-modal']);
}
