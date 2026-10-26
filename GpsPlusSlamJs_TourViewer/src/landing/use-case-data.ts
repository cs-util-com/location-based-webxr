/**
 * The use cases of the landing page: who makes a tour like this, what a
 * visitor sees, and the picture of that moment as a phone screen held
 * sideways. Every maker and place is made up; nothing here is a real place,
 * organisation or person.
 *
 * Each picture is two layers: `scene`, the real place, drawn in the muted
 * palette only (the same in both looks), and `overlay(t)`, what the tour
 * adds, drawn in the look `t` and always on top.
 *
 * @see use-case-data.ts.md
 */
import {
  anchor,
  augColour as a,
  bench,
  card,
  conifer,
  hills,
  house,
  land,
  photo,
  REAL,
  stalk,
  tree,
  type UseCaseTreatment,
} from "./use-case-draw.js";

export interface UseCase {
  /** Stable kebab-case name, for tests and test ids. */
  readonly id: string;
  readonly title: string;
  /** One sentence: who makes it, and what the visitor sees. */
  readonly sentence: string;
  /** What the picture shows, real and augmented, for a screen reader. */
  readonly alt: string;
  /** The real place, muted (`REAL` palette only). */
  readonly scene: string;
  /** What the tour adds there, in the look `t`. */
  readonly overlay: (t: UseCaseTreatment) => string;
}

const R = REAL;

const castleTower: UseCase = {
  id: "castle-tower",
  title: "The tower stands again",
  sentence:
    "The friends of an old castle set up the walk, and at the ruin a visitor holds up the phone to see the fallen tower stand on its stump again, at full height.",
  alt: "Through the phone: a castle ruin on a hill, and on the broken stump of its tower the whole tower stands again.",
  scene:
    land(60) +
    hills(52) +
    `<rect y="60" width="210" height="40" fill="${R.ground}"/>` +
    `<polygon points="0,74 40,62 92,53 140,55 180,63 210,67 210,100 0,100" fill="${R.groundDark}"/>` +
    `<polygon points="92,53 140,55 122,100 62,100" fill="${R.groundLight}"/>` +
    `<polygon points="52,66 52,52 58,49 61,54 68,48 74,53 74,66" fill="${R.stone}"/>` +
    `<polygon points="68,48 74,53 74,66 68,66" fill="${R.stoneShade}"/>` +
    `<polygon points="128,64 128,48 134,46 137,51 142,47 146,50 146,64" fill="${R.stone}"/>` +
    `<polygon points="74,64 74,58 88,58 88,64" fill="${R.stoneShade}"/>` +
    `<polygon points="112,62 112,57 128,57 128,62" fill="${R.stoneShade}"/>` +
    `<polygon points="88,62 88,50 93,47 97,51 102,46 106,50 110,48 110,62" fill="${R.stone}"/>` +
    `<polygon points="110,48 117,51 117,63 110,62" fill="${R.stoneShade}"/>`,
  overlay: (t) =>
    `<polygon points="88,50 88,16 110,16 110,50" fill="${a(t, "#ece3cf", 3)}"/>` +
    `<polygon points="110,16 117,19 117,51 110,50" fill="${a(t, "#cdbf9f", 2)}"/>` +
    `<polygon points="85,17 85,8 90,8 90,12 95,12 95,8 100,8 100,12 105,12 105,8 113,8 113,17" fill="${a(t, "#ece3cf", 3)}"/>` +
    `<polygon points="113,8 120,11 120,20 113,17" fill="${a(t, "#cdbf9f", 2)}"/>` +
    `<rect x="97" y="24" width="3" height="8" fill="${a(t, "#6c665b", 0)}"/>` +
    `<rect x="97" y="37" width="3" height="8" fill="${a(t, "#6c665b", 0)}"/>` +
    card(t, { x: 132, y: 18, w: 54, title: "As it stood" }),
};

const birthdayHunt: UseCase = {
  id: "birthday-hunt",
  title: "A birthday treasure hunt",
  sentence:
    "A parent hides six clues around the park, and each one floats where the last answer pointed, until the last shows where the presents are.",
  alt: "Through the phone: a park bench under a tree, with a clue card floating above the bench and a wrapped present beside it.",
  scene:
    land(54) +
    `<polygon points="0,54 90,54 0,78" fill="${R.groundDark}"/>` +
    `<polygon points="150,100 210,100 210,72" fill="${R.groundDark}"/>` +
    `<polygon points="120,100 150,54 158,54 168,100" fill="${R.path}"/>` +
    tree(36, 84, 14) +
    tree(196, 62, 7) +
    bench(96, 72, 42),
  overlay: (t) =>
    stalk(117, 50, 64) +
    anchor(117, 84, 16) +
    card(t, {
      x: 74,
      y: 16,
      w: 86,
      title: "Clue 3 of 6",
      text: "look under the bench",
    }) +
    `<g transform="translate(166 50)">` +
    `<polygon points="0,10 20,10 20,26 0,26" fill="${a(t, "#d24b6a", 1)}"/>` +
    `<polygon points="20,10 26,7 26,23 20,26" fill="${a(t, "#a8364f", 0)}"/>` +
    `<polygon points="0,10 6,7 26,7 20,10" fill="${a(t, "#e57d93", 2)}"/>` +
    `<rect x="8.5" y="10" width="3" height="16" fill="${a(t, "#ffe9a8", 4)}"/>` +
    `<path d="M10 9.5c-4-7-9-3-5 0M10 9.5c4-7 9-3 5 0" stroke="${a(t, "#ffe9a8", 4)}" stroke-width="1.6" fill="none"/>` +
    `</g>`,
};

