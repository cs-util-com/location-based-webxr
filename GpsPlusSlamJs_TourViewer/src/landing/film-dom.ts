/**
 * The hero film's markup: the scene box (the drawn park, the 3D canvas's
 * place, the labels, the dashed line, the old photo, the drawn phone with
 * its screen parts), the caption, the captions list and the paused mark,
 * ported from the prototype's HTML under the `lf-` prefix. A constant template:
 * nothing from the page or the user is put into it. The fake code on the
 * poster is a deterministic pattern, not a real code.
 *
 * @see film-dom.ts.md
 */

/** The fake code's modules as an SVG path (21 x 21, three finder squares). */
export function fakeCodePath(): string {
  const n = 21;
  let sd = Math.imul(8, 2654435761) >>> 0 || 1;
  let d = "";
  const r = () => {
    sd ^= sd << 13;
    sd >>>= 0;
    sd ^= sd >>> 17;
    sd ^= sd << 5;
    sd >>>= 0;
    return sd / 4294967296;
  };
  const finder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!finder(x, y) && r() < 0.47)
        d += `M${String(x)} ${String(y)}h1v1h-1z`;
    }
  }
  for (const [fx, fy] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ] as const) {
    d += `M${String(fx)} ${String(fy)}h7v7h-7zM${String(fx + 1)} ${String(fy + 1)}v5h5v-5zM${String(fx + 2)} ${String(fy + 2)}h3v3h-3z`;
  }
  return d;
}

const MILL_PHOTO =
  '<rect width="120" height="90" fill="#d8c19c"/><rect width="120" height="44" fill="#e6d6b8"/><path d="M26 76 V40 L58 20 L90 40 V76 Z" fill="#b59c74"/><path d="M22 42 L58 17 L94 42" fill="none" stroke="#6b5538" stroke-width="3"/><circle cx="22" cy="60" r="14" fill="none" stroke="#5d4a33" stroke-width="2.6"/><path d="M22 46 V74 M8 60 H36 M12 50 L32 70 M32 50 L12 70" stroke="#5d4a33" stroke-width="1.2"/><g fill="#6f5a3c"><rect x="44" y="48" width="7" height="9"/><rect x="70" y="48" width="7" height="9"/><path d="M54 76 V64 A5 5 0 0 1 64 64 V76 Z"/></g><rect y="76" width="120" height="14" fill="#c6ab82"/>';

