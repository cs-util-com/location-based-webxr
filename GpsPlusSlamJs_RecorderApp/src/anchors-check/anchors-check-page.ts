/**
 * DOM side of `ar-anchors-check.html`: the start button, the status line,
 * the jump list and the "Copy log" button. Builds the view the session
 * module talks to and wires the two buttons.
 *
 * Sidecar: `anchors-check-page.ts.md`.
 */

import { copyWithFeedback } from 'gps-plus-slam-app-framework/utils/copy-with-feedback';
import { countsLine, onScreenLine } from './anchor-jump-report';
import type {
  AnchorsCheckController,
  AnchorsCheckView,
  StartState,
} from './anchors-check-session';

export const COPY_LABELS = Object.freeze({
  idle: 'Copy log',
  busy: 'Copying...',
  done: 'Log copied',
});

export const COPY_FAILED_ADVICE =
  'Could not copy the log. It is shown below: select it and copy it by hand.';

const START_LABELS: Record<StartState, string> = {
  checking: 'Start AR',
  unavailable: 'AR not available',
  idle: 'Start AR',
  starting: 'Starting AR...',
  running: 'Stop AR',
};

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const node = doc.getElementById(id);
  if (node === null)
    throw new Error(`#${id} missing from ar-anchors-check.html`);
  return node as T;
}

export interface AnchorsCheckPageDeps {
  readonly document: Document;
  /** Normally `navigator.clipboard.writeText`; undefined where absent. */
  readonly copyText: ((text: string) => Promise<void>) | undefined;
}

export interface AnchorsCheckPage {
  readonly view: AnchorsCheckView;
  /** The element WebXR's dom-overlay shows over the camera image. */
  readonly overlayRoot: HTMLElement;
  /** Wire the buttons to `controller`; returns the copy promise for tests. */
  connect(controller: AnchorsCheckController): {
    copy(): Promise<boolean>;
  };
}

export function createAnchorsCheckPage(
  deps: AnchorsCheckPageDeps
): AnchorsCheckPage {
  const doc = deps.document;
  const overlayRoot = byId(doc, 'ac-overlay');
  const panel = byId(doc, 'ac-panel');
  const start = byId<HTMLButtonElement>(doc, 'ac-start');
  const copyButton = byId<HTMLButtonElement>(doc, 'ac-copy');
  const status = byId(doc, 'ac-status');
  const counts = byId(doc, 'ac-counts');
  const list = byId(doc, 'ac-verdicts');
  const logBox = byId<HTMLTextAreaElement>(doc, 'ac-log');

  // A tap on the panel is a button press, not a placement in the AR scene.
  panel.addEventListener('beforexrselect', (event) => event.preventDefault());

  const view: AnchorsCheckView = {
    status(text, tone) {
      status.textContent = text;
      status.classList.toggle('ac-status-error', tone === 'error');
    },
    setStartState(state) {
      start.textContent = START_LABELS[state];
      start.disabled =
        state === 'checking' || state === 'unavailable' || state === 'starting';
    },
    showEvents(events) {
      counts.textContent = countsLine(events);
      list.replaceChildren(
        ...events.map((e) => {
          const item = doc.createElement('li');
          item.textContent = onScreenLine(e);
          return item;
        })
      );
      // Oldest first: keep the newest entry in view.
      list.scrollTop = list.scrollHeight;
    },
  };

  return {
    view,
    overlayRoot,
    connect(controller) {
      const copy = (): Promise<boolean> => {
        const text = controller.log();
        return copyWithFeedback(copyButton, text, deps.copyText, {
          busy: COPY_LABELS.busy,
          done: COPY_LABELS.done,
          failed: COPY_LABELS.idle,
          onDone: () => {
            logBox.hidden = true;
          },
          onFailed: () => {
            view.status(COPY_FAILED_ADVICE, 'error');
            logBox.value = text;
            logBox.hidden = false;
          },
        });
      };
      start.addEventListener('click', () => void controller.toggle());
      copyButton.addEventListener('click', () => void copy());
      return { copy };
    },
  };
}