const shopWindows: UseCase = {
  id: "shop-window-paintings",
  title: "Paintings in empty shop windows",
  sentence:
    "A group of painters fills a street of empty shops, and through the phone each window holds a painting, there for whoever stops to look.",
  alt: "Through the phone: an empty shop window on a quiet street, with a framed painting hanging inside it.",
  scene:
    `<rect width="210" height="100" fill="${R.sky}"/>` +
    `<polygon points="0,10 120,10 120,86 0,86" fill="${R.wall}"/>` +
    `<polygon points="120,10 170,18 170,86 120,86" fill="${R.wallShade}"/>` +
    `<rect x="0" y="6" width="122" height="6" fill="${R.roof}"/>` +
    `<rect x="12" y="26" width="76" height="52" fill="${R.door}"/>` +
    `<polygon points="14,28 34,28 14,48" fill="${R.window}"/>` +
    `<rect x="96" y="40" width="16" height="38" fill="${R.roofShade}"/>` +
    `<polygon points="132,30 158,33 158,78 132,78" fill="${R.door}"/>` +
    `<rect y="86" width="210" height="14" fill="${R.groundLight}"/>` +
    `<polygon points="0,86 210,86 210,90 0,92" fill="${R.stone}"/>` +
    `<rect x="182" y="40" width="3" height="46" fill="${R.ink}"/>` +
    `<circle cx="183.5" cy="38" r="5" fill="${R.skyLow}"/>`,
  overlay: (t) =>
    `<rect x="22" y="31" width="56" height="42" fill="${a(t, "#8a6236", 0)}"/>` +
    `<rect x="25" y="34" width="50" height="36" fill="${a(t, "#f1d9a0", 4)}"/>` +
    `<polygon points="25,70 25,56 40,47 52,55 63,46 75,54 75,70" fill="${a(t, "#7fa05a", 2)}"/>` +
    `<polygon points="40,47 52,55 46,70 25,70 25,56" fill="${a(t, "#5f8a4a", 1)}"/>` +
    `<circle cx="64" cy="41" r="4.5" fill="${a(t, "#e0703a", 1)}"/>` +
    card(t, { x: 30, y: 76.5, w: 40, title: "Evening field", size: 6 }),
};

const indoorExhibition: UseCase = {
  id: "indoor-exhibition",
  title: "More about every painting",
  sentence:
    "A small museum adds stations to its rooms, and beside each painting or object on show the phone tells what the label leaves out, with the first sketch.",
  alt: "Indoors, through the phone: a framed painting on a gallery wall, and beside it a card with its story and the artist's first sketch.",
  scene:
    `<rect width="210" height="74" fill="${R.wall}"/>` +
    `<polygon points="166,0 210,0 210,100 166,74" fill="${R.wallShade}"/>` +
    `<polygon points="0,74 166,74 210,100 0,100" fill="${R.stone}"/>` +
    `<polygon points="0,74 70,74 30,100 0,100" fill="${R.stoneShade}"/>` +
    `<rect x="20" y="16" width="48" height="40" fill="${R.wood}"/>` +
    `<rect x="24" y="20" width="40" height="32" fill="${R.water}"/>` +
    `<polygon points="24,52 24,40 36,32 48,40 64,33 64,52" fill="${R.leafShade}"/>` +
    `<circle cx="36" cy="27" r="3.4" fill="${R.skyLow}"/>` +
    `<rect x="38" y="60" width="12" height="4" fill="${R.window}"/>` +
    `<polygon points="138,62 138,90 158,90 158,62" fill="${R.skyLow}"/>` +
    `<polygon points="158,62 164,59 164,87 158,90" fill="${R.wallShade}"/>` +
    `<polygon points="138,62 144,59 164,59 158,62" fill="${R.path}"/>` +
    `<polygon points="142,59 144,46 148,42 154,42 158,46 160,59" fill="${R.ink}"/>`,
  overlay: (t) =>
    card(t, { x: 76, y: 16, w: 84, title: "Painted in a barn", lines: 3 }) +
    photo(t, {
      x: 116,
      y: 34,
      w: 34,
      h: 26,
      rot: 4,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#f7f1e1", 4)}"/>` +
        `<path d="M4 38L18 22L28 30L42 18L56 30" fill="none" stroke="${a(t, "#5a5048", 0)}" stroke-width="2"/>` +
        `<circle cx="18" cy="12" r="4" fill="none" stroke="${a(t, "#5a5048", 0)}" stroke-width="1.6"/>`,
    }),
};

