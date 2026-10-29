/**
 * A tour character in the world, in one of his five views (`bubble`,
 * `speak`, `two-stations`, `portrait`, `popup`): the die-cut figure with
 * its shadow, turned towards the visitor and breathing; the speech bubble
 * near him and the name tag far away; the pulsing ring at his feet while
 * the voice plays (portrait); the beckon towards the next station
 * (two-stations); or the folding paper stage with the line on a scroll
 * (popup). Built from the station-blocks-7 prototype
 * (`public/prototypes/station-blocks-7-character/`); which parts a view
 * draws and its distances are `character-views.ts`'s, the 2D media
 * `character-canvas.ts`'s.
 *
 * `root` stands with his feet at its origin, in a parent that is not
 * rotated against the scene (`scene-stage.ts`'s holder): the look turns
 * him itself, every `update`, from the camera's place - so it needs no
 * visitor position of its own. The bubble and the tag face the camera and
 * are drawn over everything (no depth test), at a size that never reads
 * smaller than at 2.4 m.
 *
 * @see character-look.ts.md
 */

import {
  BoxGeometry,
  CanvasTexture,
  RepeatWrapping,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Material,
  type Object3D,
  type Texture,
} from "three";

import {
  paintBackdrop,
  paintBlob,
  paintBubble,
  paintChevrons,
  paintFade,
  paintFigure,
  paintPip,
  paintScroll,
  paintStageTop,
  type BubbleContent,
  type BubbleSide,
  type FigureSource,
  type Painted,
  type PaintedFigure,
  type PaintedTail,
} from "./character-canvas.js";
import {
  BECKON_AFTER_MS,
  BECKON_WITHIN_M,
  bubbleOpens,
  bubbleSide,
  SCREEN_EDGE,
  characterViewLook,
  popupUnfolds,
  readingFloor,
  type StageCharacterView,
} from "./character-views.js";

/** The painters a look draws its media with (fakes in unit tests). */
export interface CharacterPainters {
  figure(source: FigureSource): PaintedFigure;
  bubble(content: BubbleContent): PaintedTail;
  pip(name: string, side: BubbleSide): PaintedTail;
  scroll(line: string, footer: string | null): Painted;
  stageTop(name: string): Painted;
  backdrop(): Painted;
  blob(): Painted;
  chevrons(): Painted;
  fade(): Painted;
}

const CANVAS_PAINTERS: CharacterPainters = {
  figure: paintFigure,
  bubble: (content) => paintBubble(content),
  pip: (name, side) => paintPip(name, side),
  scroll: (line, footer) => paintScroll(line, footer),
  stageTop: paintStageTop,
  backdrop: paintBackdrop,
  blob: paintBlob,
  chevrons: paintChevrons,
  fade: paintFade,
};

/** The voice's state, as the story tells it (`scene-view.ts`). */
export type CharacterVoice = "idle" | "speaking" | "spoken";

/** Where the next station lies from him (m, in his parent's frame: x
 *  north, z east), and its title. */
export interface CharacterBeckon {
  readonly dx: number;
  readonly dz: number;
  readonly title: string;
}

export interface CharacterLookOptions {
  readonly view: StageCharacterView;
  readonly name: string;
  readonly line: string;
  readonly figure: FigureSource;
  /** His height (m); default 1.7. */
  readonly heightM?: number;
  readonly painters?: CharacterPainters;
}

interface CharacterFrame {
  readonly nowMs: number;
  readonly camera: Camera;
  /** Jump to the settled state (a check page's snapshot). */
  readonly snap?: boolean;
}

/** What shows now: for the check page and the tests. */
export interface CharacterLookState {
  readonly view: StageCharacterView;
  /** 0 shut .. 1 open. */
  readonly bubble: number;
  readonly pip: number;
  readonly unfold: number;
  /** His turn about the vertical (rad, 0 facing +Z). */
  readonly turn: number;
  readonly side: BubbleSide;
  readonly beckoning: boolean;
  /** The beckon's chevrons' opacity (0 .. 0.85). */
  readonly arrow: number;
  readonly footer: string | null;
  /** The horizontal distance to the camera (m). */
  readonly distanceM: number;
}

