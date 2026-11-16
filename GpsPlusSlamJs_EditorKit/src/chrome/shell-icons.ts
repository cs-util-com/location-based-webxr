/**
 * The 3D view's shell icons: small line drawings on a 16-unit grid, drawn
 * in the current text colour, as SVG elements. Constant markup only:
 * nothing from a tour ever reaches it.
 *
 * @see shell-icons.ts.md
 */

const PATHS = {
  pin: '<rect x="2.5" y="2.5" width="11" height="5" rx="1"/><path d="M8 7.5v6.5"/>',
  photo:
    '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2.5 11.2l3.4-3.4 3 3 2-2 2.6 2.6"/><circle cx="10.6" cy="6" r="1"/>',
  text: '<rect x="3" y="2" width="10" height="12" rx="1"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/>',
  model:
    '<path d="M8 1.8l5.5 3v6.4L8 14.2 2.5 11.2V4.8z"/><path d="M2.5 4.8L8 7.8l5.5-3M8 7.8v6.4"/>',
  frame:
    '<path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"/><circle cx="8" cy="8" r="1.6"/>',
  top: '<path d="M8 1.5v4M6 3.5l2 2 2-2"/><path d="M2 10.5l6-2.5 6 2.5-6 3z"/>',
  undo: '<path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.5 6.5h7a3.6 3.6 0 0 1 0 7.2H6.5"/>',
  redo: '<path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5h-7a3.6 3.6 0 0 0 0 7.2h3"/>',
  help: '<circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.7-.8 1.3v.3"/><circle cx="8" cy="11.6" r=".35"/>',
  qr: '<rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><path d="M9.5 9.5h2v2h-2zM12.5 12.5h1.5v1.5h-1.5zM9.5 13.5h1M13.5 9.5h.5"/>',
  down: '<path d="M4.5 6.5L8 10l3.5-3.5"/>',
  right: '<path d="M6.5 4.5L10 8l-3.5 3.5"/>',
  up: '<path d="M4.5 9.5L8 6l3.5 3.5"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  station:
    '<circle cx="8" cy="8" r="5.6"/><path d="M8 4.2v4.6"/><circle cx="8" cy="10.6" r=".5"/>',
  pencil:
    '<path d="M10.6 2.9l2.5 2.5-7.6 7.6-3.1.6.6-3.1z"/><path d="M9.2 4.3l2.5 2.5"/>',
  check: '<path d="M3 8.5l3.2 3.2L13 4.8"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  unlock:
    '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/>',
  walk: '<path d="M2.5 13.5c2.2-.6 2.4-3.6 4.8-4.2s3.2-3.4 5.2-5"/><path d="M10.6 12h4M12.6 10v4"/>',
  eye: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  folder:
    '<path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.4 1.6H13a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  video:
    '<rect x="2" y="3.5" width="9" height="9" rx="1"/><path d="M11 7l3-2v6l-3-2"/>',
  audio:
    '<path d="M2.5 6h2.6L8.5 3v10L5.1 10H2.5z"/><path d="M10.8 5.6a3 3 0 0 1 0 4.8M12.4 3.8a5.5 5.5 0 0 1 0 8.4"/>',
  character:
    '<circle cx="8" cy="4.6" r="2.3"/><path d="M3.8 14c0-2.9 1.9-5.2 4.2-5.2s4.2 2.3 4.2 5.2"/>',
  story: '<path d="M1.8 4h4.1l1.4 1.6h6.9v7.4H1.8z"/>',
  storyOpen:
    '<path d="M1.8 13V4h4.1l1.4 1.6h5.6v1.7"/><path d="M1.8 13l1.7-5.7h11.2L13 13z"/>',
  choice: '<path d="M8 14V8.6L4 3.6M8 8.6l4-5M3 6.2V3.2h3M13 6.2V3.2h-3"/>',
  quiz: '<circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.7-.8 1.3v.3"/><circle cx="8" cy="11.6" r=".35"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  // A long text's writer (long-text-writer.ts): its toolbar, its note, the
  // inspector's width and the three ways a visitor meets the text.
  ul: '<circle cx="3.3" cy="4.5" r=".8"/><circle cx="3.3" cy="8" r=".8"/><circle cx="3.3" cy="11.5" r=".8"/><path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7"/>',
  ol: '<path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7"/><path d="M2.4 3.6l1.1-.7v3.4M2.3 9.4c.3-.7 1.8-.7 1.8.2 0 .8-1.8 1.4-1.8 2.2h1.9"/>',
  indent: '<path d="M7 4h7M7 8h7M7 12h7M2 5.5L4.5 8 2 10.5"/>',
  outdent: '<path d="M7 4h7M7 8h7M7 12h7M4.5 5.5L2 8l2.5 2.5"/>',
  link: '<path d="M6.6 9.4l2.8-2.8"/><path d="M7.4 4.6l1.1-1.1a2.6 2.6 0 0 1 3.7 3.7l-1.1 1.1M8.6 11.4l-1.1 1.1a2.6 2.6 0 0 1-3.7-3.7l1.1-1.1"/>',
  note: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.8v.2"/>',
  wide: '<path d="M1.5 8h13M4.5 5L1.5 8l3 3M11.5 5l3 3-3 3"/>',
  reading:
    '<rect x="2" y="2" width="8" height="5" rx="1"/><path d="M6 7v7M11 9h3M11 11.5h3"/>',
  silent:
    '<rect x="4" y="1.8" width="8" height="12.4" rx="1.6"/><path d="M6 5h4M6 7.5h4M6 10h2.5"/>',
  captions:
    '<rect x="1.8" y="8" width="12.4" height="5.5" rx="1.3"/><path d="M4 10.8h5M10.5 10.8h1.5M8 2v3.5M6 3.7h4"/>',
  earlier: '<path d="M8 13.5V3M4.5 6.5L8 3l3.5 3.5"/>',
  later: '<path d="M8 2.5V13M4.5 9.5L8 13l3.5-3.5"/>',
  trash: '<path d="M3 4.2h10M6.2 4.2V2.6h3.6v1.6M4.5 4.2l.7 9.3h5.6l.7-9.3"/>',
  split:
    '<circle cx="5" cy="9" r="3.2"/><circle cx="12" cy="5" r="2.4"/><path d="M12 9.5v4M10 11.5h4"/>',
  dup: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5V3.2a.7.7 0 0 0-.7-.7H3.2a.7.7 0 0 0-.7.7v6.6c0 .4.3.7.7.7h2.3"/>',
  align:
    '<circle cx="8" cy="9.5" r="4.5"/><path d="M8 1.5v8"/><path d="M6 3.5l2-2 2 2"/>',
  copy: '<circle cx="8" cy="8" r="3.6"/><path d="M8 1.5v2.9M8 11.6v2.9M1.5 8h2.9M11.6 8h2.9"/>',
  ground: '<path d="M1.5 13h13"/><path d="M8 2.5v7M5.5 7.2L8 9.7l2.5-2.5"/>',
  grip: '<path d="M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01" stroke-width="2.2" stroke-linecap="round"/>',
  ban: '<circle cx="8" cy="8" r="6"/><path d="M3.8 12.2l8.4-8.4"/>',
  foldall: '<path d="M4.5 6.5L8 3l3.5 3.5M4.5 13L8 9.5l3.5 3.5"/>',
  left: '<path d="M9.5 4.5L6 8l3.5 3.5"/>',
  // The docked panels' tabs and rails: the details, and the bottom
  // panel's four panes.
  details:
    '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M9.5 2.5v11M11 5.5h1.5M11 8h1.5"/>',
  problems: '<path d="M8 2.2 14.2 13H1.8z"/><path d="M8 6.4v3.2M8 11.4v.1"/>',
  history: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.6V8l2.3 1.5"/>',
  tiles:
    '<path d="M1.8 4.2 5.8 2.6l4.4 1.6 4-1.6v9.2l-4 1.6-4.4-1.6-4 1.6z"/><path d="M5.8 2.6v9.2M10.2 4.2v9.2"/>',
  perf: '<path d="M1.5 8.6h2.8l1.6-4.2 2.5 8 1.8-5.4 1.1 1.6h3.2"/>',
  // A docked group floated over the 3D view, and docked back beside it.
  float:
    '<rect x="2" y="5" width="9" height="8.5" rx="1"/><path d="M5 5V2.5h8.5V11H11"/>',
  dock: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M9 2.5v11"/><path d="M5 8h2.5M6.3 6.7L7.5 8 6.3 9.3"/>',
} as const;

export type ShellIcon = keyof typeof PATHS;

const SVG_NS = "http://www.w3.org/2000/svg";

/** A new icon element (`svg.i`), hidden from screen readers: the control
 *  it sits in carries the words. */
export function shellIcon(name: ShellIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "i");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = PATHS[name];
  return svg;
}

/** Every `<i data-icon="name">` under `root` replaced by its icon (the
 *  page's static buttons). An unknown name is left as it is. */
export function placeShellIcons(root: ParentNode): void {
  for (const slot of root.querySelectorAll<HTMLElement>("i[data-icon]")) {
    const name = slot.dataset["icon"];
    if (name !== undefined && Object.hasOwn(PATHS, name)) {
      slot.replaceWith(shellIcon(name as ShellIcon));
    }
  }
}