const pondLife: UseCase = {
  id: "pond-life",
  title: "The pond life trail",
  sentence:
    "A school class marks each stop along the bank, and the photo of what the children found there floats right above the water.",
  alt: "Through the phone: a pond with reeds at its edge, and above the water a photo of a frog the class found there.",
  scene:
    land(48) +
    conifer(20, 50, 22) +
    conifer(34, 50, 16) +
    tree(186, 52, 9) +
    `<ellipse cx="108" cy="76" rx="84" ry="16" fill="${R.water}"/>` +
    `<ellipse cx="96" cy="72" rx="40" ry="5" fill="${R.waterLight}"/>` +
    `<path d="M28 82l-3-16M32 84l1-18M36 83l4-14M178 80l-2-15M182 82l2-16M186 80l5-12" stroke="${R.leafDark}" stroke-width="1.6" fill="none"/>`,
  overlay: (t) =>
    stalk(112, 54, 70) +
    anchor(112, 74, 12) +
    photo(t, {
      x: 90,
      y: 10,
      w: 44,
      h: 34,
      rot: -3,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#cfe2b8", 4)}"/>` +
        `<ellipse cx="30" cy="30" rx="16" ry="9" fill="${a(t, "#5f9a3a", 1)}"/>` +
        `<circle cx="22" cy="20" r="5" fill="${a(t, "#5f9a3a", 1)}"/>` +
        `<circle cx="36" cy="20" r="5" fill="${a(t, "#5f9a3a", 1)}"/>` +
        `<circle cx="22" cy="19" r="2" fill="${a(t, "#1f2a18", 0)}"/>` +
        `<circle cx="36" cy="19" r="2" fill="${a(t, "#1f2a18", 0)}"/>`,
    }) +
    card(t, {
      x: 138,
      y: 18,
      w: 52,
      title: "Found here",
      text: "in spring",
      size: 7,
    }),
};

const riverPoem: UseCase = {
  id: "river-poem",
  title: "A poem along the river",
  sentence:
    "A writing group leaves one verse at each bend of the river path, and at the bridge the whole poem stands together.",
  alt: "Through the phone: a river bend with a bench on its bank, and a card with a verse of a poem floating above the water.",
  scene:
    land(46) +
    hills(42) +
    `<path d="M120 52C90 60 150 68 96 80C60 88 70 96 40 100H118C130 92 118 86 150 78C196 66 136 60 150 52Z" fill="${R.water}"/>` +
    `<path d="M124 56C112 60 134 64 116 70" stroke="${R.waterLight}" stroke-width="2" fill="none"/>` +
    bench(18, 70, 34) +
    tree(186, 74, 12),
  overlay: (t) =>
    stalk(112, 46, 66) +
    anchor(112, 70, 12) +
    card(t, {
      x: 66,
      y: 12,
      w: 96,
      title: "Verse 2 of 6",
      text: "the water keeps what we forget",
    }),
};

const sculpturePath: UseCase = {
  id: "sculpture-path",
  title: "A sculpture path",
  sentence:
    "An open-air exhibition puts the artist's first sketch beside each sculpture on the lawn, with one line on how the work came about.",
  alt: "Through the phone: a stone sculpture on a lawn, and the artist's first sketch standing beside it with a short note.",
  scene:
    land(52) +
    `<rect y="40" width="210" height="14" fill="${R.leafShade}"/>` +
    `<path d="M0 40q10-6 20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0" fill="${R.leaf}"/>` +
    `<polygon points="70,88 70,82 100,82 100,88" fill="${R.stoneShade}"/>` +
    `<polygon points="74,82 72,62 80,46 90,42 96,54 92,68 98,82" fill="${R.stone}"/>` +
    `<polygon points="80,46 90,42 96,54 86,58" fill="${R.skyLow}"/>` +
    `<polygon points="86,58 96,54 92,68 98,82 88,82" fill="${R.stoneShade}"/>`,
  overlay: (t) =>
    photo(t, {
      x: 112,
      y: 30,
      w: 40,
      h: 46,
      rot: 3,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#f7f1e1", 4)}"/>` +
        `<path d="M22 40L20 26L26 10L34 8L38 18L35 28L40 40Z" fill="none" stroke="${a(t, "#5a5048", 0)}" stroke-width="1.6"/>` +
        `<path d="M26 10L34 8L38 18L31 21Z" fill="${a(t, "#d8cdb5", 3)}"/>`,
    }) +
    anchor(132, 86, 12) +
    stalk(132, 76, 86) +
    card(t, {
      x: 156,
      y: 30,
      w: 46,
      title: "First sketch",
      size: 6.4,
      lines: 2,
    }),
};

