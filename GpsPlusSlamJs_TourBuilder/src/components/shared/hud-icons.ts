/**
 * The five HUD control icons (plan 2026-09-20-hud-icon-buttons). Hand-authored
 * 24px stroke icons, `currentColor`-driven — same conventions as `icons.ts`,
 * but at HUD size. Judge them by eye in the desktop preview and adjust paths
 * freely; nothing depends on the exact geometry.
 */
const OPEN =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';

export const HUD_ICONS = {
  map: `${OPEN}<path d="M9 4 L3 6.5 V20 L9 17.5 L15 20 L21 17.5 V4 L15 6.5 Z"/><path d="M9 4 V17.5 M15 6.5 V20"/></svg>`,
  walk: `${OPEN}<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21 L11.5 15 L9 12.5 L11 8.5 L14.5 10 L16.5 13"/><path d="M11.5 15 L14 18 L14 21"/></svg>`,
  wayfinding: `${OPEN}<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5 L13.5 13.5 L8.5 15.5 L10.5 10.5 Z"/></svg>`,
  buildings: `${OPEN}<rect x="5" y="3" width="8" height="18" rx="1"/><rect x="13" y="9" width="6" height="12" rx="1"/><path d="M8 7 H10 M8 11 H10 M8 15 H10 M15.5 13 H16.5 M15.5 17 H16.5"/></svg>`,
  exit: `${OPEN}<path d="M10 4 H5 V20 H10"/><path d="M14 8 L18 12 L14 16 M18 12 H9"/></svg>`,
} as const;
