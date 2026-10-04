/**
 * The alignment-timing page: the DOM behaviour behind `alignment-timing.html`.
 *
 * Everything the page needs from the outside world is injected - the document,
 * the file reader, the recording loader, the store factory, the clock, the
 * clipboard - so the whole page is exercised in jsdom against fakes, including
 * both halves of every async action. The entry point
 * (`alignment-timing-main.ts`) does nothing but supply the real ones.
 *
 * NOTHING LEAVES THE DEVICE. There is no `fetch`, no beacon, no storage write
 * anywhere in this module or its siblings: the result is printed, and the owner
 * copies it. A guard test asserts the absence rather than trusting this
 * comment.
 */

import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';
import {
  runAlignmentTiming,
  type AlignmentTimingProgress,
} from './alignment-timing-loop';
import {
  planTimingReplay,
  createPassFactory,
  type TimingStoreLike,
} from './alignment-timing-run';
import {
  TIMING_ARMS,
  HISTORY_LADDER,
  REPEAT_OPTIONS,
  DEFAULT_REPEATS,
  WARMUP_PASSES,
  type TimingArm,
} from './alignment-timing-arms';
import {
  buildTimingReport,
  buildTimingTable,
  type AlignmentTimingReport,
  type TimingEnvironment,
  type TimingTable,
} from './alignment-timing-report';

export interface AlignmentTimingPageDeps {
  readonly document: Document;
  /** Read the chosen file's bytes. */
  readonly readFile: (file: File) => Promise<Uint8Array>;
  /** Parse a recording zip into its migrated action stream. */
  readonly loadRecording: (
    bytes: Uint8Array
  ) => Promise<readonly RecordedAction[]>;
  /** Fresh, empty store - one per timing pass. */
  readonly createStore: () => TimingStoreLike;
  readonly environment: TimingEnvironment;
  /** Monotonic millisecond clock (`performance.now` in the browser). */
  readonly now: () => number;
  /** Wall clock, ISO-formatted, stamped into the report. */
  readonly nowIso: () => string;
  readonly arms?: readonly TimingArm[];
  readonly ladder?: readonly number[];
  readonly repeatOptions?: readonly number[];
  readonly defaultRepeats?: number;
  readonly warmups?: number;
  /** Hands the UI thread back between passes so the page keeps repainting. */
  readonly yieldControl?: () => Promise<void>;
  readonly copyText?: (text: string) => Promise<void>;
}

const RUN_LABEL = 'Run timing';