const beforeItIsBuilt: UseCase = {
  id: "before-it-is-built",
  title: "Before it is built",
  sentence:
    "Neighbours with a plan put a drawing of the new playground on the empty plot, so everyone can judge it standing right where it will go.",
  alt: "Through the phone: an empty plot behind a low fence, and on it a drawing of the planned playground with a slide and swings.",
  scene:
    land(54) +
    house(8, 54, 30, 18) +
    house(160, 54, 26, 16) +
    `<polygon points="0,62 210,62 210,100 0,100" fill="${R.groundLight}"/>` +
    `<path d="M0 86H210M0 80H210" stroke="${R.wood}" stroke-width="1.4"/>` +
    `<path d="M10 76V92M40 76V92M70 76V92M100 76V92M130 76V92M160 76V92M190 76V92" stroke="${R.wood}" stroke-width="2"/>`,
  overlay: (t) =>
    `<rect x="52" y="34" width="20" height="4" fill="${a(t, "#3d7fb8", 1)}"/>` +
    `<path d="M54 38V72M70 38V72" stroke="${a(t, "#3d7fb8", 0)}" stroke-width="2.4"/>` +
    `<path d="M57 46H67M57 54H67M57 62H67" stroke="${a(t, "#3d7fb8", 0)}" stroke-width="1.4"/>` +
    `<path d="M72 38L106 70" stroke="${a(t, "#f2b134", 2)}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M120 72L130 34H162L172 72M130 34H162" fill="none" stroke="${a(t, "#d24b3a", 1)}" stroke-width="2.4"/>` +
    `<path d="M138 34V58M154 34V58" stroke="${a(t, "#5a5048", 0)}" stroke-width="0.9"/>` +
    `<rect x="133" y="58" width="10" height="2.6" fill="${a(t, "#f2b134", 2)}"/>` +
    `<rect x="149" y="58" width="10" height="2.6" fill="${a(t, "#f2b134", 2)}"/>` +
    card(t, { x: 84, y: 8, w: 70, title: "The new playground", size: 7 }),
};

const walkAsGift: UseCase = {
  id: "walk-as-gift",
  title: "A walk as a gift",
  sentence:
    "For someone you have shared years with, you make a walk to the places of your story, each with a photo from then, starting at the bench where you met.",
  alt: "Through the phone: a park bench beside a lamp post, and above the bench an old photo of two people with a small heart.",
  scene:
    land(56) +
    tree(176, 80, 15) +
    `<polygon points="0,100 40,56 60,56 50,100" fill="${R.path}"/>` +
    `<rect x="66" y="26" width="2.6" height="50" fill="${R.ink}"/>` +
    `<polygon points="62,26 72,26 70,20 64,20" fill="${R.ink}"/>` +
    bench(82, 70, 46),
  overlay: (t) =>
    stalk(105, 50, 64) +
    anchor(105, 82, 18) +
    photo(t, {
      x: 82,
      y: 8,
      w: 46,
      h: 40,
      rot: -4,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#d9c9a6", 4)}"/>` +
        `<rect y="30" width="60" height="14" fill="${a(t, "#c2ad86", 3)}"/>` +
        `<circle cx="20" cy="15" r="4.2" fill="${a(t, "#7a6248", 0)}"/>` +
        `<circle cx="40" cy="13" r="4.2" fill="${a(t, "#7a6248", 0)}"/>` +
        `<path d="M13 40V27Q13 21 20 21Q27 21 27 27V40ZM33 40V25Q33 19 40 19Q47 19 47 25V40Z" fill="${a(t, "#8f7658", 1)}"/>`,
    }) +
    `<path d="M136 16c0-4 6-4 6 0c0-4 6-4 6 0c0 4-6 8-6 9c0-1-6-5-6-9Z" fill="${a(t, "#e0455a", 1)}"/>`,
};

const oldRailway: UseCase = {
  id: "old-railway",
  title: "Where the old railway ran",
  sentence:
    "A local history group follows the path where the tracks once lay, and at each spot the station and its train appear in photos from back then.",
  alt: "Through the phone: a straight path through the fields where the tracks once were, and above it an old photo of a steam train at the station.",
  scene:
    land(50) +
    hills(46) +
    `<polygon points="0,62 210,56 210,100 0,100" fill="${R.groundDark}"/>` +
    `<polygon points="98,50 112,50 156,100 54,100" fill="${R.path}"/>` +
    `<polygon points="0,58 98,50 54,100 0,100" fill="${R.leafLight}"/>` +
    tree(26, 64, 7) +
    tree(186, 62, 8),
  overlay: (t) =>
    stalk(105, 52, 70) +
    anchor(105, 78, 18) +
    photo(t, {
      x: 66,
      y: 6,
      w: 78,
      h: 48,
      rot: 2,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#ddcfae", 4)}"/>` +
        `<rect y="34" width="60" height="10" fill="${a(t, "#bba580", 3)}"/>` +
        `<rect x="10" y="20" width="26" height="12" fill="${a(t, "#5c4a34", 0)}"/>` +
        `<rect x="30" y="12" width="8" height="10" fill="${a(t, "#5c4a34", 0)}"/>` +
        `<rect x="14" y="14" width="4" height="7" fill="${a(t, "#5c4a34", 0)}"/>` +
        `<circle cx="16" cy="34" r="4" fill="${a(t, "#3e3224", 1)}"/>` +
        `<circle cx="30" cy="34" r="4" fill="${a(t, "#3e3224", 1)}"/>` +
        `<path d="M16 12c-6-4-2-10 4-8" stroke="${a(t, "#f3ead6", 3)}" stroke-width="3" fill="none"/>` +
        `<rect x="44" y="16" width="12" height="18" fill="${a(t, "#8f7658", 2)}"/>`,
    }),
};