function template(qr: string): string {
  return `
<svg class="lf-qr-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><symbol id="${qr}" viewBox="-2 -2 25 25"><rect x="-2" y="-2" width="25" height="25" fill="#fff"/><path fill="#2a2824" fill-rule="evenodd" d="${fakeCodePath()}"/></symbol></defs></svg>
<div class="lf-stage">
  <svg class="lf-layer lf-floor" role="img" aria-label="A small model park with a mill, a pond and trees. A dotted route links a code at the start with five numbered stations."></svg>
  <div class="lf-tags" aria-hidden="true"></div>
  <svg class="lf-layer lf-lead" aria-hidden="true"><line class="lf-lead-line" x1="0" y1="0" x2="0" y2="0" stroke="#2a2824" stroke-width="1.3" stroke-dasharray="4 4" opacity="0"/><circle class="lf-lead-dot" r="3" fill="#2a2824" opacity="0"/></svg>
  <figure class="lf-polaroid" aria-hidden="true"><svg viewBox="0 0 120 90">${MILL_PHOTO}<rect width="120" height="90" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="6"/></svg><figcaption>The mill, 1910</figcaption></figure>
  <div class="lf-mphone" aria-hidden="true">
    <div class="lf-mscreen">
      <svg class="lf-still" data-still="mill" viewBox="0 0 100 190" preserveAspectRatio="xMidYMid slice">
        <rect width="100" height="190" fill="#dfe7e3"/>
        <path d="M-4 112 C 20 104 60 106 104 110 V190 H-4Z" fill="#d3cfa6"/>
        <path d="M0 118 C 18 116 28 122 40 119" stroke="#b8cbc3" stroke-width="5" fill="none"/>
        <rect x="54" y="80" width="52" height="34" fill="#efe7d4" stroke="#2a2824" stroke-width=".7"/>
        <path d="M50 82 L80 61 L110 82 Z" fill="#a49a86" stroke="#2a2824" stroke-width=".7"/>
        <rect x="62" y="90" width="7" height="9" fill="#6c665b"/><rect x="84" y="99" width="8" height="15" fill="#6c665b"/>
        <circle cx="47" cy="99" r="14" fill="none" stroke="#8f7457" stroke-width="2.4"/>
        <path d="M47 85 V113 M33 99 H61 M37 89 L57 109 M57 89 L37 109" stroke="#8f7457" stroke-width="1"/>
        <circle cx="12" cy="92" r="13" fill="#a7ae7c"/><path d="M12 105 V116" stroke="#8a735a" stroke-width="2.4"/>
        <path d="M22 118 L28 82 L34 118Z" fill="#8c9a6c"/>
        <path d="M30 190 L74 190 L50 116 L46 116 Z" fill="#f6f1e3"/>
        <circle cx="88" cy="128" r="9" fill="#a7ae7c"/><path d="M88 137 V146" stroke="#8a735a" stroke-width="2"/>
      </svg>
      <svg class="lf-still" data-still="poster" viewBox="0 0 100 190" preserveAspectRatio="xMidYMid slice">
        <rect width="100" height="190" fill="#dfe7e3"/>
        <path d="M-4 116 C 30 110 70 112 104 116 V190 H-4Z" fill="#d3cfa6"/>
        <circle cx="12" cy="96" r="15" fill="#a7ae7c"/><path d="M12 111 V122" stroke="#8a735a" stroke-width="2.4"/>
        <path d="M80 122 L88 80 L96 122Z" fill="#8c9a6c"/>
        <rect x="60" y="88" width="30" height="26" fill="#efe7d4" stroke="#2a2824" stroke-width=".6"/><path d="M57 90 L75 76 L93 90Z" fill="#b8a48a" stroke="#2a2824" stroke-width=".6"/>
        <path d="M14 190 L86 190 L58 118 L42 118 Z" fill="#f6f1e3"/>
      </svg>
      <div class="lf-ov">
        <div class="lf-anc" data-a="ret"><div class="lf-retic"><svg viewBox="0 0 100 30"><ellipse cx="50" cy="15" rx="44" ry="11" fill="rgba(255,255,255,.2)" stroke="#fff" stroke-width="2.4" stroke-dasharray="7 6"/><path d="M2 15h8M98 15h-8M50 1v5M50 29v-5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="50" cy="15" r="2.6" fill="#fff"/></svg></div><div class="lf-ripple"></div></div>
        <div class="lf-anc lf-floor-only" data-a="pinf"><div class="lf-pinf"><svg viewBox="0 0 26 92"><ellipse cx="13" cy="89" rx="9" ry="2.6" fill="rgba(42,40,36,.25)"/><path d="M13 30 V88" stroke="#2a2824" stroke-width="1.6"/><path d="M13 32 L4 16 A 11 11 0 1 1 22 16 Z" fill="#cf4428"/><circle cx="13" cy="11" r="4.2" fill="#fff"/></svg></div></div>
        <div class="lf-anc lf-floor-only" data-a="posterf"><div class="lf-posterf"><svg viewBox="0 0 40 70" preserveAspectRatio="none"><rect x="18" y="40" width="4" height="30" fill="#a88c6c"/><rect x="0" y="0" width="40" height="46" fill="#fff" stroke="#2a2824" stroke-width="1"/><rect x="0" y="0" width="40" height="7" fill="#cf4428"/><use href="#${qr}" x="8" y="12" width="24" height="24"/></svg></div></div>
        <div class="lf-anc" data-a="halo"><div class="lf-halo"></div><div class="lf-scanbox"><i></i><i></i><i></i><i></i></div></div>
        <div class="lf-anc" data-a="pic"><div class="lf-ghost">+ Picture</div><div class="lf-pic"><svg viewBox="0 0 120 90" aria-hidden="true">${MILL_PHOTO}</svg><div class="lf-pcap">The mill, 1910</div></div></div>
        <div class="lf-anc" data-a="card"><div class="lf-tcard"><div class="lf-t"><span class="lf-ct">The old mill</span><span class="lf-caret"></span></div><div class="lf-b">Built in 1820. The stream still runs below.</div></div></div>
        <div class="lf-anc" data-a="call"><div class="lf-callout"><b>Your tour's code</b><span class="lf-callout-b">Hung where the walk begins.</span></div></div>
        <div class="lf-anc" data-a="next"><div class="lf-nextlbl"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#cf4428"/><path d="M6 10h7M10 6.5 13.5 10 10 13.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Next: the old oak</div></div>
      </div>
      <div class="lf-ui">
        <div class="lf-status"><span>10:24</span><span><svg viewBox="0 0 34 12"><path d="M0 9h3v3H0zM5 6h3v6H5zM10 3h3v9h-3zM15 0h3v12h-3z"/><rect x="21" y="1" width="11" height="10" rx="2" fill="none" stroke="#2a2824" stroke-width="1.4"/><rect x="23" y="3" width="6.5" height="6" rx=".8"/></svg></span></div>
        <div class="lf-hud"><span class="lf-hud-x"><svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8"/></svg></span><span class="lf-pill"></span></div>
        <div class="lf-chip">Tour found: Mill Park</div>
        <div class="lf-sheet" data-sheet="place"><p class="lf-hint2">Stand where it happened</p><span class="lf-sbtn" data-btn="place">Place here</span></div>
        <div class="lf-sheet" data-sheet="tools"><div class="lf-tools"><span class="lf-tool lf-sel" data-tool="text"><svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13M9 19h6"/></svg>Text</span><span class="lf-tool" data-tool="pic"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 3 2.5 3-3 5 4"/></svg>Picture</span></div></div>
        <div class="lf-sheet" data-sheet="share"><div class="lf-share-row"><svg class="lf-qr" viewBox="0 0 25 25" aria-hidden="true"><use href="#${qr}" width="25" height="25"/></svg><div><b>Mill Park is ready</b><span>Print its code. Hang it where the walk begins.</span></div></div><div class="lf-share-btns"><span class="lf-p" data-btn="print">Print the code</span><span>Copy link</span></div></div>
      </div>
      <div class="lf-cover"></div>
    </div>
  </div>
  <span class="lf-paused-mark" aria-hidden="true"></span>
  <span class="lf-debug" hidden></span>
</div>
<p class="lf-caption"></p>
<ol class="lf-captions" hidden></ol>`;
}