export interface CharacterLook {
  readonly root: Group;
  /** The meshes a check page measures. */
  readonly parts: {
    readonly figure: Mesh;
    readonly bubble: Mesh;
    readonly pip: Mesh;
    readonly scroll: Mesh;
    readonly popup: Group;
    /** The beckon's chevrons on the ground. */
    readonly arrow: Mesh;
  };
  update(frame: CharacterFrame): void;
  setBeckon(beckon: CharacterBeckon | null): void;
  setVoice(voice: CharacterVoice): void;
  /** The station's presence fade (0..1), on top of the look's own. */
  setPresence(alpha: number): void;
  state(): CharacterLookState;
  dispose(): void;
}

const CHARACTER_DEFAULT_HEIGHT_M = 1.7;

/** The prototype's rates (per second). */
const OPEN_RATE = 2.6;
const UNFOLD_RATE = 0.65;
/** The chevrons: their fade rate, full opacity and scroll speed. */
const ARROW_RATE = 1.2;
const ARROW_OPACITY = 0.85;
const ARROW_SCROLL = 0.22;
const TURN_EASE = 4;
/** The pop-up stage's own height in the prototype (its figure 1.85 m). */
const POPUP_FIGURE_M = 1.85;
const BACKDROP_H = 2.25 * 1.05;

const clamp = (v: number, a: number, b: number): number =>
  Math.min(b, Math.max(a, v));
const smooth = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function texture(image: Painted["image"]): Texture {
  const t = new CanvasTexture(image);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function basic(
  map: Texture | null,
  extra: ConstructorParameters<typeof MeshBasicMaterial>[0] = {},
): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    ...extra,
  });
}

/** A plane for the die-cut figure `heightM` tall, its feet at y = 0. */
function figureGeometry(fig: PaintedFigure, heightM: number): PlaneGeometry {
  const mpp = heightM / fig.figureH;
  const w = (fig.figureW + 2 * fig.pad) * mpp;
  const h = (fig.figureH + 2 * fig.pad) * mpp;
  const g = new PlaneGeometry(w, h);
  g.translate(0, h / 2 - fig.pad * mpp, 0);
  return g;
}

/** A mesh's geometry and its materials as a list; null for an object
 *  that is not a mesh. */
function meshParts(
  object: Object3D,
): { geometry: BufferGeometry; materials: Material[] } | null {
  if (!(object instanceof Mesh)) return null;
  const mesh = object as Mesh<BufferGeometry, Material | Material[]>;
  const material = mesh.material;
  return {
    geometry: mesh.geometry,
    materials: Array.isArray(material) ? material : [material],
  };
}