const horizonNames: UseCase = {
  id: "horizon-names",
  title: "The names on the horizon",
  sentence:
    "A hiking club labels the view from the lookout, so each far hill and village carries its name, right where it rises.",
  alt: "Through the phone: a wide view of hills from a lookout with a wooden railing, and name labels standing over the hilltops.",
  scene:
    `<rect width="210" height="100" fill="${R.sky}"/>` +
    `<polygon points="0,60 30,48 64,56 100,40 140,54 176,44 210,52 210,100 0,100" fill="${R.farShade}"/>` +
    `<polygon points="0,70 44,60 90,66 130,58 170,64 210,60 210,100 0,100" fill="${R.far}"/>` +
    `<rect x="150" y="60" width="4" height="4" fill="${R.window}"/><rect x="156" y="61" width="3" height="3" fill="${R.window}"/><rect x="161" y="59" width="4" height="5" fill="${R.window}"/>` +
    `<polygon points="0,80 210,76 210,100 0,100" fill="${R.groundDark}"/>` +
    `<path d="M0 82H210M0 90H210" stroke="${R.wood}" stroke-width="2"/>` +
    `<path d="M20 80V100M80 79V100M140 78V100M200 77V100" stroke="${R.wood}" stroke-width="3"/>`,
  overlay: (t) =>
    stalk(100, 26, 40) +
    stalk(176, 30, 44) +
    stalk(158, 46, 58) +
    stalk(30, 34, 48) +
    card(t, { x: 78, y: 12, w: 44, title: "High moor", size: 6.6 }) +
    card(t, { x: 154, y: 16, w: 46, title: "Twin hills", size: 6.6 }) +
    card(t, { x: 10, y: 20, w: 40, title: "Long ridge", size: 6.6 }) +
    card(t, { x: 136, y: 32, w: 44, title: "The village", size: 6.6 }),
};

const marshBirds: UseCase = {
  id: "marsh-birds",
  title: "Birds of the marsh",
  sentence:
    "Nature volunteers put a drawing of the bird that nests in the reeds in front of each hide, with when to look for it.",
  alt: "Through the phone: tall reeds at the edge of a marsh beside a wooden hide, and above the reeds a drawing of a heron with its name.",
  scene:
    land(46) +
    `<rect y="46" width="210" height="20" fill="${R.water}"/>` +
    `<path d="M0 52H210" stroke="${R.waterLight}" stroke-width="2"/>` +
    `<polygon points="0,62 210,60 210,100 0,100" fill="${R.leafLight}"/>` +
    `<path d="M60 92l-4-34M66 94l0-38M72 92l4-36M78 94l-2-30M84 92l3-34M120 92l-3-34M126 94l1-36M132 92l4-32M138 94l-1-36M144 92l3-30" stroke="${R.leafDark}" stroke-width="1.6" fill="none"/>` +
    `<polygon points="4,90 4,64 34,64 34,90" fill="${R.wood}"/>` +
    `<polygon points="0,66 19,54 38,66" fill="${R.roofShade}"/>` +
    `<rect x="10" y="72" width="18" height="4" fill="${R.ink}"/>`,
  overlay: (t) =>
    photo(t, {
      x: 82,
      y: 8,
      w: 50,
      h: 40,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#e6eef0", 4)}"/>` +
        `<path d="M24 38V28M30 38V28" stroke="${a(t, "#4a5560", 0)}" stroke-width="1.4"/>` +
        `<path d="M18 28C18 18 34 16 40 24C34 30 24 30 18 28Z" fill="${a(t, "#8c9aa6", 2)}"/>` +
        `<path d="M38 22C38 14 40 10 44 8" stroke="${a(t, "#8c9aa6", 2)}" stroke-width="3" fill="none"/>` +
        `<path d="M44 8L54 9L45 10Z" fill="${a(t, "#e0a030", 1)}"/>`,
    }) +
    stalk(107, 48, 60) +
    card(t, {
      x: 140,
      y: 14,
      w: 60,
      title: "Grey heron",
      text: "best seen in spring",
      size: 7,
    }),
};