function must<T extends Element>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`film markup: missing ${sel}`);
  return el;
}

export interface FilmDom {
  readonly root: HTMLElement;
  readonly stage: HTMLElement;
  readonly floor: SVGSVGElement;
  readonly tags: HTMLElement;
  readonly leadLine: SVGLineElement;
  readonly leadDot: SVGCircleElement;
  readonly polaroid: HTMLElement;
  readonly phone: HTMLElement;
  readonly screen: HTMLElement;
  readonly caption: HTMLElement;
  readonly captions: HTMLOListElement;
  readonly debug: HTMLElement;
  /** The phone's parts, by role. */
  readonly parts: {
    readonly cover: HTMLElement;
    readonly pill: HTMLElement;
    readonly chip: HTMLElement;
    readonly place: HTMLElement;
    readonly tools: HTMLElement;
    readonly share: HTMLElement;
    readonly placeBtn: HTMLElement;
    readonly printBtn: HTMLElement;
    readonly toolText: HTMLElement;
    readonly toolPic: HTMLElement;
    readonly retic: HTMLElement;
    readonly ripple: HTMLElement;
    readonly pinF: HTMLElement;
    readonly posterF: HTMLElement;
    readonly halo: HTMLElement;
    readonly scan: HTMLElement;
    readonly pic: HTMLElement;
    readonly ghost: HTMLElement;
    readonly card: HTMLElement;
    readonly typed: HTMLElement;
    readonly caret: HTMLElement;
    readonly body: HTMLElement;
    readonly callout: HTMLElement;
    readonly next: HTMLElement;
    readonly stills: readonly SVGSVGElement[];
    readonly anchors: Readonly<
      Record<
        "ret" | "pinf" | "posterf" | "halo" | "pic" | "card" | "call" | "next",
        HTMLElement
      >
    >;
  };
}

let mounts = 0;

/** Builds the film's markup into a new `.lf-film` root (not yet attached). */
export function buildFilmDom(doc: Document): FilmDom {
  const root = doc.createElement("div");
  root.className = "lf-film";
  mounts += 1;
  root.innerHTML = template(`lf-qr-${String(mounts)}`);
  const anc = (a: string) => must<HTMLElement>(root, `.lf-anc[data-a="${a}"]`);
  return {
    root,
    stage: must(root, ".lf-stage"),
    floor: must(root, ".lf-floor"),
    tags: must(root, ".lf-tags"),
    leadLine: must(root, ".lf-lead-line"),
    leadDot: must(root, ".lf-lead-dot"),
    polaroid: must(root, ".lf-polaroid"),
    phone: must(root, ".lf-mphone"),
    screen: must(root, ".lf-mscreen"),
    caption: must(root, ".lf-caption"),
    captions: must(root, ".lf-captions"),
    debug: must(root, ".lf-debug"),
    parts: {
      cover: must(root, ".lf-cover"),
      pill: must(root, ".lf-pill"),
      chip: must(root, ".lf-chip"),
      place: must(root, '[data-sheet="place"]'),
      tools: must(root, '[data-sheet="tools"]'),
      share: must(root, '[data-sheet="share"]'),
      placeBtn: must(root, '[data-btn="place"]'),
      printBtn: must(root, '[data-btn="print"]'),
      toolText: must(root, '[data-tool="text"]'),
      toolPic: must(root, '[data-tool="pic"]'),
      retic: must(root, ".lf-retic"),
      ripple: must(root, ".lf-ripple"),
      pinF: must(root, ".lf-pinf"),
      posterF: must(root, ".lf-posterf"),
      halo: must(root, ".lf-halo"),
      scan: must(root, ".lf-scanbox"),
      pic: must(root, ".lf-pic"),
      ghost: must(root, ".lf-ghost"),
      card: must(root, ".lf-tcard"),
      typed: must(root, ".lf-ct"),
      caret: must(root, ".lf-caret"),
      body: must(root, ".lf-tcard .lf-b"),
      callout: must(root, ".lf-callout"),
      next: must(root, ".lf-nextlbl"),
      stills: [...root.querySelectorAll<SVGSVGElement>(".lf-still")],
      anchors: {
        ret: anc("ret"),
        pinf: anc("pinf"),
        posterf: anc("posterf"),
        halo: anc("halo"),
        pic: anc("pic"),
        card: anc("card"),
        call: anc("call"),
        next: anc("next"),
      },
    },
  };
}