function required(doc: Document, id: string): HTMLElement {
  const node = doc.getElementById(id);
  if (!node) {
    throw new Error(`alignment-timing.html is missing #${id}`);
  }
  return node;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Default yield: a macrotask, so the browser gets a chance to paint. */
function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function renderTable(host: HTMLElement, table: TimingTable): void {
  const doc = host.ownerDocument;
  host.replaceChildren();
  const el = doc.createElement('table');
  const caption = doc.createElement('caption');
  caption.textContent = table.caption;
  el.append(caption);
  const thead = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  for (const label of table.header) {
    const th = doc.createElement('th');
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = doc.createElement('tbody');
  for (const row of table.rows) {
    const tr = doc.createElement('tr');
    for (const cell of row) {
      const td = doc.createElement('td');
      td.textContent = cell;
      tr.append(td);
    }
    tbody.append(tr);
  }
  el.append(thead, tbody);
  host.append(el);
}

function renderTotals(host: HTMLElement, table: TimingTable): void {
  renderTable(host, {
    caption: table.caption,
    header: ['arm', 'total ms (median)', 'total ms (min)', 'vs shipped'],
    rows: table.totals,
    totals: [],
  });
}

/**
 * Wire the page. Called once, at load.
 *
 * @throws Error when the markup is missing an element this module drives - a
 *   loud failure at load is better than a button that silently does nothing on
 *   a device nobody can attach a debugger to.
 */
export function wireAlignmentTimingPage(deps: AlignmentTimingPageDeps): void {
  const doc = deps.document;
  const arms = deps.arms ?? TIMING_ARMS;
  const ladder = deps.ladder ?? HISTORY_LADDER;
  const repeatOptions = deps.repeatOptions ?? REPEAT_OPTIONS;
  const warmups = deps.warmups ?? WARMUP_PASSES;
  const yieldControl = deps.yieldControl ?? defaultYield;
  const copyText =
    deps.copyText ?? ((text: string) => navigator.clipboard.writeText(text));

  const fileInput = required(doc, 'timing-file') as HTMLInputElement;
  const repeatsSelect = required(doc, 'timing-repeats') as HTMLSelectElement;
  const runButton = required(doc, 'timing-run') as HTMLButtonElement;
  const copyButton = required(doc, 'timing-copy') as HTMLButtonElement;
  const statusBox = required(doc, 'timing-status');
  const parametersBox = required(doc, 'timing-parameters');
  const deviceBox = required(doc, 'timing-device');
  const tableBox = required(doc, 'timing-table');
  const totalsBox = required(doc, 'timing-totals');
  const jsonBox = required(doc, 'timing-json');

  let selectedFile: File | null = null;
  let lastJson = '';

  function setStatus(text: string, isError = false): void {
    statusBox.textContent = text;
    statusBox.className = isError
      ? 'timing-status timing-status-error'
      : 'timing-status';
  }

  for (const option of repeatOptions) {
    const node = doc.createElement('option');
    node.value = String(option);
    node.textContent = String(option);
    repeatsSelect.append(node);
  }
  repeatsSelect.value = String(deps.defaultRepeats ?? DEFAULT_REPEATS);

  // Printed BEFORE any run: a run that fails halfway must still leave the
  // reader with the parameters and the device it was attempted on.
  parametersBox.textContent =
    `History ladder ${ladder.join(' / ')} plus the full recording; ` +
    `${arms.length} arms interleaved within every pass; ` +
    `${warmups} warm-up pass per arm, discarded; median and minimum of the ` +
    `timed passes. Arms: ${arms.map((a) => a.label).join(', ')}.`;
  const cores = deps.environment.hardwareConcurrency;
  deviceBox.textContent =
    `${deps.environment.userAgent} | hardwareConcurrency ` +
    `${cores === null ? 'unavailable' : String(cores)} | app ` +
    `${deps.environment.appVersion} | library ` +
    `${deps.environment.libraryVersion} | framework ` +
    `${deps.environment.frameworkVersion} | build ` +
    `${deps.environment.buildCommit}`;

  fileInput.addEventListener('change', () => {
    selectedFile = fileInput.files?.[0] ?? null;
    runButton.disabled = selectedFile === null;
    setStatus(
      selectedFile
        ? `${selectedFile.name} chosen. Keep the screen on and the device still.`
        : 'Choose a recording zip to begin.'
    );
  });

  runButton.addEventListener('click', () => {
    void runTiming();
  });

  copyButton.addEventListener('click', () => {
    void copyJson();
  });

  async function runTiming(): Promise<void> {
    const file = selectedFile;
    if (!file) return;
    runButton.disabled = true;
    runButton.textContent = 'Running…';
    setStatus('Reading the recording…');
    try {
      const bytes = await deps.readFile(file);
      const actions = await deps.loadRecording(bytes);
      const plan = planTimingReplay(actions);
      if (plan.fixCount === 0) {
        throw new Error(
          'That recording carries no GPS fixes, so there is nothing to time.'
        );
      }
      const repeats = Number(repeatsSelect.value);
      const createPass = createPassFactory({
        plan,
        arms,
        createStore: deps.createStore,
      });
      const result = await runAlignmentTiming({
        armIds: arms.map((a) => a.id),
        fixCount: plan.fixCount,
        ladder,
        repeats,
        warmups,
        createPass,
        now: deps.now,
        yieldControl,
        onProgress: (progress: AlignmentTimingProgress) => {
          setStatus(
            `Pass ${progress.completedPasses} of ${progress.totalPasses} ` +
              `(${progress.armId}${progress.warmup ? ', warm-up' : ''}) - ` +
              `${plan.fixCount} fixes each.`
          );
        },
      });
      const report = buildTimingReport({
        result,
        arms,
        environment: deps.environment,
        recording: {
          fileName: file.name,
          fixCount: plan.fixCount,
          durationSeconds: plan.durationSeconds,
        },
        generatedAt: deps.nowIso(),
      });
      render(report);
      setStatus(
        `Done. ${plan.fixCount} fixes, ${arms.length} arms, ${repeats} timed ` +
          `passes each after ${warmups} warm-up. Copy the JSON below.`
      );
    } catch (error) {
      setStatus(`Timing run failed: ${messageOf(error)}`, true);
    } finally {
      runButton.disabled = false;
      runButton.textContent = RUN_LABEL;
    }
  }

  function render(report: AlignmentTimingReport): void {
    const table = buildTimingTable(report);
    renderTable(tableBox, table);
    renderTotals(totalsBox, table);
    lastJson = JSON.stringify(report, null, 2);
    jsonBox.textContent = lastJson;
  }

  async function copyJson(): Promise<void> {
    if (!lastJson) {
      setStatus('Nothing to copy yet - run the timing first.', true);
      return;
    }
    try {
      await copyText(lastJson);
      setStatus('Copied the JSON to the clipboard.');
    } catch (error) {
      setStatus(
        `Copy failed (${messageOf(error)}). Select the JSON below and copy it by hand.`,
        true
      );
    }
  }
}