const streetBackThen: UseCase = {
  id: "street-back-then",
  title: "Our street, back then",
  sentence:
    "The families of one street gather their old photos, and each appears in front of the house where it was taken.",
  alt: "Through the phone: a row of houses on a quiet street, and in front of one door an old photo of the neighbours who lived there.",
  scene:
    `<rect width="210" height="100" fill="${R.sky}"/>` +
    house(4, 80, 44, 40) +
    house(76, 80, 44, 40) +
    house(148, 80, 40, 38) +
    `<rect y="80" width="210" height="20" fill="${R.groundLight}"/>` +
    `<path d="M0 88H210" stroke="${R.stone}" stroke-width="1.4"/>`,
  overlay: (t) =>
    photo(t, {
      x: 78,
      y: 34,
      w: 52,
      h: 40,
      rot: -3,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#d9c9a6", 4)}"/>` +
        `<rect y="30" width="60" height="14" fill="${a(t, "#bba580", 3)}"/>` +
        `<circle cx="14" cy="16" r="4" fill="${a(t, "#6a5639", 0)}"/><path d="M8 34C8 24 20 24 20 34Z" fill="${a(t, "#7a6248", 1)}"/>` +
        `<circle cx="30" cy="14" r="4.4" fill="${a(t, "#6a5639", 0)}"/><path d="M23 34C23 22 37 22 37 34Z" fill="${a(t, "#7a6248", 1)}"/>` +
        `<circle cx="46" cy="18" r="3.4" fill="${a(t, "#6a5639", 0)}"/><path d="M41 34C41 26 51 26 51 34Z" fill="${a(t, "#7a6248", 1)}"/>`,
    }) + card(t, { x: 132, y: 22, w: 46, title: "Here, 1952", size: 6.6 }),
};

const gardenYear: UseCase = {
  id: "garden-year",
  title: "The garden through the year",
  sentence:
    "A gardener photographs each bed in every season, so a winter visitor sees the summer roses in full bloom above the bare earth.",
  alt: "Through the phone: a bare flower bed in winter beside a hedge, and above it a photo of the same bed full of roses in summer.",
  scene:
    land(50) +
    `<rect y="34" width="210" height="18" fill="${R.leafShade}"/>` +
    `<path d="M0 34q8-5 16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0" fill="${R.leaf}"/>` +
    `<ellipse cx="104" cy="80" rx="62" ry="12" fill="${R.trunk}"/>` +
    `<path d="M70 80l-2-10M84 82l1-12M98 80l-1-11M112 82l2-12M126 80l0-11M140 82l2-10" stroke="${R.ink}" stroke-width="1.2" fill="none"/>` +
    `<polygon points="0,100 30,62 44,62 30,100" fill="${R.path}"/>`,
  overlay: (t) =>
    stalk(104, 50, 70) +
    photo(t, {
      x: 74,
      y: 8,
      w: 60,
      h: 42,
      rot: 2,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#9cc27a", 3)}"/>` +
        `<rect y="30" width="60" height="14" fill="${a(t, "#6f9a4a", 2)}"/>` +
        `<circle cx="12" cy="22" r="5" fill="${a(t, "#d8344a", 1)}"/><circle cx="26" cy="16" r="5.5" fill="${a(t, "#e8607a", 0)}"/>` +
        `<circle cx="40" cy="24" r="5" fill="${a(t, "#d8344a", 1)}"/><circle cx="52" cy="14" r="4.5" fill="${a(t, "#e8607a", 0)}"/>` +
        `<circle cx="20" cy="32" r="4" fill="${a(t, "#e8607a", 0)}"/><circle cx="46" cy="34" r="4" fill="${a(t, "#d8344a", 1)}"/>`,
    }) +
    card(t, { x: 142, y: 14, w: 58, title: "In summer", size: 7 }),
};

const bridgeLegend: UseCase = {
  id: "bridge-legend",
  title: "A legend, told where it happened",
  sentence:
    "A storyteller tells an old tale in six places, and at the stone bridge a drawing shows what the tale says happened right there.",
  alt: "Through the phone: an old stone bridge over a stream between trees, and above the bridge a drawing of the dragon from the tale.",
  scene:
    land(52) +
    tree(18, 66, 12) +
    tree(192, 64, 11) +
    `<polygon points="70,100 90,62 120,62 140,100" fill="${R.water}"/>` +
    `<path d="M40 66H170V72H40Z" fill="${R.stone}"/>` +
    `<path d="M40 72H170V86H150C150 74 130 72 105 72C80 72 60 74 60 86H40Z" fill="${R.stoneShade}"/>` +
    `<path d="M40 64H170" stroke="${R.stoneShade}" stroke-width="2"/>`,
  overlay: (t) =>
    `<path d="M70 44C80 34 100 34 112 40C122 44 134 44 142 36L150 38L142 44C134 52 118 52 108 48C98 46 86 50 78 54Z" fill="${a(t, "#5f8a4a", 1)}"/>` +
    `<path d="M94 38L102 14L112 38Z" fill="${a(t, "#7fa05a", 2)}"/>` +
    `<path d="M104 38L118 18L122 40Z" fill="${a(t, "#5f8a4a", 0)}"/>` +
    `<path d="M70 44C62 46 58 52 52 50" stroke="${a(t, "#5f8a4a", 1)}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<circle cx="144" cy="38" r="1.2" fill="${a(t, "#fffaf0", 4)}"/>` +
    card(t, { x: 150, y: 10, w: 52, title: "Here it slept", size: 6.6 }),
};