export function createCharacterLook(
  options: CharacterLookOptions,
): CharacterLook {
  const painters = options.painters ?? CANVAS_PAINTERS;
  const view = options.view;
  const look = characterViewLook(view);
  const heightM =
    options.heightM !== undefined &&
    Number.isFinite(options.heightM) &&
    options.heightM > 0
      ? options.heightM
      : CHARACTER_DEFAULT_HEIGHT_M;
  const name = options.name;
  const line = options.line;

  const root = new Group();
  root.name = "station-character";
  const turn = new Group();
  root.add(turn);
  const body = new Group();
  turn.add(body);

  // The die-cut figure: front and back, each seen from its own side.
  const fig = painters.figure(options.figure);
  const figGeo = figureGeometry(fig, heightM);
  const frontTex = texture(fig.front);
  const backTex = texture(fig.back);
  // Seen from behind the silhouette is mirrored.
  backTex.repeat.x = -1;
  backTex.offset.x = 1;
  const front = new Mesh(
    figGeo,
    basic(frontTex, { alphaTest: 0.03, depthWrite: true }),
  );
  front.name = "character-front";
  const back = new Mesh(
    figGeo,
    basic(backTex, { alphaTest: 0.03, depthWrite: true }),
  );
  back.rotation.y = Math.PI;
  back.position.z = -0.004;
  body.add(front, back);

  const blob = painters.blob();
  const blobTex = texture(blob.image);
  const shadow = new Mesh(new PlaneGeometry(1, 0.5), basic(blobTex));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  shadow.scale.set(heightM * 0.55, heightM * 0.55, 1);
  root.add(shadow);

  const ring = new Mesh(
    new RingGeometry(0.5, 0.56, 64),
    basic(null, { color: 0xf2b84b, opacity: 0 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  root.add(ring);

  // The beckon (two-stations): gold chevrons on the ground, from beside
  // him toward the next station, scrolling that way.
  const arrowGroup = new Group();
  root.add(arrowGroup);
  const chevronTex = texture(painters.chevrons().image);
  chevronTex.wrapT = RepeatWrapping;
  chevronTex.repeat.set(1, 1.2);
  const fadeTex = new CanvasTexture(painters.fade().image);
  const arrow = new Mesh(
    new PlaneGeometry(0.9, 4.6),
    basic(chevronTex, { alphaMap: fadeTex, opacity: 0 }),
  );
  arrow.name = "character-arrow";
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.set(0, 0.02, -3.4);
  arrow.visible = false;
  arrowGroup.add(arrow);

  const overlay = (order: number): Mesh => {
    const mesh = new Mesh(
      new PlaneGeometry(1, 1),
      basic(null, { depthTest: false, opacity: 0 }),
    );
    mesh.renderOrder = order;
    mesh.visible = false;
    root.add(mesh);
    return mesh;
  };
  const bubble = overlay(20);
  bubble.name = "character-bubble";
  const pip = overlay(19);
  pip.name = "character-pip";

  // The pop-up paper stage (built for every view, shown in `popup`).
  const popup = new Group();
  popup.name = "character-popup";
  popup.visible = false;
  turn.add(popup);
  const popupScale = heightM / POPUP_FIGURE_M;
  popup.scale.setScalar(popupScale);
  const topTex = texture(painters.stageTop(name).image);
  const sideMat = basic(null, {
    color: 0xd9ccb0,
    transparent: false,
    depthWrite: true,
  });
  const topMat = basic(topTex, { transparent: false, depthWrite: true });
  const base = new Mesh(new BoxGeometry(2.5, 0.05, 1.35), [
    sideMat,
    sideMat,
    topMat,
    sideMat,
    sideMat,
    sideMat,
  ]);
  base.position.y = 0.025;
  popup.add(base);
  const popShadow = new Mesh(
    new PlaneGeometry(3.3, 1.9),
    basic(blobTex, { opacity: 0.8 }),
  );
  popShadow.rotation.x = -Math.PI / 2;
  popShadow.position.y = 0.01;
  popup.add(popShadow);
  const popBack = new Group();
  popBack.position.set(0, 0.05, -0.6);
  popup.add(popBack);
  const backdropTex = texture(painters.backdrop().image);
  const backdropGeo = new PlaneGeometry(2.3, BACKDROP_H);
  backdropGeo.translate(0, BACKDROP_H / 2, 0);
  popBack.add(
    new Mesh(
      backdropGeo,
      basic(backdropTex, {
        alphaTest: 0.02,
        side: DoubleSide,
        depthWrite: true,
      }),
    ),
  );
  const popFig = new Group();
  popFig.position.set(0.15, 0.05, 0.05);
  popup.add(popFig);
  popFig.add(
    new Mesh(
      figureGeometry(fig, 1.5),
      basic(frontTex, { alphaTest: 0.03, side: DoubleSide, depthWrite: true }),
    ),
  );
  const tab = new Mesh(
    new PlaneGeometry(0.42, 0.36),
    basic(null, {
      color: 0xcdbd9c,
      side: DoubleSide,
      transparent: false,
      depthWrite: true,
    }),
  );
  tab.position.set(0, 0.18, -0.14);
  tab.rotation.x = -0.6;
  popFig.add(tab);
  const scroll = new Mesh(
    new PlaneGeometry(1, 1),
    basic(null, { side: DoubleSide }),
  );
  scroll.name = "character-scroll";
  scroll.visible = false;
  popBack.add(scroll);

  /** Each material's own opacity, the presence fade multiplies it. */
  let presence = 1;
  let voice: CharacterVoice = "idle";
  let beckon: CharacterBeckon | null = null;
  let lastMs: number | null = null;
  let open = 0;
  let pipOpacity = 0;
  let unfold = 0;
  let turnYaw = 0;
  let turned = false;
  let openForMs = 0;
  let arrowOpacity = 0;
  let side: BubbleSide | null = null;
  let beckoning = false;
  let footer: string | null = null;
  let distanceM = Number.POSITIVE_INFINITY;
  let bubbleKey = "";
  let bubbleInfo: PaintedTail | null = null;
  let pipKey = "";
  let pipInfo: PaintedTail | null = null;
  let scrollKey = "";
  let scrollInfo: Painted | null = null;
  let disposed = false;

  const setMap = (mesh: Mesh, image: Painted["image"]): void => {
    const material = mesh.material as MeshBasicMaterial;
    material.map?.dispose();
    material.map = texture(image);
    material.needsUpdate = true;
  };

  const opacity = (mesh: Mesh, value: number): void => {
    (mesh.material as MeshBasicMaterial).opacity = clamp(value, 0, 1);
  };

  // Scratch vectors (one look updates once a frame).
  const camWorld = new Vector3();
  const camLocal = new Vector3();
  const rootQ = new Quaternion();
  const camQ = new Quaternion();
  const localQ = new Quaternion();
  const right = new Vector3();
  const up = new Vector3();
  const tip = new Vector3();
  const projected = new Vector3();
  const edgePoint = new Vector3();

  function footerOf(): string | null {
    if (beckoning && beckon !== null) return `Next: ${beckon.title}`;
    if (voice === "speaking") return "Speaking";
    return null;
  }

  function update(frame: CharacterFrame): void {
    if (disposed) return;
    const snap = frame.snap === true || lastMs === null;
    const dt = snap
      ? 0
      : clamp((frame.nowMs - (lastMs ?? frame.nowMs)) / 1000, 0, 0.1);
    lastMs = frame.nowMs;
    const step = (cur: number, target: number, rate: number): number =>
      snap ? target : cur + clamp(target - cur, -rate * dt, rate * dt);
    const camera = frame.camera;
    root.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    camera.getWorldPosition(camWorld);
    camLocal.copy(camWorld);
    root.worldToLocal(camLocal);
    root.getWorldQuaternion(rootQ);
    camera.getWorldQuaternion(camQ);
    localQ.copy(rootQ).invert().multiply(camQ);
    right.set(1, 0, 0).applyQuaternion(localQ);
    up.set(0, 1, 0).applyQuaternion(localQ);

    distanceM = Math.hypot(camLocal.x, camLocal.z);
    const toCam = Math.atan2(camLocal.x, camLocal.z);
    const t = frame.nowMs / 1000;

    // The beckon (two-stations): once heard, or open a while, near him.
    beckoning =
      look.beckons &&
      beckon !== null &&
      voice !== "speaking" &&
      (voice === "spoken" ||
        openForMs >= BECKON_AFTER_MS ||
        frame.snap === true) &&
      distanceM < BECKON_WITHIN_M;

    // Facing: towards the camera (the beckon is the chevrons, not a
    // turn); the pop-up keeps the facing it had first.
    if (look.turns || !turned) {
      const target = toCam;
      if (snap || !turned) turnYaw = target;
      else {
        const k = 1 - Math.exp(-dt * TURN_EASE);
        turnYaw += wrapAngle(target - turnYaw) * k;
      }
      turned = true;
    }
    turn.rotation.y = turnYaw;

    // Breathing and a slight sway (calm, about 4 s).
    const a = presence;
    body.scale.set(
      0.97 + 0.03 * a,
      (0.9 + 0.1 * a) * (1 + 0.006 * Math.sin(t * 1.6)),
      1,
    );
    body.rotation.z = 0.007 * Math.sin(t * 0.8);
    const figVisible = look.figure && a > 0.001;
    front.visible = back.visible = shadow.visible = figVisible;
    opacity(front, a);
    opacity(back, a);
    opacity(shadow, a * 0.9);
    opacity(
      ring,
      look.ring && voice === "speaking" ? (0.5 + 0.3 * Math.sin(t * 6)) * a : 0,
    );
    ring.visible = look.ring && voice === "speaking";

    updateBubble(camera, step, dt * 1000);
    updatePopup(step, a);
    updateArrow(step, dt, a);
  }

  function updateArrow(
    step: (cur: number, target: number, rate: number) => number,
    dt: number,
    a: number,
  ): void {
    arrowOpacity = step(
      arrowOpacity,
      beckoning ? ARROW_OPACITY : 0,
      ARROW_RATE,
    );
    arrow.visible = arrowOpacity > 0.01 && beckon !== null && a > 0.001;
    if (beckon !== null) {
      // Local -z (where the chevrons lie and point) turned to (dx, dz).
      arrowGroup.rotation.y = Math.atan2(-beckon.dx, -beckon.dz);
    }
    opacity(arrow, arrowOpacity * a);
    chevronTex.offset.y -= dt * ARROW_SCROLL;
  }

  function updateBubble(
    camera: Camera,
    step: (cur: number, target: number, rate: number) => number,
    dtMs: number,
  ): void {
    const wantOpen = look.bubble && presence > 0.001 && bubbleOpens(distanceM);
    open = step(open, wantOpen ? 1 : 0, OPEN_RATE);
    openForMs = wantOpen ? openForMs + dtMs : 0;
    const wantPip = look.pip && presence > 0.001 && !wantOpen;
    pipOpacity = step(pipOpacity, wantPip ? 1 : 0, OPEN_RATE);

    // The side, from where his head is on the screen.
    tip.set(0, heightM * 0.86, 0);
    const headDist = Math.max(0.5, tip.distanceTo(camLocal));
    const floor = readingFloor(headDist);
    const persp = camera instanceof PerspectiveCamera ? camera : null;
    const tanH = persp
      ? Math.tan((persp.fov * Math.PI) / 180 / 2) * persp.aspect
      : 1;
    projected.copy(tip);
    root.localToWorld(projected);
    projected.project(camera);
    if (projected.z <= 1 && Number.isFinite(projected.x)) {
      const wNdc =
        (((bubbleInfo?.w ?? 900) / 1024) * floor) / (headDist * tanH);
      const chosen = bubbleSide({ x: projected.x, width: wNdc, last: side });
      side = chosen.side;
    } else {
      side ??= "right";
    }

    footer = look.footer ? footerOf() : null;
    const key = [name, line, side, footer ?? ""].join("|");
    if (open > 0.001 && key !== bubbleKey) {
      bubbleKey = key;
      bubbleInfo = painters.bubble({
        name,
        line,
        footer,
        reserveFooter: look.footer,
        side,
      });
      setMap(bubble, bubbleInfo.image);
    }
    const pkey = `${name}|${side}`;
    if (pipOpacity > 0.001 && pkey !== pipKey) {
      pipKey = pkey;
      pipInfo = painters.pip(name, side);
      setMap(pip, pipInfo.image);
    }

    const sgn = side === "right" ? 1 : -1;
    tip.set(0, heightM * 0.86, 0).addScaledVector(right, sgn * heightM * 0.16);
    const dist = Math.max(0.5, tip.distanceTo(camLocal));
    const near = readingFloor(dist);
    const place = (
      mesh: Mesh,
      info: PaintedTail,
      s: number,
      grow: number,
    ): void => {
      const m = (s / 1024) * grow;
      mesh.quaternion.copy(localQ);
      mesh.scale.set(info.w * m, info.h * m, 1);
      mesh.position
        .copy(tip)
        .addScaledVector(right, (info.w / 2 - info.tipX) * m)
        .addScaledVector(up, (info.h / 2 - 3) * m);
    };
    bubble.visible = open > 0.001 && bubbleInfo !== null;
    if (bubble.visible && bubbleInfo !== null) {
      const e = smooth(open);
      opacity(bubble, e * presence);
      place(bubble, bubbleInfo, near, 0.86 + 0.14 * e);
      slideOnScreen(bubble, camera, tanH);
    }
    pip.visible = pipOpacity > 0.001 && pipInfo !== null;
    if (pip.visible && pipInfo !== null) {
      opacity(pip, pipOpacity * presence);
      place(pip, pipInfo, near * 0.85, 1);
    }
  }

  /**
   * A camera-facing `mesh` still past an edge of the screen is slid back
   * onto it along the camera's right (the tail keeps pointing roughly at
   * him); one wider than the screen is centred. Measured from where the
   * placed mesh's edges project, not estimated: the side's estimate
   * (`bubbleSide`) leaves out the gap between his head and the tail's
   * tip, and the prototype's bubble ran off a narrow phone by it.
   */
  function slideOnScreen(mesh: Mesh, camera: Camera, tanH: number): void {
    edgePoint.copy(mesh.position);
    root.localToWorld(edgePoint);
    edgePoint.applyMatrix4(camera.matrixWorldInverse);
    const depth = -edgePoint.z;
    if (!(depth > 0)) return;
    const edgeNdc = (sign: number): number => {
      edgePoint
        .copy(mesh.position)
        .addScaledVector(right, (sign * mesh.scale.x) / 2);
      root.localToWorld(edgePoint);
      return edgePoint.project(camera).x;
    };
    const r = edgeNdc(1);
    const l = edgeNdc(-1);
    if (!Number.isFinite(r) || !Number.isFinite(l)) return;
    let shift = 0;
    if (r - l >= 2 * SCREEN_EDGE) shift = (r + l) / 2;
    else if (r > SCREEN_EDGE) shift = r - SCREEN_EDGE;
    else if (l < -SCREEN_EDGE) shift = l + SCREEN_EDGE;
    if (shift !== 0)
      mesh.position.addScaledVector(right, -shift * depth * tanH);
  }

  function updatePopup(
    step: (cur: number, target: number, rate: number) => number,
    a: number,
  ): void {
    const on = look.popup && a > 0.001;
    popup.visible = on;
    if (!on) {
      unfold = 0;
      return;
    }
    unfold = step(
      unfold,
      popupUnfolds(distanceM, unfold > 0.5) ? 1 : 0,
      UNFOLD_RATE,
    );
    const u = unfold;
    popBack.rotation.x = (Math.PI / 2) * (1 - smooth(u / 0.6));
    popFig.rotation.x = (Math.PI / 2) * (1 - smooth((u - 0.25) / 0.6));
    const su = smooth((u - 0.62) / 0.38);
    footer = voice === "speaking" ? "Speaking" : null;
    const key = `${line}|${footer ?? ""}`;
    if (key !== scrollKey) {
      scrollKey = key;
      scrollInfo = painters.scroll(line, footer);
      setMap(scroll, scrollInfo.image);
    }
    const info = scrollInfo;
    if (info === null) return;
    const sw = 2.5;
    const sh = (sw * info.h) / info.w;
    scroll.scale.set(sw * Math.max(0.04, su), sh, 1);
    scroll.position.set(0, BACKDROP_H + 0.08 + sh / 2, 0.02);
    scroll.visible = su > 0.01;
    popup.traverse((o) => {
      for (const m of meshParts(o)?.materials ?? []) {
        if (m.transparent) m.opacity = (o === popShadow ? 0.8 : 1) * a;
      }
    });
  }

  return {
    root,
    parts: { figure: front, bubble, pip, scroll, popup, arrow },
    update,
    setBeckon(next) {
      beckon =
        next !== null &&
        Number.isFinite(next.dx) &&
        Number.isFinite(next.dz) &&
        (next.dx !== 0 || next.dz !== 0)
          ? next
          : null;
    },
    setVoice(next) {
      voice = next;
    },
    setPresence(alpha) {
      presence = Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
    },
    state: () => ({
      view,
      bubble: open,
      pip: pipOpacity,
      unfold,
      turn: turnYaw,
      side: side ?? "right",
      beckoning,
      arrow: arrowOpacity,
      footer,
      distanceM,
    }),
    dispose() {
      disposed = true;
      root.traverse((o) => {
        const parts = meshParts(o);
        if (parts === null) return;
        parts.geometry.dispose();
        for (const m of parts.materials) {
          (m as MeshBasicMaterial).map?.dispose();
          (m as MeshBasicMaterial).alphaMap?.dispose();
          m.dispose();
        }
      });
      root.removeFromParent();
    },
  };
}