const farmOpenDay: UseCase = {
  id: "farm-open-day",
  title: "An open day on the farm",
  sentence:
    "A farming family puts a card at the edge of each field saying what grows there and when, with a photo of last year's harvest.",
  alt: "Through the phone: striped fields and a barn, and at the edge of a field a card and a photo of the harvest.",
  scene:
    `<rect width="210" height="46" fill="${R.sky}"/>` +
    `<polygon points="150,46 150,30 166,22 182,30 182,46" fill="${R.wall}"/>` +
    `<polygon points="182,46 182,30 200,32 200,46" fill="${R.wallShade}"/>` +
    `<polygon points="0,44 210,44 210,58 0,62" fill="${R.leafShade}"/>` +
    `<polygon points="0,62 210,58 210,72 0,80" fill="${R.groundLight}"/>` +
    `<polygon points="0,80 210,72 210,86 0,100" fill="${R.trunk}"/>` +
    `<polygon points="0,100 210,86 210,100" fill="${R.leafShade}"/>` +
    `<path d="M0 70l210-12M0 90l210-18" stroke="${R.stone}" stroke-width="1"/>` +
    `<path d="M11 58v18M41 56v18M71 54v18M0 63H76" stroke="${R.wood}" stroke-width="2.4"/>`,
  overlay: (t) =>
    card(t, {
      x: 80,
      y: 12,
      w: 98,
      title: "Potatoes grow here",
      text: "dug up in autumn",
    }) +
    photo(t, {
      x: 22,
      y: 8,
      w: 40,
      h: 34,
      rot: -5,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#b59f7e", 3)}"/>` +
        `<circle cx="18" cy="26" r="7" fill="${a(t, "#e2b56f", 1)}"/><circle cx="32" cy="20" r="7.5" fill="${a(t, "#d9a85e", 2)}"/>` +
        `<circle cx="44" cy="28" r="6.5" fill="${a(t, "#e2b56f", 1)}"/><circle cx="28" cy="34" r="6" fill="${a(t, "#d9a85e", 2)}"/>`,
    }),
};

const schoolWelcome: UseCase = {
  id: "school-welcome",
  title: "A welcome walk around the school",
  sentence:
    "A school guides new pupils and their parents across the grounds before the first day, with signs to the canteen, the sports hall and the bus stop.",
  alt: "Through the phone: a school building and its yard, with signs floating in the yard that point to the canteen and the sports hall.",
  scene:
    `<rect width="210" height="62" fill="${R.sky}"/>` +
    `<polygon points="20,64 20,22 130,22 130,64" fill="${R.wall}"/>` +
    `<polygon points="130,22 176,28 176,64 130,64" fill="${R.wallShade}"/>` +
    `<polygon points="16,22 66,8 134,22" fill="${R.roofShade}"/>` +
    `<path d="M30 30h12v10H30ZM52 30h12v10H52ZM74 30h12v10H74ZM96 30h12v10H96ZM30 46h12v10H30ZM96 46h12v10H96Z" fill="${R.window}"/>` +
    `<rect x="58" y="46" width="22" height="18" fill="${R.door}"/>` +
    `<rect y="62" width="210" height="38" fill="${R.groundLight}"/>` +
    `<polygon points="0,62 60,62 0,84" fill="${R.stone}"/>`,
  overlay: (t) => {
    const sign = (x: number, y: number, w: number, label: string) =>
      card(t, { x, y, w, title: label, size: 7 }) +
      `<circle cx="${x + w - 7}" cy="${y + 7.5}" r="4" fill="${a(t, "#2f7a5a", 1)}"/>` +
      `<path d="M${x + w - 9} ${y + 7.5}h4M${x + w - 6.4} ${y + 5.6}l1.9 1.9l-1.9 1.9" stroke="#ffffff" stroke-width="1" fill="none" stroke-linecap="round"/>`;
    return (
      sign(58, 72, 52, "Canteen") +
      sign(134, 38, 62, "Sports hall") +
      anchor(84, 94, 14)
    );
  },
};

const trainingLoop: UseCase = {
  id: "training-loop",
  title: "The club's training loop",
  sentence:
    "A running club's coach puts the next exercise beside each post on the forest loop, drawn, with how many to do.",
  alt: "Through the phone: a forest path with a wooden marker post, and beside the post a drawing of a lunge with how many to do.",
  scene:
    `<rect width="210" height="100" fill="${R.sky}"/>` +
    conifer(14, 70, 54) +
    conifer(40, 66, 40) +
    conifer(178, 70, 52) +
    conifer(200, 64, 38) +
    conifer(150, 60, 28) +
    `<rect y="64" width="210" height="36" fill="${R.groundDark}"/>` +
    `<polygon points="90,64 116,64 168,100 40,100" fill="${R.path}"/>` +
    `<rect x="66" y="58" width="5" height="30" fill="${R.wood}"/>` +
    `<rect x="66" y="60" width="5" height="4" fill="${R.ink}"/>`,
  overlay: (t) =>
    photo(t, {
      x: 82,
      y: 14,
      w: 42,
      h: 44,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#f7f1e1", 4)}"/>` +
        `<circle cx="30" cy="8" r="4" fill="${a(t, "#2f6fa8", 1)}"/>` +
        `<path d="M30 12V24L18 30V40M30 24L42 32L44 40M30 16L20 22M30 16L40 20" stroke="${a(t, "#2f6fa8", 1)}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    }) +
    card(t, {
      x: 128,
      y: 20,
      w: 62,
      title: "Lunges",
      text: "ten on each leg",
      size: 7,
    }) +
    stalk(103, 58, 82) +
    anchor(103, 86, 12),
};

const floodLine: UseCase = {
  id: "flood-line",
  title: "Where the water reached",
  sentence:
    "A local history group marks how high the great flood rose, and on each house the water line appears with a photo from that day.",
  alt: "Through the phone: a street of houses, with a line across their walls at the height the flood water reached, and a photo from that day.",
  scene:
    `<rect width="210" height="100" fill="${R.sky}"/>` +
    house(6, 86, 56, 50) +
    house(110, 86, 54, 48) +
    `<rect y="86" width="210" height="14" fill="${R.groundLight}"/>`,
  overlay: (t) =>
    `<path d="M0 66H210" stroke="${a(t, "#2f6fa8", 1)}" stroke-width="1.8"/>` +
    `<path d="M0 69q5-3 10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0" stroke="${a(t, "#5a9ad0", 2)}" stroke-width="1" fill="none"/>` +
    card(t, { x: 66, y: 50, w: 40, title: "Water, here", size: 6 }) +
    photo(t, {
      x: 170,
      y: 26,
      w: 34,
      h: 28,
      rot: 3,
      inner:
        `<rect width="60" height="44" fill="${a(t, "#d9cba9", 4)}"/>` +
        `<rect y="24" width="60" height="20" fill="${a(t, "#8fa6b0", 3)}"/>` +
        `<rect x="8" y="8" width="20" height="18" fill="${a(t, "#8f7958", 2)}"/>` +
        `<rect x="34" y="12" width="18" height="14" fill="${a(t, "#8f7958", 2)}"/>`,
    }),
};

const ghostWalk: UseCase = {
  id: "ghost-walk",
  title: "A ghost walk at dusk",
  sentence:
    "A youth club makes a spooky walk for the autumn fair, and in the dark window of the old barn a friendly ghost looks out at each visitor.",
  alt: "Through the phone: a barn at dusk with one dark window, and a friendly ghost looking out of the window.",
  scene:
    `<rect width="210" height="100" fill="#a9acb2"/>` +
    `<rect y="70" width="210" height="30" fill="#9c9b93"/>` +
    `<polygon points="50,74 50,36 100,14 150,36 150,74" fill="#8f8c87"/>` +
    `<polygon points="150,74 150,36 178,40 178,74" fill="#85827d"/>` +
    `<polygon points="44,38 100,10 156,38 152,40 100,16 48,40" fill="#7c7975"/>` +
    `<rect x="86" y="34" width="28" height="24" fill="#6f6d6a"/>` +
    `<rect x="62" y="52" width="16" height="22" fill="#77746f"/>` +
    conifer(20, 76, 36) +
    conifer(196, 76, 30),
  overlay: (t) =>
    `<path d="M90 60C90 40 92 30 100 30C108 30 110 40 110 60L106 56L102 60L98 56L94 60Z" fill="${a(t, "#ffffff", 4)}"/>` +
    `<circle cx="97" cy="40" r="1.6" fill="${a(t, "#2a2824", 0)}"/>` +
    `<circle cx="103" cy="40" r="1.6" fill="${a(t, "#2a2824", 0)}"/>` +
    `<ellipse cx="100" cy="46" rx="2" ry="1.4" fill="${a(t, "#2a2824", 0)}"/>` +
    card(t, { x: 120, y: 12, w: 62, title: "Boo, welcome!", size: 7 }),
};

/**
 * The examples in page order. The first four are required by name (and
 * the first six show before "More ideas"); the rest are ordered for
 * variety of maker and look.
 */
export const USE_CASES: readonly UseCase[] = [
  castleTower,
  birthdayHunt,
  shopWindows,
  indoorExhibition,
  pondLife,
  riverPoem,
  sculpturePath,
  beforeItIsBuilt,
  walkAsGift,
  oldRailway,
  horizonNames,
  marshBirds,
  streetBackThen,
  gardenYear,
  bridgeLegend,
  farmOpenDay,
  schoolWelcome,
  trainingLoop,
  floodLine,
  ghostWalk,
];
